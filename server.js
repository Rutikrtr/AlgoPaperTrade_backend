const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { SmartAPI } = require('smartapi-javascript');
const otplib = require('otplib');
require('dotenv').config();

const smartapi = require('smartapi-javascript');


const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─── ANGEL ONE CONFIG ────────────────────────────────────────────────────────
const smart = new SmartAPI({
  api_key: process.env.ANGLE_ONE_API_KEY,
});

let angelSession = null;
let angelWS = null;

// ─── STOCKS ────────────────────────────────────────────────────────────────
const STOCKS = {
  RELIANCE:  { price: 2850,  sector: 'Energy',  lot: 250,  token: '2885',  symbol: 'RELIANCE-EQ' },
  TCS:       { price: 3920,  sector: 'IT',       lot: 150,  token: '11536', symbol: 'TCS-EQ' },
  HDFCBANK:  { price: 1680,  sector: 'Finance',  lot: 550,  token: '1333',  symbol: 'HDFCBANK-EQ' },
  INFY:      { price: 1780,  sector: 'IT',       lot: 300,  token: '1594',  symbol: 'INFY-EQ' },
  ITC:       { price: 465,   sector: 'FMCG',     lot: 1600, token: '1660',  symbol: 'ITC-EQ' },
  TATASTEEL: { price: 168,   sector: 'Metal',    lot: 5500, token: '3499',  symbol: 'TATASTEEL-EQ' },
  WIPRO:     { price: 545,   sector: 'IT',       lot: 1500, token: '3787',  symbol: 'WIPRO-EQ' },
  BAJFINANCE:{ price: 6720,  sector: 'Finance',  lot: 125,  token: '317',   symbol: 'BAJFINANCE-EQ' },
  SUNPHARMA: { price: 1580,  sector: 'Pharma',   lot: 700,  token: '3351',  symbol: 'SUNPHARMA-EQ' },
  MARUTI:    { price: 12800, sector: 'Auto',     lot: 100,  token: '10999', symbol: 'MARUTI-EQ' },
  ICICIBANK: { price: 1220,  sector: 'Finance',  lot: 700,  token: '4963',  symbol: 'ICICIBANK-EQ' },
  AXISBANK:  { price: 1180,  sector: 'Finance',  lot: 1200, token: '5900',  symbol: 'AXISBANK-EQ' },
  SBIN:      { price: 820,   sector: 'Finance',  lot: 1500, token: '3045',  symbol: 'SBIN-EQ' },
  ONGC:      { price: 275,   sector: 'Energy',   lot: 3850, token: '2475',  symbol: 'ONGC-EQ' },
  NTPC:      { price: 380,   sector: 'Power',    lot: 3000, token: '11630', symbol: 'NTPC-EQ' },
};

// token -> symbol map for quick lookup
const tokenToSym = {};
Object.entries(STOCKS).forEach(([sym, v]) => { tokenToSym[v.token] = sym; });

const INDICES = {
  'NIFTY 50':   { value: 24750, change: 0 },
  'SENSEX':     { value: 81200, change: 0 },
  'BANKNIFTY':  { value: 52400, change: 0 },
  'INDIA VIX':  { value: 14.2,  change: 0 },
  'MIDCAP 100': { value: 12800, change: 0 },
};

// ─── PRICE HISTORY ──────────────────────────────────────────────────────────
const priceHistory = {};
const volumeHistory = {};
Object.keys(STOCKS).forEach(sym => {
  priceHistory[sym] = [];
  volumeHistory[sym] = [];
  let p = STOCKS[sym].price;
  for (let i = 200; i >= 0; i--) {
    const o = p;
    const h = o * (1 + Math.random() * 0.012);
    const l = o * (1 - Math.random() * 0.012);
    const c = l + Math.random() * (h - l);
    const v = Math.floor(Math.random() * 500000 + 100000);
    priceHistory[sym].push({ t: Date.now() - i * 60000, o, h, l, c, v });
    p = c;
    volumeHistory[sym].push(v);
  }
  STOCKS[sym].price = priceHistory[sym][priceHistory[sym].length - 1].c;
});

