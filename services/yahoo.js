// Data: Finnhub (quote/fundamentals) + Stooq (history, no key needed)
// Cache prevents redundant calls

const FH = 'https://finnhub.io/api/v1';
const fhKey = () => process.env.FINNHUB_API_KEY || '';

// ── In-memory cache ────────────────────────────────────────
const cache = new Map();
const TTL_QUOTE = 5  * 60 * 1000;  // 5 min
const TTL_HIST  = 60 * 60 * 1000;  // 1 hour

function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > e.ttl) { cache.delete(key); return null; }
  return e.data;
}
function cacheSet(key, data, ttl) { cache.set(key, { data, ts: Date.now(), ttl }); }

// ── Fetch helpers ──────────────────────────────────────────
async function fhGet(path) {
  const res = await fetch(`${FH}${path}&token=${fhKey()}`);
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${path.split('?')[0]}`);
  return res.json();
}

// Stooq — free public OHLCV, no API key
async function stooqHistory(symbol) {
  const cached = cacheGet(`hist:${symbol}`);
  if (cached) { console.log(`[cache] history hit: ${symbol}`); return cached; }

  // stooq uses lowercase symbol with .us suffix for US stocks
  const sym = symbol.toLowerCase() + '.us';
  const url = `https://stooq.com/q/d/l/?s=${sym}&i=d`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    console.log(`[stooq] ${symbol} status: ${res.status}`);
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

    const text = await res.text();
    console.log(`[stooq] ${symbol} response (first 200): ${text.slice(0, 200)}`);

    const lines = text.trim().split('\n');
    if (lines.length < 2) throw new Error(`Stooq: too few lines (${lines.length})`);
    if (text.includes('No data') || text.includes('Exceeded')) throw new Error(`Stooq: ${text.slice(0, 100)}`);

    const history = lines.slice(1)
      .map(line => {
        const parts = line.split(',');
        if (parts.length < 5) return null;
        const [date, open, high, low, close, volume] = parts;
        return {
          date: date.trim(),
          open:   parseFloat(open),
          high:   parseFloat(high),
          low:    parseFloat(low),
          close:  parseFloat(close),
          volume: parseInt(volume) || 0,
        };
      })
      .filter(d => d && d.close && !isNaN(d.close) && d.date.match(/^\d{4}-\d{2}-\d{2}$/))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-252);

    console.log(`[stooq] ${symbol}: ${history.length} days, last: ${history.at(-1)?.date}`);
    if (history.length > 0) cacheSet(`hist:${symbol}`, history, TTL_HIST);
    return history;
  } catch(e) {
    console.error(`[stooq] ${symbol} error: ${e.message}`);
    return [];
  }
}

// ── Quote + History ────────────────────────────────────────
export async function getQuote(symbol) {
  const cached = cacheGet(`quote:${symbol}`);
  const cachedHist = cacheGet(`hist:${symbol}`);

  const [q, profile, history] = await Promise.all([
    cached || fhGet(`/quote?symbol=${symbol}`).then(d => { cacheSet(`quote:${symbol}`, d, TTL_QUOTE); return d; }),
    fhGet(`/stock/profile2?symbol=${symbol}`).catch(() => ({})),
    cachedHist || stooqHistory(symbol),
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
  const cached = cacheGet(`fund:${symbol}`);
  if (cached) return cached;

  const [metrics, rec] = await Promise.all([
    fhGet(`/stock/metric?symbol=${symbol}&metric=all`),
    fhGet(`/stock/recommendation?symbol=${symbol}`).catch(() => []),
  ]);

  const m  = metrics.metric || {};
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
    returnOnEquity:   pct(m['roeTTM']),
    returnOnAssets:   pct(m['roaTTM']),
    profitMargins:    pct(m['netProfitMarginTTM']),
    grossMargins:     pct(m['grossMarginTTM']),
    operatingMargins: pct(m['operatingMarginTTM']),
    revenueGrowth:    pct(m['revenueGrowthTTMYoy']),
    earningsGrowth:   pct(m['epsGrowthTTMYoy']),
    totalRevenue:     m['revenueTTM'],
    debtToEquity:     m['totalDebt/totalEquityAnnual'],
    currentRatio:     m['currentRatioAnnual'],
    dividendYield:    pct(m['dividendYieldIndicatedAnnual']),
    payoutRatio:      pct(m['payoutRatioAnnual']),
    trailingEps:      m['epsTTM'],
    forwardEps:       m['epsNormalizedAnnual'],
    sharesOutstanding:m['sharesOutstanding'],
    targetMeanPrice:  null, targetHighPrice: null, targetLowPrice: null,
    recommendationKey: recKey,
    numberOfAnalystOpinions: total,
    epsHistory: [],
  };

  cacheSet(`fund:${symbol}`, result, TTL_HIST);
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
