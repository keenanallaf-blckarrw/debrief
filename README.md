# Debrief

**An AI performance coach for traders. It grades every session against *your* rules, not your P&L.**

*I wrote the rules. I broke them anyway.* Debrief reads your trades straight from your broker's export, checks every one against the rules you wrote for yourself, and shows exactly where you went off script: overtrading, revenge re-entries, sizing up after losses, trading through your daily loss limit. An AI coach then explains it in plain words. No signals, no buy/sell advice. An honest mirror.

Built by [Keenan](https://github.com/keenanallaf-blckarrw) (finance & entrepreneurship, Babson College) while trading NQ and gold micros, and beta-tested with traders from a gold trading Discord.

**[Try the web demo →](https://keenanallaf-blckarrw.github.io/debrief/)** It runs in your browser with sample data, and nothing is uploaded. Install Debrief (below) for automatic imports, trade replays on real candles and the AI coach.

---

## What's new in version 2

- **Trades import themselves.** The Debrief companion watches your Downloads folder. Export from TradingView or Tradovate as usual and the trades appear within seconds, even if Debrief was closed. No API keys, and it works with prop firm accounts (the Tradovate API doesn't).
- **Every export format, no duplicates.** Tradovate Position History, Performance, Orders and Cash History; TradingView order history and notifications log; NinjaTrader and any other broker's CSV (you confirm the columns once). Drop the same file twice, or three reports covering the same fills, and each trade is counted once.
- **Rules checked by code, not guessed.** Max trades a day, daily loss limit, stop after N losses, cooldown after a loss, trading hours, no trading around big news, max size, no sizing up after a loss, stops, and your own checklist items. Each session gets a grade: rules followed ÷ rules checked ("2 of 6 rules broken" = D).
- **Account Guard for prop firm evaluations.** Daily loss limit, trailing or static drawdown, profit target and consistency rule, tracked from every closed trade.
- **Every trade replayed on a TradingView chart.** Real 1-minute candles around each trade (TradingView Lightweight Charts, installed with Debrief), with arrows at every fill.
- **Insights that explain your money.** Equity curve, P&L calendar, your edge by hour, weekday and trade number, and plain-English findings like "Rule-breaking trades: -$860. Clean trades: +$1,240."
- **The AI coach, upgraded.** Session debriefs, week/month debriefs, "Ask your coach", the Playbook decoder, a daily market brief and "What was the market doing?", all on Claude Opus 5.5, with your key kept on your own computer.
- **Fixed from version 1:** Tradovate's `$(70.00)` losses were counted as wins; Excel-saved files with 2-digit years lost their times; nothing was saved outside the Claude artifact.

---

## How to install and run it

You need a Mac or PC with **Node.js** (the program that runs Debrief). You install things once; after that, starting Debrief is one double-click.

### First time only

1. Install Node.js if you don't have it: go to [nodejs.org](https://nodejs.org), download the **LTS** version and run the installer. (To check, open Terminal and type `node -v`. Any version 22.12 or newer works.)
2. Open the **Terminal** app (press Command + Space, type `Terminal`, press Return).
3. Go to the Debrief folder. Type this and press Return:
   ```
   cd ~/debrief
   ```
4. Install Debrief's building blocks. Type this and press Return (takes about a minute):
   ```
   npm install
   ```

### Every day

- **Easiest:** double-click **Start Debrief.command** in the `debrief` folder. (The first time, macOS may ask whether to open it; click Open.)
- **Or in Terminal:** type `cd ~/debrief`, press Return, then type `npm start` and press Return.

Debrief opens in your browser at **http://localhost:4317**. Leave the Terminal window open while you trade; close it (or press Control + C) to stop Debrief.

### Turn on the AI coach (optional)

Everything except the AI coach works without it: importing, grading, the Account Guard, charts and insights.

1. Go to [console.anthropic.com](https://console.anthropic.com/settings/keys), sign in, and click **Create Key**. Copy the key (it starts with `sk-ant-`).
2. In Debrief, open **Settings**, paste the key under **AI coach**, and click **Save key**.

The key is checked, then saved on your computer only (in Debrief's data folder, readable only by you). It never goes into the browser or into this repository. AI requests are billed to your Anthropic account; one session debrief costs a few cents.

---

## Getting your trades in

**Automatic (recommended):** with Debrief running, just export from your platform. The companion picks up any recognized export that lands in your Downloads folder. The first time, click **Scan my Downloads** to import the exports you already have.

**Manual:** click **Import trades** and drop one or more files, or paste CSV rows.

| Platform | What to export | Where |
|---|---|---|
| Tradovate (and most prop firm accounts) | **Position History** (best), Performance, Orders, **Cash History** (adds real commissions and your starting balance) | ☰ menu → Reports → pick dates → Download |
| TradingView | Order history, **Notifications log** (shows your stops) | Trading Panel → History / Notifications log → Export data |
| NinjaTrader | Trades grid | Trade Performance → Generate → right-click → Export |
| Anything else | Any CSV trade list; PDFs work when the AI coach is on | Confirm the columns once |

Tip: import the file straight from the download. Opening it in Excel or Numbers and saving it again strips the seconds from every time.

---

## Free and Pro

**Free:** automatic import, the journal, trade charts, rule grading, the Account Guard, the equity curve and calendar, the market calendar, and a short AI debrief per session.

**Pro:** the deep breakdowns (hour, weekday, trade number, hold time), habit tracking, week/month AI debriefs, Ask your coach, and the Playbook decoder. During the beta, Pro unlocks with a code (`DEMO` by default; set `VITE_PRO_CODE` when building to change it). The code is a convenience gate, not security; real billing needs accounts and a server.

---

## Where your data lives

- **Your journal** (trades, rules, notes, debriefs) is saved in your browser on this computer. Nothing is uploaded anywhere.
- **Backups:** the companion keeps a daily copy in its data folder, `~/Library/Application Support/Debrief/backups/` on a Mac (Settings shows the exact path). You can also export a backup file from Settings.
- The same data folder holds the saved news calendar, saved price candles and your AI key. It's deliberately outside the project folder, so none of it can end up on GitHub.

---

## Honest limitations

- **TradingView has no public API for your trade history,** so Debrief reads the exports TradingView and your broker already give you. It uses TradingView's open-source charting library for the charts.
- **Tradovate's API** needs a live funded account, a $25/month add-on, and isn't available for prop firm or evaluation accounts, which is why Debrief watches your exports instead.
- **Price candles** come from Yahoo Finance's free chart data (continuous front-month contract). Yahoo keeps 1-minute candles for 30 days, so Debrief saves each trade's candles right after you import it. Fine for your own journal; a commercial launch would need a licensed data feed.
- **The economic calendar** comes from Forex Factory's free weekly feed, which only shows the current week. Debrief saves each week, so your news history builds up from the day you start.
- **Account Guard** checks closed trades only; prop firms also count open-trade swings.

---

## For developers

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS for the app; a small Node server in TypeScript (Hono) for the companion; TradingView Lightweight Charts; Papaparse; the Anthropic TypeScript SDK (Claude Opus 5.5 with structured outputs). Trade import, analytics and rule grading live in `shared/` and run in both the browser and the companion.

```
shared/        trade engine: importers, dedupe, round trips, rules, stats, AI prompts (unit-tested)
server/        the companion: folder watcher, AI coach, candles, calendar, backups
src/           the React app: pages in src/features/, charts in src/charts/
tests/         unit tests with made-up fixture exports (no real account data)
```

| Command | What it does |
|---|---|
| `npm start` | Build the app and start the companion at http://localhost:4317 |
| `npm run dev` | Development mode with instant reload (app on :5173, companion on :4317) |
| `npm test` | Run the unit tests |
| `npm run typecheck` | Check the TypeScript types |
| `npm run check` | Types + tests + production build |
| `npm run build:pages` | Build the browser-only demo for GitHub Pages |
| `npm run deploy` | Test, build and publish the web demo to GitHub Pages |

**Optional settings:** copy `.env.example` to `.env` to change the watched folder, port, data folder, or AI model.

**Web demo:** `npm run deploy` publishes the browser-only version to the `gh-pages` branch, which GitHub Pages serves at https://keenanallaf-blckarrw.github.io/debrief/. Run it again after changes. Without the companion, the demo imports and grades trades in the browser (and can watch a folder in Chrome); the AI coach, auto-import while Debrief is closed, and price candles need the companion running on your computer.

---

Copyright (c) 2026 Keenan. All rights reserved. See [LICENSE](LICENSE).
