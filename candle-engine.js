export class CandleEngine {
  constructor() {
    this.current = new Map();
    this.completed = new Map([[60, []], [300, []], [900, []]]);
  }

  _bucket(ts, seconds) { return Math.floor(ts / seconds) * seconds; }

  updateTick(tick) {
    const ts = Math.floor((tick.timeMs ?? Date.now()) / 1000);
    const finished = [];
    for (const tf of [60, 300, 900]) {
      const bucket = this._bucket(ts, tf);
      const key = String(tf);
      let c = this.current.get(key);
      if (!c || c.epoch !== bucket) {
        if (c) {
          const arr = this.completed.get(tf);
          arr.push(c);
          if (arr.length > 600) arr.shift();
          finished.push({ tf, candle: c });
        }
        c = { epoch: bucket, open: tick.mid, high: tick.mid, low: tick.mid, close: tick.mid };
        this.current.set(key, c);
      } else {
        c.high = Math.max(c.high, tick.mid);
        c.low = Math.min(c.low, tick.mid);
        c.close = tick.mid;
      }
    }
    return finished;
  }

  seed(tf, candles) {
    if (!Array.isArray(candles)) return;
    this.completed.set(tf, candles.slice(-600));
  }

  get(tf) { return this.completed.get(tf) || []; }
  last(tf, n=1) { return this.get(tf).slice(-n); }
}
