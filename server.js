const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

// ── Helpers ────────────────────────────────────────────────────────────────
const LOG_MAX = Math.log((10 * 10) * Math.pow(20, 20));

function normalizeScore({ V, E, T, S, M, N }) {
  const raw = (V * E) * Math.pow(T + S, M + N);
  if (raw <= 0) return 0;
  return Math.min(10, Math.max(0, (Math.log(raw) / LOG_MAX) * 10));
}

function buildPrompt(company, extraInfo) {
  return `You are a startup and company analyst. Use your training knowledge to analyze companies.

Score the company on: S = (V * E) * (T + S)^(M + N)

Variables (0.0-10.0):
- V: Vision & Opportunity
- E: Execution & People & Distribution & Innovation & Engineering & Capital
- T: Timing — alignment with technological or economic inflection points
- S: Scalability — grow with decreasing marginal costs
- M: Moat & Market Share & Lock-in & Durability
- N: Network Effects

${extraInfo
  ? `User context:\n"""\n${extraInfo}\n"""\nBase scores on this.`
  : `Use everything you know. NEVER refuse to score.`}

Respond with ONLY a raw JSON object, no markdown, no backticks, nothing else:
{"company":"Name","description":"2-3 sentences","scores":{"V":7.5,"E":8.2,"T":9.0,"S":8.8,"M":7.0,"N":6.5},"reasoning":{"V":"one sentence","E":"one sentence","T":"one sentence","S":"one sentence","M":"one sentence","N":"one sentence"},"verdict":"2-3 sentences","successLabel":"Strong"}

successLabel must be one of: Exceptional, Strong, Promising, Moderate, Weak`;
}

// ── HTTPS request helper (no fetch needed) ────────────────────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── Static file server ────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME[ext] || "text/plain";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } else {
      res.writeHead(200, { "Content-Type": mime });
      res.end(data);
    }
  });
}

function jsonError(res, status, message) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

// ── Server ────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS headers (helpful for local dev)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // API route
  if (pathname === "/api/analyze" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch { return jsonError(res, 400, "Invalid JSON body"); }

      const { company, extraContext } = parsed;
      if (!company || typeof company !== "string") {
        return jsonError(res, 400, "Missing company name");
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return jsonError(res, 500, "ANTHROPIC_API_KEY is not set in environment variables");
      }

      try {
        const result = await httpsPost(
          "api.anthropic.com",
          "/v1/messages",
          {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          {
            model: "claude-sonnet-4-20250514",
            max_tokens: 1500,
            system: buildPrompt(company, extraContext || ""),
            messages: [{ role: "user", content: `Analyze this company: "${company}"` }],
          }
        );

        if (result.status !== 200) {
          const msg = (result.body && result.body.error && result.body.error.message) || String(result.body).slice(0, 200);
          return jsonError(res, 502, "Anthropic API error: " + msg);
        }

        const text = ((result.body.content || [])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join(""));

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return jsonError(res, 500, "AI response had no JSON. Got: " + text.slice(0, 100));
        }

        const data = JSON.parse(jsonMatch[0]);
        if (!data.scores || !data.company) {
          return jsonError(res, 500, "AI response missing required fields");
        }

        data.normalizedScore = normalizeScore(data.scores);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));

      } catch (err) {
        return jsonError(res, 500, err.message || "Server error");
      }
    });
    return;
  }

  // Static files
  if (req.method === "GET") {
    // Clean path, default to index.html
    let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
    // Prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      return jsonError(res, 403, "Forbidden");
    }
    // If no extension, serve index.html (SPA)
    if (!path.extname(filePath)) {
      filePath = path.join(PUBLIC_DIR, "index.html");
    }
    return serveStatic(res, filePath);
  }

  jsonError(res, 404, "Not found");
});

server.listen(PORT, () => {
  console.log("Server listening on port " + PORT);
  console.log("ANTHROPIC_API_KEY set:", !!process.env.ANTHROPIC_API_KEY);
});
