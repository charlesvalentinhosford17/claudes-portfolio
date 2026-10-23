import { CONFIG } from './config.mjs';
import { fillAmounts } from './costs.mjs';
import { pendingDecisions, replay, settledCash } from './ledger.mjs';
import { addBusinessDays, assert, fail, isWeekday, localParts, nextWeekday, qtyToTicks, ticksToQty } from './util.mjs';

/** First full session of the venue that starts after the decision instant (rules s.10). */
export function targetSession(atIso, venue) {
  const o = CONFIG.sessionOpen[venue];
  assert(o, 'BAD_VENUE', venue);
  const { date, minutes } = localParts(atIso, o.tz);
  if (isWeekday(date) && minutes < o.hour * 60 + o.minute) return date;
  return nextWeekday(date);
}

const fxFor = (fx, currency, date) => {
  if (currency === 'EUR') return undefined;
  const d = Object.keys(fx || {}).filter(x => x <= date).sort().at(-1);
  assert(d && (Date.parse(date) - Date.parse(d)) / 86400000 <= 4, 'FX_MISSING', `USD for ${date}`);
  return fx[d];
};
const compact = (i) => ({ key: i.key, symbol: i.symbol, conid: i.conid, currency: i.currency, venue: i.venue, kind: i.kind,
  issuerId: i.issuerId, sector: i.sector, country: i.country, eventGroup: i.eventGroup, fractional: i.fractional, isin: i.isin });

function makeFill({ id, book, at, side, instrument, ticks, close, fx, decisionId, extra = {} }) {
  const a = fillAmounts({ side, kind: instrument.kind, currency: instrument.currency, ticks, close, fx });
  return {
    id, type: 'fill', book, at, side, qty: ticksToQty(ticks), ...(decisionId ? { decisionId } : { instrument: compact(instrument) }),
    close, fx: fx ?? 1, fillPrice: a.fillPrice, notionalLocalCents: a.notionalLocalCents, commissionLocalCents: a.commissionLocalCents,
    fxCostEurCents: a.fxCostEurCents, spreadEurCents: a.spreadEurCents, costsEurCents: a.costsEurCents,
    notionalEurCents: a.notionalEurCents, cashEurCents: a.cashEurCents,
    ...(side === 'SELL' ? { settleDate: addBusinessDays(at, CONFIG.settlementDays[instrument.venue]) } : {}),
    ...extra
  };
}

/**
 * Books every pending decision whose target session has completed (target < asOf), then derives the
 * no-selection mirror trades. Returns only NEW events to append. Re-running is safe: nothing is booked twice.
 * bars: { instrumentKey: { 'YYYY-MM-DD': { close, volume } } } — completed sessions only.
 */
