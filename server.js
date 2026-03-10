const express = require("express");
const path = require("path");

const app = express();

// ── API route MUST come before static middleware ───────────────────────────
app.use(express.json());

app.post("/api/analyze", async (req, res) => {
  // Always respond with JSON, never HTML
  res.setHeader("Content-Type", "application/json");

  const { company, extraContext } = req.body || {};

  if (!company || typeof company !== "string") {
    return res.status(400).json({ error: "Missing company name" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY environment variable is not set" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: buildPrompt(company, extraContext || ""),
        messages: [{ role: "user", content: `Analyze this company: "${company}"` }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: "Anthropic API error: " + response.status + " " + errText.slice(0, 200) });
    }

    const data = await response.json();

    if (data.error) {
      return res.status(502).json({ error: data.error.message || "Anthropic returned an error" });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "AI did not return valid JSON. Response: " + text.slice(0, 100) });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.scores || !parsed.company) {
      return res.status(500).json({ error: "AI response was missing required fields" });
    }

    parsed.normalizedScore = normalizeScore(parsed.scores);
    return res.json(parsed);

  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected server error" });
  }
});

// ── Static files AFTER API routes ─────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// SPA fallback — serve index.html for any non-API GET
app.get(/^(?!\/api).*$/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
  console.log("ANTHROPIC_API_KEY set:", !!process.env.ANTHROPIC_API_KEY);
});

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
- V: Vision & Opportunity — clarity of long-term goal, unique opportunity others don't see
- E: Execution & People & Distribution & Innovation & Engineering & Capital — team, operations, delivery, tech, capital
- T: Timing — alignment with technological or economic inflection points
- S: Scalability — ability to grow with decreasing marginal costs
- M: Moat & Market Share & Lock-in & Durability — competitive advantages, retention, monopolistic advantages
- N: Network Effects — value increases with number of users

${extraInfo
  ? `User-provided context:\n"""\n${extraInfo}\n"""\nBase your scores primarily on this context.`
  : `Use everything you know. For well-known companies use real data. For lesser-known ones, reason from industry and business model. NEVER refuse to score.`
}

YOU MUST respond with ONLY a raw JSON object — no markdown, no backticks, no text before or after:
{"company":"Name","description":"2-3 sentence overview","scores":{"V":7.5,"E":8.2,"T":9.0,"S":8.8,"M":7.0,"N":6.5},"reasoning":{"V":"one sentence","E":"one sentence","T":"one sentence","S":"one sentence","M":"one sentence","N":"one sentence"},"verdict":"2-3 sentence verdict","successLabel":"Strong"}

successLabel must be exactly one of: Exceptional, Strong, Promising, Moderate, Weak`;
}
