# Debrief

**An AI trading journal that grades your process, not your P&L.**

Debrief reads your trade history export (TradingView, Tradovate, or most broker CSVs) and reviews your session against *your own* stated trading rules — not generic signals, not buy/sell advice. It surfaces the behavioral patterns traders don't catch on their own: overtrading, sizing up after losses, revenge re-entries, and hidden time-of-day edges.

Built and beta-tested on real trade data (100+ trade sample sets across futures and forex) while actively trading NQ micros and gold micros.

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
