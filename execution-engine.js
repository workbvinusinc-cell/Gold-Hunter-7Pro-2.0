import { CandleEngine } from './candle-engine.js';
import { Strategy } from './strategy.js';
import { RiskEngine } from './risk.js';
import { CONFIG } from './config.js';
import { Metrics } from './metrics.js';

export class ExecutionEngine {
  constructor(broker) {
    this.broker=broker; this.candles=new CandleEngine(); this.strategy=new Strategy(CONFIG); this.risk=new RiskEngine(CONFIG); this.metrics=new Metrics();
    this.clients=new Set(); this.enabled=true; this.open=new Map(); this.inFlight=new Set(); this.lastSignal=null; this.startedAt=Date.now();
    broker.onTick(t=>this.onTick(t));
  }
  broadcast(msg){ const s=JSON.stringify(msg); for(const ws of this.clients){if(ws.readyState===1) ws.send(s);} }
  addClient(ws){this.clients.add(ws); ws.on('close',()=>this.clients.delete(ws)); this.sendStatus(ws);}
  sendStatus(ws){ ws.send(JSON.stringify(this.status())); }
  status(){
    const info=this.broker.accountInfo()||{};
    return {type:'status',ts:Date.now(),enabled:this.enabled,liveTrading:CONFIG.liveTrading,brokerReady:this.broker.ready,symbol:CONFIG.symbol,bid:this.broker.lastPrice?.bid||0,ask:this.broker.lastPrice?.ask||0,mid:this.broker.lastPrice?.mid||0,spread:this.broker.lastPrice?(this.broker.lastPrice.ask-this.broker.lastPrice.bid):0,equity:Number(info.equity)||0,balance:Number(info.balance)||0,positions:this.broker.positions().length,metrics:this.metrics.snapshot()};
  }
  control(msg){ if(msg.action==='start') this.enabled=true; if(msg.action==='stop') this.enabled=false; this.broadcast({type:'control',enabled:this.enabled}); }
  async onTick(tick){
    this.metrics.tick();
    const finished=this.candles.updateTick(tick);
    const spread=tick.ask-tick.bid;
    if(!this.enabled || !this.broker.ready) return;
    if(Date.now()-tick.receivedAt>CONFIG.maxTickAgeMs) return;
    const info=this.broker.accountInfo()||{};
    const positions=this.broker.positions();
    this.risk.updateEquity(Number(info.equity)||0);
    for(const x of finished) this.broadcast({type:'candle',tf:x.tf,candle:x.candle});

    const decision=this.strategy.evaluate({m15:this.candles.get(900),m5:this.candles.get(300),m1:this.candles.get(60),tick,spread});
    if(!decision) return;
    this.metrics.signal(); this.lastSignal=decision;
    this.broadcast({type:'signal',signal:decision});
    if(Date.now()>decision.expiresAt) return;
    const risk=this.risk.canTrade({equity:Number(info.equity)||0,freeMargin:Number(info.freeMargin)||Number(info.equity)||0,positions:positions.length});
    if(!risk.ok){this.metrics.reject();this.broadcast({type:'rejection',reason:risk.reason,signalId:decision.id});return;}
    if(spread>CONFIG.maxSpread){this.metrics.reject();return;}
    const spec=this.broker.spec||{};
    const lots=this.risk.sizeLots(Number(info.equity)||0,decision.slDist,spec);
    if(!lots){this.metrics.reject();return;}
    if(this.inFlight.has(decision.id)) return;
    this.inFlight.add(decision.id);
    const sendAt=performance.now(); this.metrics.order();
    try{
      let result;
      if(CONFIG.liveTrading){
        result=decision.dir==='BUY' ? await this.broker.buy(lots,decision.sl,decision.tp,`HFT-${decision.id}`) : await this.broker.sell(lots,decision.sl,decision.tp,`HFT-${decision.id}`);
      } else result={stringCode:'DRY_RUN',numericCode:0,orderId:`DRY-${decision.id}`};
      const latency=performance.now()-sendAt; this.metrics.recordLatency(latency); this.metrics.fill();
      const msg={type:'order',ok:true,mode:CONFIG.liveTrading?'LIVE':'DRY_RUN',signal:decision,lots,result,latencyMs:latency}; this.broadcast(msg);
    }catch(e){this.metrics.error();this.broadcast({type:'order',ok:false,signal:decision,error:e.message});}
    finally{this.inFlight.delete(decision.id);}
  }
  async shutdown(){await this.broker.shutdown();}
}
