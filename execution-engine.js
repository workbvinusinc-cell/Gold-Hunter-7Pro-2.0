import { CONFIG } from './config.js';
import { CandleEngine } from './candle-engine.js';
import { Strategy } from './strategy.js';
import { RiskEngine } from './risk.js';

export class ExecutionEngine {
  constructor(broker) {
    this.broker = broker;

    this.running = false;
    this.initializing = false;
    this.initialized = false;
    this.processingTick = false;

    this.candleEngine =
      new CandleEngine();

    this.strategy =
      new Strategy(CONFIG);

    this.risk =
      new RiskEngine(CONFIG);

    this.lastProcessedTime = 0;
    this.lastSignalTime = 0;
    this.lastTradeTime = 0;

    this.lastAccountCheck = 0;
    this.lastPositionsCheck = 0;

    this.minAccountCheckInterval = 1000;
    this.minPositionsCheckInterval = 1000;

    this.accountCache = null;
    this.positionsCache = [];

    this.tickCount = 0;
    this.signalCount = 0;
    this.tradeCount = 0;

    this.rejectedSignals = 0;
    this.riskRejected = 0;
    this.executionErrors = 0;

    this.lastSignal = null;
    this.lastRejection = null;

    this.lastSignalId = null;

    this.warmupLogged = false;
  }

  // ==========================================================
  // START
  // ==========================================================

