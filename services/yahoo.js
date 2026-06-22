// Yahoo Finance unofficial API proxy service
// Uses yahoo-finance2 patterns via direct fetch

const BASE = 'https://query1.finance.yahoo.com/v8/finance';
const BASE2 = 'https://query2.finance.yahoo.com/v10/finance';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// EOD + live quote
export async function getQuote(symbol) {
  const url = `${BASE}/chart/${symbol}?interval=1d&range=1y&includePrePost=false`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Yahoo quote fetch failed: ${res.status}`);
  const data = await res.json();
  const result = data.chart.result[0];
  const meta = result.meta;
  const quotes = result.indicators.quote[0];
  const timestamps = result.timestamp;

  const history = timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    open: quotes.open[i],
    high: quotes.high[i],
    low: quotes.low[i],
    close: quotes.close[i],
    volume: quotes.volume[i],
  })).filter(d => d.close != null);

  return {
    symbol: meta.symbol,
    shortName: meta.shortName || symbol,
    currency: meta.currency,
    exchange: meta.exchangeName,
    regularMarketPrice: meta.regularMarketPrice,
    regularMarketChange: meta.regularMarketPrice - meta.previousClose,
    regularMarketChangePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
    previousClose: meta.previousClose,
    marketCap: meta.marketCap,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    history,
  };
}

// Fundamental / summary stats
export async function getFundamentals(symbol) {
  const url = `${BASE2}/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData,summaryDetail,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,earningsHistory`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Yahoo fundamentals fetch failed: ${res.status}`);
  const data = await res.json();
  const q = data.quoteSummary.result[0];

  const safe = (obj, key) => obj?.[key]?.raw ?? null;
  const safeFmt = (obj, key) => obj?.[key]?.fmt ?? null;

  const fin = q.financialData;
  const stats = q.defaultKeyStatistics;
  const summary = q.summaryDetail;

  // Income statement history (annual)
  const incomeHistory = q.incomeStatementHistory?.incomeStatementHistory?.map(s => ({
    endDate: s.endDate?.fmt,
    totalRevenue: safe(s, 'totalRevenue'),
    netIncome: safe(s, 'netIncome'),
    grossProfit: safe(s, 'grossProfit'),
    ebit: safe(s, 'ebit'),
  })) ?? [];

  // EPS history
  const epsHistory = q.earningsHistory?.history?.map(e => ({
    quarter: e.period,
    epsActual: safe(e, 'epsActual'),
    epsEstimate: safe(e, 'epsEstimate'),
    surprisePercent: safe(e, 'surprisePercent'),
  })) ?? [];

  return {
    // Valuation
    trailingPE: safe(stats, 'trailingEps') && safe(summary, 'previousClose')
      ? (safe(summary, 'previousClose') / safe(stats, 'trailingEps')).toFixed(2)
      : safe(summary, 'trailingPE'),
    forwardPE: safe(stats, 'forwardPE'),
    priceToBook: safe(stats, 'priceToBook'),
    pegRatio: safe(stats, 'pegRatio'),
    enterpriseToEbitda: safe(stats, 'enterpriseToEbitda'),
    // Profitability
    returnOnEquity: safe(fin, 'returnOnEquity'),
    returnOnAssets: safe(fin, 'returnOnAssets'),
    profitMargins: safe(fin, 'profitMargins'),
    grossMargins: safe(fin, 'grossMargins'),
    operatingMargins: safe(fin, 'operatingMargins'),
    // Growth
    revenueGrowth: safe(fin, 'revenueGrowth'),
    earningsGrowth: safe(fin, 'earningsGrowth'),
    // Financial health
    totalDebt: safe(fin, 'totalDebt'),
    totalCash: safe(fin, 'totalCash'),
    debtToEquity: safe(fin, 'debtToEquity'),
    currentRatio: safe(fin, 'currentRatio'),
    quickRatio: safe(fin, 'quickRatio'),
    // Dividends
    dividendYield: safe(summary, 'dividendYield'),
    dividendRate: safe(summary, 'dividendRate'),
    payoutRatio: safe(summary, 'payoutRatio'),
    exDividendDate: safeFmt(summary, 'exDividendDate'),
    // Revenue
    totalRevenue: safe(fin, 'totalRevenue'),
    revenuePerShare: safe(fin, 'revenuePerShare'),
    // EPS
    trailingEps: safe(stats, 'trailingEps'),
    forwardEps: safe(fin, 'earningsPerShare'),
    // Float / shares
    sharesOutstanding: safe(stats, 'sharesOutstanding'),
    floatShares: safe(stats, 'floatShares'),
    shortRatio: safe(stats, 'shortRatio'),
    // Target
    targetHighPrice: safe(fin, 'targetHighPrice'),
    targetLowPrice: safe(fin, 'targetLowPrice'),
    targetMeanPrice: safe(fin, 'targetMeanPrice'),
    recommendationMean: safe(fin, 'recommendationMean'),
    recommendationKey: fin?.recommendationKey,
    numberOfAnalystOpinions: safe(fin, 'numberOfAnalystOpinions'),
    // History
    incomeHistory,
    epsHistory,
  };
}

// Multiple quotes (portfolio / watchlist)
export async function getMultipleQuotes(symbols) {
  const joined = symbols.join(',');
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${joined}&fields=symbol,shortName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,marketCap,fiftyTwoWeekHigh,fiftyTwoWeekLow,trailingPE,forwardPE,dividendYield`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Yahoo multi-quote failed: ${res.status}`);
  const data = await res.json();
  return data.quoteResponse.result;
}

// News from Yahoo RSS
export async function getNews(symbol) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${symbol}&region=US&lang=en-US`;
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!res.ok) return [];
  const text = await res.text();
  // Parse RSS manually
  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const item = m[1];
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ?? item.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? '';
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '';
    const description = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] ?? '';
    return { title, link, pubDate, description: description.replace(/<[^>]+>/g, '').slice(0, 200) };
  });
  return items.slice(0, 10);
}
