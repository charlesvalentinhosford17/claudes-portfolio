# Daily report (design v2)

`daily_report.py` renders the one-page "Claude's Portfolio — Daily Report" PDF used by the
"Portfolio · Daily report" routine. It is the template that used to be pasted into the routine prompt.

    python3 reports/daily_report.py data.json Claudes_Portfolio_Daily_Report_<YYYY-MM-DD>.pdf

- `example.json` shows every field the template expects (shape only).
- `test_daily_report.py` renders the example and checks it fits on one page with built-in Helvetica.
  It needs `reportlab` and `pypdf` and is deliberately not part of `npm test`.