  async start() {
    if (this.running || this.initializing) {
      return;
    }

    this.initializing = true;

    console.log(
      '=========================================='
    );

    console.log(
      ' GOLD-HUNTER-HFT V3 ENGINE'
    );

    console.log(
      '=========================================='
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

    console.log(
      `Maximum spread: ${CONFIG.maxSpread}`
    );

    console.log(
      `LIVE_TRADING: ${CONFIG.liveTrading}`
    );

    console.log(
      'Strategy: 15M regime → 5M setup → 1M trigger → tick confirmation'
    );

    console.log(
      'Historical candle initialization starting...'
    );

    try {
      await this.loadHistoricalCandles();

      this.initialized = true;
      this.running = true;

      console.log(
        'Historical candle initialization complete.'
      );

      console.log(
        'Execution engine started.'
      );

      console.log(
        '=========================================='
      );

    } catch (error) {
      console.error(
        'Historical initialization error:',
        error?.message || error
      );

      // Safe fallback: start the engine and allow
      // CandleEngine to warm up from live ticks.
      this.initialized = true;
      this.running = true;

      console.warn(
        'Falling back to live-tick candle warm-up.'
      );

    } finally {
      this.initializing = false;
    }
  }

  // ==========================================================
  // HISTORICAL CANDLE INITIALIZATION
  // ==========================================================

  async loadHistoricalCandles() {
    const timeframes = [
      {
        name: 'M1',
        api: '1m',
        seconds: 60,
        minimum: 30,
        count: 80
      },
      {
        name: 'M5',
        api: '5m',
        seconds: 300,
        minimum: 55,
        count: 80
      },
      {
        name: 'M15',
        api: '15m',
        seconds: 900,
        minimum: 55,
        count: 80
      }
    ];

    let successful = 0;

    for (const tf of timeframes) {
      try {
        console.log(
          `Loading ${tf.name} historical candles...`
        );

        const candles =
          await this.broker.historicalCandles(
            tf.api,
            tf.count
          );

        if (
          Array.isArray(candles) &&
          candles.length >= tf.minimum
        ) {
          this.candleEngine.seed(
            tf.seconds,
            candles
          );

          successful++;

          console.log(
            `✓ ${tf.name} seeded | ${candles.length} candles`
          );
        } else {
          console.warn(
            `⚠ ${tf.name} insufficient historical data | received=${candles?.length || 0} required=${tf.minimum}`
          );
        }

      } catch (error) {
        console.warn(
          `⚠ ${tf.name} historical loading failed:`,
          error?.message || error
        );
      }
    }

    console.log(
      `Historical initialization summary: ${successful}/3 timeframes seeded.`
    );

    const state =
      this.candleEngine.status();

    console.log(
      `Candle state | M1=${state.m1} | M5=${state.m5} | M15=${state.m15}`
    );

    if (successful === 0) {
      console.warn(
        'No historical candles were loaded.'
      );

      console.warn(
        'The engine will use live tick candle construction.'
      );
    }
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

    if (!this.initialized) {
      return;
    }

    if (!price) {
      return;
    }

    if (
      price.symbol &&
      price.symbol !== CONFIG.symbol
    ) {
      return;
    }

    if (this.processingTick) {
      return;
    }

    this.processingTick = true;

    try {
      this.tickCount++;

      const now = Date.now();

      this.lastProcessedTime = now;

      const bid = Number(price.bid);
      const ask = Number(price.ask);

      if (
        !Number.isFinite(bid) ||
        !Number.isFinite(ask) ||
        bid <= 0 ||
        ask <= 0 ||
        ask < bid
      ) {
        return;
      }

      const mid =
        Number.isFinite(Number(price.mid))
          ? Number(price.mid)
          : (bid + ask) / 2;

      const spread =
        ask - bid;

      const timeMs =
        Number(price.timeMs) || now;

      const tickAge =
        Math.max(
          0,
          now - timeMs
        );

      if (
        tickAge >
        CONFIG.maxTickAgeMs
      ) {
        return;
      }

      if (
        Number.isFinite(CONFIG.maxSpread) &&
        spread > CONFIG.maxSpread
      ) {
        return;
      }

      const tick = {
        ...price,
        bid,
        ask,
        mid,
        spread,
        timeMs
      };

      // ======================================================
      // LIVE CANDLE UPDATES
      // ======================================================

      this.candleEngine.updateTick(
        tick
      );

      // ======================================================
      // WARM-UP CHECK
      // ======================================================

      if (
        !this.candleEngine.ready()
      ) {
        if (!this.warmupLogged) {
          const state =
            this.candleEngine.status();

          console.log(
            `V3 warming up | M1=${state.m1}/30 | M5=${state.m5}/55 | M15=${state.m15}/55`
          );

          this.warmupLogged = true;
        }

        return;
      }

      if (this.warmupLogged) {
        console.log(
          'V3 market warm-up complete. Strategy is now active.'
        );

        this.warmupLogged = false;
      }

      // ======================================================
      // ACCOUNT STATE
      // ======================================================

      const account =
        await this.getAccount();

      if (!account) {
        return;
      }

      // ======================================================
      // POSITION STATE
      // ======================================================

      const positions =
        await this.getPositions();

      if (!Array.isArray(positions)) {
        return;
      }

      const symbolPositions =
        positions.filter(
          position =>
            position &&
            (
              !position.symbol ||
              position.symbol === CONFIG.symbol
            )
        );

      // ======================================================
      // RISK ENGINE
      // ======================================================

      const equity =
        Number(
          account.equity ??
          account.balance ??
          0
        );

      const freeMargin =
        Number(
          account.freeMargin ??
          account.freeMarginAvailable ??
          0
        );

      const riskCheck =
        this.risk.canTrade({
          equity,
          freeMargin,
          positions:
            symbolPositions.length
        });

      if (!riskCheck.ok) {
        this.lastRejection = {
          reason:
            riskCheck.reason,
          time: now
        };

        return;
      }

      // ======================================================
      // SIGNAL
      // ======================================================

      const signal =
        await this.generateSignal(
          tick,
          account,
          symbolPositions
        );

      if (!signal) {
        return;
      }

      this.signalCount++;

      this.lastSignalTime = now;
      this.lastSignal = signal;

      if (
        signal.id &&
        signal.id ===
          this.lastSignalId
      ) {
        return;
      }

      if (signal.id) {
        this.lastSignalId =
          signal.id;
      }

      const action =
        String(
          signal.action ||
          signal.side ||
          signal.direction ||
          signal.dir ||
          ''
        ).toUpperCase();

      if (
        action !== 'BUY' &&
        action !== 'SELL'
      ) {
        this.reject(
          'invalid signal direction'
        );

        return;
      }

      if (
        signal.expiresAt &&
        now >
          Number(
            signal.expiresAt
          )
      ) {
        this.reject(
          'signal expired'
        );

        return;
      }

      const signalRisk =
        this.risk.validateSignal(
          signal
        );

      if (!signalRisk.ok) {
        this.riskRejected++;

        this.reject(
          signalRisk.reason
        );

        return;
      }

      if (
        now -
          this.lastTradeTime <
        CONFIG.cooldownMs
      ) {
        return;
      }

      // ======================================================
      // POSITION SIZE
      // ======================================================

      const volume =
        this.calculateVolume(
          equity,
          signal.slDist
        );

      if (!(volume > 0)) {
        this.riskRejected++;

        this.reject(
          'position size calculated as zero'
        );

        return;
      }

      signal.volume =
        volume;

      // ======================================================
      // EXECUTE
      // ======================================================

      await this.executeSignal(
        action,
        signal,
        tick,
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
  // GENERATE SIGNAL
  // ==========================================================

  async generateSignal(
    price,
    account,
    positions
  ) {
    try {
      const m1 =
        this.candleEngine.get(60);

      const m5 =
        this.candleEngine.get(300);

      const m15 =
        this.candleEngine.get(900);

      return this.strategy.evaluate({
        m15,
        m5,
        m1,
        tick: price,
        spread: price.spread
      });

    } catch (error) {
      console.error(
        'V3 strategy error:',
        error?.message || error
      );

      return null;
    }
  }

  // ==========================================================
  // POSITION SIZE
  // ==========================================================

  calculateVolume(
    equity,
    slDist
  ) {
    const brokerSpec =
      this.broker.spec || {};

    const spec = {
      contractSize:
        Number(
          brokerSpec.contractSize
        ) || 100,

      minVolume:
        Number(
          brokerSpec.minVolume ??
          brokerSpec.volumeMin
        ) || 0.01,

      maxVolume:
        Number(
          brokerSpec.maxVolume ??
          brokerSpec.volumeMax
        ) || 200,

      volumeStep:
        Number(
          brokerSpec.volumeStep ??
          brokerSpec.volumeMinStep
        ) || 0.01
    };

    return this.risk.sizeLots(
      Number(equity),
      Number(slDist),
      spec
    );
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
      return null;
    }

    const volume =
      Number(signal.volume);

    if (
      !Number.isFinite(volume) ||
      volume <= 0
    ) {
      this.reject(
        'invalid calculated volume'
      );

      return null;
    }

    let stopLoss =
      signal.stopLoss ??
      signal.sl;

    let takeProfit =
      signal.takeProfit ??
      signal.tp;

    stopLoss =
      Number(stopLoss);

    takeProfit =
      Number(takeProfit);

    if (
      !Number.isFinite(stopLoss) ||
      !Number.isFinite(takeProfit)
    ) {
      this.reject(
        'invalid SL/TP'
      );

      return null;
    }

    const bid =
      Number(price.bid);

    const ask =
      Number(price.ask);

    const entry =
      action === 'BUY'
        ? ask
        : bid;

    if (!(entry > 0)) {
      this.reject(
        'invalid execution price'
      );

      return null;
    }

    const spread =
      ask - bid;

    if (
      spread >
      CONFIG.maxSpread
    ) {
      this.reject(
        'spread increased before execution'
      );

      return null;
    }

    if (
      signal.createdAt &&
      Date.now() -
        Number(signal.createdAt) >
      CONFIG.maxEntryAgeMs
    ) {
      this.reject(
        'signal too old for execution'
      );

      return null;
    }

    console.log(
      '=========================================='
    );

    console.log(
      `V3 SIGNAL ${action}`
    );

    console.log(
      `Symbol: ${CONFIG.symbol}`
    );

    console.log(
      `Score: ${signal.score ?? 'n/a'}`
    );

    console.log(
      `Quality: ${signal.quality ?? 'n/a'}`
    );

    console.log(
      `Regime: ${signal.regime ?? 'n/a'}`
    );

    console.log(
      `Setup: ${signal.setup ?? 'n/a'}`
    );

    console.log(
      `Entry: ${entry}`
    );

    console.log(
      `SL: ${stopLoss}`
    );

    console.log(
      `TP: ${takeProfit}`
    );

    console.log(
      `SL distance: ${signal.slDist}`
    );

    console.log(
      `Volume: ${volume}`
    );

    console.log(
      `Spread: ${spread.toFixed(3)}`
    );

    if (
      Array.isArray(
        signal.reasons
      )
    ) {
      console.log(
        'Reasons:'
      );

      for (
        const reason of
          signal.reasons
      ) {
        console.log(
          `  ✓ ${reason}`
        );
      }
    }

    console.log(
      `LIVE_TRADING: ${CONFIG.liveTrading}`
    );

    console.log(
      '=========================================='
    );

    if (!CONFIG.liveTrading) {
      console.log(
        'LIVE_TRADING=false -> ORDER BLOCKED.'
      );

      console.log(
        `Paper signal recorded: ${action} ${volume} ${CONFIG.symbol}`
      );

      return {
        blocked: true,
        reason:
          'LIVE_TRADING=false',
        action,
        volume,
        signal
      };
    }

    try {
      let result;

      const comment =
        signal.comment ||
        `GH-V3-${signal.setup || 'SIGNAL'}`;

      if (action === 'BUY') {
        result =
          await this.broker.buy(
            volume,
            stopLoss,
            takeProfit,
            comment
          );
      } else {
        result =
          await this.broker.sell(
            volume,
            stopLoss,
            takeProfit,
            comment
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
      this.executionErrors++;

      console.error(
        `ORDER ERROR ${action}:`,
        error?.message || error
      );

      return null;
    }
  }

  // ==========================================================
  // ACCOUNT CACHE
  // ==========================================================

  async getAccount() {
    const now = Date.now();

    if (
      this.accountCache &&
      now -
        this.lastAccountCheck <
      this.minAccountCheckInterval
    ) {
      return this.accountCache;
    }

    try {
      const account =
        await this.broker.accountInfo();

      if (!account) {
        return null;
      }

      this.accountCache =
        account;

      this.lastAccountCheck =
        now;

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
      now -
        this.lastPositionsCheck <
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

      this.lastPositionsCheck =
        now;

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
  // REJECTION
  // ==========================================================

  reject(reason) {
    this.rejectedSignals++;

    this.lastRejection = {
      reason,
      time: Date.now()
    };
  }

  // ==========================================================
  // STATUS
  // ==========================================================

  status() {
    const candles =
      this.candleEngine.status();

    return {
      running:
        this.running,

      initializing:
        this.initializing,

      initialized:
        this.initialized,

      strategy:
        'Gold Hunter HFT V3',

      symbol:
        CONFIG.symbol,

      tickCount:
        this.tickCount,

      signalCount:
        this.signalCount,

      tradeCount:
        this.tradeCount,

      rejectedSignals:
        this.rejectedSignals,

      riskRejected:
        this.riskRejected,

      executionErrors:
        this.executionErrors,

      lastProcessedTime:
        this.lastProcessedTime,

      lastSignalTime:
        this.lastSignalTime,

      lastTradeTime:
        this.lastTradeTime,

      liveTrading:
        CONFIG.liveTrading,

      warmup:
        candles,

      lastSignal:
        this.lastSignal,

      lastRejection:
        this.lastRejection,

      risk:
        this.risk.status()
    };
  }
    }
