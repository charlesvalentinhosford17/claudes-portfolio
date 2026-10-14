/**
 * ChatGPT's Portfolio — offline, fail-closed execution preflight.
 * Pure validation only. No IBKR SDK, network calls or order placement.
 * A future broker adapter must prove the authenticated environment and
 * reconcile the execution ledger independently before enabling paper orders.
 */
export const INITIAL_PAPER_CAPITAL_CENTS = 100_000;
export const PAPER_API_PORTS = Object.freeze([7497, 4002]);

export class PaperPreflightError extends Error {
  constructor(code) { super(`Paper order blocked: ${code}`); this.name = 'PaperPreflightError'; this.code = code; }
}
const requireTrue = (condition, code) => { if (!condition) throw new PaperPreflightError(code); };
const nonnegativeCents = v => Number.isSafeInteger(v) && v >= 0;

/** All financial amounts denominated in EUR, integer cents unless stated. */
export function checkPaperOrder({ configuration, connection, portfolio, quote, order, nowMs = Date.now() }) {
  requireTrue(configuration?.executionEnabled === true, 'EXECUTION_DISABLED');
  requireTrue(configuration?.investmentRulesReviewed === true, 'RULES_NOT_APPROVED');
  requireTrue(configuration?.paperOnly === true, 'PAPER_ONLY_NOT_CONFIRMED');
  requireTrue(typeof configuration?.allowlistedPaperAccount === 'string' && configuration.allowlistedPaperAccount.length >= 3, 'NO_PAPER_ACCOUNT_ALLOWLIST');
  requireTrue(connection?.authenticated === true && connection?.brokerEnvironment === 'PAPER', 'NOT_AUTHENTICATED_PAPER_SESSION');
  requireTrue(connection?.paperVerified === true, 'PAPER_ENVIRONMENT_NOT_VERIFIED');
  requireTrue(connection?.accountId === configuration.allowlistedPaperAccount, 'ACCOUNT_NOT_ALLOWLISTED');
  requireTrue(connection?.host === '127.0.0.1' && PAPER_API_PORTS.includes(connection?.port), 'UNAPPROVED_ENDPOINT');
  // Never trust the broker's default simulated $1m buying power as strategy funds.
  requireTrue(portfolio?.initialFundingCents === INITIAL_PAPER_CAPITAL_CENTS, 'INITIAL_CAPITAL_MISMATCH');
  requireTrue(portfolio?.additionalFundingCents === 0, 'ADDITIONAL_FUNDING_NOT_AUTHORIZED');
  requireTrue(portfolio?.reconciled === true && portfolio?.unresolvedOrders === 0, 'LEDGER_NOT_RECONCILED');
  requireTrue(nonnegativeCents(portfolio?.cashCents), 'UNKNOWN_PAPER_CASH');
  requireTrue(order?.side === 'BUY' || order?.side === 'SELL', 'INVALID_SIDE');
  requireTrue(typeof order?.contractId === 'string' && order.contractId.length >= 3, 'CONTRACT_ID_MISSING');
  requireTrue(Number.isFinite(order?.units) && order.units > 0, 'INVALID_QUANTITY');
  requireTrue(quote?.contractId === order.contractId, 'QUOTE_CONTRACT_MISMATCH');
  requireTrue(quote?.marketOpen === true, 'MARKET_NOT_OPEN');
  requireTrue(quote?.isDelayed === false && quote?.isIndicative === false, 'NON_EXECUTABLE_QUOTE');
  requireTrue(typeof quote?.source === 'string' && quote.source.length > 2, 'QUOTE_SOURCE_MISSING');
  requireTrue(Number.isFinite(quote?.unitPriceEUR) && quote.unitPriceEUR > 0, 'FX_OR_PRICE_UNVERIFIED');
  requireTrue(Number.isSafeInteger(nowMs) && Number.isSafeInteger(quote?.receivedAtMs) &&
    quote.receivedAtMs <= nowMs && nowMs - quote.receivedAtMs <= 60_000, 'QUOTE_STALE');
  requireTrue(nonnegativeCents(order?.feesMaxCents), 'COST_UNKNOWN');
  requireTrue(nonnegativeCents(order?.fxMaxCents), 'FX_COST_UNKNOWN');
  requireTrue(nonnegativeCents(order?.slippageBufferCents), 'SLIPPAGE_UNKNOWN');
  const notionalCents = Math.ceil(order.units * quote.unitPriceEUR * 100 - 1e-9);
  requireTrue(Number.isSafeInteger(notionalCents) && notionalCents > 0, 'INVALID_NOTIONAL');
  const costCeilingCents = notionalCents + order.feesMaxCents + order.fxMaxCents + order.slippageBufferCents;
  requireTrue(Number.isSafeInteger(costCeilingCents), 'INVALID_COST_CEILING');
  if (order.side === 'BUY') requireTrue(costCeilingCents <= portfolio.cashCents, 'INSUFFICIENT_STRATEGY_CASH');
  else {
    const heldUnits = portfolio?.positions?.[order.contractId];
    requireTrue(Number.isFinite(heldUnits) && heldUnits >= order.units, 'NO_SHORTS_OR_UNKNOWN_POSITION');
  }
  return Object.freeze({ eligible: true, side: order.side, contractId: order.contractId,
    units: order.units, notionalCents, costCeilingCents, paperAccountId: connection.accountId });
}
