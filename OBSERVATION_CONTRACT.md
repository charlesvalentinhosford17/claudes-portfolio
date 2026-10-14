# ChatGPT's Portfolio — Observation contract

This document is **only the dashboard's data-input specification**. It does not design, replace, or modify any investment strategy, decision rules, allocations, model prompts or execution policies.

## Project boundary

The viewer and scheduled daily PDFs observe **ChatGPT's Portfolio only**. No source, holdings, credentials, broker account or Notion data from The Terminal or another project may be imported. The project remains **paper-only** until explicitly changed.

## Recorded evidence determines what appears

1. **Watchlist** — independent Notion Watchlist (data source `bde219e6-2cac-45f2-a824-ea222a4c0bc8`). Research must include dated issuer/source evidence, research status, what changed and the last actual review date. Scheduled research does **not** imply a completed review until records are written.
2. **Paper executions** — independent Notion Activity (data source `3b4de5e5-2ce0-430d-bb7d-c12db4d10aac`). For a simulated fill, record `Category = Paper trade`, `Status = Completed`, `Event` with Buy/Sell, `Ticker`, `Date` and a `Details` field containing the instrument identity, units, filled price, quote currency, EUR conversion and fee assumptions, and the reason for the decision. A proposed, cancelled or unfilled order is **not** an execution. The web viewer filters to completed paper events only.
3. **Current holdings** — independent Notion Holdings (data source `04792c14-6a6d-46fd-9157-19d5dfd76e67`). Only rows with `Position type = Paper` can be displayed as paper holdings. The writer is responsible for reconciling holdings to confirmed fills and indicating `As of`; stale prices must remain marked as dated. The viewer does not guess values.
4. **Daily NAV** — independent Notion Performance History (data source `81b3bf2a-8ff1-4f45-8df9-567f770ed6dc`). A recorded snapshot contains the date, paper cash, position value, paper NAV, funding and (only when actually computed) realized/unrealized P&L and benchmark. NAV must reconcile cash plus positions, accounting for valid simulated transactions. Missing cash, FX, fees or quotes = not yet verified, not 0.
5. **Daily PDF report index** — independent Notion Daily Reports (data source `960094d4-1c87-4d41-9551-ababc1879698`). Each date has one factual summary, PDF attachment if uploaded successfully, and status; if the PDF is delivered through ChatGPT but unavailable as a Notion attachment, keep `Status = Incomplete` and say so explicitly. PDFs are stored separately in the private ChatGPT Library folder `/ChatGPTs Portfolio/Daily Reports`.

## What is connected, and what is not

- **Connected as structure**: The five independent Notion databases; the scheduled research task and scheduled daily PDF task; the private GitHub repository with a read-only website.
- **Still required**: deploy the private website and configure its **dedicated read-only Notion integration**, without exposing the token.
- **Not yet connected**: an autonomous paper-investment execution mechanism that produces auditable fills and recomputed holdings/NAV. Until it exists, the dashboard and PDFs show no completed simulated trades or measured investment performance. A blank ledger is accurate.
- **Not authorized**: broker access, IBKR funding or real-money orders.

## Report delivery

At 19:00 Europe/Paris daily, a separate ChatGPT task is scheduled to generate a concise one-page PDF covering the project's actual recorded activity that day, preserve it in the private ChatGPT Library and attempt to attach it to the Daily Reports Notion archive. It may report no changes rather than fabricate work. The dashboard displays attachments from Notion if available and never invents a PDF link.

Do not redesign the portfolio mechanism to accommodate this viewer; adapt the observation interface to the actual mechanism's verified output.
