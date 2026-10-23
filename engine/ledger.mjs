import { CONFIG } from './config.mjs';
import { assert, fail, isDate, qtyToTicks } from './util.mjs';

export const TYPES = Object.freeze(['fund', 'decision', 'fill', 'expired', 'dividend', 'split', 'correction', 'pause', 'restart', 'skip']);
const REVERSIBLE = new Set(['fill', 'expired', 'dividend', 'split', 'pause', 'restart', 'decision', 'skip']);

const sessionKey = (d) => d + 'T22:30:00Z';           // fills/expiries happen at the session close (after US close)
function sortKey(e) {
  switch (e.type) {
    case 'fund': return e.at + 'T00:00:00Z';
    case 'dividend': case 'split': return e.at + 'T00:00:01Z';
    case 'fill': case 'expired': case 'skip': return sessionKey(e.at);
    default: return e.at; // ISO instants for decisions, pause, restart, correction
  }
}
const TYPE_ORDER = { fund: 0, split: 1, dividend: 2, correction: 3, decision: 4, fill: 5, expired: 6, skip: 6, pause: 7, restart: 8 };

export function validateInstrument(i) {
  assert(i && typeof i === 'object', 'INSTRUMENT_MISSING');
  for (const k of ['key', 'symbol', 'currency', 'venue', 'kind', 'issuerId', 'sector', 'country', 'eventGroup'])
    assert(typeof i[k] === 'string' && i[k].length > 0, 'INSTRUMENT_FIELD_MISSING', k);
  assert(['EU', 'US'].includes(i.venue), 'BAD_VENUE', i.venue);
  assert(['stock', 'etf'].includes(i.kind), 'BAD_KIND', i.kind);
  assert(typeof i.fractional === 'boolean', 'INSTRUMENT_FIELD_MISSING', 'fractional');
  assert(CONFIG.costs.commission[i.currency], 'UNSUPPORTED_CURRENCY', i.currency);
  return i;
}

function emptyBook(name) {
  return { name, funded: false, cashCents: 0, unsettled: [], positions: new Map(), lots: new Map(), realizedCents: 0,
           decisions: new Map(), fills: [], dividendsCents: 0, paused: false, pauseEvents: [] };
}

/**
 * Replays the append-only ledger. Throws on any integrity problem (fail closed):
 * duplicate ids, unknown types/books, unmatched decisions, negative cash, short positions, bad funding.
 */
