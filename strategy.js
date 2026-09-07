const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const range = c => Math.max(0, c.high - c.low);
const body = c => Math.abs(c.close - c.open);
const ema = (values, p) => {
  if (!values.length) return 0;
  const k = 2/(p+1); let e = values[0];
  for (let i=1;i<values.length;i++) e = values[i]*k + e*(1-k);
  return e;
};
const atr = (bars,p=14) => {
  if (!bars.length) return 0;
  const trs=[];
  for(let i=0;i<bars.length;i++) trs.push(i===0 ? range(bars[i]) : Math.max(range(bars[i]), Math.abs(bars[i].high-bars[i-1].close), Math.abs(bars[i].low-bars[i-1].close)));
  const n=Math.min(p,trs.length); return trs.slice(-n).reduce((a,b)=>a+b,0)/n;
};

export class Strategy {
  constructor(config) { this.c = config; this.lastSignalAt = { BUY:0, SELL:0 }; this.lastLevel = { BUY:0, SELL:0 }; }

  evaluate({m15,m5,m1, tick, spread}) {
    if (m15.length < 55 || m5.length < 55 || m1.length < 25) return null;
    if (spread > this.c.maxSpread) return null;

    const m15c = m15.slice(0,-1), m5c = m5.slice(0,-1), m1c = m1.slice(0,-1);
    const b15 = ema(m15c.map(x=>x.close),21), s15 = ema(m15c.map(x=>x.close),50);
    const b5 = ema(m5c.map(x=>x.close),21), s5 = ema(m5c.map(x=>x.close),50);
    const bias15 = b15 > s15 ? 'BUY' : b15 < s15 ? 'SELL' : 'NONE';
    const bias5 = b5 > s5 ? 'BUY' : b5 < s5 ? 'SELL' : 'NONE';
    if (bias15 === 'NONE' || bias5 === 'NONE' || bias15 !== bias5) return null;
    const dir = bias5;

    const a1 = atr(m1c,14), a5 = atr(m5c,14);
    if (!(a1 > 0) || !(a5 > 0)) return null;
    const last5 = m5c.at(-1), prev5 = m5c.slice(-11,-1);
    const priorLow = Math.min(...prev5.map(x=>x.low)), priorHigh = Math.max(...prev5.map(x=>x.high));
    const sweepBuy = last5.low < priorLow && last5.close > priorLow && last5.close > last5.open;
    const sweepSell = last5.high > priorHigh && last5.close < priorHigh && last5.close < last5.open;
    const sweep = dir==='BUY' ? sweepBuy : sweepSell;
    if (!sweep) return null;

    const last1 = m1c.at(-1);
    const bodyRatio = body(last1)/Math.max(range(last1),1e-9);
    const displacement = range(last1) >= a1*0.85 && bodyRatio >= 0.45;
    if (!displacement) return null;

    const breakout = dir==='BUY' ? tick.mid > last1.high : tick.mid < last1.low;
    if (!breakout) return null;

    const level = dir==='BUY' ? last1.high : last1.low;
    const now = Date.now();
    if (now-this.lastSignalAt[dir] < this.c.cooldownMs) return null;
    if (Math.abs(level-this.lastLevel[dir]) < 0.08 && now-this.lastSignalAt[dir] < 60000) return null;

    const swing = dir==='BUY' ? Math.min(...m1c.slice(-8).map(x=>x.low)) : Math.max(...m1c.slice(-8).map(x=>x.high));
    const slDist = clamp(Math.abs(tick.mid-swing), this.c.minSl, Math.min(this.c.maxSl, a1*this.c.maxSlAtr));
    const sl = dir==='BUY' ? tick.mid-slDist : tick.mid+slDist;
    const tp = dir==='BUY' ? tick.mid+slDist*this.c.rr : tick.mid-slDist*this.c.rr;

    this.lastSignalAt[dir]=now; this.lastLevel[dir]=level;
    return {
      id: `${dir}-${now}-${Math.random().toString(36).slice(2,8)}`,
      dir, price: tick.mid, bid: tick.bid, ask: tick.ask, spread,
      sl, tp, slDist, rr:this.c.rr,
      quality: clamp(60 + (bodyRatio-.45)*80 + Math.min(20,(range(last1)/a1-0.85)*20), 60, 100),
      reason: `M15 ${bias15} + M5 ${bias5} + M5 liquidity sweep + M1 displacement + tick breakout`,
      createdAt: now,
      expiresAt: now + this.c.signalExpiryMs
    };
  }
}
