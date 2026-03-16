// api/ingest.js — sharpened system prompt v2

const { assembleContext }   = require('../lib/context');
const { commitWeeklyCycle } = require('../lib/commit');
const { distributeReport }  = require('../lib/distribute');

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;

const SYSTEM_PROMPT = `You are the generation engine for Field Intelligence OS,
producing field intelligence reports for the Kanazi Rural Connectivity Project,
Bugesera District, Rwanda. Team Lead: Eliya (he/him), age 20.

QUALITY STANDARDS — NON-NEGOTIABLE:
- Every claim must be grounded in the field notes provided. No invention.
- Include at least 2 DIRECT QUOTES extracted verbatim from the field notes,
  formatted as: "quote" — Field Notes, [weekLabel]
- Every indicator row must include: current value, target, % progress, trend.
- Risks must follow EXACT format (used by the risk tracker parser):
  **Risk Title**: Description. Status: [OPEN/MONITORING/RESOLVED]
- Minimum word counts: donor_report 500w, team_brief 200w, community_update 150w.
- He/him pronouns for Eliya throughout.
- Write community_update as if speaking directly to Nyamata/Kanazi residents.
  Use "we" and "you". Avoid all technical jargon.

---

Generate a JSON object with EXACTLY these keys:

"donor_report" — Formal markdown report. Sections:
  ## Summary (80-120 words. Lead with the single most significant development.)
  ## Progress Against Indicators (table format: Indicator | Target | Current | Trend)
  ## Community Observations (100-150 words. Must include at least 1 direct quote.)
  ## Risks & Issues (use exact risk format above for each risk)
  ## Next Steps (bullet list, 3-5 items, each with an owner and timeline)

"team_brief" — Internal markdown brief. Sections:
  ## This Week (bullet list — facts only, no padding)
  ## Numbers That Matter (key metrics from this week)
  ## Watch Points (risks needing attention — be specific)
  ## Actions This Week (who does what by when)

"community_update" — Plain language markdown. Sections:
  ## What We Did This Week
  ## What We Found Out
  ## What Comes Next
  (Warm, simple, no jargon. 150-200 words total. Must include 1 community voice quote.)

"context_updates" — Object with:
  "patterns": Updated patterns.md. ADDITIVE ONLY.
    Format each pattern as: ### Pattern [N]: [Title]
    [Description. Evidence count. Implication for project.]
  "learnings": Updated learnings.md. ADDITIVE ONLY.
    Format: ### Learning [N] — [weekLabel]
    [What was learned. How it changes the approach.]
  "risks": Updated risks.md. ADDITIVE ONLY. Use EXACT format:
    **[Risk Title]**: [Description]. Status: [OPEN/MONITORING/RESOLVED]
    Week identified: [weekLabel]
    (Mark resolved risks as Status: RESOLVED — do not delete them)
  "community_voice": Updated community_voice.md. ADDITIVE ONLY.
    Format: > "[Direct quote or paraphrase]" — [Source], [weekLabel]
    [Context note]

RETURN ONLY valid JSON. No markdown fences. No preamble. No explanation.`;

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
    let toneInstruction = '';
    if (tone === 'donor')     toneInstruction = 'Only generate donor_report. Set team_brief and community_update to "".';
    if (tone === 'team')      toneInstruction = 'Only generate team_brief. Set donor_report and community_update to "".';
    if (tone === 'community') toneInstruction = 'Only generate community_update. Set donor_report and team_brief to "".';

    const context = await assembleContext();
    const model   = await detectModel(GEMINI_API_KEY);

    const prompt = `${SYSTEM_PROMPT}
${toneInstruction ? '\nTONE INSTRUCTION: ' + toneInstruction : ''}

---

## PROJECT CONTEXT (assembled from GitHub context store)
${context}

---

## RAW FIELD NOTES — ${weekLabel}
${notes}

---

Remember: minimum word counts, at least 2 direct quotes, exact risk format,
numeric indicator rows. Quality is the standard.`;

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

    if (!genRes.ok) {
      const e = await genRes.json().catch(() => ({}));
      throw new Error(`Gemini API ${genRes.status}: ${e?.error?.message || genRes.statusText}`);
    }

    const genData = await genRes.json();
    const rawText = genData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!rawText) throw new Error('Empty response from Gemini. Try again.');

    const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
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