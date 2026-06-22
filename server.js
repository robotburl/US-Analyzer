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
