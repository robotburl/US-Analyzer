// Data source: Finnhub API (free, server-friendly, no cookie issues)
// API key จาก process.env.FINNHUB_API_KEY

const BASE = 'https://finnhub.io/api/v1';

function key() {
  const k = process.env.FINNHUB_API_KEY;
  if (!k) throw new Error('FINNHUB_API_KEY not set');
  return k;
}

async function fhFetch(path) {
  const url = `${BASE}${path}&token=${key()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${path}`);
  return res.json();
}

// ── Quote + History ─────────────────────────────────────
export async function getQuote(symbol) {
  const [q, candles, profile] = await Promise.all([
    fhFetch(`/quote?symbol=${symbol}`),
    fhFetch(`/stock/candle?symbol=${symbol}&resolution=D&from=${Math.floor((Date.now()-366*86400000)/1000)}&to=${Math.floor(Date.now()/1000)}`),
    fhFetch(`/stock/profile2?symbol=${symbol}`),
  ]);

  if (q.c === 0 && q.pc === 0) throw new Error(`Symbol not found: ${symbol}`);

  const history = (candles.s === 'ok' ? candles.t : []).map((t, i) => ({
    date:   new Date(t * 1000).toISOString().slice(0, 10),
    open:   candles.o[i],
    high:   candles.h[i],
    low:    candles.l[i],
    close:  candles.c[i],
    volume: candles.v[i],
  })).filter(d => d.close);

  return {
    symbol,
    shortName:     profile.name || symbol,
    currency:      'USD',
    exchange:      profile.exchange || '',
    price:         q.c,
    change:        q.d,
    changePct:     q.dp,
    previousClose: q.pc,
    marketCap:     profile.marketCapitalization ? profile.marketCapitalization * 1e6 : null,
    week52High:    q.h,   // today's high — finnhub free doesn't give 52W
    week52Low:     q.l,
    history,
  };
}

// ── Fundamentals ─────────────────────────────────────────
export async function getFundamentals(symbol) {
  const [metrics, rec] = await Promise.all([
    fhFetch(`/stock/metric?symbol=${symbol}&metric=all`),
    fhFetch(`/stock/recommendation?symbol=${symbol}`),
  ]);

  const m = metrics.metric || {};
  const latestRec = rec?.[0];

  // Analyst recommendation key
  const totalRec = latestRec ? (latestRec.buy||0)+(latestRec.hold||0)+(latestRec.sell||0)+(latestRec.strongBuy||0)+(latestRec.strongSell||0) : 0;
  const recKey = latestRec
    ? (latestRec.strongBuy+latestRec.buy > latestRec.strongSell+latestRec.sell ? 'buy' : 'hold')
    : null;

  return {
    trailingPE:              m['peBasicExclExtraTTM'],
    forwardPE:               m['peExclExtraAnnual'],
    priceToBook:             m['pbAnnual'],
    pegRatio:                m['pegNormalizedAnnual'],
    enterpriseToEbitda:      m['evEbitdaAnnual'],
    returnOnEquity:          m['roeTTM'] != null ? m['roeTTM']/100 : null,
    returnOnAssets:          m['roaTTM'] != null ? m['roaTTM']/100 : null,
    profitMargins:           m['netProfitMarginTTM'] != null ? m['netProfitMarginTTM']/100 : null,
    grossMargins:            m['grossMarginTTM'] != null ? m['grossMarginTTM']/100 : null,
    operatingMargins:        m['operatingMarginTTM'] != null ? m['operatingMarginTTM']/100 : null,
    revenueGrowth:           m['revenueGrowthTTMYoy'] != null ? m['revenueGrowthTTMYoy']/100 : null,
    earningsGrowth:          m['epsGrowthTTMYoy'] != null ? m['epsGrowthTTMYoy']/100 : null,
    totalRevenue:            m['revenueTTM'],
    totalCash:               null,
    totalDebt:               m['totalDebt/totalEquityAnnual'],
    debtToEquity:            m['totalDebt/totalEquityAnnual'],
    currentRatio:            m['currentRatioAnnual'],
    dividendYield:           m['dividendYieldIndicatedAnnual'] != null ? m['dividendYieldIndicatedAnnual']/100 : null,
    payoutRatio:             m['payoutRatioAnnual'] != null ? m['payoutRatioAnnual']/100 : null,
    trailingEps:             m['epsTTM'],
    forwardEps:              m['epsNormalizedAnnual'],
    sharesOutstanding:       m['sharesOutstanding'],
    targetMeanPrice:         null,
    targetHighPrice:         null,
    targetLowPrice:          null,
    recommendationKey:       recKey,
    numberOfAnalystOpinions: totalRec,
    epsHistory:              [],
  };
}

// ── Batch quotes ─────────────────────────────────────────
export async function getMultipleQuotes(symbols) {
  const results = await Promise.allSettled(
    symbols.map(async s => {
      const q = await fhFetch(`/quote?symbol=${s}`);
      const p = await fhFetch(`/stock/profile2?symbol=${s}`);
      return {
        symbol: s,
        shortName: p.name || s,
        regularMarketPrice:          q.c,
        regularMarketChange:         q.d,
        regularMarketChangePercent:  q.dp,
        marketCap: p.marketCapitalization ? p.marketCapitalization * 1e6 : null,
      };
    })
  );
  return results.filter(r => r.status === 'fulfilled').map(r => r.value);
}

// ── News ─────────────────────────────────────────────────
export async function getNews(symbol) {
  const to   = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  try {
    const data = await fhFetch(`/company-news?symbol=${symbol}&from=${from}&to=${to}`);
    return (Array.isArray(data) ? data : []).slice(0, 10).map(n => ({
      title:       n.headline,
      link:        n.url,
      pubDate:     new Date(n.datetime * 1000).toUTCString(),
      description: n.summary?.slice(0, 200),
    }));
  } catch {
    return [];
  }
}
