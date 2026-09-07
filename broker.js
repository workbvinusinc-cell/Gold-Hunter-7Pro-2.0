import MetaApi from 'metaapi.cloud-sdk/esm-node';
import { CONFIG } from './config.js';
import { Metrics } from './metrics.js';

export class ExnessBroker {
  constructor() {
    this.api = null;
    this.account = null;

    // Streaming connection = prices/events
    this.connection = null;

    // RPC connection = account/positions/trading queries
    this.rpc = null;

    this.symbol = CONFIG.symbol;
    this.spec = null;

    this.metrics = new Metrics();
    this.listeners = new Set();

    this.ready = false;
    this.lastPrice = null;
    this.lastTickLog = 0;
  }

  // =========================================================
  // TICK LISTENERS
  // =========================================================

  onTick(fn) {
    this.listeners.add(fn);

    return () => {
      this.listeners.delete(fn);
    };
  }

  emitTick(price) {
    for (const fn of this.listeners) {
      try {
        fn(price);
      } catch (error) {
        console.error(
          'Tick handler error:',
          error?.message || error
        );
      }
    }
  }

  // =========================================================
  // CONNECT
  // =========================================================

  async connect() {
    if (!CONFIG.metaApiToken) {
      throw new Error('METAAPI_TOKEN is missing');
    }

    if (!CONFIG.accountId) {
      throw new Error('METAAPI_ACCOUNT_ID is missing');
    }

    const broker = this;

    console.log('Connecting to MetaApi...');
    console.log(`MetaApi region: ${CONFIG.region}`);
    console.log(`Trading symbol: ${CONFIG.symbol}`);

    // ---------------------------------------------------------
    // METAAPI
    // ---------------------------------------------------------

    this.api = new MetaApi(
      CONFIG.metaApiToken,
      {
        region: CONFIG.region
      }
    );

    // ---------------------------------------------------------
    // ACCOUNT
    // ---------------------------------------------------------

    this.account =
      await this.api.metatraderAccountApi.getAccount(
        CONFIG.accountId
      );

    console.log(
      `MetaApi account region: ${this.account.region}`
    );

    console.log(
      `MetaApi account connection status: ${this.account.connectionStatus}`
    );

    // ---------------------------------------------------------
    // DEPLOY IF NECESSARY
    // ---------------------------------------------------------

    if (
      this.account.state !== 'DEPLOYED' &&
      this.account.state !== 'DEPLOYING'
    ) {
      console.log(
        'MetaApi account is not deployed. Deploying...'
      );

      await this.account.deploy();
    }

    // ---------------------------------------------------------
    // STREAMING CONNECTION
    // ---------------------------------------------------------

    this.connection =
      this.account.getStreamingConnection();

    // ---------------------------------------------------------
    // RPC CONNECTION
    // ---------------------------------------------------------

    this.rpc =
      this.account.getRPCConnection();

    // =========================================================
    // STREAMING LISTENER
    // =========================================================

    const listener = {

      // -------------------------------------------------------
      // CONNECTION
      // -------------------------------------------------------

      async onConnected(
        instanceIndex,
        replicas
      ) {
        console.log(
          `MetaApi terminal connected: ${instanceIndex}, replicas=${replicas}`
        );
      },

      async onDisconnected(
        instanceIndex
      ) {
        console.warn(
          `MetaApi terminal disconnected: ${instanceIndex}`
        );

        broker.ready = false;
      },

      async onHealthStatus(
        instanceIndex,
        status
      ) {
        // Keep quiet unless needed.
      },

      async onBrokerConnectionStatusChanged(
        instanceIndex,
        connected
      ) {
        console.log(
          `Broker connection ${instanceIndex} -> ${connected}`
        );
      },

      // -------------------------------------------------------
      // SYNCHRONIZATION
      // -------------------------------------------------------

      async onSynchronizationStarted() {},

      async onAccountInformationUpdated() {},

      async onPositionsSynchronized() {},

      async onPositionsReplaced() {},

      async onPositionUpdated() {},

      async onPositionRemoved() {},

      // -------------------------------------------------------
      // PENDING ORDERS
      // -------------------------------------------------------

      async onPendingOrdersSynchronized() {},

      async onPendingOrdersReplaced() {},

      async onPendingOrderUpdated() {},

      async onPendingOrderCompleted() {},

      async onPendingOrderRemoved() {},

      // -------------------------------------------------------
      // HISTORY
      // -------------------------------------------------------

      async onHistoryOrdersSynchronized() {},

      async onHistoryOrdersAdded() {},

      async onHistoryOrdersRemoved() {},

      async onDealsSynchronized() {},

      async onDealAdded(
        instanceIndex,
        deal
      ) {
        if (deal) {
          console.log(
            `Deal added: ${deal.id || 'unknown'}`
          );
        }
      },

      async onDealRemoved() {},

      // -------------------------------------------------------
      // SYMBOL SPECIFICATIONS
      // -------------------------------------------------------

      async onSymbolSpecificationUpdated(
        instanceIndex,
        specification
      ) {
        if (
          specification &&
          specification.symbol === broker.symbol
        ) {
          broker.spec = specification;

          console.log(
            `Symbol specification received: ${broker.symbol}`
          );
        }
      },

      async onSymbolSpecificationRemoved(
        instanceIndex,
        symbol
      ) {
        if (symbol === broker.symbol) {
          broker.spec = null;
        }
      },

      async onSymbolSpecificationsUpdated(
        instanceIndex,
        specifications
      ) {
        if (!Array.isArray(specifications)) {
          return;
        }

        const found = specifications.find(
          item =>
            item &&
            item.symbol === broker.symbol
        );

        if (found) {
          broker.spec = found;

          console.log(
            `Symbol specification received: ${broker.symbol}`
          );
        }
      },

      // =======================================================
      // PRICE EVENTS
      // =======================================================

      async onSymbolPriceUpdated(
        instanceIndex,
        price
      ) {
        await broker.processPrice(price);
      },

      async onSymbolPricesUpdated(
        instanceIndex,
        prices
      ) {
        if (!Array.isArray(prices)) {
          return;
        }

        for (const price of prices) {
          await broker.processPrice(price);
        }
      },

      // -------------------------------------------------------
      // OTHER MARKET DATA
      // -------------------------------------------------------

      async onCandlesUpdated() {},

      async onTicksUpdated() {},

      async onBooksUpdated() {},

      async onSymbolPricesReset() {}
    };

    this.connection.addSynchronizationListener(
      listener
    );

    // =========================================================
    // CONNECT STREAMING
    // =========================================================

    console.log(
      'Connecting MetaApi websocket client...'
    );

    await this.connection.connect();

    console.log(
      'MetaApi websocket connected.'
    );

    await this.connection.waitSynchronized();

    console.log(
      'MetaApi synchronization complete.'
    );

    // =========================================================
    // CONNECT RPC
    // =========================================================

    console.log(
      'Connecting MetaApi RPC connection...'
    );

    await this.rpc.connect();

    await this.rpc.waitSynchronized();

    console.log(
      'MetaApi RPC synchronized.'
    );

    // =========================================================
    // SUBSCRIBE XAUUSDm
    // =========================================================

    await this.connection.subscribeToMarketData(
      this.symbol
    );

    console.log(
      `Subscribed to market data: ${this.symbol}`
    );

    // =========================================================
    // GET SPECIFICATION FROM TERMINAL STATE
    // =========================================================

    try {
      this.spec =
        this.connection.terminalState.specification(
          this.symbol
        );

      if (this.spec) {
        console.log(
          `Symbol specification loaded: ${this.symbol}`
        );
      }
    } catch (error) {
      console.warn(
        'Could not load symbol specification:',
        error?.message || error
      );
    }

    // =========================================================
    // READY
    // =========================================================

    this.ready = true;

    console.log(
      `MetaApi/Exness connected: ${this.ready} spec: ${this.symbol}`
    );

    console.log(
      `LIVE_TRADING: ${CONFIG.liveTrading}`
    );

    return true;
  }

