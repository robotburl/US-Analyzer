import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/ai/analyze — full stock analysis with streaming
router.post('/analyze', async (req, res) => {
  const { symbol, quote, signals, fundamentals, history, news } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const recentHistory = history?.slice(-30) ?? [];
  const newsBlock = news?.slice(0, 5).map(n => `- ${n.title}`).join('\n') ?? 'No news available';

  const prompt = `You are an expert US equity analyst. Analyze this stock and give a comprehensive report.

## ${symbol} — ${quote?.shortName ?? symbol}

### Market Data
- Price: $${quote?.price?.toFixed(2)} (${quote?.changePct >= 0 ? '+' : ''}${quote?.changePct?.toFixed(2)}% today)
- Market Cap: ${formatLargeNum(quote?.marketCap)}
- 52W High: $${quote?.week52High?.toFixed(2)} | 52W Low: $${quote?.week52Low?.toFixed(2)}

### Technical Signals
- Trend bias: **${signals?.overallBias}** (${signals?.bullCount} bullish / ${signals?.bearCount} bearish signals)
- RSI(14): ${signals?.rsi?.toFixed(1)} ${signals?.rsi > 70 ? '⚠️ Overbought' : signals?.rsi < 30 ? '⚠️ Oversold' : '✅ Normal'}
- MA20: $${signals?.ma20?.toFixed(2)} | MA50: $${signals?.ma50?.toFixed(2)} | MA200: $${signals?.ma200?.toFixed(2)}
- Signals: ${signals?.signals?.map(s => s.label).join(', ')}

### Fundamentals
- P/E (trailing): ${fundamentals?.trailingPE ?? 'N/A'} | P/E (forward): ${fundamentals?.forwardPE ?? 'N/A'}
- PEG: ${fundamentals?.pegRatio ?? 'N/A'} | P/B: ${fundamentals?.priceToBook ?? 'N/A'}
- EPS (TTM): $${fundamentals?.trailingEps ?? 'N/A'} | EPS (fwd): $${fundamentals?.forwardEps ?? 'N/A'}
- Revenue growth YoY: ${pct(fundamentals?.revenueGrowth)} | Earnings growth: ${pct(fundamentals?.earningsGrowth)}
- Gross margin: ${pct(fundamentals?.grossMargins)} | Net margin: ${pct(fundamentals?.profitMargins)}
- ROE: ${pct(fundamentals?.returnOnEquity)} | Debt/Equity: ${fundamentals?.debtToEquity ?? 'N/A'}
- Dividend yield: ${pct(fundamentals?.dividendYield)} | Payout ratio: ${pct(fundamentals?.payoutRatio)}
- Analyst target (mean): $${fundamentals?.targetMeanPrice?.toFixed(2) ?? 'N/A'} | Rating: ${fundamentals?.recommendationKey?.toUpperCase() ?? 'N/A'} (${fundamentals?.numberOfAnalystOpinions ?? 0} analysts)

### Recent News
${newsBlock}

### Recent Price Action (last 30 days)
${recentHistory.slice(-10).map(d => `${d.date}: $${d.close?.toFixed(2)}`).join('\n')}

---

Provide a structured analysis in Thai (ภาษาไทย) with these sections:

## 📊 สรุปภาพรวม
Brief 2-3 sentence overview of current situation.

## 📈 Technical Analysis
- Trend direction and strength
- Key support/resistance levels based on MA and BB
- RSI and MACD interpretation
- Entry/exit signals

## 💼 Fundamental Analysis
- Valuation assessment vs sector peers
- Profitability quality
- Growth trajectory
- Balance sheet health
- Dividend sustainability (if applicable)

## 📰 News & Catalysts
- Impact of recent news
- Upcoming catalysts to watch

## ⚠️ Key Risks
Top 3 risks bullet points.

## 🎯 Conclusion & Strategy
- Short-term outlook (1-4 weeks)
- Medium-term outlook (3-6 months)
- Suggested action: BUY / HOLD / WAIT / AVOID with rationale
- Key price levels to watch

Be specific with price targets and levels. Use data from above to support every claim.`;

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// POST /api/ai/portfolio — analyze full portfolio
router.post('/portfolio', async (req, res) => {
  const { holdings, totalValue, totalGainPct } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const holdingsText = holdings.map(h =>
    `- ${h.symbol} (${h.shortName}): ${h.shares} shares @ avg $${h.avgCost?.toFixed(2)}, current $${h.currentPrice?.toFixed(2)}, ${h.gainPct >= 0 ? '+' : ''}${h.gainPct?.toFixed(2)}%, weight ${h.weight?.toFixed(1)}%`
  ).join('\n');

  const prompt = `วิเคราะห์ Portfolio หุ้น US นี้ในฐานะที่ปรึกษาการลงทุนอาวุโส:

## Portfolio Summary
- มูลค่ารวม: $${totalValue?.toFixed(2)}
- ผลตอบแทนรวม: ${totalGainPct >= 0 ? '+' : ''}${totalGainPct?.toFixed(2)}%

## Holdings
${holdingsText}

วิเคราะห์เป็นภาษาไทย:

## 📊 ภาพรวม Portfolio
สรุปสั้นๆ สภาพพอร์ตตอนนี้

## ⚖️ การกระจายความเสี่ยง (Diversification)
- Sector concentration
- ตัวที่ over-weight / under-weight
- Correlation risks

## 🌟 Top Performers
วิเคราะห์ตัวที่กำไรดีสุด ควร hold ต่อหรือ take profit?

## ⚠️ Underperformers
ตัวที่ขาดทุน/ด้อยประสิทธิภาพ ควรทำอะไรต่อ?

## 🎯 คำแนะนำเชิงกลยุทธ์
- Rebalancing suggestions
- Position sizing improvements
- ตัวที่ควร add / trim / cut

## 📅 Catalysts to Watch
เหตุการณ์สำคัญที่จะกระทบ portfolio ในช่วง 1-3 เดือนข้างหน้า`;

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// POST /api/ai/compare — compare 2 stocks
router.post('/compare', async (req, res) => {
  const { stockA, stockB } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const prompt = `เปรียบเทียบหุ้น 2 ตัวนี้ในภาษาไทย:

**${stockA.symbol}** vs **${stockB.symbol}**

### ${stockA.symbol}
- Price: $${stockA.quote?.price?.toFixed(2)}, YTD: ${stockA.quote?.changePct?.toFixed(1)}%
- P/E: ${stockA.fund?.trailingPE ?? 'N/A'}, Forward P/E: ${stockA.fund?.forwardPE ?? 'N/A'}
- Revenue Growth: ${pct(stockA.fund?.revenueGrowth)}, Net Margin: ${pct(stockA.fund?.profitMargins)}
- RSI: ${stockA.signals?.rsi?.toFixed(0)}, Bias: ${stockA.signals?.overallBias}
- Analyst target: $${stockA.fund?.targetMeanPrice?.toFixed(2)} (${stockA.fund?.recommendationKey})

### ${stockB.symbol}
- Price: $${stockB.quote?.price?.toFixed(2)}, YTD: ${stockB.quote?.changePct?.toFixed(1)}%
- P/E: ${stockB.fund?.trailingPE ?? 'N/A'}, Forward P/E: ${stockB.fund?.forwardPE ?? 'N/A'}
- Revenue Growth: ${pct(stockB.fund?.revenueGrowth)}, Net Margin: ${pct(stockB.fund?.profitMargins)}
- RSI: ${stockB.signals?.rsi?.toFixed(0)}, Bias: ${stockB.signals?.overallBias}
- Analyst target: $${stockB.fund?.targetMeanPrice?.toFixed(2)} (${stockB.fund?.recommendationKey})

เปรียบเทียบ:
## ⚖️ Valuation
## 📈 Growth & Quality
## 🔧 Technical Outlook
## 🏆 ตัวที่ดีกว่า และเหตุผล`;

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

function formatLargeNum(n) {
  if (!n) return 'N/A';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(2)}`;
}

function pct(n) {
  if (n == null) return 'N/A';
  return `${(n * 100).toFixed(2)}%`;
}

export default router;
