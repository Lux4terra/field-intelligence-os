// lib/commit.js
// Saves files back to GitHub
// Every call here makes the context layer richer
// This is how the compounding happens automatically

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO;

async function getFileSHA(path) {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
  );
  if (!res.ok) return null; // new file — no SHA needed
  const data = await res.json();
  return data.sha;
}

async function writeFile(path, content, message) {
  const sha = await getFileSHA(path);
  const encoded = Buffer.from(content, 'utf8').toString('base64');

  const body = { message, content: encoded };
  if (sha) body.sha = sha; // required for updates, omit for new files

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub write failed for ${path}: ${err.message}`);
  }
  return await res.json();
}

async function commitWeeklyCycle(weekLabel, rawNotes, report, contextUpdates) {
  const date = new Date().toISOString().slice(0, 10);
  const commitMsg = `${weekLabel} · auto-update · ${date}`;

  // Files to write this cycle
  const writes = [
    {
      path: `client_contexts/kanazi/weekly/${weekLabel}.md`,
      content: `# Raw Field Notes — ${weekLabel}\n\n${rawNotes}`
    },
    {
      path: `client_contexts/kanazi/generated/${weekLabel}-report.md`,
      content: report
    }
  ];

  // Add context updates if they exist
  const accBase = 'client_contexts/kanazi/accumulated';
  if (contextUpdates.patterns)
    writes.push({ path: `${accBase}/patterns.md`,        content: contextUpdates.patterns });
  if (contextUpdates.learnings)
    writes.push({ path: `${accBase}/learnings.md`,       content: contextUpdates.learnings });
  if (contextUpdates.risks)
    writes.push({ path: `${accBase}/risks.md`,           content: contextUpdates.risks });
  if (contextUpdates.community_voice)
    writes.push({ path: `${accBase}/community_voice.md`, content: contextUpdates.community_voice });

  // Write all files sequentially (GitHub API rate limits parallel writes)
  for (const f of writes) {
    await writeFile(f.path, f.content, commitMsg);
  }

  return { written: writes.length, weekLabel };
}

module.exports = { commitWeeklyCycle, writeFile };