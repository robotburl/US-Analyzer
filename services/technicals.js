// Technical indicators computed server-side from OHLCV history

export function computeIndicators(history) {
  const closes = history.map(d => d.close);
  const highs = history.map(d => d.high);
  const lows = history.map(d => d.low);
  const volumes = history.map(d => d.volume);

  return {
    ma20: sma(closes, 20),
    ma50: sma(closes, 50),
    ma200: sma(closes, 200),
    ema12: ema(closes, 12),
    ema26: ema(closes, 26),
    rsi14: rsi(closes, 14),
    macd: macdLine(closes),
    bollingerBands: bollinger(closes, 20, 2),
    atr14: atr(highs, lows, closes, 14),
    obv: onBalanceVolume(closes, volumes),
    vwap: vwap(history),
  };
}

function sma(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function ema(data, period) {
  const k = 2 / (period + 1);
  const result = new Array(data.length).fill(null);
  let seed = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = seed;
  for (let i = period; i < data.length; i++) {
    seed = data[i] * k + seed * (1 - k);
    result[i] = seed;
  }
  return result;
}

function rsi(closes, period) {
  const result = new Array(closes.length).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = 100 - 100 / (1 + avgGain / (avgLoss || 0.001));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result[i] = 100 - 100 / (1 + avgGain / (avgLoss || 0.001));
  }
  return result;
}

function macdLine(closes) {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macdVals = closes.map((_, i) =>
    fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null
  );
  const signalInput = macdVals.filter(v => v != null);
  const signalRaw = ema(signalInput, 9);
  // Re-align signal to full length
  const offset = macdVals.findIndex(v => v != null);
  const signal = new Array(closes.length).fill(null);
  signalRaw.forEach((v, i) => { signal[offset + i] = v; });
  const histogram = macdVals.map((v, i) =>
    v != null && signal[i] != null ? v - signal[i] : null
  );
  return { macd: macdVals, signal, histogram };
}

function bollinger(closes, period, multiplier) {
  const mid = sma(closes, period);
  const upper = mid.map((m, i) => {
    if (m == null) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - m) ** 2, 0) / period);
    return m + multiplier * std;
  });
  const lower = mid.map((m, i) => {
    if (m == null) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - m) ** 2, 0) / period);
    return m - multiplier * std;
  });
  return { upper, mid, lower };
}

function atr(highs, lows, closes, period) {
  const tr = closes.map((c, i) => {
    if (i === 0) return highs[0] - lows[0];
    return Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  });
  return sma(tr, period);
}

function onBalanceVolume(closes, volumes) {
  const obv = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - volumes[i]);
    else obv.push(obv[i - 1]);
  }
  return obv;
}

function vwap(history) {
  let cumPV = 0, cumV = 0;
  return history.map(d => {
    const typicalPrice = (d.high + d.low + d.close) / 3;
    cumPV += typicalPrice * d.volume;
    cumV += d.volume;
    return cumV ? cumPV / cumV : null;
  });
}

// Summary signals from latest indicators
export function getSignalSummary(history, indicators) {
  const last = i => {
    for (let j = i.length - 1; j >= 0; j--) {
      if (i[j] != null) return i[j];
    }
    return null;
  };

  const price = history[history.length - 1]?.close;
  const rsi = last(indicators.rsi14);
  const ma20 = last(indicators.ma20);
  const ma50 = last(indicators.ma50);
  const ma200 = last(indicators.ma200);
  const macd = last(indicators.macd.macd);
  const signal = last(indicators.macd.signal);
  const bbUpper = last(indicators.bollingerBands.upper);
  const bbLower = last(indicators.bollingerBands.lower);

  const signals = [];

  // Trend
  if (price > ma200) signals.push({ type: 'bullish', label: 'Above MA200', detail: 'Long-term uptrend' });
  else signals.push({ type: 'bearish', label: 'Below MA200', detail: 'Long-term downtrend' });

  if (ma50 > ma200) signals.push({ type: 'bullish', label: 'Golden Cross', detail: 'MA50 > MA200' });
  else signals.push({ type: 'bearish', label: 'Death Cross risk', detail: 'MA50 < MA200' });

  // RSI
  if (rsi > 70) signals.push({ type: 'bearish', label: `RSI Overbought (${rsi.toFixed(0)})`, detail: 'Potential reversal' });
  else if (rsi < 30) signals.push({ type: 'bullish', label: `RSI Oversold (${rsi.toFixed(0)})`, detail: 'Potential bounce' });
  else signals.push({ type: 'neutral', label: `RSI ${rsi.toFixed(0)}`, detail: 'Neutral momentum' });

  // MACD
  if (macd > signal) signals.push({ type: 'bullish', label: 'MACD Bullish', detail: 'MACD above signal' });
  else signals.push({ type: 'bearish', label: 'MACD Bearish', detail: 'MACD below signal' });

  // Bollinger
  if (price >= bbUpper) signals.push({ type: 'bearish', label: 'BB Upper Band', detail: 'Price at resistance' });
  else if (price <= bbLower) signals.push({ type: 'bullish', label: 'BB Lower Band', detail: 'Price at support' });

  const bullCount = signals.filter(s => s.type === 'bullish').length;
  const bearCount = signals.filter(s => s.type === 'bearish').length;
  const overallBias = bullCount > bearCount ? 'BULLISH' : bearCount > bullCount ? 'BEARISH' : 'NEUTRAL';

  return { signals, overallBias, bullCount, bearCount, rsi, ma20, ma50, ma200 };
}
