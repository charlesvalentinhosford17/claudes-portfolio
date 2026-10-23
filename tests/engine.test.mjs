import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../engine/config.mjs';
import { fillAmounts, roundTripFraction } from '../engine/costs.mjs';
import { replay, settledCash } from '../engine/ledger.mjs';
import { bookPending, launchEvents, targetSession } from '../engine/fills.mjs';
import { decide, size } from '../engine/decisions.mjs';
import { eventToRow, rowsToEvents, mirrorOrders } from '../engine/notion.mjs';
import { drawdown, valueBook } from '../engine/valuation.mjs';
import { run } from '../engine/cli.mjs';
import { qtyToTicks, ticksToQty, isoWeek } from '../engine/util.mjs';

const ETF = CONFIG.etf;
const VISA = { key: 'STK:49462172', symbol: 'V', conid: 49462172, currency: 'USD', venue: 'US', kind: 'stock', issuerId: 'ISSUER:VISA',
  sector: 'Financials', country: 'United States', eventGroup: 'V-results-2026-10', fractional: true };
const SCHN = { key: 'STK:29612196', symbol: 'SU', conid: 29612196, currency: 'EUR', venue: 'EU', kind: 'stock', issuerId: 'ISSUER:SCHNEIDER',
  sector: 'Industrials', country: 'France', eventGroup: 'SU-q3', fractional: false };
const FX = { '2026-10-22': 1.12, '2026-10-23': 1.12, '2026-10-26': 1.12, '2026-10-27': 1.12, '2026-10-28': 1.12 };
const bars = (extra = {}) => ({
  [ETF.key]: { '2026-10-23': { close: 108.30, volume: 100000 }, '2026-10-26': { close: 108.30, volume: 100000 }, '2026-10-27': { close: 109.00, volume: 90000 }, '2026-10-28': { close: 109.50, volume: 80000 } },
  [VISA.key]: { '2026-10-23': { close: 414.34, volume: 4731950 }, '2026-10-26': { close: 414.34, volume: 4731950 }, '2026-10-27': { close: 416.00, volume: 4000000 }, '2026-10-28': { close: 420.10, volume: 3900000 } },
  [SCHN.key]: { '2026-10-23': { close: 170.00, volume: 2000000 }, '2026-10-26': { close: 170.00, volume: 2000000 }, '2026-10-27': { close: 171.00, volume: 2000000 } },
  ...extra
});
const visaCase = (over = {}) => ({ verdict: 'BUY', reviewer: 'Pass', reviewedAt: '2026-10-26', validUntil: '2027-01-25', type: 'Confirmed change',
  base91: 0.09, bear91: -0.08, bull91: 0.18, etfBase91: 0.02, entryCeiling: 420, ...over });

// Launch on Monday 26 Oct 2026 07:13 Paris (06:13 UTC), book on 27 Oct morning.
function launched() {
  const ev = launchEvents({ decisionAt: '2026-10-26T06:13:00Z', etfClose: 108.30 });
  const { newEvents } = bookPending({ events: ev, asOf: '2026-10-27', bars: bars(), fx: FX });
  return [...ev, ...newEvents];
}

test('quantities are exact to 4 decimals', () => {
  assert.equal(qtyToTicks('0.4'), 4000); assert.equal(ticksToQty(4000), '0.4'); assert.equal(ticksToQty(70000), '7');
  assert.throws(() => qtyToTicks('0.12345'), /BAD_QUANTITY/); assert.throws(() => qtyToTicks('-1'), /BAD_QUANTITY/);
  assert.equal(isoWeek('2026-10-26'), '2026-W44'); assert.equal(isoWeek('2026-11-01'), '2026-W44'); assert.equal(isoWeek('2026-11-02'), '2026-W45');
});