// ─── ANGEL ONE LOGIN ─────────────────────────────────────────────────────────
async function loginAngelOne() {
  try {
    const clientId = process.env.ANGLE_ONE_CLIENT_ID?.trim();
    const password = process.env.ANGLE_ONE_PASSWORD?.trim();
    const apiKey = process.env.ANGLE_ONE_API_KEY?.trim();
    const totpSecret = process.env.ANGLE_ONE_TOTP_SECRET?.replace(/\s/g, '');

    console.log('Angel One Config Check:');
    console.log('API Key:', apiKey ? '✓ Present' : '✗ Missing');
    console.log('Client ID:', clientId ? clientId : '✗ Missing');
    console.log('Password:', password ? '✓ Present' : '✗ Missing');
    console.log('TOTP Secret:', totpSecret ? '✓ Present' : '✗ Missing');

    if (!clientId || !password || !apiKey || !totpSecret) {
      throw new Error('Missing Angel One credentials in .env');
    }
    const otp = otplib.authenticator.generate(totpSecret);

    const response = await smart.generateSession(
      clientId,
      password,
      otp
    );

    if (response?.status && response?.data) {
      angelSession = response.data;

      console.log('✅ Angel One login successful');
      console.log('JWT Token received');
      console.log('Feed Token received');

      startAngelWebSocket();
      return;
    }

    console.error('❌ Angel One login failed');
    console.error(response);

    console.log('⚠️ Falling back to simulated prices');
    setInterval(simulateTick, 1500);

  } catch (err) {
    console.error('❌ Angel One login error');
    console.error(err);

    console.log('⚠️ Falling back to simulated prices');
    setInterval(simulateTick, 1500);
  }
}

// ─── ANGEL ONE WEBSOCKET ─────────────────────────────────────────────────────
function startAngelWebSocket() {
  try {
    const { WebSocketV2 } = require('smartapi-javascript');

    angelWS = new WebSocketV2({
      jwttoken: angelSession.jwtToken,
      apikey: process.env.ANGLE_ONE_API_KEY,
      clientcode: process.env.ANGLE_ONE_CLIENT_ID,
      feedtype: angelSession.feedToken,
    });

    angelWS.connect();

    angelWS.on('open', () => {
      console.log('✅ Angel One WebSocket connected');

      const tokenList = Object.values(STOCKS).map((s) => s.token);

      angelWS.subscribe({
        correlationID: 'algo-trade',
        action: 1,
        mode: 1,
        exchangeType: 1,
        tokens: tokenList,
      });
    });

    angelWS.on('tick', (data) => {
      // Process tick data
    });

    angelWS.on('error', (err) => {
      console.error('❌ WS Error:', err);
    });

    angelWS.on('close', () => {
      console.log('⚠️ WebSocket Closed');
    });

  } catch (err) {
    console.error('❌ WebSocket init error:', err);
  }
}

// ─── SIMULATED TICK (fallback) ───────────────────────────────────────────────
function simulateTick() {
  const updates = {};
  Object.keys(STOCKS).forEach(sym => {
    const stock = STOCKS[sym];
    const prev = priceHistory[sym][priceHistory[sym].length - 1];
    const momentum = (prev.c - prev.o) / prev.o;
    const volatility = 0.008;
    const drift = momentum * 0.3;
    const random = (Math.random() - 0.5) * 2 * volatility;
    const change = drift + random;
    const open = prev.c;
    const close = Math.max(open * 0.95, open * (1 + change));
    const high = Math.max(open, close) * (1 + Math.random() * 0.004);
    const low = Math.min(open, close) * (1 - Math.random() * 0.004);
    const volume = Math.floor(Math.random() * 300000 + 50000);
    const candle = { t: Date.now(), o: open, h: high, l: low, c: close, v: volume };
    priceHistory[sym].push(candle);
    if (priceHistory[sym].length > 500) priceHistory[sym].shift();
    stock.price = close;
    const pctChange = ((close - priceHistory[sym][0].c) / priceHistory[sym][0].c) * 100;
    updates[sym] = { price: +close.toFixed(2), change: +pctChange.toFixed(2), volume, candle };
  });
  const niftyChange = (Math.random() - 0.49) * 0.3;
  INDICES['NIFTY 50'].value *= (1 + niftyChange / 100);
  INDICES['SENSEX'].value = INDICES['NIFTY 50'].value * 3.28;
  INDICES['BANKNIFTY'].value *= (1 + (niftyChange * 1.4) / 100);
  INDICES['INDIA VIX'].value = Math.max(8, Math.min(30, INDICES['INDIA VIX'].value + (Math.random() - 0.5) * 0.3));
  INDICES['MIDCAP 100'].value *= (1 + niftyChange / 100 * 1.2);
  broadcast({ type: 'PRICE_UPDATE', stocks: updates, indices: INDICES });
  checkPositions();
  if (autoTrading) runAutoSignals();
}