export function replay(events) {
  assert(Array.isArray(events), 'EVENTS_NOT_ARRAY');
  const byId = new Map();
  for (const e of events) {
    assert(e && typeof e.id === 'string' && e.id.length >= 3, 'EVENT_ID_MISSING');
    assert(!byId.has(e.id), 'DUPLICATE_EVENT_ID', e.id);
    assert(TYPES.includes(e.type), 'UNKNOWN_EVENT_TYPE', `${e.id}:${e.type}`);
    assert(e.type === 'correction' || CONFIG.books.includes(e.book), 'UNKNOWN_BOOK', `${e.id}:${e.book}`);
    assert(typeof e.at === 'string' && (isDate(e.at) || Number.isFinite(Date.parse(e.at))), 'BAD_EVENT_TIME', e.id);
    byId.set(e.id, e);
  }
  const reversed = new Set();
  for (const e of events.filter(x => x.type === 'correction')) {
    const t = byId.get(e.reverses);
    assert(t, 'CORRECTION_TARGET_MISSING', e.id);
    assert(REVERSIBLE.has(t.type), 'CORRECTION_TARGET_NOT_REVERSIBLE', e.id);
    assert(!reversed.has(t.id), 'DOUBLE_CORRECTION', e.id);
    assert(typeof e.reason === 'string' && e.reason.length > 3, 'CORRECTION_REASON_MISSING', e.id);
    reversed.add(t.id);
  }
  const books = Object.fromEntries(CONFIG.books.map(b => [b, emptyBook(b)]));
  const ordered = events.filter(e => e.type !== 'correction' && !reversed.has(e.id))
    .map((e, i) => ({ e, i })).sort((a, b) => {
      const ka = sortKey(a.e), kb = sortKey(b.e);
      if (ka !== kb) return ka < kb ? -1 : 1;
      if (TYPE_ORDER[a.e.type] !== TYPE_ORDER[b.e.type]) return TYPE_ORDER[a.e.type] - TYPE_ORDER[b.e.type];
      if (a.e.type === 'fill' && a.e.side !== b.e.side) return a.e.side === 'SELL' ? -1 : 1; // reductions first
      return a.i - b.i;
    }).map(x => x.e);

  for (const e of ordered) {
    const B = books[e.book];
    switch (e.type) {
      case 'fund': {
        assert(!B.funded, 'DOUBLE_FUNDING', e.id);
        assert(e.amountCents === CONFIG.capitalCents, 'FUNDING_NOT_1000_EUR', e.id);
        B.funded = true; B.cashCents += e.amountCents; B.fundDate = e.at; break;
      }
      case 'decision': {
        assert(B.funded, 'NOT_FUNDED', e.id);
        assert(e.side === 'BUY' || e.side === 'SELL', 'BAD_SIDE', e.id);
        validateInstrument(e.instrument);
        assert(isDate(e.targetSession), 'BAD_TARGET_SESSION', e.id);
        qtyToTicks(e.qty);
        if (e.side === 'BUY') assert(Number.isFinite(e.ceiling) && e.ceiling > 0, 'CEILING_MISSING', e.id);
        B.decisions.set(e.id, { event: e, status: 'pending' }); break;
      }
      case 'fill': {
        assert(B.funded, 'NOT_FUNDED', e.id);
        let instrument = e.instrument;
        if (e.decisionId) {
          const d = B.decisions.get(e.decisionId);
          assert(d, 'FILL_WITHOUT_DECISION', e.id);
          assert(d.status === 'pending', 'DECISION_ALREADY_CLOSED', e.id);
          assert(d.event.side === e.side, 'FILL_SIDE_MISMATCH', e.id);
          assert(d.event.qty === e.qty, 'FILL_QTY_MISMATCH', e.id);
          assert(d.event.targetSession === e.at, 'FILL_SESSION_MISMATCH', e.id);
          instrument = d.event.instrument; d.status = 'filled'; d.fillId = e.id;
        }
        validateInstrument(instrument);
        const ticks = qtyToTicks(e.qty);
        assert(Number.isSafeInteger(e.cashEurCents), 'FILL_CASH_MISSING', e.id);
        const p = B.positions.get(instrument.key);
        if (e.side === 'BUY') {
          assert(e.cashEurCents < 0, 'BUY_CASH_SIGN', e.id);
          B.cashCents += e.cashEurCents;
          assert(B.cashCents >= 0, 'NEGATIVE_CASH', `${e.id} would leave ${B.cashCents} cents`);
          if (p) { p.ticks += ticks; p.costCents += -e.cashEurCents; p.lastBuy = e.at; }
          else B.positions.set(instrument.key, { instrument, ticks, costCents: -e.cashEurCents, firstFill: e.at, lastBuy: e.at,
                                                exception: Boolean(e.exception) });
        } else {
          assert(e.cashEurCents >= 0, 'SELL_CASH_SIGN', e.id);
          assert(p && p.ticks >= ticks, 'NO_SHORTS', `${e.id} sells more than held`);
          const costOut = Math.round(p.costCents * ticks / p.ticks);
          p.ticks -= ticks; p.costCents -= costOut;
          B.realizedCents += e.cashEurCents - costOut;
          B.cashCents += e.cashEurCents;
          assert(isDate(e.settleDate), 'SETTLE_DATE_MISSING', e.id);
          B.unsettled.push({ cents: e.cashEurCents, settleDate: e.settleDate });
          if (p.ticks === 0) B.positions.delete(instrument.key);
        }
        if (e.lotKey) {
          const cur = B.lots.get(e.lotKey) || 0;
          const next = e.side === 'BUY' ? cur + ticks : cur - ticks;
          assert(next >= 0, 'LOT_NEGATIVE', e.id);
          if (next === 0) B.lots.delete(e.lotKey); else B.lots.set(e.lotKey, next);
        }
        B.fills.push({ ...e, instrument }); break;
      }
      case 'expired': {
        const d = B.decisions.get(e.decisionId);
        assert(d && d.status === 'pending', 'EXPIRY_WITHOUT_PENDING_DECISION', e.id);
        d.status = 'expired'; d.expiryId = e.id; d.reason = e.reason; break;
      }
      case 'dividend': {
        assert(Number.isSafeInteger(e.cashEurCents) && e.cashEurCents > 0, 'BAD_DIVIDEND', e.id);
        B.cashCents += e.cashEurCents; B.dividendsCents += e.cashEurCents; break;
      }
      case 'split': {
        const p = B.positions.get(e.instrumentKey);
        assert(p, 'SPLIT_WITHOUT_POSITION', e.id);
        const r = Number(e.ratio);
        assert(Number.isFinite(r) && r > 0, 'BAD_SPLIT_RATIO', e.id);
        const t = p.ticks * r;
        assert(Number.isSafeInteger(Math.round(t)) && Math.abs(t - Math.round(t)) < 1e-9, 'SPLIT_FRACTION', e.id);
        p.ticks = Math.round(t); break;
      }
      case 'skip': {
        assert(typeof e.mirrorOf === 'string' && typeof e.reason === 'string', 'BAD_SKIP', e.id); break;
      }
      case 'pause': {
        assert(e.book === 'active', 'PAUSE_ACTIVE_ONLY', e.id);
        B.paused = true; B.pauseEvents.push(e); break;
      }
      case 'restart': {
        assert(e.book === 'active', 'RESTART_ACTIVE_ONLY', e.id);
        assert(B.paused, 'RESTART_WITHOUT_PAUSE', e.id);
        assert(e.approvedBy === 'Charles', 'RESTART_NEEDS_CHARLES', e.id);
        B.paused = false; B.pauseEvents.push(e); break;
      }
      default: fail('UNKNOWN_EVENT_TYPE', e.type);
    }
  }
  return { books, byId, reversed };
}

/** Cash that may be spent on asOf: total cash minus sale proceeds not yet settled. */
export function settledCash(B, asOf) {
  const pending = B.unsettled.filter(u => u.settleDate > asOf).reduce((s, u) => s + u.cents, 0);
  return B.cashCents - pending;
}
/** Calendar date (YYYY-MM-DD) of an event. */
export const dateOf = (e) => String(e.at).slice(0, 10);
export const pendingDecisions = (B) => [...B.decisions.values()].filter(d => d.status === 'pending').map(d => d.event);
