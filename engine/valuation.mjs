import { CONFIG } from './config.mjs';
import { assert, daysBetween, eurToCents, ticksToNumber } from './util.mjs';

/** Latest bar on or before date. bars: { 'YYYY-MM-DD': {close, volume} } */
export function barOnOrBefore(bars, date) {
  if (!bars) return null;
  const d = Object.keys(bars).filter(x => x <= date).sort().at(-1);
  return d ? { date: d, ...bars[d] } : null;
}
export function fxOnOrBefore(fx, currency, date) {
  if (currency === 'EUR') return { date, rate: 1 };
  assert(currency === 'USD', 'UNSUPPORTED_CURRENCY', currency);
  const d = Object.keys(fx || {}).filter(x => x <= date).sort().at(-1);
  assert(d, 'FX_MISSING', `USD on or before ${date}`);
  return { date: d, rate: fx[d] };
}

/** Values one book at the latest completed close on or before asOf. Missing price = error (never guessed). */
export function valueBook(B, { asOf, bars, fx, etfWeights = {} }) {
  const positions = [];
  let posCents = 0;
  for (const p of B.positions.values()) {
    const bar = barOnOrBefore(bars[p.instrument.key], asOf);
    assert(bar, 'MARK_MISSING', `${p.instrument.symbol} on or before ${asOf}`);
    assert(daysBetween(bar.date, asOf) <= 7, 'MARK_STALE', `${p.instrument.symbol} last close ${bar.date}`);
    const r = fxOnOrBefore(fx, p.instrument.currency, asOf);
    const valueCents = eurToCents(ticksToNumber(p.ticks) * bar.close / r.rate);
    posCents += valueCents;
    positions.push({ key: p.instrument.key, symbol: p.instrument.symbol, instrument: p.instrument, ticks: p.ticks,
                     close: bar.close, closeDate: bar.date, fx: r.rate, valueCents, costCents: p.costCents,
                     unrealizedCents: valueCents - p.costCents, firstFill: p.firstFill, lastBuy: p.lastBuy,
                     exception: p.exception, daysHeld: daysBetween(p.firstFill, asOf) });
  }
  const navCents = B.cashCents + posCents;
  for (const x of positions) x.weight = navCents > 0 ? x.valueCents / navCents : 0;
  const exposures = exposureReport(positions, navCents, etfWeights);
  return { book: B.name, asOf, cashCents: B.cashCents, positionsCents: posCents, navCents, realizedCents: B.realizedCents,
           dividendsCents: B.dividendsCents, positions, exposures, paused: B.paused };
}

export function etfWeightFor(issuerId, etfWeights) {
  const w = etfWeights[issuerId];
  return Number.isFinite(w) ? w : CONFIG.defaultEtfWeight;
}

/** Company / sector / country / event exposures and limit breaches (rules s.4, s.5, s.8). */
export function exposureReport(positions, navCents, etfWeights) {
  const etfValue = positions.filter(p => p.instrument.kind === 'etf').reduce((s, p) => s + p.valueCents, 0);
  const stocks = positions.filter(p => p.instrument.kind === 'stock');
  const sum = (field) => stocks.reduce((m, p) => { const k = p.instrument[field]; m[k] = (m[k] || 0) + p.valueCents; return m; }, {});
  const frac = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, navCents > 0 ? v / navCents : 0]));
  const company = stocks.map(p => {
    const exp = (p.valueCents + etfValue * etfWeightFor(p.instrument.issuerId, etfWeights)) / navCents + CONFIG.lookThroughBuffer;
    const cap = p.exception ? CONFIG.exceptionMax : CONFIG.companyCap;
    return { key: p.key, symbol: p.symbol, exposure: exp, cap, breach: exp > cap + 1e-12 };
  });
  const sector = frac(sum('sector')), country = frac(sum('country')), event = frac(sum('eventGroup'));
  const breaches = [
    ...company.filter(c => c.breach).map(c => ({ kind: 'company', name: c.symbol, value: c.exposure, cap: c.cap })),
    ...Object.entries(sector).filter(([, v]) => v > CONFIG.sectorCap + 1e-12).map(([k, v]) => ({ kind: 'sector', name: k, value: v, cap: CONFIG.sectorCap })),
    ...Object.entries(country).filter(([, v]) => v > CONFIG.countryCap + 1e-12).map(([k, v]) => ({ kind: 'country', name: k, value: v, cap: CONFIG.countryCap })),
    ...Object.entries(event).filter(([, v]) => v > CONFIG.eventCap + 1e-12).map(([k, v]) => ({ kind: 'event', name: k, value: v, cap: CONFIG.eventCap }))
  ];
  const cashFraction = null;
  return { company, sector, country, event, breaches, etfValueCents: etfValue, cashFraction };
}

/** Drawdown from the recorded daily NAV history (append-only Performance History) plus today's value. */
export function drawdown(history, current) {
  const series = [...history.map(h => ({ date: h.date, navCents: h.navCents })), current].filter(Boolean)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  let hwm = 0, hwmDate = null;
  for (const s of series) if (s.navCents > hwm) { hwm = s.navCents; hwmDate = s.date; }
  const last = series.at(-1);
  const dd = hwm > 0 && last ? 1 - last.navCents / hwm : 0;
  return { highWaterCents: hwm, highWaterDate: hwmDate, drawdown: dd, triggered: dd >= CONFIG.pauseDrawdown - 1e-12 };
}
