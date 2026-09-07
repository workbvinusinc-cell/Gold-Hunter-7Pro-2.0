const clamp = (v, min, max) =>
  Math.max(min, Math.min(max, v));

const range = c =>
  Math.max(0, Number(c.high) - Number(c.low));

const body = c =>
  Math.abs(Number(c.close) - Number(c.open));

const bullish = c =>
  Number(c.close) > Number(c.open);

const bearish = c =>
  Number(c.close) < Number(c.open);

const ema = (values, period) => {
  if (!values.length) return 0;

  const p = Math.max(1, period);
  const k = 2 / (p + 1);

  let result = Number(values[0]);

  for (let i = 1; i < values.length; i++) {
    result =
      Number(values[i]) * k +
      result * (1 - k);
  }

  return result;
};

const atr = (bars, period = 14) => {
  if (!bars.length) return 0;

  const trs = [];

  for (let i = 0; i < bars.length; i++) {
    const current = bars[i];

    if (i === 0) {
      trs.push(range(current));
      continue;
    }

    const previous = bars[i - 1];

    trs.push(
      Math.max(
        range(current),
        Math.abs(
          Number(current.high) -
          Number(previous.close)
        ),
        Math.abs(
          Number(current.low) -
          Number(previous.close)
        )
      )
    );
  }

  const sample = trs.slice(
    -Math.min(period, trs.length)
  );

  return sample.length
    ? sample.reduce((a, b) => a + b, 0) / sample.length
    : 0;
};

const slope = (values, lookback = 5) => {
  if (values.length < lookback + 1) return 0;

  const now = Number(values.at(-1));
  const old = Number(
    values.at(-(lookback + 1))
  );

  if (!old) return 0;

  return (now - old) / Math.abs(old);
};

const highest = (bars, field, n) => {
  const sample = bars.slice(-n);

  if (!sample.length) return 0;

  return Math.max(
    ...sample.map(x => Number(x[field]))
  );
};

const lowest = (bars, field, n) => {
  const sample = bars.slice(-n);

  if (!sample.length) return 0;

  return Math.min(
    ...sample.map(x => Number(x[field]))
  );
};

export class Strategy {
  constructor(config) {
    this.c = config;

    this.lastSignalAt = {
      BUY: 0,
      SELL: 0
    };

    this.lastLevel = {
      BUY: 0,
      SELL: 0
    };
  }

