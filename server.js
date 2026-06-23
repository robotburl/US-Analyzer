import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import stockRoutes from './routes/stock.js';
import aiRoutes from './routes/ai.js';
import historyRoutes from './routes/history.js';
import { initDB } from './services/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));  // ai_text can be large

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/stock', stockRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/history', historyRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Debug — test data sources
app.get('/api/debug/:symbol', async (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  const result = { symbol: sym, env: {}, tests: {} };

  // Check env vars
  result.env.FINNHUB  = !!process.env.FINNHUB_API_KEY;
  result.env.AV       = !!process.env.ALPHA_VANTAGE_KEY;
  result.env.DATABASE = !!process.env.DATABASE_URL;
  result.env.ANTHROPIC= !!process.env.ANTHROPIC_API_KEY;

  // Test Finnhub quote
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${process.env.FINNHUB_API_KEY}`);
    const d = await r.json();
    result.tests.finnhub_quote = { ok: !!d.c, price: d.c, status: r.status };
  } catch(e) { result.tests.finnhub_quote = { ok: false, error: e.message }; }

  // Test Alpha Vantage history
  try {
    const r = await fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${sym}&outputsize=compact&apikey=${process.env.ALPHA_VANTAGE_KEY}`);
    const d = await r.json();
    const ts = d['Time Series (Daily)'];
    const keys = ts ? Object.keys(ts) : [];
    result.tests.alpha_vantage = { ok: keys.length > 0, days: keys.length, latest: keys[0], note: d.Note || d.Information || null };
  } catch(e) { result.tests.alpha_vantage = { ok: false, error: e.message }; }

  res.json(result);
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start: init DB then listen
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Mega US Stock Analyzer running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ DB init failed:', err.message);
    // Still start server even if DB fails (stock data still works)
    app.listen(PORT, () => {
      console.log(`🚀 Running WITHOUT DB at http://localhost:${PORT}`);
    });
  });
