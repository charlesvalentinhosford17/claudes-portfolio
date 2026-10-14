# ChatGPT's Portfolio — pre-IBKR launch audit
**Audit date:** 14 October 2026 · **Mode:** independent, paper-only, initial capital €1,000 · **Decision:** **NO-GO for autonomous orders**.

This is a readiness and systems-control audit, not an amendment to the investment strategy. It covers *only* ChatGPT's Portfolio. No Terminal records, credentials, positions or rules may be used.

## Evidence checked
- Private GitHub `chatgpts-portfolio`: read-only Node dashboard, Notion reader, website, tests, GitHub Actions. Independent viewer checks passed through run 11 on 14 October.
- Dedicated Notion: Holdings **0**, Watchlist **0**, Performance History **0**; Activity **1 setup-only entry**; Daily Reports **1 historical setup report marked Incomplete because its PDF is not attached**.
- Scheduled separate research and daily PDF tasks exist. They are not evidence that paper execution, holdings valuation or a live dashboard is functioning.
- IBKR Paper Trading activation was requested by the user and confirmation is pending. No authenticated paper API session or Mac installation has been inspected.
- Notion connector read using SQL recently hit a workspace query usage limit; saved-view mode returned the records above. Direct project-scoped Notion API access is not yet configured.
- IBKR primary documentation confirms paper/live TWS/API variants, paper default USD 1m balance, API authentication/restarts, delayed data possibility and simulated-fill limitations.

## Readiness gates — ALL must pass before enabling simulated order transmission

| ID | Gate | Current status | Required proof of completion |
|---|---|---|---|
| G01 | **Versioned investment mandate** | BLOCKED | Retrieve the exact authoritative ChatGPT investment-system rules; review user-selected 7B, sign off allowed universe, long/short/leverage/derivatives, time horizon, sizing, turnover, exits, corporate actions and maximum drawdown behavior. Do not silently substitute a past research report for the mandate. |
| G02 | **Paper account activation** | WAITING ON IBKR | Paper account confirmation from IBKR; independently verified paper session and designated paper account ID; no live account IDs in order path. |
| G03 | **Safe broker adapter** | NOT BUILT | Mac-only TWS/IB Gateway paper adapter, loopback-only networking, paper default port, explicit account allowlist, environment verification, disabled-by-default order transmission and a tested emergency stop. No live-account trading path. |
| G04 | **€1,000 independent cash ledger** | NOT BUILT | Separate cent-accurate paper cash, positions and cost basis. No contributions, margin or negative cash; never use IBKR's simulated USD 1m account balance as portfolio buying power. Funding and gains tracked separately. |
| G05 | **Auditable order and fill ledger** | NOT BUILT | Durable order-intent ID; accepted/rejected/submitted/partially-filled/cancelled states; broker `permId`, `execId` and `orderId`; executed units, price, quote currency, FX, commission, timestamps and supporting order receipt. No free-text-only 'Completed' event treated as broker proof. |
| G06 | **Idempotent recovery** | NOT BUILT | After restart/disconnect, request broker open orders and executions, deduplicate by authoritative execution identifiers and reconcile before sending anything. Unknown order state = STOP, not retry. |
| G07 | **Execution eligibility** | NEEDS MANDATE & DATA | Verified contract/ISIN and venue, long-only/short rules from mandate, product availability, exchange trading hours, market data entitlement, quote age, spread, slippage, min-size/fractional capability, cash and estimated all-in EUR cost. No assumed executable pricing. |
| G08 | **Market-data reliability** | UNVERIFIED | Validate source, licenses/subscriptions and real-time versus delayed data for actual contemplated instruments. Stop on stale, missing, delayed or inconsistent quotes when timing-sensitive; record all sources and timestamps. |
| G09 | **Reconciliation and performance** | PARTIAL | New dashboard validation rejects inconsistent NAV arithmetic. Still need daily verified ledger reconciliation, EUR FX timestamps, dividends/corporate actions, fees/tax treatment, cost basis, time-weighted return, cash-adjusted benchmark and drawdowns. |
| G10 | **Research mechanism** | PARTIAL | Dedicated watchlist task exists, but not proof of autonomous full-market discovery or full thesis completion. Define exact workflow, citation checks, coverage log, independence, failure reporting and decision-journal handoff; no strategy rule changes without approval. |
| G11 | **Mac runtime** | NOT INSTALLED/VERIFIED | Local Node dashboard and project-scoped Notion integration securely installed; OS startup/restart, sleep behavior and offline detection tested. IBKR manual reauthentication and maintenance windows handled explicitly. |
| G12 | **Dashboard delivery** | CODE EXISTS / NOT CONNECTED | Actual Mac preview opens, project-only Notion token kept out of repository, empty/stale/error states tested; no live holdings or trades shown until verified. |
| G13 | **Daily 19:00 PDF** | SCHEDULED / UNPROVEN | One-page, dated evening snapshot including source as-of, actual paper events and explicit absence of activity; document that US session is unfinished at 19:00 Paris. Verify rendered PDF, secure archive, Notion attachment or honest failure and notification delivery. |
| G14 | **Backups and integrity** | NOT BUILT | Versioned private snapshots, hashes and recovery tests for order/fill journal, positions, cash, source citations and decision history. Tested rollback/replay without double execution. |
| G15 | **Security and credentials** | PARTIAL | Private repository, no secrets committed, dedicated project-only read access for viewer. Need local keychain/secret storage, least-privileged paper broker session, safe log redaction, rotation/runbook and test that live credentials are never read. |
| G16 | **End-to-end negative testing** | OPEN | Offline preflight tests pass; must test duplicate requests, partial fills, order modification/cancellation, market closure, stale quote, FX gap, feed outage, Notion failure, Mac sleep, authentication loss, broker rejection and forced live-account mismatch using controlled fixtures. |
| G17 | **Day-zero dry run** | BLOCKED | Approved strategy, eligible paper session, baseline €1,000 cash recorded, zero open orders, initial empty positions reconciled, first paper trade with traceable fill, complete dashboard reconciliation and first truthful report. Paper only. |