export function bookPending({ events, asOf, bars, fx }) {
  const all = [...events];
  const out = [];
  const add = (e) => { all.push(e); out.push(e); };
  let st = replay(all);
  for (const bookName of ['active', 'passive']) {
    const pend = pendingDecisions(st.books[bookName]).filter(d => d.targetSession < asOf)
      .sort((a, b) => a.targetSession !== b.targetSession ? (a.targetSession < b.targetSession ? -1 : 1) : a.side !== b.side ? (a.side === 'SELL' ? -1 : 1) : a.at < b.at ? -1 : 1);
    for (const d of pend) {
      const i = d.instrument;
      if (!(i.key in bars)) fail('DATA_MISSING', `no price history supplied for ${i.symbol}; nothing booked`);
      const bar = bars[i.key][d.targetSession];
      let ticks = qtyToTicks(d.qty);
      if (d.qtyAtFill && bar) {
        assert(bookName === 'passive' && i.key === CONFIG.etf.key, 'QTY_AT_FILL_PASSIVE_ONLY', d.id);
        let n = Math.floor(settledCash(st.books[bookName], d.targetSession) / 100 / bar.close);
        while (n > 0 && settledCash(st.books[bookName], d.targetSession) + fillAmounts({ side: 'BUY', kind: 'etf', currency: 'EUR', ticks: n * 10000, close: bar.close }).cashEurCents < 0) n--;
        ticks = n * 10000;
      }
      const expire = (reason) => add({ id: 'X-' + d.id, type: 'expired', book: bookName, at: d.targetSession, decisionId: d.id, reason });
      if (!bar) { expire('NO_SESSION: no completed session on the target date (holiday, halt or missing data)'); st = replay(all); continue; }
      if (d.side === 'BUY' && bar.close > d.ceiling + 1e-9) { expire(`ABOVE_CEILING: close ${bar.close} > ceiling ${d.ceiling}`); st = replay(all); continue; }
      if (ticks <= 0) { expire('ZERO_QUANTITY: not enough cash for one share at the close'); st = replay(all); continue; }
      if (!Number.isFinite(bar.volume) || ticks / 10000 > CONFIG.volumeParticipation * bar.volume) { expire(`VOLUME: ${bar.volume ?? 'unknown'} traded`); st = replay(all); continue; }
      const rate = fxFor(fx, i.currency, d.targetSession);
      const extra = {};
      if (d.side === 'SELL') extra.heldBefore = ticksToQty(st.books[bookName].positions.get(i.key)?.ticks ?? 0);
      if (d.exception) extra.exception = true;
      const f = makeFill({ id: 'F-' + d.id, book: bookName, at: d.targetSession, side: d.side, instrument: i, ticks, close: bar.close, fx: rate, decisionId: d.id, extra });
      if (d.side === 'BUY' && settledCash(st.books[bookName], d.targetSession) + f.cashEurCents < 0) { expire('INSUFFICIENT_SETTLED_CASH'); st = replay(all); continue; }
      add(f); st = replay(all);
    }
  }
  // No-selection book: mirror every active fill, replacing stocks with the ACWI ETF (original protocol).
  const done = new Set(all.filter(e => e.book === 'noselection' && e.mirrorOf).map(e => e.mirrorOf));
  const activeFills = all.filter(e => e.type === 'fill' && e.book === 'active' && !st.reversed.has(e.id) && !done.has(e.id))
    .sort((a, b) => a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.side !== b.side ? (a.side === 'SELL' ? -1 : 1) : 0);
  for (const f of activeFills) {
    const inst = f.decisionId ? st.books.active.decisions.get(f.decisionId)?.event.instrument : f.instrument;
    assert(inst, 'MIRROR_INSTRUMENT_MISSING', f.id);
    const N = st.books.noselection;
    const skip = (reason) => { add({ id: 'MX-' + f.id, type: 'skip', book: 'noselection', at: f.at, mirrorOf: f.id, reason }); st = replay(all); };
    const etfBar = bars[CONFIG.etf.key]?.[f.at];
    if (!etfBar) { skip('ETF_NO_SESSION: no ACWI ETF close on that date'); continue; }
    let ticks;
    const lotKey = inst.key === CONFIG.etf.key ? 'PARK' : inst.key;
    if (inst.key === CONFIG.etf.key) ticks = qtyToTicks(f.qty);
    else if (f.side === 'BUY') ticks = Math.floor(f.notionalEurCents / 100 / etfBar.close) * 10000;
    else {
      const held = N.lots.get(lotKey) || 0;
      const frac = qtyToTicks(f.qty) / qtyToTicks(f.heldBefore || f.qty);
      ticks = frac >= 1 - 1e-12 ? held : Math.floor(frac * held / 10000) * 10000;
    }
    if (f.side === 'BUY') {
      while (ticks > 0 && settledCash(N, f.at) + fillAmounts({ side: 'BUY', kind: 'etf', currency: 'EUR', ticks, close: etfBar.close }).cashEurCents < 0) ticks -= 10000;
    } else ticks = Math.min(ticks, N.positions.get(CONFIG.etf.key)?.ticks ?? 0);
    if (ticks <= 0) { skip('ZERO_QUANTITY: budget or matched lot below one ETF share'); continue; }
    add(makeFill({ id: 'M-' + f.id, book: 'noselection', at: f.at, side: f.side, instrument: CONFIG.etf, ticks, close: etfBar.close, extra: { mirrorOf: f.id, lotKey } }));
    st = replay(all);
  }
  return { newEvents: out, state: st };
}

/** Day-one events: funding of the three books and the initial ETF purchases (active 80%, passive 100%). */
export function launchEvents({ decisionAt, etfClose }) {
  assert(Number.isFinite(etfClose) && etfClose > 0, 'ETF_PRICE_MISSING');
  const ts = targetSession(decisionAt, CONFIG.etf.venue);
  const fundDate = decisionAt.slice(0, 10);
  const ceiling = Math.round(etfClose * 1.02 * 100) / 100; // expires if the ETF jumps more than 2% before the fill
  const maxShares = (budgetCents) => {
    let n = Math.floor(budgetCents / 100 / ceiling);
    while (n > 0 && -fillAmounts({ side: 'BUY', kind: 'etf', currency: 'EUR', ticks: n * 10000, close: ceiling }).cashEurCents > budgetCents) n--;
    return n;
  };
  const a = maxShares(Math.round(CONFIG.capitalCents * CONFIG.initialEtfFraction));
  const ymd = ts.replaceAll('-', '');
  // The passive benchmark is "€1,000 into the ACWI ETF on day one": its quantity is the most whole shares the
  // €1,000 buys at the actual close (no decision-making, so no safety margin that would leave it partly in cash).
  const dec = (book, code, n) => ({ id: `D-${ymd}-${code}-${CONFIG.etf.symbol}-B-1`, type: 'decision', book, at: decisionAt, side: 'BUY',
    instrument: compact(CONFIG.etf), qty: String(n), ceiling: book === 'passive' ? Math.round(etfClose * 1.10 * 100) / 100 : ceiling,
    ...(book === 'passive' ? { qtyAtFill: true } : {}), targetSession: ts, startType: 'parking', launch: true,
    reason: book === 'active' ? 'Launch: park 80% in the ACWI ETF (rules v1.1 s.3)' : 'Launch: passive benchmark, all-in ACWI ETF (rules v1.1 s.2)' });
  return [
    ...CONFIG.books.map(b => ({ id: `FUND-${b}`, type: 'fund', book: b, at: fundDate, amountCents: CONFIG.capitalCents })),
    dec('active', 'A', a), dec('passive', 'P', 0)
  ];
}
