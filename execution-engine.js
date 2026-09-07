import { CONFIG } from './config.js';

export class ExecutionEngine {
  constructor(broker) {
    this.broker = broker;

    this.running = false;

    this.processingTick = false;

    this.lastProcessedTime = 0;
    this.lastSignalTime = 0;
    this.lastTradeTime = 0;

    this.tickCount = 0;
    this.signalCount = 0;
    this.tradeCount = 0;

    this.lastAccountCheck = 0;
    this.accountCache = null;

    this.minAccountCheckInterval = 1000;

    this.lastLogTime = 0;

    this.positionsCache = [];
    this.lastPositionsCheck = 0;

    this.minPositionsCheckInterval = 1000;
  }

  // ==========================================================
  // START
  // ==========================================================

  start() {
    if (this.running) {
      return;
    }

    this.running = true;

    console.log(
      'Execution engine started.'
    );

    console.log(
      `Risk per trade: ${CONFIG.riskPerTradePct}%`
    );

    console.log(
      `Max concurrent positions: ${CONFIG.maxConcurrentPositions}`
    );

    console.log(
      `Max daily loss: ${CONFIG.maxDailyLossPct}%`
    );

    console.log(
      `Risk/Reward: ${CONFIG.rr}`
    );
  }

  // ==========================================================
  // STOP
  // ==========================================================

  stop() {
    this.running = false;

    console.log(
      'Execution engine stopped.'
    );
  }

  // ==========================================================
  // RECEIVE MARKET TICK
  // ==========================================================

  async onTick(price) {
    if (!this.running) {
      return;
    }

    if (!price) {
      return;
    }

    if (price.symbol !== CONFIG.symbol) {
      return;
    }

    // --------------------------------------------------------
    // Prevent overlapping tick processing.
    // --------------------------------------------------------

    if (this.processingTick) {
      return;
    }

    this.processingTick = true;

    try {
      this.tickCount++;

      this.lastProcessedTime =
        Date.now();

      // ------------------------------------------------------
      // Validate price
      // ------------------------------------------------------

      const bid = Number(price.bid);
      const ask = Number(price.ask);

      if (
        !Number.isFinite(bid) ||
        !Number.isFinite(ask) ||
        bid <= 0 ||
        ask <= 0
      ) {
        return;
      }

      const spread =
        ask - bid;

      // ------------------------------------------------------
      // Spread protection
      // ------------------------------------------------------

      if (
        Number.isFinite(CONFIG.maxSpread) &&
        spread > CONFIG.maxSpread
      ) {
        return;
      }

      // ------------------------------------------------------
      // Account state
      // ------------------------------------------------------

      const account =
        await this.getAccount();

      if (!account) {
        return;
      }

      // ------------------------------------------------------
      // Position state
      // ------------------------------------------------------

      const positions =
        await this.getPositions();

      if (!Array.isArray(positions)) {
        return;
      }

      // ------------------------------------------------------
      // Maximum concurrent positions
      // ------------------------------------------------------

      const symbolPositions =
        positions.filter(
          position =>
            position &&
            position.symbol === CONFIG.symbol
        );

      if (
        symbolPositions.length >=
        CONFIG.maxConcurrentPositions
      ) {
        return;
      }

      // ------------------------------------------------------
      // Basic tick-age protection
      // ------------------------------------------------------

      if (
        price.timeMs &&
        Number.isFinite(price.timeMs)
      ) {
        const age =
          Date.now() - price.timeMs;

        if (
          age > CONFIG.maxTickAgeMs
        ) {
          return;
        }
      }

      // ------------------------------------------------------
      // SIGNAL HOOK
      //
      // The strategy can be connected here without allowing
      // the execution engine to crash the entire bot.
      // ------------------------------------------------------

      const signal =
        await this.generateSignal(
          price,
          account,
          symbolPositions
        );

      if (!signal) {
        return;
      }

      this.signalCount++;

      this.lastSignalTime =
        Date.now();

      // ------------------------------------------------------
      // Validate signal
      // ------------------------------------------------------

      if (
        signal.symbol &&
        signal.symbol !== CONFIG.symbol
      ) {
        return;
      }

      const action =
        String(
          signal.action ||
          signal.side ||
          signal.direction ||
          ''
        ).toUpperCase();

      if (
        action !== 'BUY' &&
        action !== 'SELL'
      ) {
        return;
      }

      // ------------------------------------------------------
      // Cooldown
      // ------------------------------------------------------

      if (
        Date.now() - this.lastTradeTime <
        CONFIG.cooldownMs
      ) {
        return;
      }

      // ------------------------------------------------------
      // Execute
      // ------------------------------------------------------

      await this.executeSignal(
        action,
        signal,
        price,
        account
      );

    } catch (error) {
      console.error(
        'ExecutionEngine.onTick error:',
        error?.message || error
      );
    } finally {
      this.processingTick = false;
    }
  }

