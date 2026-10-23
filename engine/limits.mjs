import { CONFIG } from './config.mjs';
import { fillAmounts, roundTripFraction } from './costs.mjs';
import { pendingDecisions, settledCash } from './ledger.mjs';
import { barOnOrBefore, etfWeightFor, fxOnOrBefore } from './valuation.mjs';
import { assert, isoWeek, ticksToNumber } from './util.mjs';

const isEtf = (i) => i.key === CONFIG.etf.key;

/** Number of active-book trades (filled or pending, not expired) whose session falls in the ISO week of `session`. */
export function tradesInWeek(B, session) {
  const wk = isoWeek(session);
  return [...B.decisions.values()].filter(d => d.status !== 'expired' && isoWeek(d.event.targetSession) === wk).length;
}

/** Cash already committed to pending purchases, estimated at their ceilings. */
export function pendingBuyCommitments(B, fxRate) {
  return pendingDecisions(B).filter(d => d.side === 'BUY').reduce((s, d) => {
    const rate = d.instrument.currency === 'EUR' ? undefined : fxRate;
    const a = fillAmounts({ side: 'BUY', kind: d.instrument.kind, currency: d.instrument.currency, ticks: Math.round(Number(d.qty) * 10000), close: d.ceiling, fx: rate });
    return s - a.cashEurCents;
  }, 0);
}

function directSums(valuation, field) {
  const m = {};
  for (const p of valuation.positions) if (p.instrument.kind === 'stock') m[p.instrument[field]] = (m[p.instrument[field]] || 0) + p.valueCents;
  return m;
}

/**
 * Checks a proposed BUY decision for the active book against rules v1.1.
 * ctx: { B (active book state), valuation (active, last close), asOf, targetSession, bars, fx, etfWeights, weeklyReviewCurrent }
 * p:   { instrument, ticks, ceiling, startType ('confirmed'|'anticipated'|'parking'), exception, caseInfo, fundingFromEtf, launch }
 * caseInfo (stocks): { verdict, reviewer, reviewedAt, validUntil, type, base91, bear91, bull91, etfBase91, entryCeiling } (fractions, not %)
 */
