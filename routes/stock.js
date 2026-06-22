import { Router } from 'express';
import { getQuote, getFundamentals, getMultipleQuotes, getNews } from '../services/yahoo.js';
import { computeIndicators, getSignalSummary } from '../services/technicals.js';

const router = Router();

// GET /api/stock/:symbol — full data (quote + technicals)
router.get('/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const quote = await getQuote(symbol);
    const indicators = computeIndicators(quote.history);
    const signals = getSignalSummary(quote.history, indicators);

    res.json({
      ok: true,
      quote: {
        symbol: quote.symbol,
        shortName: quote.shortName,
        currency: quote.currency,
        exchange: quote.exchange,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePct: quote.regularMarketChangePercent,
        previousClose: quote.previousClose,
        marketCap: quote.marketCap,
        week52High: quote.fiftyTwoWeekHigh,
        week52Low: quote.fiftyTwoWeekLow,
      },
      history: quote.history.slice(-252), // ~1 year trading days
      indicators: {
        ma20: indicators.ma20.slice(-252),
        ma50: indicators.ma50.slice(-252),
        ma200: indicators.ma200.slice(-252),
        rsi14: indicators.rsi14.slice(-252),
        macd: {
          macd: indicators.macd.macd.slice(-252),
          signal: indicators.macd.signal.slice(-252),
          histogram: indicators.macd.histogram.slice(-252),
        },
        bollingerBands: {
          upper: indicators.bollingerBands.upper.slice(-252),
          mid: indicators.bollingerBands.mid.slice(-252),
          lower: indicators.bollingerBands.lower.slice(-252),
        },
      },
      signals,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/stock/:symbol/fundamentals
router.get('/:symbol/fundamentals', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await getFundamentals(symbol);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/stock/:symbol/news
router.get('/:symbol/news', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const news = await getNews(symbol);
    res.json({ ok: true, news });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/stock/batch — { symbols: ['NVDA','TSM',...] }
router.post('/batch', async (req, res) => {
  try {
    const { symbols } = req.body;
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ ok: false, error: 'symbols array required' });
    }
    const data = await getMultipleQuotes(symbols.map(s => s.toUpperCase()));
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