// ─── STRATEGY LOGIC ──────────────────────────────────────────────────────────
function calcSMA(arr, n) {
  if (arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}
function calcEMA(arr, n) {
  if (arr.length < n) return null;
  const k = 2 / (n + 1);
  let ema = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}
function calcRSI(closes, n = 14) {
  if (closes.length < n + 1) return null;
  const changes = closes.slice(-n - 1).map((v, i, a) => i === 0 ? 0 : v - a[i - 1]).slice(1);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? -c : 0);
  const avgGain = gains.reduce((a, b) => a + b) / n;
  const avgLoss = losses.reduce((a, b) => a + b) / n;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (!ema12 || !ema26) return null;
  const macd = ema12 - ema26;
  const signal = calcEMA([...closes.slice(-26).map((_, i, a) => {
    const sl = a.slice(0, i + 1);
    const e12 = calcEMA(sl, 12);
    const e26 = calcEMA(sl, 26);
    return e12 && e26 ? e12 - e26 : null;
  }).filter(v => v !== null)], 9);
  return { macd, signal, hist: signal ? macd - signal : 0 };
}
function calcBB(closes, n = 20, mult = 2) {
  if (closes.length < n) return null;
  const slice = closes.slice(-n);
  const sma = slice.reduce((a, b) => a + b) / n;
  const std = Math.sqrt(slice.map(v => (v - sma) ** 2).reduce((a, b) => a + b) / n);
  return { upper: sma + mult * std, mid: sma, lower: sma - mult * std };
}
function calcVWAP(candles) {
  const recent = candles.slice(-20);
  const totalTV = recent.reduce((sum, c) => sum + ((c.h + c.l + c.c) / 3) * c.v, 0);
  const totalV = recent.reduce((sum, c) => sum + c.v, 0);
  return totalV ? totalTV / totalV : null;
}
function calcStochastic(candles, k = 14) {
  if (candles.length < k) return null;
  const slice = candles.slice(-k);
  const highK = Math.max(...slice.map(c => c.h));
  const lowK = Math.min(...slice.map(c => c.l));
  const curr = slice[slice.length - 1].c;
  const stochK = ((curr - lowK) / (highK - lowK)) * 100;
  return { k: stochK, d: stochK };
}
function calcADX(candles, n = 14) {
  if (candles.length < n + 1) return null;
  const recent = candles.slice(-(n + 1));
  let plusDI = 0, minusDI = 0, tr = 0;
  for (let i = 1; i < recent.length; i++) {
    const curr = recent[i], prev = recent[i - 1];
    const trueRange = Math.max(curr.h - curr.l, Math.abs(curr.h - prev.c), Math.abs(curr.l - prev.c));
    tr += trueRange;
    const upMove = curr.h - prev.h;
    const downMove = prev.l - curr.l;
    if (upMove > downMove && upMove > 0) plusDI += upMove;
    if (downMove > upMove && downMove > 0) minusDI += downMove;
  }
  const adx = tr > 0 ? ((plusDI - minusDI) / (plusDI + minusDI + 0.0001)) * 100 : 0;
  return { adx: Math.abs(adx), plusDI: plusDI / tr * 100, minusDI: minusDI / tr * 100 };
}
function calcSupertrend(candles, mult = 3, period = 7) {
  if (candles.length < period) return null;
  const recent = candles.slice(-period * 2);
  let atr = 0;
  for (let i = 1; i < recent.length; i++) {
    const c = recent[i], p = recent[i - 1];
    atr += Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
  }
  atr /= recent.length - 1;
  const last = candles[candles.length - 1];
  const hl2 = (last.h + last.l) / 2;
  return { trend: last.c > hl2 ? 'UP' : 'DOWN', upperBand: hl2 + mult * atr, lowerBand: hl2 - mult * atr, atr };
}
function calcPivotPoints(candles) {
  if (candles.length < 2) return null;
  const prev = candles[candles.length - 2];
  const pp = (prev.h + prev.l + prev.c) / 3;
  return { pp, r1: 2 * pp - prev.l, r2: pp + (prev.h - prev.l), s1: 2 * pp - prev.h, s2: pp - (prev.h - prev.l) };
}
function calcWilliamsR(candles, n = 14) {
  if (candles.length < n) return null;
  const slice = candles.slice(-n);
  const highH = Math.max(...slice.map(c => c.h));
  const lowL = Math.min(...slice.map(c => c.l));
  const curr = candles[candles.length - 1].c;
  return ((highH - curr) / (highH - lowL)) * -100;
}
function calcOBV(candles) {
  let obv = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].c > candles[i - 1].c) obv += candles[i].v;
    else if (candles[i].c < candles[i - 1].c) obv -= candles[i].v;
  }
  return obv;
}
function calcIchimoku(candles) {
  if (candles.length < 52) return null;
  const tenkan = (Math.max(...candles.slice(-9).map(c => c.h)) + Math.min(...candles.slice(-9).map(c => c.l))) / 2;
  const kijun = (Math.max(...candles.slice(-26).map(c => c.h)) + Math.min(...candles.slice(-26).map(c => c.l))) / 2;
  const senkouA = (tenkan + kijun) / 2;
  const senkouB = (Math.max(...candles.slice(-52).map(c => c.h)) + Math.min(...candles.slice(-52).map(c => c.l))) / 2;
  return { tenkan, kijun, senkouA, senkouB, cloud: senkouA > senkouB ? 'BULLISH' : 'BEARISH' };
}

