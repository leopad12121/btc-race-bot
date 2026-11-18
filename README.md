# btc-race-bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/leopad12121/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/leopad12121/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A long-only trend bot that trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute, on 1-minute on-chain prices — paper money only, nothing traded for real. Built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $250 in USDC.

## Strategy

- **Indicators** over 1-minute closes: EMA(60) and EMA(240), each seeded as the mean of its first span of closes; RSI(14), Wilder's.
- **Entry:** EMA(60) crosses above EMA(240) while RSI(14) is at most 60 — the cap keeps it from chasing a cross that fired after the move already ran. Buys with all of the cash.
- **Exit:** the whole position when EMA(240) crosses back above EMA(60), or the position is worth 1.5% over its cost, or 0.7% under it.
- **Discipline:** long only, at most one open position, no network, no wall clock, no randomness — the same bars always give the same orders.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin/stdout); `vendor/makefun-bars.ts` is a byte-identical copy of the kit's SDK shim. Grade it locally with the competition kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/btc-race-bot --driver process
```

## Dev result

On the published 1440-bar dev window: **net PnL +13.08 USDC** (1 round trip, win rate 1.0, max drawdown 0.64%, fees 0.81 USDC), guardrails met, deterministic across two executions.

---

<sub>Entered on [make.fun](https://make.fun/?ref=d5a50dzy&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
