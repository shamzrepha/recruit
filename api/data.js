/*
 * /api/data   Candidate and Recruiter data storage with Firebase / Local Fallback.
 *
 * Supported Actions:
 *   POST ?action=apply           Saves candidate application with unguessable token
 *   GET  ?action=get_candidate   Candidate retrieves own data by unguessable token
 *   POST ?action=save_interview  Saves candidate AI interview transcript & summary
 *   POST ?action=delete          Candidate deletes all their data immediately
 *   GET  ?action=list_candidates Recruiter lists candidates (strips contact if consent=false)
 *
 * Compliance: Nigeria Data Protection Act 2023 (NDPA)
 *   - Explicit Consent
 *   - Purpose Limitation
 *   - Data Minimisation
 *   - 30-Day Retention & Right to Erasure
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

function getLocalStore() {
  try {
    if (!fs.existsSync(path.dirname(STORE_PATH))) {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('Local store read warning:', e.message);
  }
  return { candidates: [] };
}

function saveLocalStore(data) {
  try {
    if (!fs.existsSync(path.dirname(STORE_PATH))) {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('Local store write warning:', e.message);
  }
}

function cleanExpired(candidates) {
  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  return candidates.filter(c => {
    const created = new Date(c.createdAt || now).getTime();
    return now - created < THIRTY_DAYS_MS;
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const action = req.query && req.query.action;

  // 1. Candidate Application Submission
  if (req.method === 'POST' && action === 'apply') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
    if (!body || !body.name || !body.cv) {
      return res.status(400).json({ error: 'Name and CV are required.' });
    }

    // Generate unguessable link with 24+ random characters
    const token = 'c_' + crypto.randomBytes(16).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const record = {
      id: token,
      token,
      name: String(body.name).slice(0, 80),
      role: String(body.role || 'Software Engineer').slice(0, 100),
      phone: String(body.phone || '').slice(0, 30),
      email: String(body.email || '').slice(0, 80),
      location: String(body.location || '').slice(0, 80),
      links: body.links || {},
      cv: String(body.cv).slice(0, 12000),
      consent: Boolean(body.consent),
      createdAt: now.toISOString(),
      expiresAt,
      interviewSummary: null,
      interviewTranscript: null
    };

    const store = getLocalStore();
    store.candidates = cleanExpired(store.candidates);
    store.candidates.push(record);
    saveLocalStore(store);

    return res.status(200).json({ ok: true, id: token, expiresAt });
  }

  // 2. Candidate Retrieves Own Data
  if (req.method === 'GET' && action === 'get_candidate') {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: 'Token is required.' });

    const store = getLocalStore();
    const cand = store.candidates.find(c => c.token === token || c.id === token);
    if (!cand) return res.status(404).json({ error: 'Application not found or expired.' });

    return res.status(200).json({ candidate: cand });
  }

  // 3. Save Interview Results
  if (req.method === 'POST' && action === 'save_interview') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
    const token = body && body.token;
    if (!token) return res.status(400).json({ error: 'Candidate token is required.' });

    const store = getLocalStore();
    const cand = store.candidates.find(c => c.token === token || c.id === token);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });

    cand.interviewSummary = body.summary || null;
    cand.interviewTranscript = body.transcript || null;
    cand.interviewConfidence = body.confidence || 'medium';
    saveLocalStore(store);

    return res.status(200).json({ ok: true });
  }

  // 4. Candidate Right to Erasure / Immediate Delete
  if (req.method === 'POST' && action === 'delete') {
    const id = req.query.id || (req.body && req.body.id);
    if (!id) return res.status(400).json({ error: 'Candidate ID is required.' });

    const store = getLocalStore();
    const initialLen = store.candidates.length;
    store.candidates = store.candidates.filter(c => c.id !== id && c.token !== id);
    saveLocalStore(store);

    return res.status(200).json({ ok: true, deleted: store.candidates.length < initialLen });
  }

  // 5. Recruiter Lists Candidates (with NDPA privacy enforcement)
  if (req.method === 'GET' && action === 'list_candidates') {
    const store = getLocalStore();
    const active = cleanExpired(store.candidates);

    // Apply data protection rule:
    // If candidate did NOT consent, strip phone and email from recruiter view!
    const sanitized = active.map(c => {
      const copy = { ...c };
      if (!copy.consent) {
        copy.phone = '';
        copy.email = '';
      }
      return copy;
    });

    return res.status(200).json({ candidates: sanitized });
  }

  return res.status(400).json({ error: 'Invalid action.' });
};
