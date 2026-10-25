#!/usr/bin/env node
/**
 * Claude's Portfolio engine CLI. Reads one JSON input file, prints JSON. Never writes to Notion itself.
 * Usage: node engine/cli.mjs <launch|book|value|decide|size|verify|orders> input.json
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG, RULES_VERSION } from './config.mjs';
import { fillAmounts } from './costs.mjs';
import { decide, size } from './decisions.mjs';
import { bookPending, launchEvents } from './fills.mjs';
import { pendingDecisions, replay } from './ledger.mjs';
import { eventToRow, holdingRows, mirrorOrders, parsePayload, performanceRow } from './notion.mjs';
import { drawdown, valueBook } from './valuation.mjs';
import { EngineError, qtyToTicks, ticksToQty } from './util.mjs';
import { dividendEvent, ingest } from './ingest.mjs';

const decisionsById = (events) => Object.fromEntries(events.filter(e => e.type === 'decision').map(e => [e.id, e]));
const rows = (evs, all) => evs.map(e => eventToRow(e, decisionsById(all)));

export function run(cmd, input) {
  const events = (input.events || []).map(e => (typeof e === 'string' ? parsePayload(e) : e));
  input = { ...input, events, asOf: input.asOf ?? input.today };
  switch (cmd) {
    case 'launch': {
      if (events.some(e => e.type === 'fund')) throw new EngineError('ALREADY_LAUNCHED');
      const evs = launchEvents(input.launch);
      replay(evs);
      return { rulesVersion: RULES_VERSION, newEvents: evs, rows: rows(evs, evs) };
    }
    case 'book': {
      const { newEvents } = bookPending({ events, asOf: input.asOf, bars: input.bars, fx: input.fx });
      const all = [...events, ...newEvents];
      return { newEvents, rows: rows(newEvents, all) };
    }
    case 'ingest': return ingest({ today: input.today, series: input.series, fx: input.fx });
    case 'dividend': {
      const ev = dividendEvent(events, input.dividend);
      return { newEvents: ev ? [ev] : [], rows: ev ? [eventToRow(ev)] : [] };
    }
    case 'status':
    case 'value': {
      const st = replay(events);
      const v = Object.fromEntries(CONFIG.books.map(b => [b, valueBook(st.books[b], { asOf: input.asOf, bars: input.bars, fx: input.fx, etfWeights: input.etfWeights || {} })]));
      const dd = drawdown(input.navHistory || [], { date: input.asOf, navCents: v.active.navCents });
      const pauseEvent = dd.triggered && !st.books.active.paused
        ? { id: `PAUSE-${input.asOf}`, type: 'pause', book: 'active', at: `${input.asOf}T23:00:00Z`, reason: `Drawdown ${(dd.drawdown * 100).toFixed(2)}% from high ${dd.highWaterCents / 100} EUR (${dd.highWaterDate}); new stock purchases paused until Charles approves a restart (rules s.9)` }
        : null;
      const exitsDue = v.active.positions.filter(p => p.instrument.kind === 'stock' && p.daysHeld >= CONFIG.maxHoldDays).map(p => ({ symbol: p.symbol, daysHeld: p.daysHeld }));
      return {
        asOf: input.asOf, valuations: v, drawdown: dd, pauseEvent, exitsDue, breaches: v.active.exposures.breaches,
        pending: pendingDecisions(st.books.active).map(d => ({ id: d.id, side: d.side, symbol: d.instrument.symbol, qty: d.qty, targetSession: d.targetSession })),
        performanceRow: performanceRow({ asOf: input.asOf, active: v.active, passive: v.passive, noselection: v.noselection, dd }),
        holdingRows: holdingRows(v.active, input.asOf), pauseRow: pauseEvent ? eventToRow(pauseEvent) : null
      };
    }
    case 'decide': {
      const p = input.proposal || {};
      if (!p.qty && Number.isSafeInteger(p.budgetCents) && p.instrument?.key === CONFIG.etf.key) {
        let n = Math.floor(p.budgetCents / 100 / p.ceiling);
        while (n > 0 && -fillAmounts({ side: 'BUY', kind: 'etf', currency: 'EUR', ticks: n * 10000, close: p.ceiling }).cashEurCents > p.budgetCents) n--;
        input = { ...input, proposal: { ...p, qty: ticksToQty(n * 10000) } };
        if (n === 0) return { ok: false, reasons: ['BUDGET_BELOW_ONE_SHARE'] };
      }
      const r = decide(input);
      return r.ok ? { ...r, row: eventToRow(r.event) } : r;
    }
    case 'size': return size(input);
    case 'orders': {
      const st = replay(events);
      return { orders: mirrorOrders(pendingDecisions(st.books.active), input.asOf) };
    }
    case 'verify': {
      const issues = [];
      let st;
      try { st = replay(events); } catch (e) { return { ok: false, issues: [String(e.message)] }; }
      const dec = decisionsById(events);
      for (const f of events.filter(e => e.type === 'fill' && !st.reversed.has(e.id))) {
        const inst = f.instrument || dec[f.decisionId]?.instrument;
        const a = fillAmounts({ side: f.side, kind: inst.kind, currency: inst.currency, ticks: qtyToTicks(f.qty), close: f.close, fx: inst.currency === 'EUR' ? undefined : f.fx });
        for (const k of ['cashEurCents', 'costsEurCents', 'notionalLocalCents', 'commissionLocalCents'])
          if (a[k] !== f[k]) issues.push(`${f.id}: ${k} stored ${f[k]} != recomputed ${a[k]}`);
      }
      for (const d of events.filter(e => e.type === 'decision')) {
        const s = st.books[d.book].decisions.get(d.id);
        if (s && s.status === 'pending' && d.targetSession < input.asOf) issues.push(`${d.id}: target ${d.targetSession} passed but not booked`);
      }
      const mirrored = new Set(events.filter(e => e.mirrorOf).map(e => e.mirrorOf));
      for (const f of events.filter(e => e.type === 'fill' && e.book === 'active' && !st.reversed.has(e.id)))
        if (!mirrored.has(f.id)) issues.push(`${f.id}: no-selection mirror missing`);
      for (const b of CONFIG.books) if (!st.books[b].funded && events.length) issues.push(`${b}: not funded`);
      return { ok: issues.length === 0, issues };
    }
    default: throw new EngineError('UNKNOWN_COMMAND', cmd);
  }
}

// Compare real file paths, not a URL with a raw path: the URL percent-encodes spaces and points past
// symlinks, so the old check was false in folders like ".../Claude Code/..." and the CLI printed nothing.
function invokedDirectly() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
}

if (invokedDirectly()) {
  const [cmd, file] = process.argv.slice(2);
  try {
    const out = run(cmd, JSON.parse(readFileSync(file, 'utf8')));
    process.stdout.write(JSON.stringify(out, null, 1) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.code || 'ERROR', message: e.message }) + '\n');
    process.exitCode = 2;
  }
}
