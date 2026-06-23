// Data: Finnhub (quote/fundamentals) + Alpha Vantage (history)
// In-memory cache prevents rate limit hits

const FH = 'https://finnhub.io/api/v1';
const AV = 'https://www.alphavantage.co/query';

const fhKey = () => process.env.FINNHUB_API_KEY || '';
const avKey = () => process.env.ALPHA_VANTAGE_KEY || '';

// ── In-memory cache (resets on redeploy) ──────────────────
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) { cache.set(key, { data, ts: Date.now() }); }

// ── Fetch helpers ──────────────────────────────────────────
async function fhGet(path) {
  const url = `${FH}${path}&token=${fhKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${path.split('?')[0]}`);
  return res.json();
}

async function avHistory(symbol) {
  const cacheKey = `av:${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) { console.log(`[AV] cache hit: ${symbol}`); return cached; }

  const url = `${AV}?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=full&apikey=${avKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AV HTTP ${res.status}`);
  const data = await res.json();

  // Rate limit check
  const note = data['Note'] || data['Information'];
  if (note) {
    console.warn('[AV] rate limit:', note.slice(0, 100));
    // return cached if available even if expired
    const stale = cache.get(cacheKey);
    if (stale) return stale.data;
    return [];
  }

  const ts = data['Time Series (Daily)'];
  if (!ts) { console.warn('[AV] no data:', JSON.stringify(data).slice(0, 150)); return []; }

  const history = Object.entries(ts)
    .map(([date, v]) => ({
      date,
      open:   parseFloat(v['1. open']),
      high:   parseFloat(v['2. high']),
      low:    parseFloat(v['3. low']),
      close:  parseFloat(v['4. close']),
      volume: parseInt(v['5. volume']),
    }))
    .filter(d => d.close)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-252);

  console.log(`[AV] fetched ${history.length} days for ${symbol}`);
  cacheSet(cacheKey, history);
  return history;
}

// ── Quote + History ────────────────────────────────────────
export async function getQuote(symbol) {
  const [q, profile, history] = await Promise.all([
    fhGet(`/quote?symbol=${symbol}`),
    fhGet(`/stock/profile2?symbol=${symbol}`).catch(() => ({})),
    avHistory(symbol),
  ]);

  if (!q.c) throw new Error(`Symbol not found: ${symbol}`);

  return {
    symbol,
    shortName:     profile.name || symbol,
    currency:      'USD',
    exchange:      profile.exchange || '',
    price:         q.c,
    change:        q.d  ?? 0,
    changePct:     q.dp ?? 0,
    previousClose: q.pc ?? q.c,
    marketCap:     profile.marketCapitalization ? profile.marketCapitalization * 1e6 : null,
    week52High:    q.h,
    week52Low:     q.l,
    history,
  };
}

// ── Fundamentals ───────────────────────────────────────────
export async function getFundamentals(symbol) {
  const cacheKey = `fund:${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const [metrics, rec] = await Promise.all([
    fhGet(`/stock/metric?symbol=${symbol}&metric=all`),
    fhGet(`/stock/recommendation?symbol=${symbol}`).catch(() => []),
  ]);

  const m = metrics.metric || {};
  const r0 = Array.isArray(rec) ? rec[0] : null;
  const total = r0 ? (r0.buy||0)+(r0.hold||0)+(r0.sell||0)+(r0.strongBuy||0)+(r0.strongSell||0) : 0;
  const recKey = r0 ? ((r0.strongBuy||0)+(r0.buy||0) > (r0.strongSell||0)+(r0.sell||0) ? 'buy' : 'hold') : null;
  const pct = v => v != null ? v / 100 : null;

  const result = {
    trailingPE:    m['peBasicExclExtraTTM'],
    forwardPE:     m['peExclExtraAnnual'],
    priceToBook:   m['pbAnnual'],
    pegRatio:      m['pegNormalizedAnnual'],
    enterpriseToEbitda: m['evEbitdaAnnual'],
    returnOnEquity:  pct(m['roeTTM']),
    returnOnAssets:  pct(m['roaTTM']),
    profitMargins:   pct(m['netProfitMarginTTM']),
    grossMargins:    pct(m['grossMarginTTM']),
    operatingMargins:pct(m['operatingMarginTTM']),
    revenueGrowth:   pct(m['revenueGrowthTTMYoy']),
    earningsGrowth:  pct(m['epsGrowthTTMYoy']),
    totalRevenue:    m['revenueTTM'],
    debtToEquity:    m['totalDebt/totalEquityAnnual'],
    currentRatio:    m['currentRatioAnnual'],
    dividendYield:   pct(m['dividendYieldIndicatedAnnual']),
    payoutRatio:     pct(m['payoutRatioAnnual']),
    trailingEps:     m['epsTTM'],
    forwardEps:      m['epsNormalizedAnnual'],
    sharesOutstanding: m['sharesOutstanding'],
    targetMeanPrice: null, targetHighPrice: null, targetLowPrice: null,
    recommendationKey: recKey,
    numberOfAnalystOpinions: total,
    epsHistory: [],
  };

  cacheSet(cacheKey, result);
  return result;
}

// ── Batch quotes ───────────────────────────────────────────
export async function getMultipleQuotes(symbols) {
  const results = await Promise.allSettled(
    symbols.map(async s => {
      const [q, p] = await Promise.all([
        fhGet(`/quote?symbol=${s}`),
        fhGet(`/stock/profile2?symbol=${s}`).catch(() => ({})),
      ]);
      return {
        symbol: s,
        shortName: p.name || s,
        regularMarketPrice:         q.c,
        regularMarketChange:        q.d,
        regularMarketChangePercent: q.dp,
        marketCap: p.marketCapitalization ? p.marketCapitalization * 1e6 : null,
      };
    })
  );
  return results.filter(r => r.status === 'fulfilled').map(r => r.value);
}

// ── News ───────────────────────────────────────────────────
export async function getNews(symbol) {
  const to   = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7*86400000).toISOString().slice(0, 10);
  try {
    const data = await fhGet(`/company-news?symbol=${symbol}&from=${from}&to=${to}`);
    return (Array.isArray(data) ? data : []).slice(0, 10).map(n => ({
      title:       n.headline,
      link:        n.url,
      pubDate:     new Date(n.datetime * 1000).toUTCString(),
      description: (n.summary || '').slice(0, 200),
    }));
  } catch { return []; }
}
