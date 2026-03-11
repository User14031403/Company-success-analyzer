export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { company, extraContext } = req.body || {};

  if (!company || typeof company !== "string") {
    return res.status(400).json({ error: "Missing company name" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  const LOG_MAX = Math.log((10 * 10) * Math.pow(20, 20));

  function normalizeScore({ V, E, T, S, M, N }) {
    const raw = (V * E) * Math.pow(T + S, M + N);
    if (raw <= 0) return 0;
    return Math.min(10, Math.max(0, (Math.log(raw) / LOG_MAX) * 10));
  }

  const context = extraContext
    ? `User-provided context:\n"""\n${extraContext}\n"""\nBase your scores primarily on this.`
    : `Use everything you know. For well-known companies use real data. For lesser-known ones, reason from industry and business model. NEVER refuse to score.`;

  const systemPrompt = `You are a startup and company analyst. Use your training knowledge to analyze companies.

Score the company on: S = (V * E) * (T + S)^(M + N)

Variables (0.0-10.0):
- V: Vision & Opportunity
- E: Execution & People & Distribution & Innovation & Engineering & Capital
- T: Timing - alignment with technological or economic inflection points
- S: Scalability - grow with decreasing marginal costs
- M: Moat & Market Share & Lock-in & Durability
- N: Network Effects

${context}

YOU MUST respond with ONLY a raw JSON object, no markdown, no backticks, no text before or after:
{"company":"Name","description":"2-3 sentences","scores":{"V":7.5,"E":8.2,"T":9.0,"S":8.8,"M":7.0,"N":6.5},"reasoning":{"V":"one sentence","E":"one sentence","T":"one sentence","S":"one sentence","M":"one sentence","N":"one sentence"},"verdict":"2-3 sentences","successLabel":"Strong"}

successLabel must be exactly one of: Exceptional, Strong, Promising, Moderate, Weak`;

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
        system: systemPrompt,
        messages: [{ role: "user", content: `Analyze this company: "${company}"` }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(502).json({ error: data.error.message });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "Could not parse AI response" });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    parsed.normalizedScore = normalizeScore(parsed.scores);
    return res.json(parsed);

  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