const STRATEGIES = {
  RSI_REVERSAL: {
    name: 'RSI Reversal', description: 'Buy oversold (<30), Sell overbought (>70)', sl: 1.5, target: 3.0,
    signal: (candles) => {
      const closes = candles.map(c => c.c);
      const rsi = calcRSI(closes);
      if (!rsi) return { signal: 'NEUTRAL', strength: 0, indicators: { RSI: null } };
      const signal = rsi < 30 ? 'BUY' : rsi > 70 ? 'SELL' : rsi < 40 ? 'WATCH' : 'NEUTRAL';
      return { signal, strength: rsi < 30 ? 90 : rsi > 70 ? 85 : 40, indicators: { RSI: rsi.toFixed(2) } };
    }
  },
  MACD_CROSS: {
    name: 'MACD Crossover', description: 'MACD line crosses signal line', sl: 2.0, target: 4.0,
    signal: (candles) => {
      const closes = candles.map(c => c.c);
      const m = calcMACD(closes);
      if (!m) return { signal: 'NEUTRAL', strength: 0, indicators: {} };
      const signal = m.hist > 0.1 ? 'BUY' : m.hist < -0.1 ? 'SELL' : 'NEUTRAL';
      return { signal, strength: Math.min(90, Math.abs(m.hist) * 500), indicators: { MACD: m.macd.toFixed(2), Signal: m.signal?.toFixed(2), Hist: m.hist.toFixed(2) } };
    }
  },
  BOLLINGER_BAND: {
    name: 'Bollinger Band Squeeze', description: 'Breakout from BB squeeze', sl: 1.8, target: 3.5,
    signal: (candles) => {
      const closes = candles.map(c => c.c);
      const bb = calcBB(closes);
      const curr = closes[closes.length - 1];
      if (!bb) return { signal: 'NEUTRAL', strength: 0, indicators: {} };
      const bw = ((bb.upper - bb.lower) / bb.mid) * 100;
      const signal = curr < bb.lower ? 'BUY' : curr > bb.upper ? 'SELL' : bw < 2 ? 'WATCH' : 'NEUTRAL';
      return { signal, strength: curr < bb.lower || curr > bb.upper ? 85 : 40, indicators: { BW: bw.toFixed(2) + '%', Upper: bb.upper.toFixed(0), Lower: bb.lower.toFixed(0) } };
    }
  },
  VWAP_BREAKOUT: {
    name: 'VWAP Breakout', description: 'Price crosses VWAP with volume', sl: 1.2, target: 2.5,
    signal: (candles) => {
      const vwap = calcVWAP(candles);
      const curr = candles[candles.length - 1].c;
      const prev = candles[candles.length - 2].c;
      if (!vwap) return { signal: 'NEUTRAL', strength: 0, indicators: {} };
      const signal = prev < vwap && curr > vwap ? 'BUY' : prev > vwap && curr < vwap ? 'SELL' : curr > vwap ? 'WATCH' : 'NEUTRAL';
      return { signal, strength: signal === 'BUY' || signal === 'SELL' ? 82 : 35, indicators: { VWAP: vwap.toFixed(2), Price: curr.toFixed(2) } };
    }
  },
  EMA_CROSS: {
    name: 'EMA 9/21 Cross', description: 'Short EMA crosses long EMA', sl: 1.5, target: 3.0,
    signal: (candles) => {
      const closes = candles.map(c => c.c);
      const ema9 = calcEMA(closes, 9);
      const ema21 = calcEMA(closes, 21);
      const prevCloses = closes.slice(0, -1);
      const prevEma9 = calcEMA(prevCloses, 9);
      const prevEma21 = calcEMA(prevCloses, 21);
      if (!ema9 || !ema21) return { signal: 'NEUTRAL', strength: 0, indicators: {} };
      const signal = prevEma9 < prevEma21 && ema9 > ema21 ? 'BUY' : prevEma9 > prevEma21 && ema9 < ema21 ? 'SELL' : ema9 > ema21 ? 'WATCH' : 'NEUTRAL';
      return { signal, strength: signal === 'BUY' || signal === 'SELL' ? 88 : 45, indicators: { EMA9: ema9.toFixed(2), EMA21: ema21.toFixed(2) } };
    }
  },
  SUPERTREND: {
    name: 'Supertrend', description: 'ATR-based trend following', sl: 2.0, target: 4.5,
    signal: (candles) => {
      const st = calcSupertrend(candles);
      if (!st) return { signal: 'NEUTRAL', strength: 0, indicators: {} };
      const signal = st.trend === 'UP' ? 'BUY' : 'SELL';
      return { signal, strength: 78, indicators: { Trend: st.trend, ATR: st.atr.toFixed(2) } };
    }
  },
  STOCHASTIC: {
    name: 'Stochastic Oscillator', description: 'K/D cross in oversold/overbought zones', sl: 1.5, target: 3.0,
    signal: (candles) => {
      const stoch = calcStochastic(candles);
      if (!stoch) return { signal: 'NEUTRAL', strength: 0, indicators: {} };
      const signal = stoch.k < 20 ? 'BUY' : stoch.k > 80 ? 'SELL' : 'NEUTRAL';
      return { signal, strength: stoch.k < 20 || stoch.k > 80 ? 80 : 30, indicators: { K: stoch.k.toFixed(2), D: stoch.d.toFixed(2) } };
    }
  },
  ADX_TREND: {
    name: 'ADX Trend Strength', description: 'ADX > 25 confirms strong trend', sl: 2.5, target: 5.0,
    signal: (candles) => {
      const adx = calcADX(candles);
      if (!adx) return { signal: 'NEUTRAL', strength: 0, indicators: {} };
      const signal = adx.adx > 25 && adx.plusDI > adx.minusDI ? 'BUY' : adx.adx > 25 && adx.minusDI > adx.plusDI ? 'SELL' : 'NEUTRAL';
      return { signal, strength: adx.adx > 25 ? Math.min(95, adx.adx * 2) : 20, indicators: { ADX: adx.adx.toFixed(2), '+DI': adx.plusDI.toFixed(2), '-DI': adx.minusDI.toFixed(2) } };
    }
  },
  PIVOT_POINTS: {
    name: 'Pivot Point Bounce', description: 'Price action near S1/R1/PP levels', sl: 1.0, target: 2.0,
    signal: (candles) => {
      const pp = calcPivotPoints(candles);
      const curr = candles[candles.length - 1].c;
      if (!pp) return { signal: 'NEUTRAL', strength: 0, indicators: {} };
      const nearS1 = Math.abs(curr - pp.s1) / curr < 0.005;
      const nearR1 = Math.abs(curr - pp.r1) / curr < 0.005;
      const signal = nearS1 ? 'BUY' : nearR1 ? 'SELL' : curr > pp.pp ? 'WATCH' : 'NEUTRAL';
      return { signal, strength: nearS1 || nearR1 ? 75 : 30, indicators: { PP: pp.pp.toFixed(2), R1: pp.r1.toFixed(2), S1: pp.s1.toFixed(2) } };
    }
  },
  ICHIMOKU: {
    name: 'Ichimoku Cloud', description: 'Price position relative to Kumo cloud', sl: 2.0, target: 5.0,
    signal: (candles) => {
      const ich = calcIchimoku(candles);
      const curr = candles[candles.length - 1].c;
      if (!ich) return { signal: 'NEUTRAL', strength: 0, indicators: {} };
      const aboveCloud = curr > Math.max(ich.senkouA, ich.senkouB);
      const belowCloud = curr < Math.min(ich.senkouA, ich.senkouB);
      const signal = aboveCloud && ich.tenkan > ich.kijun ? 'BUY' : belowCloud && ich.tenkan < ich.kijun ? 'SELL' : aboveCloud ? 'WATCH' : 'NEUTRAL';
      return { signal, strength: aboveCloud || belowCloud ? 85 : 40, indicators: { Cloud: ich.cloud, Tenkan: ich.tenkan.toFixed(2), Kijun: ich.kijun.toFixed(2) } };
    }
  },
  WILLIAMS_R: {
    name: 'Williams %R', description: 'Momentum oscillator -20/-80 levels', sl: 1.5, target: 3.0,
    signal: (candles) => {
      const wr = calcWilliamsR(candles);
      if (wr === null) return { signal: 'NEUTRAL', strength: 0, indicators: {} };
      const signal = wr < -80 ? 'BUY' : wr > -20 ? 'SELL' : 'NEUTRAL';
      return { signal, strength: wr < -80 || wr > -20 ? 80 : 30, indicators: { 'W%R': wr.toFixed(2) } };
    }
  },
  OBV_DIVERGENCE: {
    name: 'OBV Divergence', description: 'Volume diverges from price trend', sl: 2.0, target: 4.0,
    signal: (candles) => {
      const obv = calcOBV(candles);
      const prevObv = calcOBV(candles.slice(0, -5));
      const priceDelta = candles[candles.length - 1].c - candles[candles.length - 6]?.c;
      const obvDelta = obv - prevObv;
      let signal = 'NEUTRAL';
      if (priceDelta < 0 && obvDelta > 0) signal = 'BUY';
      else if (priceDelta > 0 && obvDelta < 0) signal = 'SELL';
      else if (priceDelta > 0 && obvDelta > 0) signal = 'WATCH';
      return { signal, strength: signal !== 'NEUTRAL' ? 82 : 25, indicators: { OBV: (obv / 1000000).toFixed(2) + 'M', Divergence: priceDelta < 0 && obvDelta > 0 ? 'Bullish' : priceDelta > 0 && obvDelta < 0 ? 'Bearish' : 'None' } };
    }
  },
};