test('IBKR fixed fees: Europe 0.05% min €3, ETF spread+slippage 15 bps', () => {
  const a = fillAmounts({ side: 'BUY', kind: 'etf', currency: 'EUR', ticks: 70000, close: 108.30 });
  assert.equal(a.fillPrice, 108.46245); assert.equal(a.notionalLocalCents, 75924); assert.equal(a.commissionLocalCents, 300);
  assert.equal(a.cashEurCents, -76224); assert.equal(a.costsEurCents, 300 + 114);
  const big = fillAmounts({ side: 'SELL', kind: 'stock', currency: 'EUR', ticks: 500000, close: 200 });
  assert.equal(big.commissionLocalCents, 499); // 0.05% of €9,980 = €4.99, above the €3 minimum
});

test('IBKR fixed fees: US $0.005/share, min $1, max 1%, plus 0.10% FX', () => {
  const a = fillAmounts({ side: 'BUY', kind: 'stock', currency: 'USD', ticks: 3000, close: 414.34, fx: 1.12 });
  assert.equal(a.notionalLocalCents, 12455); assert.equal(a.commissionLocalCents, 100);
  assert.equal(a.cashEurCents, -11221); // (124.55 + 1.00) / 1.12 = 112.098 + 0.112 FX
  const tiny = fillAmounts({ side: 'BUY', kind: 'stock', currency: 'USD', ticks: 1000, close: 50, fx: 1.12 });
  assert.equal(tiny.commissionLocalCents, 5); // capped at 1% of $5.01
  assert.throws(() => fillAmounts({ side: 'BUY', kind: 'stock', currency: 'GBP', ticks: 10000, close: 10, fx: 0.87 }), /UNSUPPORTED_CURRENCY/);
  assert.throws(() => fillAmounts({ side: 'BUY', kind: 'stock', currency: 'USD', ticks: 10000, close: 10 }), /FX_MISSING/);
});

test('round-trip costs make small European positions expensive (why the rules size at €150+)', () => {
  const eu100 = roundTripFraction({ kind: 'stock', currency: 'EUR', ticks: 10000, price: 100 });
  const us150 = roundTripFraction({ kind: 'stock', currency: 'USD', ticks: 4000, price: 420, fx: 1.12 });
  assert.ok(eu100 > 0.06 && eu100 < 0.07, String(eu100));
  assert.ok(us150 < 0.02, String(us150));
});

test('target session = first full session starting after the decision', () => {
  assert.equal(targetSession('2026-10-26T06:13:00Z', 'EU'), '2026-10-26'); // 07:13 Paris, before 09:00
  assert.equal(targetSession('2026-10-26T09:00:00Z', 'EU'), '2026-10-27'); // 10:00 Paris, after the open
  assert.equal(targetSession('2026-10-26T09:00:00Z', 'US'), '2026-10-26'); // 05:00 New York
  assert.equal(targetSession('2026-10-30T15:00:00Z', 'US'), '2026-11-02'); // Friday after the US open -> Monday
  assert.equal(targetSession('2026-10-31T10:00:00Z', 'EU'), '2026-11-02'); // Saturday -> Monday
});

test('launch: three books funded with €1,000; active parks ~80% and passive ~100% in whole ETF shares', () => {
  const ev = launchEvents({ decisionAt: '2026-10-26T06:13:00Z', etfClose: 108.30 });
  const d = ev.filter(e => e.type === 'decision');
  assert.equal(ev.filter(e => e.type === 'fund').length, 3);
  assert.equal(d.find(x => x.book === 'active').qty, '7');
  assert.equal(d.find(x => x.book === 'passive').qtyAtFill, true); // sized at the actual close: fully invested benchmark
  assert.equal(d[0].ceiling, 110.47); assert.equal(d[0].targetSession, '2026-10-26');
  assert.throws(() => run('launch', { events: ev, launch: { decisionAt: '2026-10-26T06:13:00Z', etfClose: 108.3 } }), /ALREADY_LAUNCHED/);
});

test('booking fills at the close, mirrors no-selection, and re-running books nothing twice', () => {
  const all = launched();
  const st = replay(all);
  assert.equal(st.books.active.cashCents, 100000 - 76224);
  assert.equal(st.books.passive.positions.get(ETF.key).ticks, 90000);
  assert.equal(st.books.noselection.positions.get(ETF.key).ticks, 70000);
  assert.equal(st.books.active.cashCents, st.books.noselection.cashCents);
  const again = bookPending({ events: all, asOf: '2026-10-28', bars: bars(), fx: FX });
  assert.equal(again.newEvents.length, 0);
  assert.deepEqual(run('verify', { events: all, asOf: '2026-10-27' }), { ok: true, issues: [] });
});

