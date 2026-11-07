const assert = require('assert');
const parseCvHandler = require('../api/parse-cv.js');
const dataHandler = require('../api/data.js');

function fakeRes() {
  return {
    code: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

(async () => {
  console.log('Running Career Roadmap, CV Parser & Job Board tests...');

  // 1. Parse CV fallback without key
  delete process.env.GROQ_API_KEY;
  let res = fakeRes();
  await parseCvHandler({
    method: 'POST',
    body: {
      cv: 'Adaeze Okafor\nLead Payments Engineer\nLagos, Nigeria\n5 years Python and PostgreSQL experience building payment gateways.\nUniversity of Lagos, B.Sc. Computer Science.'
    }
  }, res);

  assert.strictEqual(res.code, 200);
  assert.ok(res.body.profile, 'Returns parsed profile');
  assert.ok(res.body.profile.education.length > 0, 'Includes education array');
  assert.ok(res.body.profile.roadmap.length > 0, 'Includes career roadmap array');
  assert.ok(res.body.profile.skills, 'Includes skills taxonomy');

  // 2. Parse CV with Mocked Groq
  process.env.GROQ_API_KEY = 'gsk_mock';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            name: 'Adaeze Okafor',
            headline: 'Lead Payments Engineer',
            location: 'Lagos, Nigeria',
            phone: '+2348031234567',
            email: 'adaeze@example.com',
            links: { linkedin: 'https://linkedin.com/in/adaeze', github: 'https://github.com/adaeze' },
            summary: 'Senior Backend Engineer specialized in payment processing systems.',
            education: [{ school: 'University of Lagos', degree: 'B.Sc.', field: 'Computer Science', year: '2019', details: 'First Class' }],
            roadmap: [{ company: 'PaySprint', role: 'Lead Backend Engineer', duration: '2021-Present', scale: '2M req/day', highlights: ['Built payments API'] }],
            skills: { languages: ['Python', 'SQL'], frameworks: ['FastAPI'], databases: ['PostgreSQL'], cloud: ['AWS'], tools: ['Docker'] },
            projects: [{ title: 'Payment Gateway', description: 'Handled transactions', tech: 'Python', link: '' }],
            suggestedRoles: ['Founding Backend Engineer'],
            recommendations: ['Add more scale metrics']
          })
        }
      }]
    })
  });

  res = fakeRes();
  await parseCvHandler({
    method: 'POST',
    body: { cv: 'Adaeze Okafor\nLead Payments Engineer...' }
  }, res);

  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.profile.name, 'Adaeze Okafor');
  assert.strictEqual(res.body.profile.education[0].school, 'University of Lagos');
  assert.strictEqual(res.body.profile.roadmap[0].company, 'PaySprint');

  // 3. List Jobs & Post Job
  res = fakeRes();
  await dataHandler({ method: 'GET', query: { action: 'list_jobs' } }, res);
  assert.strictEqual(res.code, 200);
  assert.ok(Array.isArray(res.body.jobs), 'Returns jobs array');
  assert.ok(res.body.jobs.length >= 3, 'Pre-seeded with active startup openings');

  // Post new job
  res = fakeRes();
  await dataHandler({
    method: 'POST',
    query: { action: 'post_job' },
    body: {
      title: 'Senior AI Engineer',
      company: 'SprintAI',
      location: 'Remote',
      description: 'Building LLM orchestration platforms',
      mustHaves: ['Python and PyTorch', 'LangChain or LlamaIndex'],
      niceToHaves: ['Groq LPU experience']
    }
  }, res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.job.title, 'Senior AI Engineer');

  // 4. Role Match Diagnostics & Percentile Ranking (Top 5%)
  res = fakeRes();
  await dataHandler({
    method: 'POST',
    query: { action: 'match_role' },
    body: {
      cv: 'Senior Backend Engineer with 5 years experience in Python, FastAPI, Go, PostgreSQL database optimization, and AWS cloud deployment. Shipped customer facing payments APIs.',
      jobId: 'job_backend_lagos'
    }
  }, res);

  assert.strictEqual(res.code, 200);
  assert.ok(res.body.score >= 70, 'Calculates strong match score');
  assert.ok(res.body.percentile.includes('%'), 'Calculates percentile ranking');
  assert.ok(res.body.passedRequirements.length > 0, 'Lists passed requirements');
  assert.ok(Array.isArray(res.body.recommendations), 'Provides actionable AI recommendations');

  console.log('All Career Roadmap, CV Parser & Job Board tests passed successfully!');
})().catch(e => {
  console.error('Roadmap Test Error:', e);
  process.exit(1);
});