  evaluate({
    m15,
    m5,
    m1,
    tick,
    spread
  }) {
    if (
      !Array.isArray(m15) ||
      !Array.isArray(m5) ||
      !Array.isArray(m1) ||
      !tick
    ) {
      return null;
    }

    if (
      m15.length < 55 ||
      m5.length < 55 ||
      m1.length < 25
    ) {
      return null;
    }

    if (!Number.isFinite(Number(tick.mid))) {
      return null;
    }

    if (
      !Number.isFinite(Number(spread)) ||
      spread > this.c.maxSpread
    ) {
      return null;
    }

    /*
     * Ignore currently forming candles.
     * We make decisions from completed candles.
     */
    const c15 = m15.slice(0, -1);
    const c5 = m5.slice(0, -1);
    const c1 = m1.slice(0, -1);

    if (
      c15.length < 50 ||
      c5.length < 50 ||
      c1.length < 20
    ) {
      return null;
    }

    /*
     * =====================================================
     * 15M REGIME
     * =====================================================
     */

    const close15 = c15.map(x => Number(x.close));

    const ema21_15 = ema(close15, 21);
    const ema50_15 = ema(close15, 50);

    const last15 = c15.at(-1);
    const previous15 = c15.at(-2);

    const atr15 = atr(c15, 14);

    if (!(atr15 > 0)) return null;

    let bull15 = 0;
    let bear15 = 0;

    if (last15.close > ema21_15) bull15 += 15;
    if (last15.close < ema21_15) bear15 += 15;

    if (ema21_15 > ema50_15) bull15 += 15;
    if (ema21_15 < ema50_15) bear15 += 15;

    if (last15.close > previous15.close) bull15 += 10;
    if (last15.close < previous15.close) bear15 += 10;

    const slope15 = slope(close15, 5);

    if (slope15 > 0) bull15 += 10;
    if (slope15 < 0) bear15 += 10;

    const range15 = range(last15);

    /*
     * Extremely small candles indicate compression.
     */
    const compressed15 =
      range15 < atr15 * 0.35;

    if (compressed15) {
      bull15 -= 10;
      bear15 -= 10;
    }

    let regime = 'RANGE';
    let direction = null;

    if (bull15 >= 30 && bull15 > bear15 + 8) {
      regime = 'BULL';
      direction = 'BUY';
    } else if (
      bear15 >= 30 &&
      bear15 > bull15 + 8
    ) {
      regime = 'BEAR';
      direction = 'SELL';
    }

    if (!direction) return null;

    /*
     * =====================================================
     * 5M SETUP
     * =====================================================
     */

    const close5 = c5.map(x => Number(x.close));

    const ema21_5 = ema(close5, 21);
    const ema50_5 = ema(close5, 50);

    const atr5 = atr(c5, 14);

    if (!(atr5 > 0)) return null;

    const last5 = c5.at(-1);
    const prev5 = c5.at(-2);

    let setupScore = 0;
    let setup = null;

    /*
     * Trend continuation
     */
    const trendContinuation =
      direction === 'BUY'
        ? (
            last5.close > ema21_5 &&
            ema21_5 > ema50_5 &&
            bullish(last5)
          )
        : (
            last5.close < ema21_5 &&
            ema21_5 < ema50_5 &&
            bearish(last5)
          );

    if (trendContinuation) {
      setupScore += 20;
      setup = 'MOMENTUM_CONTINUATION';
    }

    /*
     * Breakout
     */
    const previousRange5 = c5.slice(-7, -1);

    const priorHigh5 = highest(
      previousRange5,
      'high',
      previousRange5.length
    );

    const priorLow5 = lowest(
      previousRange5,
      'low',
      previousRange5.length
    );

    const breakoutBuy =
      last5.close > priorHigh5 &&
      bullish(last5);

    const breakoutSell =
      last5.close < priorLow5 &&
      bearish(last5);

    if (
      direction === 'BUY' &&
      breakoutBuy
    ) {
      setupScore += 25;
      setup = 'BREAKOUT';
    }

    if (
      direction === 'SELL' &&
      breakoutSell
    ) {
      setupScore += 25;
      setup = 'BREAKOUT';
    }

    /*
     * Liquidity sweep
     */
    const sweepBars = c5.slice(-11, -1);

    const sweepHigh = highest(
      sweepBars,
      'high',
      sweepBars.length
    );

    const sweepLow = lowest(
      sweepBars,
      'low',
      sweepBars.length
    );

    const sweepBuy =
      last5.low < sweepLow &&
      last5.close > sweepLow &&
      bullish(last5);

    const sweepSell =
      last5.high > sweepHigh &&
      last5.close < sweepHigh &&
      bearish(last5);

    if (
      direction === 'BUY' &&
      sweepBuy
    ) {
      setupScore += 25;
      setup = 'LIQUIDITY_SWEEP';
    }

    if (
      direction === 'SELL' &&
      sweepSell
    ) {
      setupScore += 25;
      setup = 'LIQUIDITY_SWEEP';
    }

    if (!setup) return null;

    /*
     * M5 momentum confirmation
     */
    const bodyRatio5 =
      body(last5) /
      Math.max(range(last5), 1e-9);

    if (bodyRatio5 >= 0.55) {
      setupScore += 10;
    }

    /*
     * =====================================================
     * 1M ENTRY ENGINE
     * =====================================================
     */

    const atr1 = atr(c1, 14);

    if (!(atr1 > 0)) return null;

    const last1 = c1.at(-1);
    const prev1 = c1.at(-2);

    const bodyRatio1 =
      body(last1) /
      Math.max(range(last1), 1e-9);

    const displacement =
      range(last1) >= atr1 * 0.65 &&
      bodyRatio1 >= 0.45;

    if (!displacement) return null;

    let entryScore = 0;

    if (
      direction === 'BUY' &&
      bullish(last1)
    ) {
      entryScore += 15;
    }

    if (
      direction === 'SELL' &&
      bearish(last1)
    ) {
      entryScore += 15;
    }

    /*
     * Micro structure
     */
    const microHigh = highest(
      c1.slice(-6, -1),
      'high',
      5
    );

    const microLow = lowest(
      c1.slice(-6, -1),
      'low',
      5
    );

    const microBreak =
      direction === 'BUY'
        ? tick.mid > microHigh
        : tick.mid < microLow;

    if (microBreak) {
      entryScore += 15;
    }

    /*
     * Short-term momentum
     */
    const close1 = c1.map(x => Number(x.close));

    const ema8_1 = ema(close1, 8);
    const ema21_1 = ema(close1, 21);

    const momentumAligned =
      direction === 'BUY'
        ? (
            last1.close > ema8_1 &&
            ema8_1 > ema21_1
          )
        : (
            last1.close < ema8_1 &&
            ema8_1 < ema21_1
          );

    if (momentumAligned) {
      entryScore += 10;
    }

    /*
     * Tick direction
     */
    const tickAligned =
      direction === 'BUY'
        ? tick.mid >= last1.close
        : tick.mid <= last1.close;

    if (tickAligned) {
      entryScore += 10;
    }

    /*
     * =====================================================
     * SCORE
     * =====================================================
     */

    let score =
      bull15 >= bear15
        ? bull15
        : bear15;

    score =
      clamp(
        score * 0.30 +
        setupScore * 0.35 +
        entryScore * 0.35,
        0,
        100
      );

    /*
     * Require meaningful confluence.
     */
    if (score < 68) return null;

    /*
     * If the 1M micro-break is missing, require
     * a stronger overall score.
     */
    if (!microBreak && score < 78) {
      return null;
    }

    /*
     * =====================================================
     * ENTRY / SL / TP
     * =====================================================
     */

    const now = Date.now();

    if (
      now -
      this.lastSignalAt[direction] <
      this.c.cooldownMs
    ) {
      return null;
    }

    const entry =
      direction === 'BUY'
        ? Number(tick.ask)
        : Number(tick.bid);

    /*
     * Structure-based stop.
     */
    const structure =
      direction === 'BUY'
        ? lowest(c1, 'low', 8)
        : highest(c1, 'high', 8);

    let slDist =
      Math.abs(entry - structure);

    /*
     * Don't allow an absurdly small or large stop.
     */
    slDist = clamp(
      slDist,
      this.c.minSl,
      Math.min(
        this.c.maxSl,
        atr1 * this.c.maxSlAtr
      )
    );

    if (!(slDist > 0)) return null;

    const sl =
      direction === 'BUY'
        ? entry - slDist
        : entry + slDist;

    const tp =
      direction === 'BUY'
        ? entry + slDist * this.c.rr
        : entry - slDist * this.c.rr;

    /*
     * Avoid repeatedly firing around the same level.
     */
    const level =
      direction === 'BUY'
        ? microHigh
        : microLow;

    if (
      Math.abs(
        level -
        this.lastLevel[direction]
      ) < 0.05 &&
      now -
      this.lastSignalAt[direction] <
      60000
    ) {
      return null;
    }

    this.lastSignalAt[direction] = now;
    this.lastLevel[direction] = level;

    const quality =
      score >= 85
        ? 'A+'
        : score >= 78
          ? 'A'
          : 'B';

    return {
      id:
        `${direction}-${now}-` +
        Math.random()
          .toString(36)
          .slice(2, 8),

      dir: direction,

      price: entry,

      bid: Number(tick.bid),
      ask: Number(tick.ask),

      spread: Number(spread),

      sl,
      tp,
      slDist,

      rr: this.c.rr,

      score: Number(score.toFixed(2)),
      quality,

      regime,
      setup,

      reasons: [
        `15M regime: ${regime}`,
        `15M bull score: ${bull15}`,
        `15M bear score: ${bear15}`,
        `5M setup: ${setup}`,
        `5M setup score: ${setupScore}`,
        `1M displacement: confirmed`,
        `1M momentum: ${momentumAligned ? 'aligned' : 'weak'}`,
        `Micro-break: ${microBreak ? 'confirmed' : 'not confirmed'}`,
        `Tick direction: ${tickAligned ? 'aligned' : 'weak'}`,
        `Spread: ${Number(spread).toFixed(3)}`
      ],

      reason:
        `V3 ${quality}: ` +
        `${regime} + ${setup} + ` +
        `M1 displacement + ` +
        `${microBreak ? 'micro-break' : 'momentum'} + ` +
        `tick confirmation`,

      createdAt: now,

      expiresAt:
        now + this.c.signalExpiryMs
    };
  }
                                }
