// lib/context.js
// Pulls the full context document from GitHub
// Assembles core/ + accumulated/ into one markdown string
// This is the standing brief that enriches every generation

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO;

async function fetchFile(path) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3.raw'
    }
  });
  if (!res.ok) return ''; // file may not exist yet — that's fine
  return await res.text();
}

async function assembleContext() {
  // Core files — the permanent standing brief
  const corePaths = [
    'client_contexts/kanazi/core/project_brief.md',
    'client_contexts/kanazi/core/stakeholders.md',
    'client_contexts/kanazi/core/indicators.md'
  ];

  // Accumulated files — grow with every cycle
  const accPaths = [
    'client_contexts/kanazi/accumulated/patterns.md',
    'client_contexts/kanazi/accumulated/learnings.md',
    'client_contexts/kanazi/accumulated/risks.md',
    'client_contexts/kanazi/accumulated/community_voice.md'
  ];

  const allPaths = [...corePaths, ...accPaths];

  const parts = await Promise.all(
    allPaths.map(async p => {
      const content = await fetchFile(p);
      if (!content) return '';
      const label = p.split('/').pop().replace('.md', '').replace('_', ' ');
      return `## CONTEXT: ${label.toUpperCase()}\n\n${content}`;
    })
  );

  return parts.filter(Boolean).join('\n\n---\n\n');
}

module.exports = { assembleContext, fetchFile };