// ─── STATE ──────────────────────────────────────────────────────────────────
let positions = {};
let orders = [];
let capital = 200000;
let autoTrading = false;
let activeStrategy = 'RSI_REVERSAL';
let orderIdCounter = 1;

// ─── BROADCAST ──────────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// ─── POSITIONS ───────────────────────────────────────────────────────────────
function checkPositions() {
  Object.keys(positions).forEach(sym => {
    const pos = positions[sym];
    const curr = STOCKS[sym].price;
    const pnl = (curr - pos.entry) * pos.qty * (pos.side === 'BUY' ? 1 : -1);
    pos.ltp = curr;
    pos.pnl = pnl;
    if (pos.side === 'BUY') {
      if (curr <= pos.sl) exitPosition(sym, curr, 'SL_HIT');
      else if (curr >= pos.target) exitPosition(sym, curr, 'TARGET_HIT');
    } else {
      if (curr >= pos.sl) exitPosition(sym, curr, 'SL_HIT');
      else if (curr <= pos.target) exitPosition(sym, curr, 'TARGET_HIT');
    }
  });
  broadcast({ type: 'POSITIONS_UPDATE', positions, capital });
}

function exitPosition(sym, price, reason) {
  const pos = positions[sym];
  if (!pos) return;
  const pnl = (price - pos.entry) * pos.qty * (pos.side === 'BUY' ? 1 : -1);
  capital += pos.entry * pos.qty + pnl;
  const order = {
    id: orderIdCounter++, sym, side: pos.side === 'BUY' ? 'SELL' : 'BUY',
    qty: pos.qty, price: +price.toFixed(2), type: reason, strategy: pos.strategy,
    pnl: +pnl.toFixed(2), time: new Date().toISOString()
  };
  orders.unshift(order);
  delete positions[sym];
  broadcast({ type: 'ORDER_FILLED', order, notification: `${reason === 'SL_HIT' ? '🔴' : '🟢'} ${sym} ${reason.replace('_', ' ')} @ ₹${price.toFixed(2)} | P&L: ₹${pnl.toFixed(0)}` });
}

