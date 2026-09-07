import MetaApi from 'metaapi.cloud-sdk/esm-node';
import { CONFIG } from './config.js';
import { Metrics } from './metrics.js';

export class ExnessBroker {
  constructor() {
    this.api = null;
    this.account = null;
    this.connection = null;

    this.symbol = CONFIG.symbol;
    this.spec = null;

    this.metrics = new Metrics();
    this.listeners = new Set();

    this.ready = false;
    this.lastPrice = null;

    this.lastTickLog = 0;
  }

  // ---------------------------------------------------------
  // TICK LISTENERS
  // ---------------------------------------------------------

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
      } catch (e) {
        console.error('Tick handler error:', e);
      }
    }
  }

  // ---------------------------------------------------------
  // CONNECT TO METAAPI / EXNESS
  // ---------------------------------------------------------

  async connect() {
    if (!CONFIG.metaApiToken) {
      throw new Error('METAAPI_TOKEN is missing');
    }

    if (!CONFIG.accountId) {
      throw new Error('METAAPI_ACCOUNT_ID is missing');
    }

    // Keep reference to the actual ExnessBroker instance.
    // MetaApi listener callbacks have their own "this".
    const broker = this;

    console.log('Connecting to MetaApi...');
    console.log(`MetaApi region: ${CONFIG.region}`);
    console.log(`Trading symbol: ${CONFIG.symbol}`);

    this.api = new MetaApi(CONFIG.metaApiToken, {
      region: CONFIG.region
    });

    // -------------------------------------------------------
    // GET ACCOUNT
    // -------------------------------------------------------

    this.account =
      await this.api.metatraderAccountApi.getAccount(
        CONFIG.accountId
      );

    console.log(`MetaApi account region: ${this.account.region}`);
    console.log(
      `MetaApi account connection status: ${this.account.connectionStatus}`
    );

    // -------------------------------------------------------
    // DEPLOY ACCOUNT IF REQUIRED
    // -------------------------------------------------------

    if (
      this.account.state !== 'DEPLOYED' &&
      this.account.state !== 'DEPLOYING'
    ) {
      console.log('MetaApi account is not deployed. Deploying...');

      await this.account.deploy();

      console.log('MetaApi account deployment requested.');
    }

    // -------------------------------------------------------
    // STREAMING CONNECTION
    // -------------------------------------------------------

    this.connection =
      this.account.getStreamingConnection();

    console.log('Connecting MetaApi websocket client...');

    // -------------------------------------------------------
    // SYNCHRONIZATION LISTENER
    // -------------------------------------------------------

    this.connection.addSynchronizationListener({

      // -----------------------------------------------
      // CONNECTION
      // -----------------------------------------------

      async onConnected(instanceIndex, replicas) {
        console.log(
          `MetaApi terminal connected: ${instanceIndex}, replicas=${replicas}`
        );
      },

      async onDisconnected(instanceIndex) {
        console.warn(
          `MetaApi terminal disconnected: ${instanceIndex}`
        );

        broker.ready = false;
      },

      async onHealthStatus(instanceIndex, status) {
        console.log(
          `MetaApi health status ${instanceIndex}:`,
          status || {}
        );
      },

      async onBrokerConnectionStatusChanged(
        instanceIndex,
        connected
      ) {
        console.log(
          `Broker connection ${instanceIndex} -> ${connected}`
        );
      },

      // -----------------------------------------------
      // SYNCHRONIZATION
      // -----------------------------------------------

      async onSynchronizationStarted(
        instanceIndex,
        specifications,
        specificationsHash,
        synchronizationId
      ) {
        console.log(
          `Synchronization started: ${instanceIndex}`
        );
      },

      async onAccountInformationUpdated(
        instanceIndex,
        accountInformation
      ) {
        // Account information is handled on demand.
      },

      async onPositionsReplaced(
        instanceIndex,
        positions
      ) {
        // No action required.
      },

      async onPositionUpdated(
        instanceIndex,
        position
      ) {
        // No action required.
      },

      async onPositionRemoved(
        instanceIndex,
        positionId
      ) {
        // No action required.
      },

      async onOrdersReplaced(
        instanceIndex,
        orders
      ) {
        // No action required.
      },

      async onOrderUpdated(
        instanceIndex,
        order
      ) {
        // No action required.
      },

      async onOrderCompleted(
        instanceIndex,
        orderId
      ) {
        console.log(
          `Order completed: ${orderId}`
        );
      },

      async onOrderRemoved(
        instanceIndex,
        orderId
      ) {
        // No action required.
      },

      async onHistoryOrdersAdded(
        instanceIndex,
        historyOrders
      ) {
        // No action required.
      },

      async onHistoryOrdersRemoved(
        instanceIndex,
        historyOrders
      ) {
        // No action required.
      },

      async onHistoryDealsAdded(
        instanceIndex,
        deals
      ) {
        // No action required.
      },

      async onHistoryDealsRemoved(
        instanceIndex,
        deals
      ) {
        // No action required.
      },

      // -----------------------------------------------
      // SYMBOL SPECIFICATION
      // -----------------------------------------------

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

          console.warn(
            `Symbol specification removed: ${symbol}`
          );
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
          specification =>
            specification &&
            specification.symbol === broker.symbol
        );

        if (found) {
          broker.spec = found;

          console.log(
            `Symbol specification received: ${broker.symbol}`
          );
        }
      },

      // -----------------------------------------------
      // PRICE STREAM
      // -----------------------------------------------

      async onSymbolPriceUpdated(
        instanceIndex,
        price
      ) {
        await broker.processPrice(price);
      },

      async onSymbolPricesUpdated(
        instanceIndex,
        prices,
        equity,
        margin,
        freeMargin,
        marginLevel,
        accountCurrencyExchangeRate
      ) {
        if (!Array.isArray(prices)) {
          return;
        }

        for (const price of prices) {
          await broker.processPrice(price);
        }
      },

      // -----------------------------------------------
      // MARKET DATA
      // -----------------------------------------------

      async onCandlesUpdated(
        instanceIndex,
        candles,
        equity,
        margin,
        freeMargin,
        marginLevel,
        accountCurrencyExchangeRate
      ) {
        // Candle engine can request candles directly.
      },

      async onTicksUpdated(
        instanceIndex,
        ticks,
        equity,
        margin,
        freeMargin,
        marginLevel,
        accountCurrencyExchangeRate
      ) {
        // Price events are handled above.
      },

      async onBooksUpdated(
        instanceIndex,
        books,
        equity,
        margin,
        freeMargin,
        marginLevel,
        accountCurrencyExchangeRate
      ) {
        // Order book data is optional.
      },

      // -----------------------------------------------
      // DEALS
      // -----------------------------------------------

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

      async onDealRemoved(
        instanceIndex,
        deal
      ) {
        // No action required.
      },

      // -----------------------------------------------
      // SYMBOL PRICES RESET
      // -----------------------------------------------

      async onSymbolPricesReset(
        instanceIndex,
        symbols
      ) {
        // No action required.
      },

      // -----------------------------------------------
      // STREAMING STATUS
      // -----------------------------------------------

      async onStreamClosed(
        instanceIndex
      ) {
        console.warn(
          `MetaApi stream closed: ${instanceIndex}`
        );

        broker.ready = false;
      }
    });

    // -------------------------------------------------------
    // CONNECT
    // -------------------------------------------------------

    await this.connection.connect();

    console.log('MetaApi websocket connected.');

    // -------------------------------------------------------
    // WAIT FOR TERMINAL SYNCHRONIZATION
    // -------------------------------------------------------

    await this.connection.waitSynchronized();

    console.log('MetaApi synchronization complete.');

    // -------------------------------------------------------
    // SUBSCRIBE TO XAUUSDm
    // -------------------------------------------------------

    await this.connection.subscribeToMarketData(
      this.symbol
    );

    console.log(
      `Subscribed to market data: ${this.symbol}`
    );

    // -------------------------------------------------------
    // LOAD SYMBOL SPECIFICATION
    // -------------------------------------------------------

    try {
      this.spec =
        await this.connection.getSymbolSpecification(
          this.symbol
        );

      if (this.spec) {
        console.log(
          `Symbol specification loaded: ${this.symbol}`
        );
      }
    } catch (error) {
      console.warn(
        `Could not load symbol specification for ${this.symbol}:`,
        error.message
      );
    }

    // -------------------------------------------------------
    // READY
    // -------------------------------------------------------

    this.ready = true;

    console.log(
      `MetaApi/Exness connected: ${this.ready} spec: ${this.symbol}`
    );

    console.log(
      `LIVE_TRADING: ${CONFIG.liveTrading}`
    );

    return true;
  }

  // ---------------------------------------------------------
  // PROCESS PRICE
  // ---------------------------------------------------------

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
      const parsedTime =
        new Date(price.time).getTime();

      if (Number.isFinite(parsedTime)) {
        timeMs = parsedTime;
      }
    }

    const p = {
      symbol: price.symbol,
      bid,
      ask,
      mid: (bid + ask) / 2,
      timeMs,
      receivedAt
    };

    this.lastPrice = p;

    // Update metrics.
    try {
      this.metrics.tick();
    } catch (error) {
      console.error(
        'Metrics tick error:',
        error.message
      );
    }

    // Send price to strategy / execution engine.
    this.emitTick(p);

    // -------------------------------------------------------
    // LOW-FREQUENCY DEBUG LOG
    // Prevent Render logs from being flooded.
    // -------------------------------------------------------

    if (
      receivedAt - this.lastTickLog >= 10000
    ) {
      this.lastTickLog = receivedAt;

      console.log(
        `XAUUSDm price stream OK | Bid: ${bid} | Ask: ${ask} | Spread: ${(ask - bid).toFixed(3)}`
      );
    }
  }

  // ---------------------------------------------------------
  // ACCOUNT INFORMATION
  // ---------------------------------------------------------

  async accountInfo() {
    if (!this.connection) {
      throw new Error(
        'MetaApi connection is not available'
      );
    }

    return await this.connection.getAccountInformation();
  }

  // ---------------------------------------------------------
  // OPEN POSITIONS
  // ---------------------------------------------------------

  async positions() {
    if (!this.connection) {
      throw new Error(
        'MetaApi connection is not available'
      );
    }

    return await this.connection.getPositions();
  }

  // ---------------------------------------------------------
  // BUY
  // ---------------------------------------------------------

  async buy(
    volume,
    stopLoss = undefined,
    takeProfit = undefined,
    comment = 'Gold-Hunter-7Pro'
  ) {
    if (!this.connection) {
      throw new Error(
        'MetaApi connection is not available'
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

    return await this.connection.createMarketBuyOrder(
      this.symbol,
      volume,
      stopLoss,
      takeProfit,
      {
        comment,
        magic: CONFIG.magic
      }
    );
  }

  // ---------------------------------------------------------
  // SELL
  // ---------------------------------------------------------

  async sell(
    volume,
    stopLoss = undefined,
    takeProfit = undefined,
    comment = 'Gold-Hunter-7Pro'
  ) {
    if (!this.connection) {
      throw new Error(
        'MetaApi connection is not available'
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

    return await this.connection.createMarketSellOrder(
      this.symbol,
      volume,
      stopLoss,
      takeProfit,
      {
        comment,
        magic: CONFIG.magic
      }
    );
  }

  // ---------------------------------------------------------
  // MODIFY POSITION
  // ---------------------------------------------------------

  async modify(
    positionId,
    stopLoss = undefined,
    takeProfit = undefined
  ) {
    if (!this.connection) {
      throw new Error(
        'MetaApi connection is not available'
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

    return await this.connection.modifyPosition(
      positionId,
      stopLoss,
      takeProfit
    );
  }

  // ---------------------------------------------------------
  // CLOSE POSITION
  // ---------------------------------------------------------

  async close(positionId) {
    if (!this.connection) {
      throw new Error(
        'MetaApi connection is not available'
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

    return await this.connection.closePosition(
      positionId
    );
  }

  // ---------------------------------------------------------
  // SHUTDOWN
  // ---------------------------------------------------------

  async shutdown() {
    this.ready = false;

    if (this.connection) {
      try {
        await this.connection.close();
      } catch (error) {
        console.warn(
          'MetaApi connection close warning:',
          error.message
        );
      }
    }

    this.connection = null;
    this.account = null;
    this.api = null;

    console.log('MetaApi broker shutdown complete.');
  }
        }
