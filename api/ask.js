// api/ask.js
//
// Portfolio Q&A endpoint. Uses Anthropic prompt caching on the stable
// system block (voice + rules + FAQ + project context) so we only pay
// full token cost on the first request in a ~5-minute window, and ~10%
// of that on every subsequent hit.
//
// Accepts two payload shapes:
//   • { system, question }   — preferred. Lets us cache `system` independently.
//   • { prompt }             — legacy. Whole thing goes in as a user message,
//                              no caching. Kept so an older frontend deploy
//                              doesn't 400 while a new backend is live.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { system, question, prompt } = req.body || {};

  // Build the Messages API payload based on which shape we got.
  let payload;
  if (typeof system === "string" && typeof question === "string" && question.trim()) {
    payload = {
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: system,
          // Cache breakpoint: the entire system preamble is reused verbatim
          // across requests, so Anthropic stores it and replays it for ~5 min.
          // Min cacheable size for Haiku is ~1024 tokens — our system block
          // (FAQ + project context) clears that comfortably.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: question }],
    };
  } else if (typeof prompt === "string" && prompt.trim()) {
    // Legacy fallback — no caching possible because the whole thing is in
    // the user message and varies per request.
    payload = {
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    };
  } else {
    return res.status(400).json({ error: "Missing system+question or prompt" });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: errText });
    }

    const data = await r.json();
    const text = data.content?.[0]?.text || "";

    // Surface cache stats so you can verify it's working from the network tab.
    // cache_creation_input_tokens > 0 on the first request (cache miss + write),
    // cache_read_input_tokens > 0 on subsequent requests within the TTL.
    const usage = data.usage || {};
    return res.status(200).json({
      text,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
