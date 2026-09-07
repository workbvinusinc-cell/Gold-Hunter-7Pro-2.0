export class CandleEngine {
  constructor() {
    this.timeframes = [60, 300, 900];

    this.current = new Map();

    this.completed = new Map([
      [60, []],
      [300, []],
      [900, []]
    ]);

    this.lastTick = null;
  }

  _bucket(ts, seconds) {
    return Math.floor(ts / seconds) * seconds;
  }

  updateTick(tick) {
    if (!tick || !Number.isFinite(Number(tick.mid))) {
      return [];
    }

    const timeMs = Number(tick.timeMs) || Date.now();
    const ts = Math.floor(timeMs / 1000);

    this.lastTick = {
      ...tick,
      timeMs
    };

    const finished = [];

    for (const tf of this.timeframes) {
      const bucket = this._bucket(ts, tf);
      const key = String(tf);

      let candle = this.current.get(key);

      if (!candle || candle.epoch !== bucket) {
        if (candle) {
          const history = this.completed.get(tf);

          history.push({
            ...candle
          });

          while (history.length > 600) {
            history.shift();
          }

          finished.push({
            tf,
            candle: {
              ...candle
            }
          });
        }

        candle = {
          epoch: bucket,
          time: bucket * 1000,
          open: Number(tick.mid),
          high: Number(tick.mid),
          low: Number(tick.mid),
          close: Number(tick.mid),
          ticks: 1
        };

        this.current.set(key, candle);
      } else {
        candle.high = Math.max(
          candle.high,
          Number(tick.mid)
        );

        candle.low = Math.min(
          candle.low,
          Number(tick.mid)
        );

        candle.close = Number(tick.mid);
        candle.ticks += 1;
      }
    }

    return finished;
  }

  seed(tf, candles) {
    if (!this.completed.has(tf)) {
      this.completed.set(tf, []);
    }

    if (!Array.isArray(candles)) return;

    const clean = candles
      .filter(c =>
        c &&
        Number.isFinite(Number(c.open)) &&
        Number.isFinite(Number(c.high)) &&
        Number.isFinite(Number(c.low)) &&
        Number.isFinite(Number(c.close))
      )
      .map(c => ({
        epoch: Number(c.epoch ?? c.time ?? 0),
        time: Number(c.time ?? c.epoch ?? 0),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        ticks: Number(c.ticks ?? c.volume ?? 0)
      }));

    this.completed.set(
      tf,
      clean.slice(-600)
    );
  }

  get(tf) {
    return this.completed.get(tf) || [];
  }

  last(tf, n = 1) {
    return this.get(tf).slice(-n);
  }

  currentCandle(tf) {
    return this.current.get(String(tf)) || null;
  }

  size(tf) {
    return this.get(tf).length;
  }

  ready() {
    return (
      this.size(900) >= 55 &&
      this.size(300) >= 55 &&
      this.size(60) >= 30
    );
  }

  status() {
    return {
      m1: this.size(60),
      m5: this.size(300),
      m15: this.size(900),
      ready: this.ready()
    };
  }
}
