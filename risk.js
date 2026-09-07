export class RiskEngine {
  constructor(config) {
    this.c = config;

    this.startEquity = 0;
    this.dayStartEquity = 0;

    this.locked = false;

    this.losses = 0;
    this.wins = 0;

    this.trades = 0;

    this.lastEquity = 0;
  }

  setDayStart(equity) {
    const value = Number(equity);

    if (!(value > 0)) return;

    if (!this.dayStartEquity) {
      this.dayStartEquity = value;
    }

    if (!this.startEquity) {
      this.startEquity = value;
    }
  }

  updateEquity(equity) {
    const value = Number(equity);

    if (!(value > 0)) return;

    this.setDayStart(value);

    this.lastEquity = value;

    if (
      this.dayStartEquity > 0 &&
      (
        (
          this.dayStartEquity - value
        ) /
        this.dayStartEquity
      ) *
        100 >=
      this.c.maxDailyLossPct
    ) {
      this.locked = true;
    }
  }

  canTrade({
    equity,
    freeMargin,
    positions
  }) {
    const eq = Number(equity);
    const margin = Number(freeMargin);
    const pos = Number(positions);

    this.updateEquity(eq);

    if (this.locked) {
      return {
        ok: false,
        reason: 'daily loss lock'
      };
    }

    if (
      !Number.isFinite(pos) ||
      pos >= this.c.maxConcurrentPositions
    ) {
      return {
        ok: false,
        reason: 'max concurrent positions'
      };
    }

    if (!(eq > 0)) {
      return {
        ok: false,
        reason: 'invalid account equity'
      };
    }

    if (!(margin > 0)) {
      return {
        ok: false,
        reason: 'invalid free margin'
      };
    }

    return {
      ok: true
    };
  }

  validateSignal(signal) {
    if (!signal) {
      return {
        ok: false,
        reason: 'no signal'
      };
    }

    if (
      signal.dir !== 'BUY' &&
      signal.dir !== 'SELL'
    ) {
      return {
        ok: false,
        reason: 'invalid direction'
      };
    }

    if (
      !Number.isFinite(Number(signal.price)) ||
      !Number.isFinite(Number(signal.sl)) ||
      !Number.isFinite(Number(signal.tp))
    ) {
      return {
        ok: false,
        reason: 'invalid trade levels'
      };
    }

    if (
      Number(signal.slDist) <
      Number(this.c.minSl)
    ) {
      return {
        ok: false,
        reason: 'stop below minimum'
      };
    }

    if (
      Number(signal.slDist) >
      Number(this.c.maxSl)
    ) {
      return {
        ok: false,
        reason: 'stop above maximum'
      };
    }

    if (
      Number(signal.score || 0) < 68
    ) {
      return {
        ok: false,
        reason: 'signal score too low'
      };
    }

    return {
      ok: true
    };
  }

  sizeLots(equity, slDist, spec) {
    const eq = Number(equity);
    const distance = Number(slDist);

    if (
      !(eq > 0) ||
      !(distance > 0)
    ) {
      return 0;
    }

    const riskMoney =
      eq *
      Number(this.c.riskPerTradePct) /
      100;

    const contract =
      Number(spec?.contractSize) || 100;

    const lossPerLot =
      distance * contract;

    if (!(lossPerLot > 0)) {
      return 0;
    }

    let lots =
      riskMoney /
      lossPerLot;

    const min =
      Number(spec?.minVolume) || 0.01;

    const max =
      Number(spec?.maxVolume) || 200;

    const step =
      Number(spec?.volumeStep) || 0.01;

    lots =
      Math.floor(lots / step) *
      step;

    if (lots < min) {
      /*
       * Do not automatically force minimum volume
       * if that would exceed the intended risk.
       */
      const minimumRisk =
        min * lossPerLot;

      if (
        minimumRisk >
        riskMoney * 1.10
      ) {
        return 0;
      }

      lots = min;
    }

    lots =
      Math.min(max, lots);

    return Number(
      lots.toFixed(2)
    );
  }

  recordWin() {
    this.wins += 1;
    this.trades += 1;
  }

  recordLoss() {
    this.losses += 1;
    this.trades += 1;
  }

  resetLossStreak() {
    this.losses = 0;
  }

  lock(reason = 'manual risk lock') {
    this.locked = true;

    return {
      locked: true,
      reason
    };
  }

  unlock() {
    this.locked = false;
  }

  status() {
    return {
      locked: this.locked,
      trades: this.trades,
      wins: this.wins,
      losses: this.losses,
      dayStartEquity: this.dayStartEquity,
      startEquity: this.startEquity,
      currentEquity: this.lastEquity
    };
  }
  }
