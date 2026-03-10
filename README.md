# Company Success Analyzer

Rates any company's future success out of 10 using the formula:

**S = (V × E) × (T + S)^(M+N)**

Powered by Claude AI (Anthropic).

## Deploy to Railway

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Select your repo
4. Go to **Variables** and add:
   ```
   ANTHROPIC_API_KEY=your-key-here
   ```
5. Railway auto-detects Node.js and runs `npm start` — your app is live!

## Local Development

```bash
npm install
ANTHROPIC_API_KEY=your-key-here node server.js
```

Then open http://localhost:3000

## Project Structure

```
company-analyzer/
├── server.js        # Express backend — proxies Anthropic API (key stays secure)
├── package.json
└── public/
    └── index.html   # Frontend — calls /api/analyze on the same server
```
