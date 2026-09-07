export class RiskEngine {
  constructor(config) { this.c=config; this.startEquity=0; this.dayStartEquity=0; this.locked=false; this.losses=0; this.wins=0; }
  setDayStart(equity) { if (!this.dayStartEquity && equity>0) this.dayStartEquity=equity; if (!this.startEquity && equity>0) this.startEquity=equity; }
  updateEquity(equity) {
    this.setDayStart(equity);
    if (this.dayStartEquity>0 && ((this.dayStartEquity-equity)/this.dayStartEquity*100)>=this.c.maxDailyLossPct) this.locked=true;
  }
  canTrade({equity, freeMargin, positions}) {
    this.updateEquity(equity);
    if (this.locked) return {ok:false,reason:'daily loss lock'};
    if (positions >= this.c.maxConcurrentPositions) return {ok:false,reason:'max concurrent positions'};
    if (!(equity>0) || !(freeMargin>0)) return {ok:false,reason:'invalid account equity/margin'};
    return {ok:true};
  }
  sizeLots(equity, slDist, spec) {
    if (!(equity>0) || !(slDist>0)) return 0;
    const riskMoney=equity*this.c.riskPerTradePct/100;
    const contract=Number(spec?.contractSize)||100;
    const lossPerLot=slDist*contract;
    let lots=riskMoney/lossPerLot;
    const min=Number(spec?.minVolume)||0.01, max=Number(spec?.maxVolume)||200, step=Number(spec?.volumeStep)||0.01;
    lots=Math.floor(lots/step)*step;
    lots=Math.max(min,Math.min(max,lots));
    return Number(lots.toFixed(2));
  }
}
