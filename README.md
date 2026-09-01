# Debrief

**An AI trading journal that grades your process, not your P&L.**

Debrief reads your trade history export (TradingView, Tradovate, or most broker CSVs) and reviews your session against *your own* stated trading rules — not generic signals, not buy/sell advice. It surfaces the behavioral patterns traders don't catch on their own: overtrading, sizing up after losses, revenge re-entries, and hidden time-of-day edges.

Built and beta-tested on real trade data (100+ trade sample sets across futures and forex) while actively trading NQ micros and gold micros.

**[Live demo →][https://claude.ai/public/artifacts/18c5771d-2932-4af3-a28c-a30c33ddfe83](https://claude.ai/public/artifacts/ec8604c5-a227-4e52-ab2b-b719896d21bf)**
---

## What it does

- **Session & period debriefs** — drop a CSV, get an AI-generated grade (A–F) on process, not outcome. A losing trade that followed the rules can grade well; a winning trade that broke them can't.
- **Deterministic import engine** — recognizes broker/TradingView export formats (including formats with no explicit Buy/Sell column, where direction has to be derived from fill-order timestamps) and falls back to a user-confirmed column-mapping preview for anything it doesn't recognize. Trade data is parsed locally before any AI call — the model never has to guess what a CSV means.
- **Deep analytics engine** — hour-by-hour P&L, quick re-entries after losses, size-after-win vs. size-after-loss, and streak/drawdown tracking, computed in code so the numbers are always exact, then handed to the AI as ground truth for interpretation.
- **Market context, not signals** — a daily brief and a post-session "what was the market doing?" replay, both web-search-backed, translating economic events into plain-language risk context for the trader's specific strategy. Never a price call.
- **Playbook decoder** — reconstructs a trader's actual strategy from their logged behavior, including the gap between what they *say* they do and what their fills show.
- **Freemium model** — free tier debriefs one session at a time; premium unlocks full-period analysis, the deep analytics engine, the Playbook, and a conversational "ask your debrief" feature.

## Why

Most trading journals ask you to manually log every trade and self-report your own mistakes — which means the traders who most need the feedback are the ones least likely to log it honestly. Debrief flips that: it reads your actual fills and holds them up against the rules you already wrote down for yourself.

## Status

Early beta. Currently distributed as an interactive prototype for direct feedback from a small group of testers before a full backend build (auth, persistent broker sync via the Tradovate API, and historical chart replay).

## Stack

React · Papaparse (deterministic CSV parsing) · Anthropic API (Claude) for review generation and web-search-backed market context.

## Roadmap

- [ ] Broker auto-sync (Tradovate API) — no file export required
- [ ] Chart replay: historical 1-minute bars around every entry/exit
- [ ] Expanded broker format library (NinjaTrader, IBKR, thinkorswim)
- [ ] Full account system + Stripe billing

---

Built by [Keenan](https://github.com/) — finance & entrepreneurship, Babson College.

---

## Running it locally

```bash
npm install
npm run dev
```

## Deploying

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds the app and publishes it to
GitHub Pages on every push to `main`. Enable it once under **Settings → Pages → Source: GitHub
Actions**.

### Turning the AI features on

The app calls the Anthropic API, which requires a key — and a key shipped to the browser is a
public key. So the API calls in `src/api.js` go to a proxy you control rather than straight to
`api.anthropic.com`:

1. Deploy a small proxy (a Cloudflare Worker or Vercel function is enough) that holds
   `ANTHROPIC_API_KEY` and forwards `POST /v1/messages` to the Anthropic API.
2. Add its origin as a repository variable named `API_BASE`
   (**Settings → Secrets and variables → Actions → Variables**).

Without it the app deploys in demo mode: CSV import, column mapping, and trade parsing all work
locally, and the AI review reports itself as unavailable instead of failing silently.