test('integrity: duplicates, negative cash, shorts, double funding and tampering are refused', () => {
  const all = launched();
  assert.throws(() => replay([...all, all[0]]), /DUPLICATE_EVENT_ID/);
  assert.throws(() => replay([...all, { id: 'FUND-active-2', type: 'fund', book: 'active', at: '2026-10-27', amountCents: 100000 }]), /DOUBLE_FUNDING/);
  const fill = all.find(e => e.id.startsWith('F-') && e.book === 'active');
  assert.throws(() => replay([...all, { ...fill, id: 'F-x', decisionId: undefined, instrument: ETF, cashEurCents: -50000000 }]), /NEGATIVE_CASH/);
  assert.throws(() => replay([...all, { ...fill, id: 'F-y', decisionId: undefined, instrument: VISA, side: 'SELL', cashEurCents: 100, settleDate: '2026-10-28' }]), /NO_SHORTS/);
  const tampered = all.map(e => e.id === fill.id ? { ...e, cashEurCents: e.cashEurCents + 1000 } : e);
  const v = run('verify', { events: tampered, asOf: '2026-10-27' });
  assert.equal(v.ok, false); assert.match(v.issues[0], /cashEurCents/);
});

test('a correction reverses a fill without deleting history', () => {
  const all = launched();
  const fill = all.find(e => e.id.startsWith('F-') && e.book === 'active');
  const st = replay([...all, { id: 'COR-1', type: 'correction', at: '2026-10-27T10:00:00Z', reverses: fill.id, reason: 'Test: wrong close used' }]);
  assert.equal(st.books.active.cashCents, 100000);
  assert.throws(() => replay([...all, { id: 'COR-2', type: 'correction', at: '2026-10-27T10:00:00Z', reverses: 'nope', reason: 'x' }]), /CORRECTION_TARGET_MISSING/);
});

const decideInput = (events, over = {}) => ({
  events, asOf: '2026-10-27', at: '2026-10-27T06:13:00Z', bars: bars(), fx: FX, etfWeights: { 'ISSUER:VISA': 0.006 }, weeklyReviewCurrent: true,
  proposal: { side: 'BUY', instrument: VISA, qty: '0.4', ceiling: 420, startType: 'confirmed', caseInfo: visaCase(), caseUrl: 'https://app.notion.com/p/case',
    reason: 'Visa: test case, results beat and raised guidance' },
  ...over
});

test('a reviewed BUY case within every limit produces a decision for today\'s US close', () => {
  const all = launched();
  const r = decide(decideInput(all));
  assert.equal(r.ok, true, r.reasons?.join('; '));
  assert.equal(r.event.id, 'D-20261027-A-V-B-1'); assert.equal(r.event.targetSession, '2026-10-27');
  assert.ok(r.check.netExcess > 0.03 && r.check.netExcess < 0.07);
  const s = size(decideInput(all));
  assert.ok(s.ticks >= 3900 && s.ticks <= 4010, `sized ${s.qty}`); // 15% of NAV €1,000.76 at the $420 ceiling = 0.4003
  assert.ok(s.binding.some(x => x.startsWith('START_SIZE_EXCEEDED')));
});

