# PG Budget

An offline-first iPhone web app (PWA) for tracking spending when you live in a PG and money arrives at irregular times. It shows where your money goes and tells you **when** and **how much** to save.

Data stays on your phone in IndexedDB. There is no account and no server.

## Run it

```bash
npm install
npm run dev          # http://localhost:5174 (add -- --host to open it from your iPhone on the same Wi-Fi)
npm test             # engine + CSV importer unit tests
npm run build        # typecheck + production build into dist/
```

## Put it on your iPhone

Installing to the Home Screen with offline support needs HTTPS hosting. Only the app code is hosted; your data never leaves the phone.

Live at **https://agrawalarnav129-ui.github.io/pg-budget/**

1. After making changes, run `npm run deploy`. It tests, builds, and publishes `dist/` to the `gh-pages` branch.
2. Open the URL in **Safari** → Share → **Add to Home Screen**.
3. Settings → **Export backup** every month or so (Save to Files / iCloud Drive).

## How the planning works

All logic lives in pure, tested functions in `src/engine/`.

| Concept | Rule |
|---|---|
| Spending money | Opening balance + money in − spent − moved to savings |
| Bills set aside | Fixed costs (rent, recharge…) due before your next expected money (or within 30 days) |
| Daily pace | Last 30 days of non-bill spending; blends in your estimate for the first 14 days |
| Safe to spend today | (Spending money − bills) ÷ days until next money; fixed at the start of the day |
| Runway | (Spending money − bills) ÷ daily pace |
| Money arrives | Cover bills first → save 15% of allowance (10% once the emergency fund is full), 50% of windfalls, 0% of refunds → cut back if it would leave under 21 days of runway |
| Sweep | If runway is > 1.25× the time until next money, save half the surplus |
| Emergency fund | 2 × monthly essentials (bills + need-type daily spending); savings fill it before goals |
| Alerts | Category > 25% above its usual week; delivery > 50% of food spending |
| Leaks | ≥ 5 small "want" spends totalling ≥ ₹500; delivery more than ~10 orders/month |

These are budgeting rules of thumb, not investment advice.

## Project layout

```
src/
  domain/      types, Mumbai-PG categories, merchant keyword rules
  engine/      planner.ts (balance, runway, split), analytics.ts (report), savePlan.ts
  import/      CSV + PDF statement parsing, column mapping, dedupe
  db/          Dexie schema, write actions, live hooks, sample data
  components/  UI kit + dependency-free SVG charts
  screens/     Onboarding, Home, AddEntry, History, Report, Import, Settings
scripts/        make-icons.mjs (PWA icons), make-sample-statement.mjs (test fixtures)
```

## Importing statements

**PDF** (easiest) or **CSV**, from a bank or from GPay / PhonePe / Paytm.

- Net banking → Account statement → download **PDF** or **CSV** (HDFC, SBI, ICICI, Axis, Kotak).
- Password-protected PDFs are handled; the app asks for the password and never stores it.
- Excel only? Open in Numbers → File → Export To → CSV.
- Re-importing the same statement skips what's already in, and "Always put X in Y" creates a merchant rule.

### How the PDF reader works

A PDF has no table structure, only text with coordinates, so `src/import/pdf.ts` rebuilds the
table: it groups text into lines by y, merges cells by x, keeps the lines that start with a date,
then clusters the x positions of the money figures into columns. The column whose change between
rows equals that row's own figure is the running balance — which is what makes money in vs money
out reliable, even across a page break or a negative balance. Wrapped narration on the next
baseline is joined back on; headers, totals and footers are dropped.

pdfjs is loaded only when you actually open a PDF, so it costs nothing on a normal app start.

Fixtures for the tests are generated, not checked in by hand:

```bash
node scripts/make-sample-statement.mjs   # plain + password-protected sample statements
```