function runAutoSignals() {
  const strat = STRATEGIES[activeStrategy];
  if (!strat) return;
  Object.keys(STOCKS).forEach(sym => {
    if (positions[sym]) return;
    const result = strat.signal(priceHistory[sym]);
    if (result.signal === 'BUY' && result.strength > 75) placeOrder(sym, 'BUY', 1, activeStrategy);
  });
}

function placeOrder(sym, side, qty, strategy) {
  const price = STOCKS[sym].price;
  const strat = STRATEGIES[strategy];
  const slPct = strat.sl / 100;
  const tgtPct = strat.target / 100;
  const lot = STOCKS[sym].lot;
  const actualQty = qty * Math.max(1, Math.floor(lot / 10));
  const cost = price * actualQty;
  if (cost > capital) return { error: 'Insufficient capital' };
  capital -= cost;
  const sl = side === 'BUY' ? price * (1 - slPct) : price * (1 + slPct);
  const target = side === 'BUY' ? price * (1 + tgtPct) : price * (1 - tgtPct);
  positions[sym] = { sym, side, entry: price, ltp: price, qty: actualQty, sl, target, strategy, pnl: 0, time: new Date().toISOString() };
  const order = {
    id: orderIdCounter++, sym, side, qty: actualQty,
    price: +price.toFixed(2), type: 'MARKET', strategy,
    sl: +sl.toFixed(2), target: +target.toFixed(2), pnl: 0, time: new Date().toISOString()
  };
  orders.unshift(order);
  if (orders.length > 200) orders.pop();
  broadcast({ type: 'ORDER_FILLED', order, notification: `${side === 'BUY' ? '🟢' : '🔴'} ${sym} ${side} @ ₹${price.toFixed(2)} | SL: ₹${sl.toFixed(2)} | Tgt: ₹${target.toFixed(2)}` });
  broadcast({ type: 'POSITIONS_UPDATE', positions, capital });
  return order;
}