  // =========================================================
  // PROCESS PRICE
  // =========================================================

  async processPrice(price) {
    if (!price) {
      return;
    }

    if (price.symbol !== this.symbol) {
      return;
    }

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

    const receivedAt = Date.now();

    let timeMs = receivedAt;

    if (price.time) {
      const parsed =
        new Date(price.time).getTime();

      if (Number.isFinite(parsed)) {
        timeMs = parsed;
      }
    }

    const processedPrice = {
      symbol: price.symbol,
      bid,
      ask,
      mid: (bid + ask) / 2,
      timeMs,
      receivedAt
    };

    this.lastPrice = processedPrice;

    try {
      this.metrics.tick();
    } catch (error) {
      console.error(
        'Metrics error:',
        error?.message || error
      );
    }

    // Send price to strategy/execution engine.
    this.emitTick(processedPrice);

    // Log only every 10 seconds.
    if (
      receivedAt - this.lastTickLog >= 10000
    ) {
      this.lastTickLog = receivedAt;

      console.log(
        `XAUUSDm price stream OK | Bid: ${bid} | Ask: ${ask} | Spread: ${(ask - bid).toFixed(3)}`
      );
    }
  }

  // =========================================================
  // ACCOUNT INFORMATION
  // =========================================================

  async accountInfo() {
    if (!this.rpc) {
      throw new Error(
        'MetaApi RPC connection is not available'
      );
    }

    return await this.rpc.getAccountInformation();
  }

