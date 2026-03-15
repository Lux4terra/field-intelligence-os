// api/ingest.js
// The entry point — receives field notes from the web form
// Validates, then triggers the full generation cycle

const { assembleContext }      = require('../lib/context');
const { commitWeeklyCycle }    = require('../lib/commit');
const { distributeReport }     = require('../lib/distribute');

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;

const SYSTEM_PROMPT = `You are the generation engine for Field Intelligence OS.
You receive raw field notes from a field officer working on the Kanazi Rural
Connectivity Project in Bugesera District, Rwanda. You also receive the full
project context — standing brief, stakeholder information, M&E indicators,
and accumulated intelligence from previous weeks.

Your job is to return a single valid JSON object with exactly two keys:

1. "report" — A complete, professional field report in markdown format.
   Include these sections: Summary, Progress Against Indicators, Community
   Observations, Risks & Issues, Next Steps. Write for a stakeholder audience
   — clear, evidence-based, mission-aligned. He/him pronouns for Eliya.

2. "context_updates" — An object with four keys:
   - "patterns": updated patterns.md — add any new recurring themes observed
   - "learnings": updated learnings.md — add what this week taught us
   - "risks": updated risks.md — add new risks, mark resolved ones [RESOLVED]
   - "community_voice": updated community_voice.md — add notable quotes or
     sentiment observations from this week's notes

Rules:
- Return ONLY valid JSON. No markdown fences. No preamble.
- For context_updates: be ADDITIVE. Never delete existing content.
- If a field is not applicable this week, return the existing content unchanged.
- Write in a clear, professional register appropriate for NGO reporting.`;

async function detectModel(apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  const data = await res.json();
  const available = (data.models || []).map(m => m.name.replace('models/', ''));
  const preferred = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  return preferred.find(m => available.includes(m)) ||
         available.find(m => m.includes('flash')) ||
         available[0];
}

module.exports = async function(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password, weekLabel, notes } = req.body;

  // Password check
  if (password !== ACCESS_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Validate inputs
  if (!weekLabel || !notes || notes.trim().length < 20) {
    return res.status(400).json({ error: 'Week label and notes are required' });
  }

  try {
    // Step 1: Pull context from GitHub
    const context = await assembleContext();

    // Step 2: Auto-detect best available Gemini model
    const model = await detectModel(GEMINI_API_KEY);

    // Step 3: Generate report + context updates
    const prompt = `${SYSTEM_PROMPT}\n\n---\n\n## PROJECT CONTEXT\n\n${context}\n\n---\n\n## THIS WEEK'S RAW FIELD NOTES (${weekLabel})\n\n${notes}`;

    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 8192 }
        })
      }
    );

    const genData  = await genRes.json();
    const rawText  = genData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed   = JSON.parse(rawText.replace(/```json|```/g, '').trim());

    // Step 4: Commit everything to GitHub
    await commitWeeklyCycle(
      weekLabel,
      notes,
      parsed.report,
      parsed.context_updates || {}
    );

    // Step 5: Email report to stakeholders
    await distributeReport(weekLabel, parsed.report);

    // Return the report to the browser for immediate display
    return res.status(200).json({
      success: true,
      report: parsed.report,
      model,
      weekLabel
    });

  } catch (err) {
    console.error('Ingest error:', err);
    return res.status(500).json({ error: err.message });
  }
};