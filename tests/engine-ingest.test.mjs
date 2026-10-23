import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../engine/cli.mjs';
import { CONFIG } from '../engine/config.mjs';

const ETF = CONFIG.etf;
// Shapes copied from real IBKR get_price_history responses (23 Oct 2026).
const IUSQ_RAW = { chart_step: 86400, delayed: 900, source: 'Last', time: ['2026-10-19T05:30:00Z', '2026-10-20T05:30:00Z', '2026-10-21T05:30:00Z', '2026-10-22T05:30:00Z', '2026-10-23T05:30:00Z'], volume: [260044, 170195, 93809, 119210, 55140], close: [109.5, 109.16, 109.78, 108.52, 108.3] };
const FX_RAW = { chart_step: 86400, source: 'MidPoint', time: ['2026-10-18T21:15:00Z', '2026-10-19T21:15:00Z', '2026-10-20T21:15:00Z', '2026-10-21T21:15:00Z', '2026-10-22T21:15:00Z'], close: [1.1213, 1.123725, 1.1232, 1.12155, 1.120025] };

test('ingest keeps completed sessions only and keys FX bars by their closing day', () => {
  const out = run('ingest', { today: '2026-10-23', series: { [ETF.key]: IUSQ_RAW }, fx: FX_RAW });
  assert.deepEqual(Object.keys(out.bars[ETF.key]), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']); // today's partial bar dropped
  assert.equal(out.bars[ETF.key]['2026-10-22'].close, 108.52);
  assert.deepEqual(Object.keys(out.fx), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']);
  assert.equal(out.fx['2026-10-22'], 1.12155);   // stamped 21:15Z on the 21st, closes on the 22nd
  assert.throws(() => run('ingest', { today: '2026-10-23', series: { x: { error: 'No market data permissions' } } }), /IBKR_BARS_MALFORMED/);
});

test('dividend needs an explicit withholding with a source and pays only shares held before the ex-date', () => {
  const bars = { [ETF.key]: { '2026-10-26': { close: 108.30, volume: 100000 } } };
  const L = run('launch', { launch: { decisionAt: '2026-10-26T06:13:00Z', etfClose: 108.30 } });
  const ev = [...L.newEvents, ...run('book', { events: L.newEvents, today: '2026-10-27', bars, fx: {} }).newEvents];
  assert.throws(() => run('dividend', { events: ev, dividend: { instrumentKey: ETF.key, exDate: '2026-11-05', payDate: '2026-11-20', grossPerShare: 1, currency: 'EUR' } }), /WITHHOLDING_REQUIRED/);
  const d = run('dividend', { events: ev, dividend: { instrumentKey: ETF.key, exDate: '2026-11-05', payDate: '2026-11-20', grossPerShare: 1.00, currency: 'EUR', withholding: 0.25, withholdingSource: 'test fixture' } });
  assert.equal(d.newEvents[0].cashEurCents, 525);   // 7 shares x €1 x 75%
  const none = run('dividend', { events: ev, dividend: { instrumentKey: ETF.key, exDate: '2026-10-26', payDate: '2026-11-20', grossPerShare: 1.00, currency: 'EUR', withholding: 0, withholdingSource: 'test fixture' } });
  assert.equal(none.newEvents.length, 0);
});

test('Payload strings exported from Notion are accepted as events; ETF re-parking can be sized from a budget', () => {
  const bars = { [ETF.key]: { '2026-10-26': { close: 108.30, volume: 100000 }, '2026-11-02': { close: 108.0, volume: 100000 } } };
  const L = run('launch', { launch: { decisionAt: '2026-10-26T06:13:00Z', etfClose: 108.30 } });
  const ev = [...L.newEvents, ...run('book', { events: L.newEvents, today: '2026-10-27', bars, fx: {} }).newEvents].map(e => JSON.stringify(e));
  const small = run('decide', { events: ev, asOf: '2026-11-02', at: '2026-11-02T06:13:00Z', bars, fx: {}, proposal: { side: 'BUY', instrument: ETF, budgetCents: 15000, ceiling: 110, startType: 'parking', reason: 'Re-park idle cash in the ACWI ETF' } });
  assert.equal(small.ok, false); assert.match(small.reasons.join(' '), /PARK_BELOW_300/);
});
