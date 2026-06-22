// Yahoo Finance unofficial API proxy service

const BASE  = 'https://query1.finance.yahoo.com/v8/finance';
const BASE2 = 'https://query2.finance.yahoo.com/v10/finance';

// Full browser-like headers — required when calling from server (Railway)
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

// Fetch with retry on alternate host
async function yFetch(url) {
  // Try query1 first, fall back to query2
  const urls = [
    url,
    url.replace('query1.finance.yahoo.com', 'query2.finance.yahoo.com'),
  ];
  let lastErr;
  for (const u of urls) {
    try {
      const res = await fetch(u, { headers: HEADERS });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} from ${u}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// EOD + live quote
export async function getQuote(symbol) {
  const url = `${BASE}/chart/${symbol}?interval=1d&range=1y&includePrePost=false&events=div,split`;
  const res = await yFetch(url);
  const data = await res.json();

  if (!data?.chart?.result?.[0]) {
    throw new Error(`No data for symbol: ${symbol}`);
  }

  const result = data.chart.result[0];
  const meta   = result.meta;
  const q      = result.indicators.quote[0];
  const ts     = result.timestamp || [];

  const history = ts.map((t, i) => ({
    date:   new Date(t * 1000).toISOString().slice(0, 10),
    open:   q.open[i],
    high:   q.high[i],
    low:    q.low[i],
    close:  q.close[i],
    volume: q.volume[i],
  })).filter(d => d.close != null);

  return {
    symbol:               meta.symbol,
    shortName:            meta.shortName || symbol,
    currency:             meta.currency,
    exchange:             meta.exchangeName,
    price:                meta.regularMarketPrice,
    change:               meta.regularMarketPrice - meta.previousClose,
    changePct:            ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
    previousClose:        meta.previousClose,
    marketCap:            meta.marketCap,
    week52High:           meta.fiftyTwoWeekHigh,
    week52Low:            meta.fiftyTwoWeekLow,
    history,
  };
}

// Fundamental / summary stats
export async function getFundamentals(symbol) {
  const url = `${BASE2}/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData,summaryDetail,earningsHistory`;
  const res = await yFetch(url);
  const data = await res.json();

  if (!data?.quoteSummary?.result?.[0]) {
    throw new Error(`No fundamental data for: ${symbol}`);
  }

  const r    = data.quoteSummary.result[0];
  const safe = (obj, k) => obj?.[k]?.raw ?? null;
  const fin  = r.financialData;
  const stats= r.defaultKeyStatistics;
  const sum  = r.summaryDetail;

  const epsHistory = r.earningsHistory?.history?.map(e => ({
    quarter:         e.period,
    epsActual:       safe(e, 'epsActual'),
    epsEstimate:     safe(e, 'epsEstimate'),
    surprisePercent: safe(e, 'surprisePercent'),
  })) ?? [];

  return {
    trailingPE:           safe(sum,   'trailingPE'),
    forwardPE:            safe(stats, 'forwardPE'),
    priceToBook:          safe(stats, 'priceToBook'),
    pegRatio:             safe(stats, 'pegRatio'),
    enterpriseToEbitda:   safe(stats, 'enterpriseToEbitda'),
    returnOnEquity:       safe(fin,   'returnOnEquity'),
    returnOnAssets:       safe(fin,   'returnOnAssets'),
    profitMargins:        safe(fin,   'profitMargins'),
    grossMargins:         safe(fin,   'grossMargins'),
    operatingMargins:     safe(fin,   'operatingMargins'),
    revenueGrowth:        safe(fin,   'revenueGrowth'),
    earningsGrowth:       safe(fin,   'earningsGrowth'),
    totalRevenue:         safe(fin,   'totalRevenue'),
    totalCash:            safe(fin,   'totalCash'),
    totalDebt:            safe(fin,   'totalDebt'),
    debtToEquity:         safe(fin,   'debtToEquity'),
    currentRatio:         safe(fin,   'currentRatio'),
    dividendYield:        safe(sum,   'dividendYield'),
    payoutRatio:          safe(sum,   'payoutRatio'),
    trailingEps:          safe(stats, 'trailingEps'),
    forwardEps:           safe(fin,   'earningsPerShare'),
    sharesOutstanding:    safe(stats, 'sharesOutstanding'),
    targetMeanPrice:      safe(fin,   'targetMeanPrice'),
    targetHighPrice:      safe(fin,   'targetHighPrice'),
    targetLowPrice:       safe(fin,   'targetLowPrice'),
    recommendationMean:   safe(fin,   'recommendationMean'),
    recommendationKey:    fin?.recommendationKey ?? null,
    numberOfAnalystOpinions: safe(fin, 'numberOfAnalystOpinions'),
    epsHistory,
  };
}

// Batch quotes for portfolio / watchlist
export async function getMultipleQuotes(symbols) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}&fields=symbol,shortName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,marketCap`;
  const res = await yFetch(url);
  const data = await res.json();
  return data?.quoteResponse?.result ?? [];
}

// News RSS
export async function getNews(symbol) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${symbol}&region=US&lang=en-US`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const text = await res.text();
    return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const b     = m[1];
      const title = b.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
                  ?? b.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
      const link  = b.match(/<link>(.*?)<\/link>/)?.[1] ?? '';
      const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '';
      const description = (b.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] ?? '')
                          .replace(/<[^>]+>/g, '').slice(0, 200);
      return { title, link, pubDate, description };
    }).slice(0, 10);
  } catch {
    return [];
  }
}
