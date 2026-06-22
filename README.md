# 📈 Mega US Stock Analyzer

Full-stack web app สำหรับวิเคราะห์หุ้น US ด้วย Yahoo Finance + Claude AI  
Design เหมือน SET Analyzer — IBM Plex Thai, dark theme, accent สีเหลือง

## Features
- 📊 Price chart + MA20/50/200, RSI, MACD, Bollinger Bands, Volume
- 💹 Fundamental: P/E, EPS history, Margins, Analyst targets
- 🤖 AI วิเคราะห์ภาษาไทยแบบ streaming (Claude Sonnet)
- 💼 Portfolio tracker พร้อม Live P&L
- 📋 Watchlists (หลาย list)
- ⚖️ เปรียบเทียบ 2 หุ้น + AI verdict
- 📰 News feed จาก Yahoo Finance RSS

## Tech Stack
- **Backend**: Node.js + Express
- **Data**: Yahoo Finance (ฟรี, ไม่ต้อง API key)
- **AI**: Claude Sonnet 4.6 via Anthropic API (streaming, server-side)
- **Charts**: Chart.js
- **Deploy**: Railway

## Local Setup
```bash
npm install
cp .env.example .env
# แก้ ANTHROPIC_API_KEY ใน .env
npm run dev
# เปิด http://localhost:3001
```

## Deploy to Railway
1. Push repo นี้ขึ้น GitHub
2. ไป railway.app → New Project → Deploy from GitHub
3. ตั้ง Environment Variable: `ANTHROPIC_API_KEY`
4. Deploy ✅

## Project Structure
```
.
├── server.js          ← Express entry point
├── routes/
│   ├── stock.js       ← /api/stock/* (Yahoo Finance proxy)
│   └── ai.js          ← /api/ai/* (Claude streaming)
├── services/
│   ├── yahoo.js       ← Yahoo Finance fetcher
│   └── technicals.js  ← MA, RSI, MACD, BB indicators
├── public/
│   └── index.html     ← Single-page frontend
├── railway.json       ← Railway deploy config
└── package.json
```
