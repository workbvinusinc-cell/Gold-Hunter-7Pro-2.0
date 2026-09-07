import 'dotenv/config';
import express from 'express';

import { CONFIG, assertConfig } from './config.js';
import { ExnessBroker } from './broker.js';
import { ExecutionEngine } from './execution-engine.js';

const app = express();

app.use(express.json());

const broker = new ExnessBroker();

let executionEngine = null;
let started = false;
let startError = null;

// ============================================================
// BASIC ROUTES
// ============================================================

app.get('/', (req, res) => {
  res.json({
    name: 'Gold-Hunter-7Pro-2.0',
    status: started ? 'online' : 'starting',
    brokerConnected: broker.ready,
    symbol: CONFIG.symbol,
    liveTrading: CONFIG.liveTrading,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', async (req, res) => {
  res.json({
    ok: started && broker.ready,
    status: started ? 'online' : 'starting',
    brokerConnected: broker.ready,
    symbol: CONFIG.symbol,
    liveTrading: CONFIG.liveTrading,
    timestamp: new Date().toISOString()
  });
});

app.get('/status', async (req, res) => {
  let account = null;
  let positions = [];

  try {
    if (broker.ready) {
      account = await broker.accountInfo();
      positions = await broker.positions();
    }
  } catch (error) {
    console.error(
      'Status query error:',
      error?.message || error
    );
  }

  res.json({
    bot: 'Gold-Hunter-7Pro-2.0',
    started,
    brokerConnected: broker.ready,
    symbol: CONFIG.symbol,
    liveTrading: CONFIG.liveTrading,
    account,
    positions,
    lastPrice: broker.lastPrice,
    error: startError,
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// START BOT
// ============================================================

async function startBot() {
  if (started) {
    return;
  }

  try {
    assertConfig();

    console.log('==========================================');
    console.log(' GOLD-HUNTER-7PRO-2.0');
    console.log('==========================================');

    console.log(
      `Symbol: ${CONFIG.symbol}`
    );

    console.log(
      `MetaApi region: ${CONFIG.region}`
    );

    console.log(
      `LIVE_TRADING: ${CONFIG.liveTrading}`
    );

    // --------------------------------------------------------
    // CONNECT BROKER
    // --------------------------------------------------------

    await broker.connect();

    console.log(
      `Broker ready: ${broker.ready}`
    );

    if (!broker.ready) {
      throw new Error(
        'Broker connection did not become ready'
      );
    }

    // --------------------------------------------------------
    // START EXECUTION ENGINE
    // --------------------------------------------------------

    executionEngine =
      new ExecutionEngine(broker);

    executionEngine.start();

    // --------------------------------------------------------
    // RECEIVE MARKET TICKS
    // --------------------------------------------------------

    broker.onTick(async price => {
      try {
        if (!executionEngine) {
          return;
        }

        await executionEngine.onTick(price);
      } catch (error) {
        console.error(
          'Execution engine tick error:',
          error?.message || error
        );
      }
    });

    started = true;

    console.log('==========================================');
    console.log(' BOT ONLINE');
    console.log('==========================================');

    console.log(
      `Broker connected: ${broker.ready}`
    );

    console.log(
      `Market data: ${CONFIG.symbol}`
    );

    console.log(
      `Live trading: ${CONFIG.liveTrading}`
    );

    console.log('==========================================');
  } catch (error) {
    startError =
      error?.message || String(error);

    console.error(
      'BOT START ERROR:',
      startError
    );

    started = false;
  }
}

// ============================================================
// HTTP SERVER
// ============================================================

const port = Number(
  process.env.PORT || CONFIG.port || 10000
);

const host =
  process.env.HOST ||
  CONFIG.host ||
  '0.0.0.0';

app.listen(port, host, () => {
  console.log(
    `HFT server listening on ${host}:${port}`
  );

  startBot();
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(signal) {
  console.log(
    `Received ${signal}. Shutting down...`
  );

  try {
    if (executionEngine) {
      executionEngine.stop();
    }

    await broker.shutdown();
  } catch (error) {
    console.error(
      'Shutdown error:',
      error?.message || error
    );
  }

  process.exit(0);
}

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

// ============================================================
// UNHANDLED ERRORS
// ============================================================

process.on(
  'unhandledRejection',
  error => {
    console.error(
      'Unhandled promise rejection:',
      error?.message || error
    );
  }
);

process.on(
  'uncaughtException',
  error => {
    console.error(
      'Uncaught exception:',
      error?.message || error
    );
  }
);
