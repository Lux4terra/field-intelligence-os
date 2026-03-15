// api/synthesise.js
// Generates a quarterly synthesis report from all weekly reports
// in a given quarter. This is the $500 feature.

const { assembleContext } = require('../lib/context');
const { writeFile }       = require('../lib/commit');

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN    = process.env.GITHUB_TOKEN;
const GITHUB_REPO     = process.env.GITHUB_REPO;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;

async function fetchFile(path) {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3.raw' } }
  );
  if (!res.ok) return null;
  return await res.text();
}

async function listFiles(path) {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
  );
  if (!res.ok) return [];
  return await res.json();
}

async function detectModel(apiKey) {
  const res  = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();
  const avail = (data.models || []).map(m => m.name.replace('models/', ''));
  const pref  = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  return pref.find(m => avail.includes(m)) || avail.find(m => m.includes('flash')) || avail[0];
}

module.exports = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, quarter } = req.body;
  if (password !== ACCESS_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
  if (!quarter) return res.status(400).json({ error: 'Quarter required (e.g. 2026-Q1)' });

  try {
    // Determine which weeks belong to this quarter
    const [year, q]    = quarter.split('-Q');
    const startWeek    = (parseInt(q) - 1) * 13 + 1;
    const endWeek      = startWeek + 12;

    // Fetch list of weekly reports
    const weeklyFiles  = await listFiles('client_contexts/kanazi/weekly');
    const qWeekFiles   = weeklyFiles
      .filter(f => {
        const m = f.name.match(/\d{4}-W(\d+)/);
        if (!m) return false;
        const w = parseInt(m[1]);
        return f.name.startsWith(year) && w >= startWeek && w <= endWeek;
      });

    if (!qWeekFiles.length)
      return res.status(404).json({ error: `No weekly reports found for ${quarter}` });

    // Fetch content of each weekly report
    const weeklyContents = await Promise.all(
      qWeekFiles.map(async f => {
        const content = await fetchFile(`client_contexts/kanazi/weekly/${f.name}`);
        return `### ${f.name.replace('.md','')}\n${content}`;
      })
    );

    // Fetch project context and accumulated intelligence
    const context     = await assembleContext();
    const model       = await detectModel(GEMINI_API_KEY);

    const prompt = `You are generating a QUARTERLY SYNTHESIS REPORT for the Kanazi Rural
Connectivity Project (${quarter}).

This is a formal donor-facing quarterly report compiled from ${qWeekFiles.length} weeks
of field intelligence. It should be comprehensive, evidence-based, and ready to
submit to funders without editing.

## PROJECT CONTEXT
${context}

## WEEKLY FIELD NOTES FOR ${quarter}
${weeklyContents.join('\n\n---\n\n')}

---

Generate a comprehensive quarterly synthesis report in markdown with these sections:

# Quarterly Report: Kanazi Rural Connectivity Project — ${quarter}

## Executive Summary
3-4 sentences capturing the quarter's key achievements, challenges, and trajectory.

## Progress Against Indicators
For each indicator in the M&E framework, report: target, progress this quarter,
cumulative progress, and trend (On Track / At Risk / Behind).

## Key Achievements
The 3-5 most significant accomplishments of the quarter with evidence.

## Community Engagement & Voice
What the community has said and done. Direct observations. Cultural insights.
The human texture of the work.

## Challenges & Risk Register
All risks identified this quarter, their status, and mitigation actions taken.

## Financial & Resource Notes
Any resource considerations mentioned in field notes.

## Lessons Learned
What this quarter taught the project — operational, community, technical.

## Outlook: Next Quarter
Key priorities and milestones for the coming quarter.

---

Tone: Formal, evidence-based, donor-ready. He/him for Eliya.
Return ONLY the markdown report. No JSON. No preamble.`;

    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 8192 }
        })
      }
    );

    if (!genRes.ok) {
      const e = await genRes.json().catch(() => ({}));
      throw new Error(`Gemini ${genRes.status}: ${e?.error?.message}`);
    }

    const raw       = await genRes.json();
    const synthesis = raw.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!synthesis) throw new Error('Empty response from Gemini');

    // Save to GitHub
    const date = new Date().toISOString().slice(0, 10);
    await writeFile(
      `client_contexts/kanazi/generated/${quarter}-synthesis.md`,
      synthesis,
      `${quarter} quarterly synthesis · generated ${date}`
    );

    return res.status(200).json({ success: true, synthesis, quarter, model });

  } catch (err) {
    console.error('Synthesis error:', err);
    return res.status(500).json({ error: err.message });
  }
};