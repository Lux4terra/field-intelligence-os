// api/generate.js
// Context viewer + single-file fetcher for Risk Tracker

const { assembleContext, fetchFile } = require('../lib/context');
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;

const FILE_MAP = {
  risks:           'client_contexts/kanazi/accumulated/risks.md',
  patterns:        'client_contexts/kanazi/accumulated/patterns.md',
  learnings:       'client_contexts/kanazi/accumulated/learnings.md',
  community_voice: 'client_contexts/kanazi/accumulated/community_voice.md',
};

module.exports = async function(req, res) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const { password, file } = req.body;
  if (password !== ACCESS_PASSWORD)
    return res.status(401).json({ error: 'Invalid password' });

  try {
    // If a specific file is requested (e.g. risks), return just that file
    if (file && FILE_MAP[file]) {
      const content = await fetchFile(FILE_MAP[file]);
      return res.status(200).json({
        context: content || '',
        file,
        tokenEstimate: Math.round((content || '').length / 4)
      });
    }

    // Otherwise return full assembled context for Context Depth tab
    const context = await assembleContext();
    return res.status(200).json({
      context,
      tokenEstimate: Math.round(context.length / 4)
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};