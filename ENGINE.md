# Claude's Portfolio — paper engine (rules v1.1)

Deterministic, dependency-free Node code that does every money calculation for Claude's Portfolio.
The AI never computes cash, fills, values or limits by hand: it gathers data, writes and reviews the research
case, and runs these commands. Rules: Notion page "Claude's Portfolio — Investment Rules v1.1" (approved by
Charles on 23 Oct 2026). `engine/config.mjs` holds the frozen parameters; changing one is a rule change that
only Charles can approve.

## Boundaries
- **Paper only.** Simulated fills at the official close of the next full session (rules s.10). No broker orders, ever.
- **Prices:** IBKR connection **price tools only**: `search_contracts`, `get_price_history`, `get_price_snapshot`.
  Never the account, positions, balances, orders, order instructions, alerts, watchlists or trades tools (s.12).
- **Separate** from the Terminal and Charles's own accounts. IBKR paper DUR269359 is an optional copy that only
  Charles places by hand.
- **Official record:** the Notion Ledger (append-only). Every run replays the whole ledger from scratch, so
  a re-run never books anything twice and any inconsistency stops the run.

## Notion sources
| Table | Data source | Saved view (read with mode "view": no quota) |
|---|---|---|
| Ledger | `collection://86c304cb-9faf-4b1b-9136-1c41d0ef2199` | `view://b01e808c-8e55-4bc8-b863-5f331ab377ff` |
| Cases | `collection://88e0979c-5f36-4dd1-8095-20a143692275` | `view://79a073aa-9498-44fb-8da9-75c25aff8360` |
| Performance History | `collection://81b3bf2a-8ff1-4f45-8df9-567f770ed6dc` | `view://f98d5c69-b8e1-4160-a7cb-9e4a01fc44e6` |
| Holdings | `collection://04792c14-6a6d-46fd-9157-19d5dfd76e67` | `view://533ba891-32f9-43a0-8d5d-b78e0c11edcd` |
| Watchlist | `collection://bde219e6-2cac-45f2-a824-ea222a4c0bc8` | `view://dee387a6-983b-4462-8d91-a1348345b92a` |
| Activity | `collection://3b4de5e5-2ce0-430d-bb7d-c12db4d10aac` | `view://d0a8a353-cb9b-467e-8ee2-de09fb7acc8f` |

`events` = the **Payload** strings of every Ledger row (read all pages of the view; pass the strings as-is). Payloads are
stored as `ev1:` + JSON, because the Notion connector rejects text that looks like a JSON object; always create rows with
exactly the properties the engine returns.
`navHistory` = `[{ "date": "YYYY-MM-DD", "navCents": <Total NAV EUR × 100> }]` from Performance History.

## Commands
`node engine/cli.mjs <command> input.json` prints JSON. A refusal prints `{ ok:false, error, message }` and exits 2.
`asOf` (alias `today`) is the Paris date of the run: fills are booked only for sessions **before** it, and
values use the latest completed close on or before it.

| Command | Input | Output |
|---|---|---|
| `ingest` | `{ today, series: { "<key>": <raw get_price_history JSON> }, fx: <raw EUR.USD JSON> }` | `{ bars, fx }`, completed sessions only; FX keyed by the day each bar closes |
| `launch` | `{ events: [], launch: { decisionAt, etfClose } }` | funding of the 3 books + day-one ETF decisions (active ~80%, passive ~100%), with `rows` |
| `book` | `{ events, asOf, bars, fx }` | `newEvents` + `rows`: fills / expiries for decisions whose session closed, plus no-selection mirrors |
| `status` | `{ events, asOf, bars, fx, navHistory, etfWeights }` | values of the 3 books, exposures, `breaches`, `drawdown`, `pauseEvent`/`pauseRow` if 15% is hit, `exitsDue` (182 days), `pending`, `performanceRow`, `holdingRows` |
| `size` | `{ events, asOf, at, bars, fx, etfWeights, proposal }` | largest quantity passing every size, cash, volume and concentration rule, with the binding rule |
| `decide` | `{ events, asOf, at, bars, fx, etfWeights, weeklyReviewCurrent, proposal }` | `ok` + decision `event` + `row`, or `reasons` (rule codes) |
| `dividend` | `{ events, dividend: { instrumentKey, exDate, payDate, grossPerShare, currency, withholding, withholdingSource, fxOnPay } }` | dividend event + row (or none if not held before the ex-date) |
| `orders` | `{ events, asOf }` | plain-language orders Charles may copy into DUR269359 (optional) |
| `verify` | `{ events, asOf }` | recomputes every fill, checks every past decision was booked and every active fill mirrored |

Instrument keys are `STK:<IBKR contract id>`. The ACWI ETF is `STK:239363241` (IUSQ; prices via SMART, no exchange).
EUR.USD history: contract 12087792, security type CASH, exchange IDEALPRO.

### Proposal formats
Stock purchase (case returns are **fractions**: 0.09 = 9%; the Cases table stores percent numbers):
```json
{ "side": "BUY", "qty": "0.4",  "ceiling": 420, "startType": "confirmed", "exception": false, "fundingFromEtf": false,
  "instrument": { "key": "STK:49462172", "symbol": "V", "conid": 49462172, "currency": "USD", "venue": "US", "kind": "stock",
                  "issuerId": "ISSUER:VISA", "sector": "Financials", "country": "United States", "eventGroup": "V-FY26-results", "fractional": true },
  "caseInfo": { "verdict": "BUY", "reviewer": "Pass", "reviewedAt": "2026-10-27", "validUntil": "2027-01-26", "type": "Confirmed change",
                "base91": 0.09, "bear91": -0.08, "bull91": 0.18, "etfBase91": 0.02, "entryCeiling": 420 },
  "caseUrl": "<Notion case page>", "reason": "Plain-words reason (at least 10 characters)" }
```
ETF re-parking: `{ "side": "BUY", "instrument": <CONFIG.etf>, "budgetCents": 32000, "ceiling": <last close × 1.02>, "startType": "parking", "reason": "..." }`.
Sale: `{ "side": "SELL", "instrument": <same instrument>, "qty": "0.4", "reason": "Exit rule 3: catalyst missed (source)" }`.

## Daily runbook (used by the scheduled tasks)
1. Clone this repo (main branch); `npm test` must pass, else stop and report.
2. Read the Ledger (all pages) → `events`; Performance History → `navHistory`; Cases.
3. Prices with the IBKR price tools: for every held instrument, every pending decision and the ACWI ETF, `get_price_history`
   (step ONE_DAY, step_count 10, outside_rth false, no exchange); EUR.USD as above. Save the raw JSON → `ingest`.
4. `book` → before creating each row, check its Event ID is not already in the Ledger; then create it. Run `verify`.
5. `status` → one Performance History row per date (skip if the date exists); refresh Holdings; record `pauseRow` if present.
6. Research → case in Cases → independent review by a separate agent that did not write the case → `size` → `decide`
   → append the decision row. Never trade anything the engine refuses.
7. `orders` → message Charles the optional IBKR paper copy list.
8. Backup: save the `events` JSON to Google Drive (Claude's Portfolio Reports folder).

## Tests
`npm test` runs the engine tests (fees, sessions, ledger integrity, limits, fills, mirrors, drawdown, Notion round trip, CLI),
the ingest tests and the original viewer and preflight tests.
