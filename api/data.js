/*
 * /api/data   Candidate, Job Postings, and Recruiter data storage with NDPA 2023 compliance.
 *
 * Supported Actions:
 *   POST ?action=apply           Saves candidate application with unguessable token and Career Roadmap
 *   GET  ?action=get_candidate   Candidate retrieves own data by unguessable token
 *   POST ?action=save_interview  Saves candidate AI interview transcript & summary
 *   POST ?action=delete          Candidate deletes all their data immediately (NDPA Right to Erasure)
 *   GET  ?action=list_candidates Recruiter lists candidates (strips contact if consent=false)
 *   GET  ?action=list_jobs       Lists active recruiter job openings (Devpost-style)
 *   POST ?action=post_job        Recruiter publishes a new job opening
 *   POST ?action=match_role      Calculates match diagnostics, ranking percentile (Top 5%), & recommendations
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

const DEFAULT_JOBS = [
  {
    id: 'job_backend_lagos',
    title: 'Founding Backend Engineer (Python / Go)',
    company: 'Fintech Velocity (Seed)',
    location: 'Lagos, Nigeria (Hybrid / Remote)',
    type: 'Full-time',
    description: 'We are building next-generation payment infrastructure for African merchants. Looking for a founding engineer to design high-throughput APIs and transaction ledgers.',
    mustHaves: [
      '3+ years building production backend services',
      'Python (FastAPI/Django) or Go in production',
      'PostgreSQL database design and query optimization',
      'Shipped an API used by external customers'
    ],
    niceToHaves: [
      'Prior early-stage startup experience',
      'AWS (ECS, RDS) or GCP infrastructure',
      'Redis caching and message queues'
    ],
    createdAt: new Date().toISOString()
  },
  {
    id: 'job_fullstack_health',
    title: 'Full-Stack Product Engineer (React / Node)',
    company: 'Afrigood Health (Series A)',
    location: 'Remote (Africa / GMT±2)',
    type: 'Full-time',
    description: 'Connecting patients to verified clinics and pharmacy deliveries across West Africa. You will own patient-facing dashboards and clinician workflows.',
    mustHaves: [
      '3+ years building web applications with React or TypeScript',
      'Node.js or Python backend APIs',
      'Relational database modeling (PostgreSQL or MySQL)'
    ],
    niceToHaves: [
      'Tailwind CSS and responsive mobile-first UI design',
      'Healthcare or compliance experience',
      'GraphQL or tRPC knowledge'
    ],
    createdAt: new Date().toISOString()
  },
  {
    id: 'job_mobile_logistics',
    title: 'Mobile Engineer (Flutter / React Native)',
    company: 'SprintLogistics (Seed)',
    location: 'Lagos / Abuja, Nigeria',
    type: 'Full-time',
    description: 'Building driver, warehouse dispatch, and tracking applications optimized for low-bandwidth cellular environments.',
    mustHaves: [
      '2+ years in mobile development with Flutter or React Native',
      'Offline-first synchronization and SQLite or Realm caching',
      'Shipped at least one app to Google Play Store or App Store'
    ],
    niceToHaves: [
      'Native Android (Kotlin) bridge knowledge',
      'Background geolocation and live telemetry'
    ],
    createdAt: new Date().toISOString()
  },
  {
    id: 'job_devops_infra',
    title: 'DevOps & Cloud Infrastructure Lead',
    company: 'Apex Cloud Systems',
    location: 'Remote (Worldwide)',
    type: 'Full-time',
    description: 'Lead automated cloud provisioning, CI/CD pipelines, Kubernetes cluster health, and multi-region disaster recovery.',
    mustHaves: [
      '3+ years managing production cloud infrastructure (AWS or GCP)',
      'Docker containerization and Kubernetes orchestration',
      'Infrastructure as Code (Terraform or Pulumi)'
    ],
    niceToHaves: [
      'SOC2 / ISO 27001 compliance hardening',
      'Prometheus, Grafana, and OpenTelemetry monitoring'
    ],
    createdAt: new Date().toISOString()
  }
];

function getLocalStore() {
  try {
    if (!fs.existsSync(path.dirname(STORE_PATH))) {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (!parsed.jobs || !parsed.jobs.length) parsed.jobs = DEFAULT_JOBS;
      if (!parsed.candidates) parsed.candidates = [];
      return parsed;
    }
  } catch (e) {
    console.warn('Local store read warning:', e.message);
  }
  return { candidates: [], jobs: DEFAULT_JOBS };
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
  return (candidates || []).filter(c => {
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
  const store = getLocalStore();

  // 1. Candidate Application Submission (with Career Roadmap Profile)
  if (req.method === 'POST' && action === 'apply') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
    if (!body || !body.name || !body.cv) {
      return res.status(400).json({ error: 'Name and CV are required.' });
    }

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
      cv: String(body.cv).slice(0, 15000),
      consent: Boolean(body.consent),
      roadmapProfile: body.roadmapProfile || null,
      rankingPercentile: body.rankingPercentile || 'Top 10%',
      targetJobId: body.targetJobId || null,
      createdAt: now.toISOString(),
      expiresAt,
      interviewSummary: null,
      interviewTranscript: null
    };

    store.candidates = cleanExpired(store.candidates);
    store.candidates.push(record);
    saveLocalStore(store);

    return res.status(200).json({ ok: true, id: token, expiresAt, candidate: record });
  }

  // 2. Candidate Retrieves Own Data
  if (req.method === 'GET' && action === 'get_candidate') {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: 'Token is required.' });

    const cand = store.candidates.find(c => c.token === token || c.id === token);
    if (!cand) return res.status(404).json({ error: 'Application not found or expired.' });

    return res.status(200).json({ candidate: cand });
  }

  // 3. Save Interview Results
  if (req.method === 'POST' && action === 'save_interview') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
    const token = body && body.token;
    if (!token) return res.status(400).json({ error: 'Candidate token is required.' });

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

    const initialLen = store.candidates.length;
    store.candidates = store.candidates.filter(c => c.id !== id && c.token !== id);
    saveLocalStore(store);

    return res.status(200).json({ ok: true, deleted: store.candidates.length < initialLen });
  }

  // 5. Recruiter Lists Candidates (with NDPA privacy enforcement)
  if (req.method === 'GET' && action === 'list_candidates') {
    const active = cleanExpired(store.candidates);

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

  // 6. List Active Job Openings (Devpost style)
  if (req.method === 'GET' && action === 'list_jobs') {
    return res.status(200).json({ jobs: store.jobs || DEFAULT_JOBS });
  }

  // 7. Recruiter Posts a New Job Opening
  if (req.method === 'POST' && action === 'post_job') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
    if (!body || !body.title) {
      return res.status(400).json({ error: 'Job title is required.' });
    }

    const newJob = {
      id: 'job_' + crypto.randomBytes(6).toString('hex'),
      title: String(body.title).slice(0, 100),
      company: String(body.company || 'Our Startup').slice(0, 80),
      location: String(body.location || 'Remote').slice(0, 80),
      type: String(body.type || 'Full-time').slice(0, 40),
      description: String(body.description || '').slice(0, 2000),
      mustHaves: Array.isArray(body.mustHaves) ? body.mustHaves.slice(0, 15) : ['3+ years in software engineering'],
      niceToHaves: Array.isArray(body.niceToHaves) ? body.niceToHaves.slice(0, 10) : ['Startup experience'],
      createdAt: new Date().toISOString()
    };

    if (!store.jobs) store.jobs = DEFAULT_JOBS.slice();
    store.jobs.unshift(newJob);
    saveLocalStore(store);

    return res.status(200).json({ ok: true, job: newJob });
  }

  // 8. Match Diagnostics & Percentile Ranking for Candidate
  if (req.method === 'POST' && action === 'match_role') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
    const cvText = String(body && body.cv || '').toLowerCase();
    const targetJobId = body && body.jobId;
    const jobs = store.jobs || DEFAULT_JOBS;

    // Evaluate against all jobs to find ranking and best fits
    const evaluations = jobs.map(j => {
      const allReqs = [
        ...j.mustHaves.map(t => ({ text: t, weight: 3 })),
        ...j.niceToHaves.map(t => ({ text: t, weight: 1 }))
      ];

      let earned = 0, total = 0;
      const passed = [];
      const missing = [];

      allReqs.forEach(r => {
        total += r.weight;
        // Simple intelligent keyword coverage
        const keywords = r.text.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['with', 'years', 'using', 'from', 'have', 'experience', 'building', 'production'].includes(w));
        const matched = keywords.some(k => cvText.includes(k));

        if (matched) {
          earned += r.weight;
          passed.push(r.text);
        } else {
          missing.push(r.text);
        }
      });

      const score = Math.round((earned / (total || 1)) * 100);
      return {
        jobId: j.id,
        title: j.title,
        company: j.company,
        score,
        passed,
        missing
      };
    }).sort((a, b) => b.score - a.score);

    // Selected job or top match
    const primary = targetJobId
      ? (evaluations.find(e => e.jobId === targetJobId) || evaluations[0])
      : evaluations[0];

    // Compute percentile ranking
    let percentile = 'Top 5%';
    if (primary.score >= 85) percentile = 'Top 5%';
    else if (primary.score >= 70) percentile = 'Top 10%';
    else if (primary.score >= 50) percentile = 'Top 25%';
    else percentile = 'Top 40%';

    const recommendations = [];
    if (primary.missing.length > 0) {
      recommendations.push(`Add direct proof of: ${primary.missing.slice(0, 2).join(', ')}.`);
    }
    recommendations.push('Include metrics (e.g. daily throughput, database size, latency improvements) in your project summaries.');
    recommendations.push('Verify your profile with our 5-minute AI interview to boost your verified score for recruiters.');

    return res.status(200).json({
      ok: true,
      job: primary,
      score: primary.score,
      percentile,
      passedRequirements: primary.passed,
      missingRequirements: primary.missing,
      recommendations,
      allMatches: evaluations
    });
  }

  return res.status(400).json({ error: 'Invalid action.' });
};
