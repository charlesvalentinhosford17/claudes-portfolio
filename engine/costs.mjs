import { CONFIG } from './config.mjs';
import { assert, eurToCents, round6, ticksToNumber } from './util.mjs';

/** Commission in the instrument's currency (float, rounded to cents), IBKR Pro Fixed schedule (rules s.10). */
export function commissionLocal(currency, ticks, notionalLocal) {
  const sched = CONFIG.costs.commission[currency];
  assert(sched, 'UNSUPPORTED_CURRENCY', `${currency}: no verified fee schedule`);
  let c;
  if (sched.type === 'percent') c = Math.max(sched.rate * notionalLocal, sched.min);
  else c = Math.min(Math.max(sched.perShare * ticksToNumber(ticks), sched.min), sched.maxFraction * notionalLocal);
  return Math.round(c * 100 + 1e-9) / 100;
}

/** Adverse execution adjustment (half spread + slippage) as a fraction. */
export const adverseFraction = (kind) => (CONFIG.costs.halfSpreadBps[kind] + CONFIG.costs.slippageBps) / 10000;

/**
 * Simulated fill at the close with all modeled costs.
 * fxUsdPerEur: units of the instrument currency per 1 EUR (1 for EUR instruments).
 * Returns integer euro cents; cashEurCents is signed (negative for buys).
 */
export function fillAmounts({ side, kind, currency, ticks, close, fx }) {
  assert(side === 'BUY' || side === 'SELL', 'BAD_SIDE', side);
  assert(kind === 'stock' || kind === 'etf', 'BAD_KIND', kind);
  assert(Number.isSafeInteger(ticks) && ticks > 0, 'BAD_QUANTITY', String(ticks));
  assert(Number.isFinite(close) && close > 0, 'BAD_PRICE', String(close));
  const rate = currency === 'EUR' ? 1 : fx;
  assert(Number.isFinite(rate) && rate > 0, 'FX_MISSING', currency);
  if (currency === 'EUR') assert(fx === undefined || fx === 1, 'FX_FOR_EUR', String(fx));
  const adv = adverseFraction(kind);
  const fillPrice = round6(side === 'BUY' ? close * (1 + adv) : close * (1 - adv));
  const qty = ticksToNumber(ticks);
  const notionalLocal = Math.round(qty * fillPrice * 100 + 1e-9) / 100;
  const atCloseLocal = qty * close;
  const comm = commissionLocal(currency, ticks, notionalLocal);
  const grossLocal = side === 'BUY' ? notionalLocal + comm : notionalLocal - comm;
  const fxCostEur = currency === 'EUR' ? 0 : (CONFIG.costs.fxBps / 10000) * (grossLocal / rate);
  const cashEur = side === 'BUY' ? -(grossLocal / rate) - fxCostEur : (grossLocal / rate) - fxCostEur;
  const spreadEur = Math.abs(notionalLocal - atCloseLocal) / rate;
  return {
    fillPrice,
    notionalLocalCents: Math.round(notionalLocal * 100),
    commissionLocalCents: Math.round(comm * 100),
    fxCostEurCents: eurToCents(fxCostEur),
    spreadEurCents: eurToCents(spreadEur),
    commissionEurCents: eurToCents(comm / rate),
    cashEurCents: eurToCents(cashEur),
    costsEurCents: eurToCents(comm / rate + fxCostEur + spreadEur),
    notionalEurCents: eurToCents(notionalLocal / rate)
  };
}

/** Estimated round-trip cost of a stock position as a fraction of its EUR value (buy + later sell at the same price). */
export function roundTripFraction({ kind, currency, ticks, price, fx, withEtfLegs = false, etfPrice }) {
  const buy = fillAmounts({ side: 'BUY', kind, currency, ticks, close: price, fx });
  const sell = fillAmounts({ side: 'SELL', kind, currency, ticks, close: price, fx });
  let costs = buy.costsEurCents + sell.costsEurCents;
  const base = Math.abs(buy.notionalEurCents);
  if (withEtfLegs) {
    assert(Number.isFinite(etfPrice) && etfPrice > 0, 'ETF_PRICE_MISSING');
    const etfTicks = Math.max(10000, Math.floor(base / 100 / etfPrice) * 10000);
    const e1 = fillAmounts({ side: 'SELL', kind: 'etf', currency: 'EUR', ticks: etfTicks, close: etfPrice });
    const e2 = fillAmounts({ side: 'BUY', kind: 'etf', currency: 'EUR', ticks: etfTicks, close: etfPrice });
    costs += e1.costsEurCents + e2.costsEurCents;
  }
  return costs / base;
}
