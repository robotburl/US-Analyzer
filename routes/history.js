import { Router } from 'express';
import pool from '../services/db.js';

const router = Router();

// GET /api/history?limit=50&offset=0&bias=BULLISH&symbol=NVDA
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, bias, symbol } = req.query;
    const conditions = [];
    const params = [];

    if (bias && bias !== 'all') {
      params.push(bias.toUpperCase());
      conditions.push(`bias = $${params.length}`);
    }
    if (symbol) {
      params.push(symbol.toUpperCase() + '%');
      conditions.push(`symbol LIKE $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await pool.query(
      `SELECT id, created_at, type, symbol, short_name, price, change_pct,
              bias, rsi, ma50, ma200, market_cap, note,
              LEFT(ai_text, 200) AS ai_preview
       FROM analysis_history
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM analysis_history ${where}`,
      params.slice(0, -2)
    );

    res.json({ ok: true, data: rows, total: parseInt(countRes.rows[0].count) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/history/:id — full record with ai_text
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM analysis_history WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/history — save new analysis
router.post('/', async (req, res) => {
  try {
    const {
      type = 'stock', symbol, shortName, price, changePct,
      bias, rsi, ma50, ma200, marketCap, aiText, note = ''
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO analysis_history
         (type, symbol, short_name, price, change_pct, bias, rsi, ma50, ma200, market_cap, ai_text, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, created_at`,
      [type, symbol?.toUpperCase(), shortName, price, changePct,
       bias?.toUpperCase(), rsi, ma50, ma200, marketCap, aiText, note]
    );

    res.json({ ok: true, id: rows[0].id, createdAt: rows[0].created_at });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/history/:id/note — update note only
router.patch('/:id/note', async (req, res) => {
  try {
    const { note = '' } = req.body;
    await pool.query(
      'UPDATE analysis_history SET note = $1 WHERE id = $2',
      [note, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/history/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM analysis_history WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/history — clear all
router.delete('/', async (req, res) => {
  try {
    await pool.query('DELETE FROM analysis_history');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
