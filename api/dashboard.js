// api/dashboard.js
// Returns list of all generated reports from GitHub
// Powers the archive view in the dashboard

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;

module.exports = async function(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password, weekLabel } = req.body;
  if (password !== ACCESS_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  try {
    // If a specific week is requested, return that report
    if (weekLabel) {
      const path = `client_contexts/kanazi/generated/${weekLabel}-report.md`;
      const res2 = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
        {
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3.raw'
          }
        }
      );
      if (!res2.ok) return res.status(404).json({ error: 'Report not found' });
      const content = await res2.text();
      return res.status(200).json({ report: content, weekLabel });
    }

    // Otherwise return list of all generated reports
    const listRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/client_contexts/kanazi/generated`,
      { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
    );

    if (!listRes.ok) {
      return res.status(200).json({ reports: [] }); // no reports yet
    }

    const files = await listRes.json();
    const reports = files
      .filter(f => f.name.endsWith('-report.md'))
      .map(f => ({
        weekLabel: f.name.replace('-report.md', ''),
        filename:  f.name,
        url:       f.html_url
      }))
      .reverse(); // most recent first

    return res.status(200).json({ reports });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};