test('purchases are refused without review, below the 3-point edge, above the ceiling or start size, or over the weekly limit', () => {
  const all = launched();
  const reasons = (over) => decide(decideInput(all, over)).reasons.join(' | ');
  assert.match(reasons({ proposal: { ...decideInput(all).proposal, caseInfo: visaCase({ reviewer: 'Pending' }) } }), /CASE_NOT_REVIEWED/);
  assert.match(reasons({ proposal: { ...decideInput(all).proposal, caseInfo: visaCase({ base91: 0.045 }) } }), /NET_EXCESS_BELOW_3PP/);
  assert.match(reasons({ proposal: { ...decideInput(all).proposal, ceiling: 425 } }), /CEILING_ABOVE_CASE/);
  assert.match(reasons({ proposal: { ...decideInput(all).proposal, qty: '0.6' } }), /START_SIZE_EXCEEDED/);
  assert.match(reasons({ weeklyReviewCurrent: false }), /WEEKLY_REVIEW_OVERDUE/);
  assert.match(reasons({ proposal: { ...decideInput(all).proposal, startType: 'anticipated' } }), /CASE_TYPE_MISMATCH/);
  // weekly limit: launch (1) + three more decisions in week 44 -> the fifth is refused
  let evs = all;
  for (const [sym, n] of [['A1', 1], ['A2', 2], ['A3', 3]]) evs = [...evs, { id: `D-20261027-A-${sym}-B-1`, type: 'decision', book: 'active', at: '2026-10-27T06:00:00Z', side: 'BUY',
    instrument: { ...VISA, key: 'STK:9' + n, symbol: sym, issuerId: 'I' + n, eventGroup: 'E' + n }, qty: '0.01', ceiling: 10, targetSession: '2026-10-27', reason: 'test filler' }];
  assert.match(decide(decideInput(evs)).reasons.join(' | '), /WEEKLY_TRADE_LIMIT/);
});

test('whole-share exception: one confirmed whole share up to 25% including look-through and buffer', () => {
  const all = launched();
  const base = decideInput(all, { at: '2026-10-27T06:13:00Z' });
  const prop = { side: 'BUY', instrument: SCHN, qty: '1', ceiling: 172, startType: 'confirmed', reason: 'Schneider: test whole share exception',
    caseInfo: { ...visaCase(), entryCeiling: 172, base91: 0.12 } };
  assert.match(decide({ ...base, proposal: prop }).reasons.join(' | '), /START_SIZE_EXCEEDED/);
  const ok = decide({ ...base, proposal: { ...prop, exception: true } });
  assert.equal(ok.ok, true, ok.reasons?.join('; '));
  assert.match(decide({ ...base, proposal: { ...prop, exception: true, ceiling: 250, caseInfo: { ...prop.caseInfo, entryCeiling: 250 } } }).reasons.join(' | '), /COMPANY_CAP|EXCEPTION_ABOVE_25PCT/);
  assert.match(decide({ ...base, proposal: { ...prop, exception: true, startType: 'anticipated', caseInfo: { ...prop.caseInfo, type: 'Anticipated change' } } }).reasons.join(' | '), /EXCEPTION_CONFIRMED_ONLY/);
  assert.match(decide({ ...base, proposal: { ...prop, qty: '1.5' } }).reasons.join(' | '), /FRACTION_NOT_ALLOWED/);
});

test('fills respect the ceiling, missing sessions expire, missing data stops everything', () => {
  const all = launched();
  const d = decide(decideInput(all)).event;
  const hi = bars({ [VISA.key]: { '2026-10-27': { close: 421.00, volume: 4e6 } } });
  const r1 = bookPending({ events: [...all, d], asOf: '2026-10-28', bars: hi, fx: FX });
  assert.equal(r1.newEvents[0].type, 'expired'); assert.match(r1.newEvents[0].reason, /ABOVE_CEILING/);
  const hol = bars({ [VISA.key]: { '2026-10-26': { close: 414, volume: 4e6 } } });
  assert.match(bookPending({ events: [...all, d], asOf: '2026-10-28', bars: hol, fx: FX }).newEvents[0].reason, /NO_SESSION/);
  const missing = bars(); delete missing[VISA.key];
  assert.throws(() => bookPending({ events: [...all, d], asOf: '2026-10-28', bars: missing, fx: FX }), /DATA_MISSING/);
});

