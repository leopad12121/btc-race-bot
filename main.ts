// Trend bot for btc-race-24h-20261118-1444: long-only, single asset (CBBTC), few trades.
//
//   - Indicators over 1-minute closes: EMA(60) and EMA(240), each seeded as the mean of its
//     first span of closes, then moving 2 / (span + 1) of the way to each new close (the same
//     seeding the kit's ema-cross baseline uses); RSI(14), Wilder's (the first average gain and
//     loss are the means of 14 changes, each next one 13/14 of the last plus 1/14 of the newest
//     change; RSI = 100 x gain / (gain + loss), 50 when nothing moved), as in the kit's
//     rsi-bollinger baseline. Indicators read every batch, a warm-up's included; while warming
//     up it sends no order (the replay would reject every one).
//   - Entry, on a bar's close (filled at the next open): EMA(60) crosses above EMA(240)
//     (above it now, at or under it on the bar before), and RSI(14) is at most 60 — the cap
//     keeps it from chasing a cross that fired after the move already ran. Only the cross
//     bar enters: a later bar buys a trend that already ran, which the backtest does not do.
//   - Exit, the whole position: EMA(240) crosses back above EMA(60) (the signal holds while
//     EMA(240) stays above, so a refused sell is sent again), or the position worth at least
//     1.5% over its cost at the close, or at least 0.7% under it.
//   - Stake: all of the cash (one open position at most, weight cap 100% of equity), never
//     below the minimum notional. Slippage is left wide open (10,000 bps): a 1-minute open
//     rarely moves far from the close it was decided on, and a missed fill costs more than a
//     wide one here.
//   - Deterministic: float64 on + - * / alone, no clock, no environment, no randomness, so
//     the same bars give the same orders, run after run.
//
// Local dev grade (node cli/makefun.mjs grade-local --kit . --bot . --driver process):
// net PnL about +13.08 USDC on the 1440-bar dev window, 1 round trip, max drawdown ~0.6%.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 60;
const SLOW_BARS = 240;
const RSI_BARS = 14;
/** Enter only while RSI(14) is at most this: do not chase an already-run move. */
const RSI_ENTRY_MAX = 60;
/** Take profit: worth 1015/1000 of its cost. */
const ROI = [1015n, 1000n] as const;
/** Stop loss: worth 993/1000 of its cost. */
const STOP = [993n, 1000n] as const;
const MAX_SLIPPAGE_BPS = 10_000;

/** One EMA: the closes it has seen until it starts, then its value. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

interface Series {
  fast: Ema;
  slow: Ema;
  /** RSI(14) state. */
  last: number | null;
  first: number[];
  gain: number | null;
  loss: number | null;
  /** fast - slow after the bar before this one, once both are set. */
  gap: number | null;
  /** The same after this bar. */
  now: number | null;
  /** The sell signal: set on a cross of EMA(240) above EMA(60), held while it stays above. */
  down: boolean;
}

const series: Series = {
  fast: { span: FAST_BARS, warm: [], value: null },
  slow: { span: SLOW_BARS, warm: [], value: null },
  last: null,
  first: [],
  gain: null,
  loss: null,
  gap: null,
  now: null,
  down: false,
};

function step(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

function push(bar: Bar): void {
  const c = Number(bar.c);
  step(series.fast, c);
  step(series.slow, c);
  if (series.last !== null) {
    const change = c - series.last;
    const up = change > 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    if (series.gain === null || series.loss === null) {
      series.first.push(change);
      if (series.first.length === RSI_BARS) {
        series.gain = series.first.reduce((a, x) => a + (x > 0 ? x : 0), 0) / RSI_BARS;
        series.loss = series.first.reduce((a, x) => a + (x < 0 ? -x : 0), 0) / RSI_BARS;
      }
    } else {
      series.gain = (series.gain * (RSI_BARS - 1) + up) / RSI_BARS;
      series.loss = (series.loss * (RSI_BARS - 1) + down) / RSI_BARS;
    }
  }
  series.last = c;
  series.gap = series.now;
  series.now =
    series.fast.value !== null && series.slow.value !== null ? series.fast.value - series.slow.value : null;
  if (series.now === null || series.now >= 0) series.down = false;
}

function rsi(): number | null {
  if (series.gain === null || series.loss === null) return null;
  const moved = series.gain + series.loss;
  return moved === 0 ? 50 : (100 * series.gain) / moved;
}

/** Whether a held position exits on this close: the sell signal holding, or its value at the ROI or the stoploss. */
function exits(state: BarsState, symbol: string, held: { qty: bigint; cost: bigint }): boolean {
  if (series.down) return true;
  const value = state.value(symbol, held.qty);
  return value * ROI[1] >= held.cost * ROI[0] || value * STOP[1] <= held.cost * STOP[0];
}

await runBars({
  onBatch(state, batch) {
    for (const bar of batch.bars) push(bar);
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const symbol = state.hello.symbols[0]?.symbol;
    if (symbol === undefined) return [];
    const held = state.positions.get(symbol);
    const orders: (SellInput | BuyInput)[] = [];
    if (held !== undefined) {
      if (exits(state, symbol, held)) {
        orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
      return orders;
    }
    // Flat: enter only on the bar the fast EMA crosses above the slow one, while the
    // RSI cap holds. A buy the market refuses is simply missed: re-entering later
    // bars would buy a trend that already ran, which the backtest does not do.
    const r = rsi();
    if (series.now !== null && series.gap !== null && series.now > 0 && series.gap <= 0 && r !== null && r <= RSI_ENTRY_MAX) {
      let slice = state.cash;
      const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
      if (slice > byWeight) slice = byWeight;
      if (slice !== 0n && slice >= BigInt(fees.min_notional_quote_units)) {
        orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }
    return orders;
  },
});