// ─── API ROUTES ──────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  const signals = {};
  Object.keys(STOCKS).forEach(sym => {
    signals[sym] = {};
    Object.keys(STRATEGIES).forEach(stratKey => {
      signals[sym][stratKey] = STRATEGIES[stratKey].signal(priceHistory[sym]);
    });
  });
  res.json({
    stocks: Object.fromEntries(Object.entries(STOCKS).map(([k, v]) => [k, { ...v, price: +v.price.toFixed(2) }])),
    indices: INDICES, positions, orders: orders.slice(0, 100), capital, autoTrading, activeStrategy,
    strategies: Object.fromEntries(Object.entries(STRATEGIES).map(([k, v]) => [k, { name: v.name, description: v.description, sl: v.sl, target: v.target }])),
    signals, history: Object.fromEntries(Object.entries(priceHistory).map(([k, v]) => [k, v.slice(-100)])),
    angelConnected: !!angelSession
  });
});

app.post('/api/order', (req, res) => {
  const { sym, side, qty, strategy } = req.body;
  if (!sym || !side || !STOCKS[sym]) return res.status(400).json({ error: 'Invalid params' });
  const result = placeOrder(sym, side, qty || 1, strategy || activeStrategy);
  res.json(result);
});

app.post('/api/squareoff', (req, res) => {
  const { sym } = req.body;
  if (!positions[sym]) return res.status(404).json({ error: 'No position' });
  exitPosition(sym, STOCKS[sym].price, 'MANUAL_EXIT');
  res.json({ ok: true });
});