**Launch authorization:** all G01–G17 must be demonstrably satisfied; do not equate a green CI unit-test job with production paper readiness. Recheck immediately after IBKR activation. The current execution preflight module is *pure, disconnected, and disabled by default*; it does not submit orders. A future adapter must invoke it and prove its inputs against broker-provided data. This audit authorizes no live-money trading.

## Control matrix: non-negotiable negative tests
1. Live instead of paper username/session/account or live API port -> reject order; stop all subsequent transmissions.
2. IBKR account buying power exceeds independent €1,000 strategy cash -> reject overspend.
3. Insufficient EUR strategy cash after fees, FX and slippage -> reject.
4. Delayed/indicative/stale quote, missing permission, closed market or unknown contract -> reject.
5. Missing reviewed strategy rules or explicit paper execution enablement -> reject.
6. Unknown outstanding order or ledger/broker divergence -> freeze, reconcile, *never blind retry*.
7. Partial fill followed by disconnect -> replay only previously unrecorded broker fills; preserve `execId` uniqueness.
8. Attempted leverage, short or disallowed instrument under the approved mandate -> reject.
9. Notion API quota/outage or reporting upload failure -> queue observations safely, retain immutable evidence, alert; no invented PDF link or holdings.
10. Mac sleep/restart or weekend reauthentication -> no phantom fills or retrospective orders; state 'not monitored' when applicable.
11. Stale account/FX/price source, missing reconciled cash or mathematically inconsistent NAV -> suppress unverified performance.
12. Strategy decision outside approved universe or without dated source evidence -> hold for review; don't convert a research idea directly into an order.

## Operational architecture without changing the investment strategy
**Existing strategy (authoritative, pending review)** → **dated decision record** → **independent paper risk/account gate** → **IBKR PAPER only** → **broker execution receipts + append-only ledger** → **positions, €1,000-strategy cash and dated reconciled NAV** → **project Notion observation views** → **Mac dashboard + 19:00 PDF**.

Research and reporting are separate schedules; neither currently constitutes a trading engine. The dashboard and reporting layer remain read-only. Research findings are not investment decisions unless the approved system records them as such.

## Broker-specific facts to retest at activation
- Paper accounts generally have a default simulated USD 1m equity figure; ledger must independently enforce €1,000 strategy *initial* capital.
- IBKR TWS API normally uses TWS 7497 or IB Gateway 4002 for paper; 7496/4001 are live defaults. Port is *not proof* of account type; verify actual authenticated account ID and environment.
- Paper trades are simulated; fills differ from real venue execution. Reconcile `orderStatus`, `openOrder`, `execDetails`, commission information and account state.
- No continuous event-driven execution while the Mac is off or asleep. Manual authentication is periodically required; don't store 2FA credentials or bypass broker protections.
- Market data may be delayed without entitlements. Do not assume all products support fractional trading or are accessible to a French/EU investor.

## Primary technical references
- IBKR paper behavior: https://www.interactivebrokers.com/campus/glossary-terms/paper-trading-account/
- IB Gateway operating model: https://www.interactivebrokers.com/docs/tws-api/doc/architecture/the-trader-workstation/the-ib-gateway
- TWS/Gateway paper vs live ports: https://www.interactivebrokers.com/docs/tws-api/sync-doc/connect-start-connection
- Paper connection verification: https://www.interactivebrokers.com/docs/tws-api/doc/connectivity/verify-api-connection
- Execution IDs / partial fills: https://www.interactivebrokers.com/docs/tws-api/ref/execution
- Required order callbacks: https://www.interactivebrokers.com/docs/tws-api/doc/orders/place-order/order-placement-considerations

## Immediate next work without IBKR login
1. Review and freeze the exact existing investment mandate before any execution implementation.
2. Specify append-only order/fill journal, double-entry-style cash/position reconciliation and baseline initialization.
3. Build an offline IBKR-paper adapter against fixtures, with no order endpoint connected; add fault-injection tests.
4. Install / smoke-test the Mac viewer with a separate, read-only Notion integration and secure local credentials.
5. Test daily PDF generation, permanent private archival, attachment failures, schedule delivery and stale-status warnings.
6. Once IBKR paper credentials are available: verify paper environment, market data and account permissions; then controlled zero-risk dry runs, then explicitly enabled **paper-only** order tests. No real-money functionality.

**Final audit verdict (14 October 2026): RED — NOT YET READY FOR AUTONOMOUS PAPER EXECUTION.**