  // =========================================================
  // POSITIONS
  // =========================================================

  async positions() {
    if (!this.rpc) {
      throw new Error(
        'MetaApi RPC connection is not available'
      );
    }

    return await this.rpc.getPositions();
  }

  // =========================================================
  // BUY
  // =========================================================

  async buy(
    volume,
    stopLoss = undefined,
    takeProfit = undefined,
    comment = 'Gold-Hunter-7Pro'
  ) {
    if (!this.rpc) {
      throw new Error(
        'MetaApi RPC connection is not available'
      );
    }

    if (!CONFIG.liveTrading) {
      console.log(
        `LIVE_TRADING=false -> BUY blocked | ${this.symbol} | volume=${volume}`
      );

      return {
        blocked: true,
        reason: 'LIVE_TRADING=false'
      };
    }

    return await this.rpc.createMarketBuyOrder(
      this.symbol,
      volume,
      stopLoss,
      takeProfit,
      undefined,
      {
        comment,
        magic: CONFIG.magic
      }
    );
  }

  // =========================================================
  // SELL
  // =========================================================

  async sell(
    volume,
    stopLoss = undefined,
    takeProfit = undefined,
    comment = 'Gold-Hunter-7Pro'
  ) {
    if (!this.rpc) {
      throw new Error(
        'MetaApi RPC connection is not available'
      );
    }

    if (!CONFIG.liveTrading) {
      console.log(
        `LIVE_TRADING=false -> SELL blocked | ${this.symbol} | volume=${volume}`
      );

      return {
        blocked: true,
        reason: 'LIVE_TRADING=false'
      };
    }

    return await this.rpc.createMarketSellOrder(
      this.symbol,
      volume,
      stopLoss,
      takeProfit,
      undefined,
      {
        comment,
        magic: CONFIG.magic
      }
    );
  }

  // =========================================================
  // MODIFY POSITION
  // =========================================================

  async modify(
    positionId,
    stopLoss = undefined,
    takeProfit = undefined
  ) {
    if (!this.rpc) {
      throw new Error(
        'MetaApi RPC connection is not available'
      );
    }

    if (!CONFIG.liveTrading) {
      console.log(
        `LIVE_TRADING=false -> MODIFY blocked | position=${positionId}`
      );

      return {
        blocked: true,
        reason: 'LIVE_TRADING=false'
      };
    }

    return await this.rpc.modifyPosition(
      positionId,
      stopLoss,
      takeProfit
    );
  }

  // =========================================================
  // CLOSE POSITION
  // =========================================================

  async close(positionId) {
    if (!this.rpc) {
      throw new Error(
        'MetaApi RPC connection is not available'
      );
    }

    if (!CONFIG.liveTrading) {
      console.log(
        `LIVE_TRADING=false -> CLOSE blocked | position=${positionId}`
      );

      return {
        blocked: true,
        reason: 'LIVE_TRADING=false'
      };
    }

    return await this.rpc.closePosition(
      positionId
    );
  }

  // =========================================================
  // SHUTDOWN
  // =========================================================

  async shutdown() {
    this.ready = false;

    try {
      if (this.connection) {
        await this.connection.close();
      }
    } catch (error) {
      console.warn(
        'Streaming shutdown warning:',
        error?.message || error
      );
    }

    try {
      if (this.rpc) {
        await this.rpc.close();
      }
    } catch (error) {
      console.warn(
        'RPC shutdown warning:',
        error?.message || error
      );
    }

    this.connection = null;
    this.rpc = null;
    this.account = null;
    this.api = null;

    console.log(
      'MetaApi broker shutdown complete.'
    );
  }
  }
