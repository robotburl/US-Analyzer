import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

// Auto-create tables on startup
export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analysis_history (
      id          BIGSERIAL PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      type        VARCHAR(20) NOT NULL DEFAULT 'stock',
      symbol      VARCHAR(20),
      short_name  TEXT,
      price       NUMERIC(12,4),
      change_pct  NUMERIC(8,4),
      bias        VARCHAR(20),
      rsi         NUMERIC(6,2),
      ma50        NUMERIC(12,4),
      ma200       NUMERIC(12,4),
      market_cap  BIGINT,
      ai_text     TEXT,
      note        TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_history_created  ON analysis_history(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_symbol   ON analysis_history(symbol);
    CREATE INDEX IF NOT EXISTS idx_history_bias     ON analysis_history(bias);
  `);
  console.log('✅ DB tables ready');
}

export default pool;
