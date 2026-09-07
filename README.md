# XAUUSD Retail-HFT Execution Layer — Exness / MetaApi

This package converts the existing browser bot into a **low-latency retail execution architecture**:

- `frontend/index.html` — the existing UI, retained as the dashboard.
- `backend/` — the new execution engine. It owns the Exness/MetaApi streaming connection, tick processing, strategy decision, risk, order execution, position management and latency metrics.
- MetaApi streaming is used instead of the old 1.5-second browser REST polling.
- MetaApi credentials are server-side only; they are no longer required in the browser for the HFT path.
- The strategy is intentionally **retail-HFT style**, not institutional co-location HFT. It uses M15 → M5 → M1 context and tick-level entry timing.

## Install

```bash
npm install
cp .env.example .env
# edit .env
npm start
```

Open `http://YOUR_VPS_IP:8787`.

## Safety

`LIVE_TRADING=false` is the default. Start with an Exness demo MT5 account. Only set `LIVE_TRADING=true` after checking the connection, symbol specification, spread and order results.

The bot will refuse trades when:

- the MetaApi stream is unhealthy,
- the quote is stale,
- spread is above the configured ceiling,
- the daily loss limit is reached,
- position count is at the limit,
- risk sizing is invalid,
- an identical client order is already in-flight/open.

## MetaApi configuration

MetaApi's official streaming API is designed for automated trading and keeps a synchronized local terminal state. Subscribe to the Exness XAUUSD symbol and receive quote updates through a `SynchronizationListener`. Market orders are submitted over the same streaming connection. See the official docs before deployment.

For best quote cadence, configure the MetaApi account/replica quote streaming interval to `0` where your MetaApi plan/infrastructure supports it. MetaApi documents that `0` means receive quotes on each tick; sub-2.5-second intervals require G2 infrastructure.

## VPS placement

Put the VPS geographically close to the MetaApi/Exness route. Do not run the trading engine from a phone browser, GitHub Pages or a laptop that sleeps. The PWA is now the monitor/control surface, not the execution venue.

## What this does not claim

It is not guaranteed profitable and it is not exchange-grade/institutional HFT. It is a low-latency retail XAUUSD execution system designed to reduce avoidable browser/polling latency and make execution event-driven.
