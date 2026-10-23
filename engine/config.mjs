/**
 * Claude's Portfolio — frozen parameters of Investment Rules v1.1 (approved by Charles, 23 Oct 2026).
 * Changing any value here is a rule change: only Charles can approve it, and the rules page must be
 * updated in the same change. Money is integer euro cents; fractions are plain decimals.
 */
export const RULES_VERSION = 'v1.1';

export const CONFIG = Object.freeze({
  capitalCents: 100_000,                 // €1,000 virtual, fixed, never topped up (s.1)
  books: Object.freeze(['active', 'passive', 'noselection']),
  paperAccount: 'DUR269359',             // optional mirror only, placed by Charles (s.10)

  // s.2 benchmark / parking ETF: iShares MSCI ACWI UCITS ETF (Acc), Xetra IUSQ, EUR
  etf: Object.freeze({
    key: 'STK:239363241',                // IBKR contract id; prices via SMART (IBIS2 needs a subscription)
    symbol: 'IUSQ', conid: 239363241, isin: 'IE00B6R52259', currency: 'EUR', venue: 'EU',
    kind: 'etf', issuerId: 'FUND:IE00B6R52259', sector: 'Fund', country: 'Fund', eventGroup: 'Fund',
    fractional: false                    // not confirmed as IBKR-fractional: whole shares (s.5)
  }),

  // s.3 idle money
  initialEtfFraction: 0.80,
  cashFloorFraction: 0.05,
  reparkThresholdCents: 30_000,

  // s.4 limits (direct-stock limits unless stated)
  companyCap: 0.20,                      // direct + ETF look-through + buffer
  lookThroughBuffer: 0.01,
  defaultEtfWeight: 0.01,                // assumed ETF weight for a company outside the published top 10
  startConfirmed: 0.15,
  startAnticipated: 0.075,
  sectorCap: 0.40,
  countryCap: 0.60,
  eventCap: 0.25,
  volumeParticipation: 0.01,
  // s.5 whole-share exception
  exceptionMax: 0.25,
  // s.6 entry test
  minNetExcess: 0.03,
  horizonDays: 91,
  // s.8 exits
  maxHoldDays: 182,
  // s.9 downturn
  pauseDrawdown: 0.15,
  // s.10 execution
  maxTradesPerWeek: 4,
  costs: Object.freeze({
    halfSpreadBps: Object.freeze({ stock: 10, etf: 5 }),
    slippageBps: 10,
    fxBps: 10,
    commission: Object.freeze({
      EUR: Object.freeze({ type: 'percent', rate: 0.0005, min: 3.00 }),                       // IBKR Pro Fixed, Europe
      USD: Object.freeze({ type: 'perShare', perShare: 0.005, min: 1.00, maxFraction: 0.01 })  // IBKR Pro Fixed, US
    })
  }),
  settlementDays: Object.freeze({ US: 1, EU: 2 }),
  sessionOpen: Object.freeze({ EU: { tz: 'Europe/Paris', hour: 9, minute: 0 }, US: { tz: 'America/New_York', hour: 9, minute: 30 } }),
  qtyDecimals: 4
});
