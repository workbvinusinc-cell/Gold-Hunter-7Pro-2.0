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
  }

  onTick(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emitTick(price) {
    for (const fn of this.listeners) {
      try {
        fn(price);
      } catch (e) {
        console.error('tick handler error:', e);
      }
    }
  }

  async connect() {
    this.api = new MetaApi(CONFIG.metaApiToken, {
      region: CONFIG.region
    });

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

    this.connection =
      this.account.getStreamingConnection();

    this.connection.addSynchronizationListener({

      async onConnected(instanceIndex, replicas) {
        console.log(
          `MetaApi terminal connected: ${instanceIndex}, replicas=${replicas}`
        );
      },

      async onDisconnected(instanceIndex) {
        console.warn(
          `MetaApi terminal disconnected: ${instanceIndex}`
        );

        this.ready = false;
      },

      async onHealthStatus(instanceIndex, status) {
        console.log(
          `MetaApi health status: ${instanceIndex}`,
          status
        );
      },

      async onBrokerConnectionStatusChanged(
        instanceIndex,
        connected
      ) {
        console.log(
          `Broker connection: ${instanceIndex} -> ${connected}`
        );
      },

      async onSynchronizationStarted(
        instanceIndex,
        specificationsHash,
        positionsHash,
        ordersHash,
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
        // Account state is maintained by MetaApi terminalState.
      },

      async onPositionsReplaced(
        instanceIndex,
        positions
      ) {},

      async onPositionsSynchronized(
        instanceIndex,
        synchronizationId
      ) {},

      async onPositionsUpdated(
        instanceIndex,
        positions,
        removedPositionIds
      ) {},

      async onPositionUpdated(
        instanceIndex,
        position
      ) {},

      async onPositionRemoved(
        instanceIndex,
        positionId
      ) {},

      async onPendingOrdersReplaced(
        instanceIndex,
        orders
      ) {},

      async onPendingOrdersUpdated(
        instanceIndex,
        orders,
        completedOrderIds
      ) {},

      async onPendingOrderUpdated(
        instanceIndex,
        order
      ) {},

      async onPendingOrderCompleted(
        instanceIndex,
        orderId
      ) {},

      async onPendingOrdersSynchronized(
        instanceIndex,
        synchronizationId
      ) {},

      async onHistoryOrderAdded(
        instanceIndex,
        historyOrder
      ) {},

      async onHistoryOrdersSynchronized(
        instanceIndex,
        synchronizationId
      ) {},

      async onDealAdded(
        instanceIndex,
        deal
      ) {},

      async onDealsSynchronized(
        instanceIndex,
        synchronizationId
      ) {},

      async onSymbolSpecificationUpdated(
        instanceIndex,
        specification
      ) {
        if (
          specification &&
          specification.symbol === this.symbol
        ) {
          this.spec = specification;

          console.log(
            `Symbol specification received: ${this.symbol}`
          );
        }
      },

      async onSymbolSpecificationRemoved(
        instanceIndex,
        symbol
      ) {},

      async onSymbolSpecificationsUpdated(
        instanceIndex,
        specifications,
        removedSymbols
      ) {
        if (!Array.isArray(specifications)) return;

        const match = specifications.find(
          s => s?.symbol === this.symbol
        );

        if (match) {
          this.spec = match;

          console.log(
            `Symbol specification received: ${this.symbol}`
          );
        }
      },

      async onSymbolPriceUpdated(
        instanceIndex,
        price
      ) {
        await this.processPrice(price);
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
        if (!Array.isArray(prices)) return;

        for (const price of prices) {
          await this.processPrice(price);
        }
      },

      async onCandlesUpdated(
        instanceIndex,
        candles,
        equity,
        margin,
        freeMargin,
        marginLevel,
        accountCurrencyExchangeRate
      ) {},

      async onTicksUpdated(
        instanceIndex,
        ticks,
        equity,
        margin,
        freeMargin,
        marginLevel,
        accountCurrencyExchangeRate
      ) {},

      async onBooksUpdated(
        instanceIndex,
        books,
        equity,
        margin,
        freeMargin,
        marginLevel,
        accountCurrencyExchangeRate
      ) {},

      async onSubscriptionDowngraded(
        instanceIndex,
        symbol,
        updates,
        unsubscriptions
      ) {},

      async onStreamClosed(
        instanceIndex
      ) {
        console.warn(
          `MetaApi stream closed: ${instanceIndex}`
        );
      },

      async onUnsubscribeRegion(
        region
      ) {
        console.warn(
          `MetaApi region unsubscribed: ${region}`
        );
      }
    });

    await this.connection.connect();

    await this.connection.waitSynchronized();

    console.log('MetaApi synchronization complete');

    await this.connection.subscribeToMarketData(
      this.symbol
    );

    console.log(
      `Subscribed to market data: ${this.symbol}`
    );

    this.spec =
      this.connection.terminalState.specification(
        this.symbol
      );

    if (!this.spec) {
      console.warn(
        `WARNING: No symbol specification found for ${this.symbol}`
      );
    } else {
      console.log(
        `Symbol specification loaded: ${this.symbol}`
      );
    }

    this.ready = true;

    return {
      connected:
        this.connection.terminalState.connected,

      connectedToBroker:
        this.connection.terminalState.connectedToBroker,

      specification: this.spec
    };
  }

  async processPrice(price) {
    if (!price || price.symbol !== this.symbol) {
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

    const timeMs = price.time
      ? new Date(price.time).getTime()
      : receivedAt;

    const p = {
      symbol: price.symbol,
      bid,
      ask,
      mid: (bid + ask) / 2,
      timeMs,
      receivedAt
    };

    this.lastPrice = p;

    this.metrics.tick();

    this.emitTick(p);
  }

  accountInfo() {
    return (
      this.connection?.terminalState
        ?.accountInformation || null
    );
  }

  positions() {
    return (
      this.connection?.terminalState?.positions || []
    );
  }

  async buy(volume, sl, tp, clientId) {
    return this.connection.createMarketBuyOrder(
      this.symbol,
      volume,
      sl,
      tp,
      {
        comment: 'XAU HFT',
        clientId,
        magic: CONFIG.magic
      }
    );
  }

  async sell(volume, sl, tp, clientId) {
    return this.connection.createMarketSellOrder(
      this.symbol,
      volume,
      sl,
      tp,
      {
        comment: 'XAU HFT',
        clientId,
        magic: CONFIG.magic
      }
    );
  }

  async modify(positionId, sl, tp) {
    return this.connection.modifyPosition(
      positionId,
      sl,
      tp
    );
  }

  async close(positionId) {
    return this.connection.closePosition(
      positionId
    );
  }

  async shutdown() {
    try {
      await this.connection?.unsubscribeFromMarketData(
        this.symbol
      );
    } catch {}

    try {
      await this.connection?.close();
    } catch {}

    try {
      await this.api?.close();
    } catch {}
  }
}
