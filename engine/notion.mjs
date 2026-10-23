import { CONFIG } from './config.mjs';
import { assert, centsToEur, ticksToNumber } from './util.mjs';

const TYPE_LABEL = { fund: 'Fund', decision: 'Decision', fill: 'Fill', expired: 'Expired', dividend: 'Dividend', split: 'Split',
  correction: 'Correction', pause: 'Pause', restart: 'Restart', skip: 'Skip' };
const BOOK_LABEL = { active: 'Active', passive: 'Passive', noselection: 'No-selection' };

/** Notion Ledger row properties for one event. Payload carries the exact JSON the engine replays. */
export function eventToRow(e, decisionsById = {}) {
  const inst = e.instrument || decisionsById[e.decisionId]?.instrument || null;
  const isDT = e.at.length > 10;
  const notes = {
    fund: () => `€${centsToEur(e.amountCents)} virtual capital`,
    decision: () => `${e.side} ${e.qty} ${inst?.symbol}${e.ceiling ? ` (ceiling ${e.ceiling} ${inst?.currency})` : ''}, fills at the close of ${e.targetSession}. ${e.reason || ''}`,
    fill: () => `${e.side} ${e.qty} ${inst?.symbol} at close ${e.close} ${inst?.currency}${e.mirrorOf ? ' (no-selection mirror)' : ''}`,
    expired: () => e.reason, skip: () => e.reason, dividend: () => e.note || 'Dividend', split: () => `Split ratio ${e.ratio}`,
    correction: () => `Reverses ${e.reverses}: ${e.reason}`, pause: () => e.reason || '15% downturn pause', restart: () => `Restart approved by ${e.approvedBy}`
  }[e.type]();
  const payload = JSON.stringify(e);
  assert(payload.length <= 1990, 'PAYLOAD_TOO_LONG', e.id);
  return {
    'Event ID': e.id, Type: TYPE_LABEL[e.type], ...(e.book ? { Book: BOOK_LABEL[e.book] } : {}),
    'date:Date:start': e.at, 'date:Date:is_datetime': isDT ? 1 : 0,
    ...(inst ? { Ticker: inst.symbol, Currency: inst.currency } : {}),
    ...(e.side ? { Side: e.side === 'BUY' ? 'Buy' : 'Sell' } : {}),
    ...(e.qty ? { Quantity: e.qty } : {}),
    ...(e.type === 'fill' ? { Price: e.close } : e.type === 'decision' && e.ceiling ? { Price: e.ceiling } : {}),
    ...(Number.isSafeInteger(e.cashEurCents) ? { 'Cash change EUR': centsToEur(e.cashEurCents) } : {}),
    ...(e.type === 'fund' ? { 'Cash change EUR': centsToEur(e.amountCents) } : {}),
    ...(Number.isSafeInteger(e.costsEurCents) ? { 'Costs EUR': centsToEur(e.costsEurCents) } : {}),
    ...((e.decisionId || e.mirrorOf || e.reverses) ? { Decision: e.decisionId || e.mirrorOf || e.reverses } : {}),
    ...(e.caseUrl ? { Case: e.caseUrl } : {}),
    Payload: payload, Notes: String(notes).slice(0, 1900)
  };
}

/** Parses exported Ledger rows (objects with 'Event ID' and 'Payload') back into events, verifying each one. */
export function rowsToEvents(rows) {
  return rows.map(r => {
    const id = r['Event ID'], raw = r.Payload;
    assert(typeof raw === 'string' && raw.startsWith('{'), 'PAYLOAD_MISSING', String(id));
    const e = JSON.parse(raw);
    assert(e.id === id, 'PAYLOAD_ID_MISMATCH', `${id} vs ${e.id}`);
    return e;
  });
}

const eur = (c) => centsToEur(c);
/** One Performance History row per valuation date (active book, with both comparison books). */
export function performanceRow({ asOf, active, passive, noselection, dd }) {
  const unreal = active.positions.reduce((s, p) => s + p.unrealizedCents, 0);
  return {
    Snapshot: `Valuation ${asOf}`, 'date:As of:start': asOf, 'date:As of:is_datetime': 0,
    'Total NAV EUR': eur(active.navCents), 'Paper cash EUR': eur(active.cashCents), 'Positions EUR': eur(active.positionsCents),
    'Realized P&L EUR': eur(active.realizedCents), 'Unrealized P&L EUR': eur(unreal), 'Net funding EUR': eur(CONFIG.capitalCents),
    'Benchmark value EUR': eur(passive.navCents), 'No-selection value EUR': eur(noselection.navCents),
    'Drawdown %': Math.round(dd.drawdown * 10000) / 100, 'High-water mark EUR': eur(dd.highWaterCents),
    Notes: `Closing prices on or before ${asOf} (IBKR). Active ${eur(active.navCents)} / passive ACWI ${eur(passive.navCents)} / no-selection ${eur(noselection.navCents)}. Simulated paper portfolio, rules ${'v1.1'}.`
  };
}

export function holdingRows(active, asOf) {
  return active.positions.map(p => ({
    Holding: p.symbol, Ticker: p.symbol, ...(p.instrument.isin ? { ISIN: p.instrument.isin } : {}),
    Units: ticksToNumber(p.ticks), 'Value EUR': eur(p.valueCents), 'Weight %': Math.round(p.weight * 10000) / 100,
    'date:As of:start': asOf, 'date:As of:is_datetime': 0, 'Position type': 'Paper', Account: "Claude's Portfolio (simulated, rules v1.1)"
  }));
}

/** Plain-language orders Charles may copy into IBKR paper (optional; Claude never places them). */
export function mirrorOrders(pending, session) {
  return pending.filter(d => d.book === 'active' && d.targetSession === session).map(d => {
    const i = d.instrument;
    return d.side === 'BUY'
      ? `BUY ${d.qty} ${i.symbol} (${i.currency}) — limit ${d.ceiling}, at the close if IBKR offers it (otherwise a day limit order), in paper account ${CONFIG.paperAccount}`
      : `SELL ${d.qty} ${i.symbol} (${i.currency}) — at the close (market-on-close), in paper account ${CONFIG.paperAccount}`;
  });
}
