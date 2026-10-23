import { CONFIG } from './config.mjs';
import { targetSession } from './fills.mjs';
import { replay } from './ledger.mjs';
import { checkBuy, checkSell, sizeBuy } from './limits.mjs';
import { valueBook } from './valuation.mjs';
import { assert, qtyToTicks, ticksToQty } from './util.mjs';

const CODE = { active: 'A', passive: 'P', noselection: 'N' };

function context(input, book = 'active', venue) {
  const st = replay(input.events);
  const B = st.books[book];
  const valuation = valueBook(B, { asOf: input.asOf, bars: input.bars, fx: input.fx, etfWeights: input.etfWeights || {} });
  const ts = targetSession(input.at, venue);
  return { st, B, valuation, ctx: { B, valuation, asOf: input.asOf, targetSession: ts, bars: input.bars, fx: input.fx,
    etfWeights: input.etfWeights || {}, weeklyReviewCurrent: Boolean(input.weeklyReviewCurrent) } };
}

/** Builds a decision event if (and only if) every rule passes. Never writes anything itself. */
export function decide(input) {
  const p = input.proposal;
  assert(p && p.instrument, 'PROPOSAL_MISSING');
  assert(typeof input.at === 'string' && Number.isFinite(Date.parse(input.at)), 'DECISION_TIME_MISSING');
  const { B, ctx } = context(input, 'active', p.instrument.venue);
  assert(ctx.targetSession >= input.asOf, 'TARGET_IN_PAST');
  const ticks = qtyToTicks(p.qty);
  const check = p.side === 'SELL' ? checkSell(ctx, { ...p, ticks }) : checkBuy(ctx, { ...p, ticks });
  if (!check.ok) return { ok: false, reasons: check.reasons, check };
  const ymd = ctx.targetSession.replaceAll('-', '');
  const prefix = `D-${ymd}-${CODE.active}-${p.instrument.symbol}-${p.side[0]}-`;
  const n = input.events.filter(e => e.id.startsWith(prefix)).length + 1;
  const event = {
    id: prefix + n, type: 'decision', book: 'active', at: input.at, side: p.side, instrument: p.instrument,
    qty: ticksToQty(ticks), ...(p.side === 'BUY' ? { ceiling: p.ceiling } : {}), targetSession: ctx.targetSession,
    startType: p.startType || (p.side === 'SELL' ? 'exit' : 'parking'), ...(p.exception ? { exception: true } : {}),
    ...(p.caseId ? { caseId: p.caseId } : {}), ...(p.caseUrl ? { caseUrl: p.caseUrl } : {}), reason: p.reason || ''
  };
  assert(event.reason.length >= 10, 'REASON_REQUIRED', 'every decision states its reason in plain words');
  return { ok: true, reasons: [], event, check };
}

export function size(input) {
  const p = input.proposal;
  const { ctx } = context(input, 'active', p.instrument.venue);
  const r = sizeBuy(ctx, { ...p, ticks: 0 });
  return { ...r, qty: ticksToQty(r.ticks) };
}

export { CONFIG };
