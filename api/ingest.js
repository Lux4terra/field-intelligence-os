// api/ingest.js — updated for multi-tone output

const { assembleContext }   = require('../lib/context');
const { commitWeeklyCycle } = require('../lib/commit');
const { distributeReport }  = require('../lib/distribute');

const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const ACCESS_PASSWORD  = process.env.ACCESS_PASSWORD;

const SYSTEM_PROMPT = `You are the generation engine for Field Intelligence OS.
You receive raw field notes from the Kanazi Rural Connectivity Project
team in Bugesera District, Rwanda, plus the full project context.

Generate a JSON object with these keys:

"donor_report" — Formal, evidence-based markdown report for donors/funders.
  Sections: ## Summary, ## Progress Against Indicators, ## Community Observations,
  ## Risks & Issues, ## Next Steps
  Tone: Professional. Cite numbers. Use bold for key findings.
  Length: 400-600 words.

"team_brief" — Concise internal markdown brief for the project team.
  Sections: ## This Week, ## Watch Points, ## Actions This Week
  Tone: Direct. No fluff. Bullet-heavy. What happened, what needs doing.
  Length: 150-250 words.

"community_update" — Plain language markdown update suitable for community members.
  Sections: ## What We Did This Week, ## What We Found Out, ## What Comes Next
  Tone: Warm, simple, no jargon. Write as if speaking to community members directly.
  Length: 150-200 words.

"context_updates" — object with keys:
  "patterns": updated patterns.md — add recurring themes (be additive, never delete)
  "learnings": updated learnings.md — add this week's lessons
  "risks": updated risks.md — add new risks, mark resolved as [RESOLVED]
  "community_voice": updated community_voice.md — notable quotes or sentiments

Rules:
- Return ONLY valid JSON. No markdown fences. No preamble.
- He/him pronouns for Eliya throughout all reports.
- In donor_report and team_brief: render list items as markdown bullets (- item)
  NOT as asterisks (* item).
- context_updates: additive only. Never remove existing content.`;

async function detectModel(apiKey) {
  const res  = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();
  const avail = (data.models || []).map(m => m.name.replace('models/', ''));
  const pref  = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  return pref.find(m => avail.includes(m)) || avail.find(m => m.includes('flash')) || avail[0];
}

module.exports = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, weekLabel, notes, tone = 'all' } = req.body;

  if (password !== ACCESS_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
  if (!weekLabel || !notes || notes.trim().length < 20)
    return res.status(400).json({ error: 'Week label and notes required' });

  try {
    // Build tone instruction based on selection
    let toneInstruction = '';
    if (tone === 'donor')     toneInstruction = 'Only generate donor_report. Set team_brief and community_update to empty string "".';
    if (tone === 'team')      toneInstruction = 'Only generate team_brief. Set donor_report and community_update to empty string "".';
    if (tone === 'community') toneInstruction = 'Only generate community_update. Set donor_report and team_brief to empty string "".';

    const context = await assembleContext();
    const model   = await detectModel(GEMINI_API_KEY);

    const prompt = `${SYSTEM_PROMPT}
${toneInstruction ? '\nTONE INSTRUCTION: ' + toneInstruction : ''}

---

## PROJECT CONTEXT
${context}

---

## RAW FIELD NOTES (${weekLabel})
${notes}`;

    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.65, maxOutputTokens: 8192 }
        })
      }
    );

    if (!genRes.ok) {
      const e = await genRes.json().catch(() => ({}));
      throw new Error(`Gemini API ${genRes.status}: ${e?.error?.message || genRes.statusText}`);
    }

    const genData = await genRes.json();
    const rawText = genData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!rawText) throw new Error('Empty response from Gemini. Try again.');

    const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());

    // Save donor_report to GitHub (primary report for archive)
    const primaryReport = parsed.donor_report || parsed.team_brief || parsed.community_update || '';

    await commitWeeklyCycle(weekLabel, notes, primaryReport, parsed.context_updates || {});
    await distributeReport(weekLabel, primaryReport);

    return res.status(200).json({
      success:          true,
      donor_report:     parsed.donor_report     || '',
      team_brief:       parsed.team_brief       || '',
      community_update: parsed.community_update || '',
      model,
      weekLabel
    });

  } catch (err) {
    console.error('Ingest error:', err);
    return res.status(500).json({ error: err.message });
  }
};