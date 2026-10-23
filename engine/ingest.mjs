import { assert, addDays, isDate, qtyToTicks, ticksToNumber, eurToCents } from './util.mjs';
import { replay, dateOf } from './ledger.mjs';

/**
 * Convert raw IBKR get_price_history output (daily bars) into { 'YYYY-MM-DD': { close, volume } }.
 * Only completed sessions are kept: any bar dated `today` or later is dropped.
 * FX daily bars are stamped at the previous day's 21:15 UTC (the FX day starts the evening before), so they
 * are keyed by the day on which they close.
 */
export function barsFromIbkr(raw, { today, kind = 'stock' }) {
  assert(raw && Array.isArray(raw.time) && Array.isArray(raw.close), 'IBKR_BARS_MALFORMED', raw?.error ?? '');
  assert(isDate(today), 'BAD_DATE', String(today));
  assert(raw.time.length === raw.close.length, 'IBKR_BARS_MALFORMED', 'time/close length');
  const out = {};
  raw.time.forEach((t, k) => {
    let d = String(t).slice(0, 10);
    if (kind === 'fx' && Number(String(t).slice(11, 13)) >= 20) d = addDays(d, 1);
    if (d >= today) return;
    const close = raw.close[k];
    assert(Number.isFinite(close) && close > 0, 'IBKR_BAD_CLOSE', `${t}`);
    out[d] = { close, volume: Array.isArray(raw.volume) ? raw.volume[k] : null };
  });
  return out;
}

export function ingest({ today, series = {}, fx = null }) {
  const bars = Object.fromEntries(Object.entries(series).map(([key, raw]) => [key, barsFromIbkr(raw, { today, kind: 'stock' })]));
  const fxBars = fx ? barsFromIbkr(fx, { today, kind: 'fx' }) : {};
  return { bars, fx: Object.fromEntries(Object.entries(fxBars).map(([d, b]) => [d, b.close])) };
}

/**
 * Dividend event for a book: shares held at the end of the day before the ex-date, gross per share in the
 * instrument currency, an explicit withholding fraction (with its source), converted at the payment-date rate.
 */
export function dividendEvent(rawEvents, { book = 'active', instrumentKey, exDate, payDate, grossPerShare, currency, withholding, withholdingSource, fxOnPay }) {
  assert(isDate(exDate) && isDate(payDate) && payDate >= exDate, 'BAD_DIVIDEND_DATES');
  assert(Number.isFinite(grossPerShare) && grossPerShare > 0, 'BAD_DIVIDEND_AMOUNT');
  assert(Number.isFinite(withholding) && withholding >= 0 && withholding < 1, 'WITHHOLDING_REQUIRED');
  assert(typeof withholdingSource === 'string' && withholdingSource.length > 5, 'WITHHOLDING_SOURCE_REQUIRED');
  const rate = currency === 'EUR' ? 1 : fxOnPay;
  assert(Number.isFinite(rate) && rate > 0, 'FX_MISSING', currency);
  const before = replay(parseLocal(rawEvents).filter(e => dateOf(e) < exDate));
  const pos = before.books[book].positions.get(instrumentKey);
  if (!pos) return null;
  const cash = eurToCents(ticksToNumber(pos.ticks) * grossPerShare * (1 - withholding) / rate);
  return { id: `DIV-${book}-${pos.instrument.symbol}-${exDate}`, type: 'dividend', book, at: payDate, instrumentKey, symbol: pos.instrument.symbol, currency,
    exDate, grossPerShare, withholding, withholdingSource, fx: rate, qty: String(pos.ticks / 10000), cashEurCents: cash };
}
const parseLocal = (raw) => raw.map(e => (typeof e === 'string' ? JSON.parse(e) : e));
export { qtyToTicks };
