import 'dotenv/config';

const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
};

export const CONFIG = Object.freeze({
  port: num('PORT', 10000),
  host: process.env.HOST || '0.0.0.0',
  metaApiToken: process.env.METAAPI_TOKEN || '',
  accountId: process.env.METAAPI_ACCOUNT_ID || '',
  region: process.env.METAAPI_REGION || 'london',
  symbol: process.env.EXNESS_SYMBOL || 'XAUUSDm',
  liveTrading: String(process.env.LIVE_TRADING || 'false').toLowerCase() === 'true',
  frontendOrigin: process.env.FRONTEND_ORIGIN || '*',
  riskPerTradePct: num('RISK_PER_TRADE_PCT', 0.35),
  maxConcurrentPositions: num('MAX_CONCURRENT_POSITIONS', 2),
  maxDailyLossPct: num('MAX_DAILY_LOSS_PCT', 3),
  maxSpread: num('MAX_SPREAD', 0.35),
  rr: num('RR', 1.5),
  maxSlAtr: num('MAX_SL_ATR', 2.5),
  minSl: num('MIN_SL', 0.5),
  maxSl: num('MAX_SL', 6),
  cooldownMs: num('COOLDOWN_MS', 15000),
  signalExpiryMs: num('SIGNAL_EXPIRY_MS', 30000),
  maxEntryAgeMs: num('MAX_ENTRY_AGE_MS', 1200),
  maxTickAgeMs: num('MAX_TICK_AGE_MS', 2500),
  magic: 26090701
});

export function assertConfig() {
  const missing=[];
  if(!CONFIG.metaApiToken) missing.push('METAAPI_TOKEN');
  if(!CONFIG.accountId) missing.push('METAAPI_ACCOUNT_ID');
  if(missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
