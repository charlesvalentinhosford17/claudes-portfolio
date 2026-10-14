# ChatGPT's Portfolio

An independent, private **paper-investing observation dashboard**. It displays the portfolio, paper-trade log, research watchlist, activity timeline and dated performance history. It does **not** make investing decisions or execute any orders.

The only private data sources used by this application are the four Notion databases created **inside ChatGPT's Portfolio**. It never imports, queries, synchronizes or modifies any other investment project or brokerage account.

## Current state

This is the **viewer**, not the investing engine. A separate research task can create or update the watchlist. No genuine paper holdings, paper fills or NAV snapshots have been recorded yet, so the corresponding views deliberately display empty states, never invented numbers.

## Run locally

Requires Node.js 20 or newer. No package installation or third-party dependencies.

1. Clone this private repository, then run: \`npm start\`
2. Open \`http://127.0.0.1:8787\`.
3. Initially the interface will show **Not connected** until Notion is configured.
4. To connect, create a **new, read-only Notion integration for this project only**, give it access exclusively to this project's four databases, then put the token in your local environment as \`NOTION_TOKEN\`. Do not send it into a conversation or commit it to GitHub.
5. Restart the server. Data from Notion is fetched server-side; the browser never receives the token.

Example for a local shell: \`NOTION_TOKEN=your_private_token npm start\`. Prefer a private environment manager over saving credentials to files.

## Private hosting (optional)

A cloud host running Node 20+ (e.g. Railway or Render) can run \`npm start\` with this private repo.

Set these **secret environment variables through the hosting provider UI**, not in GitHub:
- \`NOTION_TOKEN\`: read-only integration token with access solely to this project's four databases.
- \`DASHBOARD_PASSWORD\`: long, unique password (minimum 12 characters; 20+ recommended).
- \`HOST=0.0.0.0\` for the cloud runtime; the server refuses a non-loopback address without a password.
- \`NODE_ENV=production\` so the authentication cookie is Secure; the host must serve the application over **HTTPS**.
- \`PORT\` only if the host does not supply it.

The built-in password gate is suitable as an initial private viewer, not an enterprise identity system. For a long-running public-internet deployment, additionally enable the hosting provider's access controls or SSO, HTTPS, private access and audit logging. Do **not** enable public GitHub Pages: a static site cannot safely hold the Notion token and private financial records.

## Data contract

The server uses the existing, independent ChatGPT's Portfolio sources only:
- Holdings: \`04792c14-6a6d-46fd-9157-19d5dfd76e67\`
- Watchlist: \`bde219e6-2cac-45f2-a824-ea222a4c0bc8\`
- Activity (including simulated paper-trade events): \`3b4de5e5-2ce0-430d-bb7d-c12db4d10aac\`
- Performance history: \`81b3bf2a-8ff1-4f45-8df9-567f770ed6dc\`

The source IDs are *fixed* to enforce separation. Do not repoint them to another portfolio. The viewer makes read-only Notion queries and never submits trades or Notion updates. It filters holdings to \`Position type = Paper\`; trade history only displays completed \`Paper trade\` activity events (with the notes actually recorded). A future dedicated execution ledger can replace the activity-based trade display, but **none is fabricated or inferred today**.

The main NAV and P&L are shown only where the separate performance-history database contains dated, complete values. No missing cash balance, entry price, return, or FX rate is guessed. Refreshing the web page does not produce new investment research or simulated trades; that requires a separate investment workflow to record the event in these databases.

- The browser polls the read-only API every 5 minutes while visible.
- The server caches successful Notion queries for 90 seconds to respect API limits.
- Every page includes source dates and clear disconnected/stale labels.
- A backend fetch failure never silently reports the prior response as current.

## Checks

Run \`npm test\` to validate data normalisation and financial empty-state rules. \`npm start\` starts the standalone local viewer.

## Security boundaries

No broker access, API key embedded in client JavaScript, token in the repository, automatic trades, writes from the viewer, fake holdings, or imports from unrelated Notion workspaces. The app starts bound to \`127.0.0.1\`. No live broker account should be connected during the paper phase.
