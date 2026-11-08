/*
 * /api/data   Jobs, applicants and privacy rules (see core.js).
 *
 *   GET  /api/data?action=status   { persistent, store }
 *   POST /api/data?action=<op>     body = the op's arguments (JSON)
 *
 * Storage:
 *   - If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set
 *     (or KV_REST_API_URL and KV_REST_API_TOKEN, which Vercel's Upstash
 *     integration sets), data is saved in Redis and shared across devices.
 *   - Otherwise there is no durable server storage on Vercel, so this reports
 *     persistent:false and the pages keep data in the user's own browser.
 *
 * Recruiter operations need the job's private key. Candidate operations need
 * the candidate's unguessable token. Contact details are stripped unless the
 * candidate agreed. Candidate records expire after 30 days.
 */

const core = require('../core.js');

let memory = null;

function getStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    return { kv: core.upstashKV(url, token), persistent: true, store: 'redis' };
  }
  if (!memory) memory = core.memoryKV();
  // SCOUT_STORE=memory-persistent is for tests and local demos only.
  return { kv: memory, persistent: process.env.SCOUT_STORE === 'memory-persistent', store: 'memory' };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const action = req.query && req.query.action;
  const s = getStore();

  if (req.method === 'GET' && action === 'status') {
    return res.status(200).json({ persistent: s.persistent, store: s.store });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (core.OPS.indexOf(action) < 0) return res.status(400).json({ error: 'Unknown action.' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid JSON request body.' });

  try {
    const ops = core.createCore(s.kv);
    const result = await ops[action](body);
    return res.status(200).json(result);
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error('data api failed:', err && err.message);
    return res.status(500).json({ error: 'Something went wrong saving or loading data. Try again.' });
  }
};