test('a stock fill is mirrored by the ACWI ETF in no-selection; a sale settles before its cash can be reused', () => {
  const all = launched();
  const d = decide(decideInput(all)).event;
  const r = bookPending({ events: [...all, d], asOf: '2026-10-28', bars: bars(), fx: FX });
  const f = r.newEvents.find(e => e.id === 'F-' + d.id);
  const m = r.newEvents.find(e => e.mirrorOf === f.id);
  assert.equal(f.close, 416); assert.equal(m.lotKey, VISA.key); assert.equal(m.qty, '1');
  let evs = [...all, d, ...r.newEvents];
  // sell everything on 28 Oct: proceeds settle on 29 Oct (US T+1); the matched ETF lot is sold too
  const s = decide({ ...decideInput(evs), asOf: '2026-10-28', at: '2026-10-28T06:13:00Z', proposal: { side: 'SELL', instrument: VISA, qty: '0.4', reason: 'Test: thesis invalidated' } });
  assert.equal(s.ok, true, s.reasons?.join('; '));
  const r2 = bookPending({ events: [...evs, s.event], asOf: '2026-10-29', bars: bars(), fx: FX });
  evs = [...evs, s.event, ...r2.newEvents];
  const st = replay(evs);
  assert.equal(st.books.active.positions.has(VISA.key), false);
  assert.equal(st.books.noselection.lots.has(VISA.key), false);
  const sale = r2.newEvents.find(e => e.id === 'F-' + s.event.id);
  assert.equal(sale.settleDate, '2026-10-29');
  assert.equal(settledCash(st.books.active, '2026-10-28'), st.books.active.cashCents - sale.cashEurCents);
  assert.equal(settledCash(st.books.active, '2026-10-29'), st.books.active.cashCents);
  assert.deepEqual(run('verify', { events: evs, asOf: '2026-10-29' }), { ok: true, issues: [] });
});

test('valuation, 15% drawdown pause and restart only by Charles', () => {
  const all = launched();
  const st = replay(all);
  const v = valueBook(st.books.active, { asOf: '2026-10-27', bars: bars(), fx: FX, etfWeights: {} });
  assert.equal(v.navCents, st.books.active.cashCents + Math.round(7 * 109.00 * 100));
  const dd = drawdown([{ date: '2026-10-27', navCents: 100000 }], { date: '2026-11-20', navCents: 84900 });
  assert.equal(dd.triggered, true);
  const out = run('value', { events: all, asOf: '2026-10-27', bars: bars(), fx: FX, navHistory: [{ date: '2026-10-20', navCents: 120000 }] });
  assert.ok(out.pauseEvent);
  const paused = [...all, out.pauseEvent];
  assert.match(decide(decideInput(paused)).reasons.join(' | '), /DRAWDOWN_PAUSE/);
  assert.throws(() => replay([...paused, { id: 'R-1', type: 'restart', book: 'active', at: '2026-11-30T10:00:00Z', approvedBy: 'Claude' }]), /RESTART_NEEDS_CHARLES/);
  assert.equal(replay([...paused, { id: 'R-1', type: 'restart', book: 'active', at: '2026-11-30T10:00:00Z', approvedBy: 'Charles' }]).books.active.paused, false);
  assert.throws(() => valueBook(st.books.active, { asOf: '2026-10-27', bars: {}, fx: FX }), /MARK_MISSING/);
});

test('Notion rows round-trip exactly; mirror orders are plain instructions for Charles', () => {
  const all = launched();
  const dec = Object.fromEntries(all.filter(e => e.type === 'decision').map(e => [e.id, e]));
  const rows = all.map(e => eventToRow(e, dec));
  assert.deepEqual(rowsToEvents(rows), all);
  assert.equal(rows.find(r => r['Event ID'] === 'FUND-active')['Cash change EUR'], 1000);
  assert.throws(() => rowsToEvents([{ 'Event ID': 'A', Payload: JSON.stringify({ id: 'B' }) }]), /PAYLOAD_ID_MISMATCH/);
  assert.ok(rows.every(r => r.Payload.startsWith('ev1:{')));                       // stored as text by the Notion connector
  assert.deepEqual(rowsToEvents([{ 'Event ID': 'FUND-active', Payload: JSON.stringify(all[0]) }]), [all[0]]); // legacy, unprefixed
  const d = decide(decideInput(all)).event;
  const o = mirrorOrders([d], '2026-10-27');
  assert.match(o[0], /BUY 0\.4 V \(USD\) — limit 420/);
  assert.match(o[0], /DUR269359/);
});