export function checkBuy(ctx, p) {
  const reasons = [];
  const no = (code, detail = '') => reasons.push(detail ? `${code}: ${detail}` : code);
  const { B, valuation, targetSession } = ctx;
  const i = p.instrument;
  const nav = valuation.navCents;
  assert(nav > 0, 'NAV_UNKNOWN');
  if (B.paused) no('DRAWDOWN_PAUSE', '15% pause active; restart needs Charles');
  if (!Number.isSafeInteger(p.ticks) || p.ticks <= 0) { no('BAD_QUANTITY'); return { ok: false, reasons }; }
  if (!i.fractional && p.ticks % 10000 !== 0) no('FRACTION_NOT_ALLOWED', `${i.symbol} is whole shares only`);
  if (!(Number.isFinite(p.ceiling) && p.ceiling > 0)) no('CEILING_MISSING');
  if (pendingDecisions(B).some(d => d.instrument.key === i.key)) no('PENDING_DECISION_EXISTS', i.symbol);

  const fxR = i.currency === 'EUR' ? undefined : fxOnOrBefore(ctx.fx, i.currency, ctx.asOf).rate;
  const rate = fxR ?? 1;
  const bar = barOnOrBefore(ctx.bars[i.key], ctx.asOf);
  if (!bar) no('PRICE_MISSING', i.symbol);
  if (bar && p.ceiling < bar.close * 0.5) no('CEILING_IMPLAUSIBLE');

  // Cash: settled cash minus pending commitments minus this purchase at its ceiling must stay above the 5% floor.
  const cost = fillAmounts({ side: 'BUY', kind: i.kind, currency: i.currency, ticks: p.ticks, close: p.ceiling, fx: fxR });
  const usdNow = Object.keys(ctx.fx || {}).length ? fxOnOrBefore(ctx.fx, 'USD', ctx.asOf).rate : undefined;
  const available = settledCash(B, ctx.asOf) - pendingBuyCommitments(B, usdNow);
  const floor = Math.ceil(CONFIG.cashFloorFraction * nav);
  if (available + cost.cashEurCents < floor) no('CASH_FLOOR', `needs ${-cost.cashEurCents} cents, available ${available}, floor ${floor}`);

  if (tradesInWeek(B, targetSession) >= CONFIG.maxTradesPerWeek) no('WEEKLY_TRADE_LIMIT', `${CONFIG.maxTradesPerWeek} trades already in ${targetSession}'s week`);
  if (bar) {
    if (!Number.isFinite(bar.volume)) no('VOLUME_UNKNOWN', i.symbol);
    else if (ticksToNumber(p.ticks) > CONFIG.volumeParticipation * bar.volume) no('VOLUME_LIMIT', `max ${Math.floor(CONFIG.volumeParticipation * bar.volume)} shares`);
  }

  if (isEtf(i)) {
    if (!p.launch && -cost.cashEurCents < CONFIG.reparkThresholdCents) no('PARK_BELOW_300', 'idle cash is parked only in amounts above €300');
    return { ok: reasons.length === 0, reasons, costCents: -cost.cashEurCents };
  }

  assert(i.kind === 'stock', 'BAD_KIND', i.kind);
  // Research case (s.6)
  const c = p.caseInfo || {};
  if (c.verdict !== 'BUY') no('CASE_NOT_BUY', String(c.verdict));
  if (c.reviewer !== 'Pass') no('CASE_NOT_REVIEWED', 'independent review must pass first');
  if (!(typeof c.validUntil === 'string' && c.validUntil >= targetSession)) no('CASE_EXPIRED');
  const wantType = p.startType === 'confirmed' ? 'Confirmed change' : p.startType === 'anticipated' ? 'Anticipated change' : null;
  if (!wantType || c.type !== wantType) no('CASE_TYPE_MISMATCH', `${c.type} vs ${p.startType}`);
  if (!(Number.isFinite(c.base91) && c.base91 > 0)) no('BASE_NOT_POSITIVE');
  if (Number.isFinite(c.entryCeiling) && p.ceiling > c.entryCeiling + 1e-9) no('CEILING_ABOVE_CASE', `${p.ceiling} > ${c.entryCeiling}`);
  if (!Number.isFinite(c.entryCeiling)) no('CASE_CEILING_MISSING');
  const etfBar = barOnOrBefore(ctx.bars[CONFIG.etf.key], ctx.asOf);
  const route = roundTripFraction({ kind: 'stock', currency: i.currency, ticks: p.ticks, price: p.ceiling, fx: fxR, withEtfLegs: Boolean(p.fundingFromEtf), etfPrice: etfBar?.close });
  const netExcess = (c.base91 ?? NaN) - (c.etfBase91 ?? NaN) - route;
  if (!(netExcess >= CONFIG.minNetExcess - 1e-12)) no('NET_EXCESS_BELOW_3PP', `net excess ${(netExcess * 100).toFixed(2)} pp after ${(route * 100).toFixed(2)}% route costs`);
  if (!ctx.weeklyReviewCurrent) no('WEEKLY_REVIEW_OVERDUE');

  // Size and concentration (s.4, s.5), valued at the ceiling (worst permitted fill)
  const existing = valuation.positions.find(x => x.key === i.key);
  const held = B.positions.get(i.key);
  const addValue = ticksToNumber(p.ticks) * p.ceiling / rate * 100;
  const valueAfter = (existing?.valueCents || 0) + addValue;
  const startLimit = p.startType === 'anticipated' ? CONFIG.startAnticipated : CONFIG.startConfirmed;
  if (held) {
    if (held.exception) no('EXCEPTION_NO_ADD', 'a whole-share exception position is never added to');
    if (p.exception) no('EXCEPTION_NOT_FOR_INCREASE');
    if (!(typeof c.reviewedAt === 'string' && c.reviewedAt > held.lastBuy)) no('INCREASE_NEEDS_NEW_REVIEW');
  }
  let cap = CONFIG.companyCap;
  if (p.exception) {
    cap = CONFIG.exceptionMax;
    if (i.fractional) no('EXCEPTION_NOT_NEEDED', 'fractional shares available');
    if (p.ticks !== 10000) no('EXCEPTION_ONE_SHARE_ONLY');
    if (p.startType !== 'confirmed') no('EXCEPTION_CONFIRMED_ONLY');
    if (addValue / nav <= startLimit) no('EXCEPTION_NOT_NEEDED', 'one share fits the normal starting size');
    if (addValue / nav > CONFIG.exceptionMax + 1e-12) no('EXCEPTION_ABOVE_25PCT');
    if ([...B.positions.values()].some(x => x.exception)) no('EXCEPTION_ALREADY_OPEN');
  } else if (!held && addValue / nav > startLimit + 1e-12) {
    no('START_SIZE_EXCEEDED', `${(addValue / nav * 100).toFixed(2)}% > ${(startLimit * 100).toFixed(1)}%`);
  }
  const etfValue = valuation.positions.filter(x => x.instrument.kind === 'etf').reduce((s, x) => s + x.valueCents, 0);
  const companyExp = (valueAfter + etfValue * etfWeightFor(i.issuerId, ctx.etfWeights || {})) / nav + CONFIG.lookThroughBuffer;
  if (companyExp > cap + 1e-12) no('COMPANY_CAP', `${(companyExp * 100).toFixed(2)}% > ${(cap * 100).toFixed(0)}%`);
  for (const [field, limit, code] of [['sector', CONFIG.sectorCap, 'SECTOR_CAP'], ['country', CONFIG.countryCap, 'COUNTRY_CAP'], ['eventGroup', CONFIG.eventCap, 'EVENT_CAP']]) {
    const after = ((directSums(valuation, field)[i[field]] || 0) + addValue) / nav;
    if (after > limit + 1e-12) no(code, `${i[field]} ${(after * 100).toFixed(2)}% > ${(limit * 100).toFixed(0)}%`);
  }
  return { ok: reasons.length === 0, reasons, costCents: -cost.cashEurCents, netExcess, routeCost: route, companyExposure: companyExp };
}

