export class EngineError extends Error {
  constructor(code, detail = '') { super(detail ? `${code}: ${detail}` : code); this.name = 'EngineError'; this.code = code; }
}
export const fail = (code, detail) => { throw new EngineError(code, detail); };
export const assert = (cond, code, detail) => { if (!cond) fail(code, detail); };

const QTY_RE = /^\d+(\.\d{1,4})?$/;
/** Quantity string -> integer ticks of 0.0001 share. */
export function qtyToTicks(q) {
  const s = String(q);
  assert(QTY_RE.test(s), 'BAD_QUANTITY', s);
  const [i, f = ''] = s.split('.');
  return Number(i) * 10000 + Number((f + '0000').slice(0, 4));
}
export function ticksToQty(t) {
  assert(Number.isSafeInteger(t) && t >= 0, 'BAD_TICKS', String(t));
  const i = Math.floor(t / 10000), f = String(t % 10000).padStart(4, '0').replace(/0+$/, '');
  return f ? `${i}.${f}` : String(i);
}
export const ticksToNumber = (t) => t / 10000;

/** Round a euro amount (float) to integer cents, half away from zero. */
export function eurToCents(x) {
  assert(Number.isFinite(x), 'BAD_AMOUNT', String(x));
  const c = Math.round(Math.abs(x) * 100 + 1e-9);
  return x < 0 ? -c : c;
}
export const centsToEur = (c) => Math.round(c) / 100;
export const round6 = (x) => Math.round(x * 1e6) / 1e6;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (d) => typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
export function addDays(d, n) {
  assert(isDate(d), 'BAD_DATE', String(d));
  const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
export const weekday = (d) => new Date(d + 'T00:00:00Z').getUTCDay(); // 0 Sun .. 6 Sat
export const isWeekday = (d) => { const w = weekday(d); return w >= 1 && w <= 5; };
export function addBusinessDays(d, n) {
  let x = d, k = 0;
  while (k < n) { x = addDays(x, 1); if (isWeekday(x)) k++; }
  return x;
}
export function nextWeekday(d) { let x = addDays(d, 1); while (!isWeekday(x)) x = addDays(x, 1); return x; }
export function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
/** ISO week key, e.g. 2026-W44 */
export function isoWeek(d) {
  const t = new Date(d + 'T00:00:00Z');
  const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}
/** Local date and minutes-after-midnight of an ISO instant in a time zone. */
export function localParts(iso, tz) {
  const ms = Date.parse(iso);
  assert(Number.isFinite(ms), 'BAD_TIMESTAMP', String(iso));
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
