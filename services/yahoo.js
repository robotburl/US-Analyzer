// Data source: Finnhub (quote + fundamentals) + Alpha Vantage (historical)
// FINNHUB_API_KEY + ALPHA_VANTAGE_KEY required in env

const FH  = 'https://finnhub.io/api/v1';
const AV  = 'https://www.alphavantage.co/query';

function fhKey()  { return process.env.FINNHUB_API_KEY || ''; }
function avKey()  { return process.env.ALPHA_VANTAGE_KEY || ''; }

async function fhGet(path) {
  const res = await fetch(`${FH}${path}&token=${fhKey()}`);
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${path.split('?')[0]}`);
  return res.json();
}

async function avGet(params) {
  const qs = new URLSearchParams({ ...params, apikey: avKey() });
  const res = await fetch(`${AV}?${qs}`);
  if (!res.ok) throw new Error(`AlphaVantage ${res.status}`);
  return res.json();
}

// ── Quote + History ──────────────────────────────────────
export async function getQuote(symbol) {
  // Finnhub: real-time quote + profile
  const [q, profile] = await Promise.all([
    fhGet(`/quote?symbol=${symbol}`),
    fhGet(`/stock/profile2?symbol=${symbol}`),
  ]);

  if (!q.c) throw new Error(`Symbol not found: ${symbol}`);

  // Alpha Vantage: daily history (compact = 100 days, full = 20yr)
  let history = [];
  if (avKey()) {
    try {
      const av = await avGet({
        function: 'TIME_SERIES_DAILY',
        symbol,
        outputsize: 'full',
        datatype: 'json',
      });
      const ts = av['Time Series (Daily)'];
      if (ts) {
        history = Object.entries(ts)
          .map(([date, v]) => ({
            date,
            open:   parseFloat(v['1. open']),
            high:   parseFloat(v['2. high']),
            low:    parseFloat(v['3. low']),
            close:  parseFloat(v['4. close']),
            volume: parseInt(v['5. volume']),
          }))
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-252);
      }
    } catch(e) {
      console.warn('AV history failed:', e.message);
    }
  }

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

// ── Fundamentals ─────────────────────────────────────────
export async function getFundamentals(symbol) {
  const [metrics, rec] = await Promise.all([
    fhGet(`/stock/metric?symbol=${symbol}&metric=all`),
    fhGet(`/stock/recommendation?symbol=${symbol}`).catch(() => []),
  ]);

  const m = metrics.metric || {};
  const latestRec = Array.isArray(rec) ? rec[0] : null;
  const totalRec  = latestRec
    ? (latestRec.buy||0)+(latestRec.hold||0)+(latestRec.sell||0)+(latestRec.strongBuy||0)+(latestRec.strongSell||0)
    : 0;
  const recKey = latestRec
    ? ((latestRec.strongBuy||0)+(latestRec.buy||0) > (latestRec.strongSell||0)+(latestRec.sell||0) ? 'buy' : 'hold')
    : null;

  const pct = v => v != null ? v / 100 : null;

  return {
    trailingPE:              m['peBasicExclExtraTTM'],
    forwardPE:               m['peExclExtraAnnual'],
    priceToBook:             m['pbAnnual'],
    pegRatio:                m['pegNormalizedAnnual'],
    enterpriseToEbitda:      m['evEbitdaAnnual'],
    returnOnEquity:          pct(m['roeTTM']),
    returnOnAssets:          pct(m['roaTTM']),
    profitMargins:           pct(m['netProfitMarginTTM']),
    grossMargins:            pct(m['grossMarginTTM']),
    operatingMargins:        pct(m['operatingMarginTTM']),
    revenueGrowth:           pct(m['revenueGrowthTTMYoy']),
    earningsGrowth:          pct(m['epsGrowthTTMYoy']),
    totalRevenue:            m['revenueTTM'],
    totalCash:               null,
    totalDebt:               null,
    debtToEquity:            m['totalDebt/totalEquityAnnual'],
    currentRatio:            m['currentRatioAnnual'],
    dividendYield:           pct(m['dividendYieldIndicatedAnnual']),
    payoutRatio:             pct(m['payoutRatioAnnual']),
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
      const [q, p] = await Promise.all([
        fhGet(`/quote?symbol=${s}`),
        fhGet(`/stock/profile2?symbol=${s}`).catch(() => ({})),
      ]);
      return {
        symbol: s,
        shortName:                  p.name || s,
        regularMarketPrice:         q.c,
        regularMarketChange:        q.d,
        regularMarketChangePercent: q.dp,
        marketCap: p.marketCapitalization ? p.marketCapitalization * 1e6 : null,
      };
    })
  );
  return results.filter(r => r.status === 'fulfilled').map(r => r.value);
}

// ── News ─────────────────────────────────────────────────
export async function getNews(symbol) {
  const to   = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7*86400000).toISOString().slice(0, 10);
  try {
    const data = await fhGet(`/company-news?symbol=${symbol}&from=${from}&to=${to}`);
    return (Array.isArray(data) ? data : []).slice(0, 10).map(n => ({
      title:       n.headline,
      link:        n.url,
      pubDate:     new Date(n.datetime * 1000).toUTCString(),
      description: n.summary?.slice(0, 200) || '',
    }));
  } catch {
    return [];
  }
}