/** Checks a SELL decision: no shorts, whole shares where required, weekly limit. */
export function checkSell(ctx, p) {
  const reasons = [];
  const { B, targetSession } = ctx;
  const held = B.positions.get(p.instrument.key);
  const pendingSells = pendingDecisions(B).filter(d => d.side === 'SELL' && d.instrument.key === p.instrument.key)
    .reduce((s, d) => s + Math.round(Number(d.qty) * 10000), 0);
  if (!held) reasons.push('NOT_HELD');
  else if (p.ticks > held.ticks - pendingSells) reasons.push('NO_SHORTS');
  if (!p.instrument.fractional && p.ticks % 10000 !== 0 && !(held && p.ticks === held.ticks)) reasons.push('FRACTION_NOT_ALLOWED');
  if (tradesInWeek(B, targetSession) >= CONFIG.maxTradesPerWeek) reasons.push('WEEKLY_TRADE_LIMIT');
  if (B.positions.size && pendingDecisions(B).some(d => d.instrument.key === p.instrument.key && d.side === 'BUY')) reasons.push('PENDING_BUY_EXISTS');
  return { ok: reasons.length === 0, reasons, heldTicks: held?.ticks ?? 0 };
}

/** Largest quantity that passes every size, concentration, cash and volume rule (ignores case checks). */
export function sizeBuy(ctx, p) {
  const step = p.instrument.fractional ? 1 : 10000;
  const sizeOnly = (r) => r.reasons.every(x => /^(CASE_|BASE_|NET_EXCESS|WEEKLY_REVIEW|CEILING_ABOVE_CASE|PENDING_DECISION|WEEKLY_TRADE|DRAWDOWN)/.test(x));
  const ok = (t) => sizeOnly(checkBuy(ctx, { ...p, ticks: t, launch: true }));
  const navEur = ctx.valuation.navCents / 100;
  const rate = p.instrument.currency === 'EUR' ? 1 : fxOnOrBefore(ctx.fx, p.instrument.currency, ctx.asOf).rate;
  let hi = Math.max(step, Math.floor(navEur * 0.3 * rate / p.ceiling * 10000 / step) * step);
  let lo = 0;
  if (!ok(step)) return { ticks: 0, binding: checkBuy(ctx, { ...p, ticks: step, launch: true }).reasons };
  lo = step;
  while (hi - lo > step) { const mid = Math.floor((lo + hi) / 2 / step) * step; if (mid <= lo) break; if (ok(mid)) lo = mid; else hi = mid; }
  if (ok(hi)) lo = hi;
  const next = checkBuy(ctx, { ...p, ticks: lo + step, launch: true }).reasons.filter(x => !/^(CASE_|BASE_|NET_EXCESS|WEEKLY_REVIEW|CEILING_ABOVE_CASE)/.test(x));
  return { ticks: lo, binding: next };
}
