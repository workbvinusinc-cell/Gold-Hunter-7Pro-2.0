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

  emitTick(p) {
    for (const fn of this.listeners) {
      try {
        fn(p);
      } catch (e) {
        console.error('tick handler', e);
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

    this.connection =
      this.account.getStreamingConnection();

    this.connection.addSynchronizationListener({
      onSymbolPricesUpdated: async (_instanceIndex, prices) => {
        if (!Array.isArray(prices)) {
          prices = [prices];
        }

        for (const price of prices) {
          if (price?.symbol !== this.symbol) {
            continue;
          }

          const t0 = Date.now();

          const bid = Number(price.bid);
          const ask = Number(price.ask);

          if (
            !Number.isFinite(bid) ||
            !Number.isFinite(ask)
          ) {
            continue;
          }

          const p = {
            symbol: this.symbol,
            bid,
            ask,
            mid: (bid + ask) / 2,
            timeMs: price.time
              ? new Date(price.time).getTime()
              : Date.now(),
            receivedAt: Date.now()
          };

          this.lastPrice = p;

          this.metrics.tick();

          this.emitTick(p);

          this.metrics.recordLatency(
            Date.now() - t0
          );
        }
      },

      onDisconnected: async (_instanceIndex) => {
        this.ready = false;
        console.warn('MetaApi disconnected');
      },

      onConnected: async () => {
        this.ready = true;
        console.log('MetaApi connection established');
      }
    });

    await this.connection.connect();

    await this.connection.waitSynchronized();

    await this.connection.subscribeToMarketData(
      this.symbol
    );

    this.spec =
      this.connection.terminalState.specification(
        this.symbol
      );

    this.ready = true;

    return {
      connected:
        this.connection.terminalState.connected,

      connectedToBroker:
        this.connection.terminalState.connectedToBroker,

      specification: this.spec
    };
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