  // ==========================================================
  // ACCOUNT CACHE
  // ==========================================================

  async getAccount() {
    const now = Date.now();

    if (
      this.accountCache &&
      now - this.lastAccountCheck <
      this.minAccountCheckInterval
    ) {
      return this.accountCache;
    }

    try {
      const account =
        await this.broker.accountInfo();

      this.accountCache = account;
      this.lastAccountCheck = now;

      return account;
    } catch (error) {
      console.error(
        'Account information error:',
        error?.message || error
      );

      return null;
    }
  }

  // ==========================================================
  // POSITIONS CACHE
  // ==========================================================

  async getPositions() {
    const now = Date.now();

    if (
      now - this.lastPositionsCheck <
      this.minPositionsCheckInterval
    ) {
      return this.positionsCache;
    }

    try {
      const positions =
        await this.broker.positions();

      this.positionsCache =
        Array.isArray(positions)
          ? positions
          : [];

      this.lastPositionsCheck = now;

      return this.positionsCache;
    } catch (error) {
      console.error(
        'Positions information error:',
        error?.message || error
      );

      return [];
    }
  }

  // ==========================================================
  // SIGNAL GENERATION
  // ==========================================================

  async generateSignal(
    price,
    account,
    positions
  ) {
    /*
     * IMPORTANT:
     *
     * This method is deliberately isolated.
     *
     * Your existing strategy.js should provide the actual
     * 15M / 5M / 1M strategy logic.
     *
     * We do NOT invent a trading signal here.
     *
     * Until the strategy is connected, returning null means
     * the execution engine will NOT place trades.
     */

    return null;
  }

  // ==========================================================
  // EXECUTE SIGNAL
  // ==========================================================

  async executeSignal(
    action,
    signal,
    price,
    account
  ) {
    if (!signal) {
      return;
    }

    const volume =
      Number(
        signal.volume ||
        signal.lot ||
        signal.lots ||
        0
      );

    if (
      !Number.isFinite(volume) ||
      volume <= 0
    ) {
      console.warn(
        'Signal rejected: invalid volume.'
      );

      return;
    }

    let stopLoss =
      signal.stopLoss ??
      signal.sl ??
      undefined;

    let takeProfit =
      signal.takeProfit ??
      signal.tp ??
      undefined;

    if (
      stopLoss !== undefined
    ) {
      stopLoss =
        Number(stopLoss);
    }

    if (
      takeProfit !== undefined
    ) {
      takeProfit =
        Number(takeProfit);
    }

    // --------------------------------------------------------
    // Always log signals.
    // --------------------------------------------------------

    console.log(
      `SIGNAL ${action} | ${CONFIG.symbol} | volume=${volume} | SL=${stopLoss ?? 'none'} | TP=${takeProfit ?? 'none'} | live=${CONFIG.liveTrading}`
    );

    // --------------------------------------------------------
    // SAFETY SWITCH
    // --------------------------------------------------------

    if (!CONFIG.liveTrading) {
      console.log(
        `LIVE_TRADING=false -> signal recorded, order NOT sent.`
      );

      return {
        blocked: true,
        reason: 'LIVE_TRADING=false',
        action,
        volume
      };
    }

    // --------------------------------------------------------
    // EXECUTION
    // --------------------------------------------------------

    try {
      let result;

      if (action === 'BUY') {
        result =
          await this.broker.buy(
            volume,
            stopLoss,
            takeProfit,
            signal.comment ||
              'Gold-Hunter-7Pro'
          );
      } else {
        result =
          await this.broker.sell(
            volume,
            stopLoss,
            takeProfit,
            signal.comment ||
              'Gold-Hunter-7Pro'
          );
      }

      this.tradeCount++;
      this.lastTradeTime =
        Date.now();

      console.log(
        `ORDER RESULT ${action}:`,
        result
      );

      return result;

    } catch (error) {
      console.error(
        `ORDER ERROR ${action}:`,
        error?.message || error
      );

      return null;
    }
  }

  // ==========================================================
  // STATUS
  // ==========================================================

  status() {
    return {
      running: this.running,
      tickCount: this.tickCount,
      signalCount: this.signalCount,
      tradeCount: this.tradeCount,
      lastProcessedTime:
        this.lastProcessedTime,
      lastSignalTime:
        this.lastSignalTime,
      lastTradeTime:
        this.lastTradeTime,
      liveTrading:
        CONFIG.liveTrading
    };
  }
  }
