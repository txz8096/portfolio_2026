// api/feedback.js
//
// Contact-form endpoint. Receives { to, from, subject, message, tag } from
// the portfolio's contact form and forwards it as an email via Resend
// (https://resend.com — free tier covers ~3,000 sends/month).
//
// ENV vars required on Vercel:
//   RESEND_API_KEY    — from resend.com → API keys
//   FEEDBACK_TO       — (optional) override the destination address
//                       Defaults to the `to` field from the request body.
//   FEEDBACK_FROM     — (optional) verified sender address.
//                       Defaults to "onboarding@resend.dev" which works
//                       out of the box but shows that sender in inbox.
//                       Once you verify your own domain in Resend, set
//                       this to e.g. "portfolio@melissatang.com".

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { to, from, subject, message, tag } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing message" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY not configured" });
  }

  const destination = process.env.FEEDBACK_TO || to || "txz8096@gmail.com";
  const sender = process.env.FEEDBACK_FROM || "onboarding@resend.dev";
  const fromLabel = (from || "anonymous").toString().slice(0, 80);
  const subj = (subject || `[portfolio · ${tag || "general"}] feedback from ${fromLabel}`).slice(0, 200);

  // Plain-text body: keep it readable, attribute the sender,
  // tag for filtering, and timestamp for context.
  const body =
    `${message.trim()}\n\n` +
    `— ${fromLabel}\n` +
    `tag: ${tag || "general"}\n` +
    `received: ${new Date().toISOString()}`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `Portfolio <${sender}>`,
        to: [destination],
        subject: subj,
        text: body,
        // reply_to lets you hit "reply" in Gmail and reach the visitor —
        // but only if they supplied an email-shaped string in the name
        // field. Skip it otherwise; an arbitrary string breaks Resend.
        ...(isEmail(fromLabel) ? { reply_to: fromLabel } : {}),
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: errText });
    }

    const data = await r.json();
    return res.status(200).json({ ok: true, id: data.id });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}

function isEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
