export class Metrics {
  constructor() {
    this.ticks = 0;
    this.signals = 0;
    this.orders = 0;
    this.fills = 0;
    this.rejections = 0;
    this.errors = 0;
    this.latency = [];
    this.lastTickAt = 0;
  }
  tick() { this.ticks++; this.lastTickAt = Date.now(); }
  signal() { this.signals++; }
  order() { this.orders++; }
  fill() { this.fills++; }
  reject() { this.rejections++; }
  error() { this.errors++; }
  recordLatency(ms) {
    if (!Number.isFinite(ms)) return;
    this.latency.push(ms);
    if (this.latency.length > 5000) this.latency.shift();
  }
  snapshot() {
    const a = [...this.latency].sort((x,y)=>x-y);
    const pct = p => a.length ? a[Math.min(a.length-1, Math.floor((a.length-1)*p))] : 0;
    return {
      ticks: this.ticks,
      signals: this.signals,
      orders: this.orders,
      fills: this.fills,
      rejections: this.rejections,
      errors: this.errors,
      lastTickAt: this.lastTickAt,
      latencyMs: { p50: pct(.5), p95: pct(.95), p99: pct(.99), max: a.at(-1) || 0 }
    };
  }
}