app.post('/api/settings', (req, res) => {
  const { autoTrading: at, activeStrategy: as } = req.body;
  if (at !== undefined) autoTrading = at;
  if (as && STRATEGIES[as]) activeStrategy = as;
  broadcast({ type: 'SETTINGS_UPDATE', autoTrading, activeStrategy });
  res.json({ autoTrading, activeStrategy });
});

app.get('/api/backtest/:sym/:stratKey/:period', (req, res) => {
  const { sym, stratKey, period } = req.params;
  const strat = STRATEGIES[stratKey];
  const candles = priceHistory[sym];
  if (!strat || !candles) return res.status(404).json({ error: 'Not found' });
  const periodMap = { '1W': 7, '1M': 30, '3M': 90 };
  const days = periodMap[period] || 30;
  const startIdx = Math.max(0, candles.length - days * 6);
  const testCandles = candles.slice(startIdx);
  let btCapital = 100000, btPnl = 0, wins = 0, losses = 0;
  let btPosition = null, maxDD = 0, peak = btCapital;
  const equity = [];
  for (let i = 30; i < testCandles.length; i++) {
    const slice = testCandles.slice(0, i + 1);
    const result = strat.signal(slice);
    const curr = testCandles[i].c;
    if (btPosition) {
      const pnl = (curr - btPosition.entry) * btPosition.qty;
      if (curr <= btPosition.sl || curr >= btPosition.target) {
        btCapital += btPosition.cost + pnl;
        if (pnl > 0) wins++; else losses++;
        btPnl += pnl;
        if (btCapital > peak) peak = btCapital;
        const dd = (peak - btCapital) / peak * 100;
        if (dd > maxDD) maxDD = dd;
        btPosition = null;
        equity.push({ t: testCandles[i].t, v: btCapital });
      }
    } else if (result.signal === 'BUY' && result.strength > 70) {
      const qty = Math.floor(btCapital * 0.1 / curr);
      if (qty > 0) {
        const cost = qty * curr;
        btCapital -= cost;
        btPosition = { entry: curr, qty, cost, sl: curr * (1 - strat.sl / 100), target: curr * (1 + strat.target / 100) };
      }
    }
  }
  const total = wins + losses;
  res.json({
    totalTrades: total, wins, losses,
    winRate: total ? ((wins / total) * 100).toFixed(1) : '0',
    totalPnl: btPnl.toFixed(2), maxDrawdown: maxDD.toFixed(2),
    sharpe: (btPnl / (btCapital * 0.15 + 1)).toFixed(2),
    equity: equity.slice(-50)
  });
});

// ─── WS HANDSHAKE ────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'AlgoTrade.IN Server v2.0', angelConnected: !!angelSession }));
});

// ─── START ───────────────────────────────────────────────────────────────────
server.listen(4000, () => {
  console.log('🚀 AlgoTrade.IN WebSocket Server running on :4000');
  loginAngelOne();
});