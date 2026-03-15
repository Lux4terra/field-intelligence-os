// api/generate.js
// Utility endpoint — returns the current assembled context
// Useful for debugging: "what does the AI actually see right now?"

const { assembleContext } = require('../lib/context');
const ACCESS_PASSWORD  = process.env.ACCESS_PASSWORD;

module.exports = async function(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body;
  if (password !== ACCESS_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  try {
    const context = await assembleContext();
    const tokenEstimate = Math.round(context.length / 4);
    return res.status(200).json({ context, tokenEstimate });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};