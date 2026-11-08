const assert = require('assert');
const Core = require('../core.js');

const REQS = [
  { text: '3+ years building backend services', weight: 'must' },
  { text: 'Python or Go in production', weight: 'must' },
  { text: 'AWS or GCP experience', weight: 'nice' }
];
const CV = 'Adaeze Okafor\nBackend engineer, 5 years of experience.\nBuilt payment APIs in Python on PostgreSQL.';

async function rejects(p, status, re) {
  try { await p; } catch (e) {
    assert.strictEqual(e.status, status, 'status ' + e.status + ' for ' + e.message);
    if (re) assert.ok(re.test(e.message), e.message);
    return;
  }
  assert.fail('expected a ' + status + ' error');
}

(async () => {
  console.log('Running core tests (jobs, privacy, storage adapters)...');
  let t = Date.parse('2026-11-08T10:00:00Z');
  const clock = () => t;
  const kv = Core.memoryKV(clock);
  const ops = Core.createCore(kv, { now: clock });

  /* ---- jobs ---- */
  await rejects(ops.jobCreate({ title: '', requirements: REQS }), 400);
  await rejects(ops.jobCreate({ title: 'X', requirements: [] }), 400);
  const made = await ops.jobCreate({ title: 'Founding Backend Engineer', company: 'Acme', jd: 'jd', requirements: REQS });
  const job = made.job, key = made.key;
  assert.ok(job.id.startsWith('j_') && job.id.length >= 18);
  assert.ok(key.length >= 32, 'private key is long');
  assert.strictEqual(job.keyHash, undefined, 'the key hash is never returned');
  assert.strictEqual(job.requirements.length, 3);
  assert.ok(job.requirements.every(r => r.id), 'every requirement gets a stable id');
  const stored = await kv.get('job:' + job.id);
  assert.notStrictEqual(stored.keyHash, key, 'the key itself is never stored');
  assert.strictEqual((await ops.jobGet({ id: job.id })).job.title, 'Founding Backend Engineer');
  await rejects(ops.jobGet({ id: 'j_nope' }), 404);

  /* ---- public job board ---- */
  assert.strictEqual(job.type, 'Full-time');
  assert.strictEqual(job.workMode, 'On-site');
  assert.strictEqual((await ops.jobsOpen({})).jobs.length, 1, 'open listed job is on the board');
  assert.strictEqual((await ops.jobsOpen({})).jobs[0].keyHash, undefined);
  const hidden = await ops.jobCreate({ title: 'Hidden', requirements: REQS, listed: false, type: 'nonsense', workMode: 'Remote', location: 'Lagos' });
  assert.strictEqual(hidden.job.type, 'Full-time', 'bad type falls back');
  assert.strictEqual(hidden.job.workMode, 'Remote');
  assert.strictEqual((await ops.jobsOpen({})).jobs.length, 1, 'unlisted jobs stay off the board');
  await ops.jobUpdate({ id: hidden.job.id, key: hidden.key, patch: { listed: true } });
  assert.strictEqual((await ops.jobsOpen({})).jobs.length, 2);
  await ops.jobUpdate({ id: hidden.job.id, key: hidden.key, patch: { status: 'closed' } });
  assert.strictEqual((await ops.jobsOpen({})).jobs.length, 1, 'closed jobs leave the board');

  /* ---- recruiter access control ---- */
  await rejects(ops.candidates({ jobId: job.id, key: 'wrong' }), 403);
  await rejects(ops.candidates({ jobId: job.id }), 403);
  await rejects(ops.jobUpdate({ id: job.id, key: 'wrong', patch: { title: 'Hacked' } }), 403);
  assert.strictEqual((await ops.jobUpdate({ id: job.id, key, patch: { title: 'Lead Backend Engineer' } })).job.title, 'Lead Backend Engineer');
  await rejects(ops.jobUpdate({ id: job.id, key, patch: { requirements: [] } }), 400);

  /* ---- applying ---- */
  await rejects(ops.apply({ jobId: 'j_nope', name: 'A', cv: CV }), 404);
  await rejects(ops.apply({ jobId: job.id, name: '', cv: CV }), 400);
  await rejects(ops.apply({ jobId: job.id, name: 'A', cv: 'short' }), 400);
  const a1 = await ops.apply({
    jobId: job.id, name: 'Adaeze Okafor', cv: CV, phone: '+2348031234567', email: 'a@example.com',
    consent: true, links: { linkedin: 'https://linkedin.com/in/ada', github: 'javascript:alert(1)' }
  });
  const a2 = await ops.apply({ jobId: job.id, name: 'Private Person', cv: CV, phone: '+2348000000000', email: 'p@example.com', consent: false });
  assert.ok(a1.token.startsWith('c_') && a1.token.length >= 34, 'unguessable token');
  assert.strictEqual(new Date(a1.expiresAt) - t, 30 * 24 * 3600 * 1000, '30-day expiry');
  const consentString = await ops.apply({ jobId: job.id, name: 'String Consent', cv: CV, phone: '1', consent: 'false' });
  const asRecruiter = (await ops.candidates({ jobId: job.id, key })).candidates;
  assert.strictEqual(asRecruiter.length, 3);
  const byName = n => asRecruiter.find(c => c.name === n);
  assert.strictEqual(byName('Adaeze Okafor').phone, '+2348031234567', 'consented contact is visible');
  assert.strictEqual(byName('Private Person').phone, '', 'phone hidden without consent');
  assert.strictEqual(byName('Private Person').email, '', 'email hidden without consent');
  assert.strictEqual(byName('String Consent').phone, '', 'only a real true counts as consent');
  assert.strictEqual(byName('Adaeze Okafor').links.github, '', 'non-http links are dropped');
  assert.strictEqual(byName('Adaeze Okafor').stage, 'new');

  /* ---- closing a job ---- */
  await ops.jobUpdate({ id: job.id, key, patch: { status: 'closed' } });
  await rejects(ops.apply({ jobId: job.id, name: 'Late', cv: CV }), 410);
  await ops.jobUpdate({ id: job.id, key, patch: { status: 'open' } });

  /* ---- stages, contact marks, screening ---- */
  const id1 = a1.token;
  await rejects(ops.candidatePatch({ jobId: job.id, key: 'wrong', candId: id1, patch: { stage: 'pass' } }), 403);
  await rejects(ops.candidatePatch({ jobId: job.id, key, candId: id1, patch: { stage: 'hired' } }), 400, /stage/i);
  let p = await ops.candidatePatch({ jobId: job.id, key, candId: id1, patch: { stage: 'shortlist', contactedAt: '2026-11-08T11:00:00Z' } });
  assert.strictEqual(p.candidate.stage, 'shortlist');
  assert.strictEqual(p.candidate.contactedAt, '2026-11-08T11:00:00Z');
  const screen = {
    reqSig: 'sig', usedAi: false, at: 'now', summary: '2 of 3',
    checks: [{ reqId: job.requirements[0].id, status: 'met', evidence: '5 years', note: '' }, { reqId: 'x', status: 'banana', evidence: '' }],
    questions: ['q1', 'q2', 'q3', 'q4', 'q5']
  };
  const saved = await ops.screensSave({ jobId: job.id, key, results: [{ candId: id1, screen }, { candId: 'c_missing', screen }] });
  assert.strictEqual(saved.saved, 1, 'unknown candidates are skipped');
  const after = (await ops.candidates({ jobId: job.id, key })).candidates.find(c => c.id === id1);
  assert.strictEqual(after.screen.checks[1].status, 'not_stated', 'bad status is normalised');
  assert.strictEqual(after.screen.questions.length, 4, 'questions are capped');
  assert.strictEqual(after.screen.now, null, 'now is optional');
  assert.strictEqual(after.stage, 'shortlist', 'screening does not change the stage');

  // A recruiter of another job cannot touch this job's candidates.
  const other = await ops.jobCreate({ title: 'Other', requirements: REQS });
  await rejects(ops.candidatePatch({ jobId: other.job.id, key: other.key, candId: id1, patch: { stage: 'pass' } }), 404);
  await rejects(ops.candidates({ jobId: job.id, key: other.key }), 403, /does not match/);

  /* ---- anonymous score distribution + profile ---- */
  await ops.screensSave({ jobId: job.id, key, results: [{ candId: id1, screen: Object.assign({}, screen, { now: 82.4 }) }] });
  const dist = await ops.jobScores({ id: job.id });
  assert.deepStrictEqual(dist, { scores: [82] }, 'only anonymous numbers are shared');
  const withProfile = await ops.apply({
    jobId: job.id, name: 'Profile Person', cv: CV, consent: false, phone: '1', email: 'x@y.com',
    profile: { name: 'Profile Person', email: 'x@y.com', phone: '+234800', skills: ['Python', 'SQL'], yearsExperience: '4', education: [{ school: 'FUTO', qualification: 'B.Eng' }], experience: [{ company: 'Acme', title: 'Engineer', highlights: ['Built things'] }], links: { linkedin: 'javascript:x' } }
  });
  const pr = (await ops.candidates({ jobId: job.id, key })).candidates.find(c => c.id === withProfile.token);
  assert.deepStrictEqual(pr.profile.skills, ['Python', 'SQL']);
  assert.strictEqual(pr.profile.yearsExperience, 4);
  assert.strictEqual(pr.profile.email, '', 'profile contact hidden without consent');
  assert.strictEqual(pr.profile.links.linkedin, '');
  assert.strictEqual(pr.profile.experience[0].highlights[0], 'Built things');
  await ops.candidateDelete({ token: withProfile.token });

  /* ---- candidate view and interview ---- */
  const mine = await ops.candidateGet({ token: id1 });
  assert.strictEqual(mine.candidate.stage, undefined, 'candidates never see recruiter stage');
  assert.strictEqual(mine.candidate.screen, undefined, 'candidates never see screening');
  assert.strictEqual(mine.job.title, 'Lead Backend Engineer');
  assert.strictEqual(mine.job.keyHash, undefined);
  await rejects(ops.candidateGet({ token: 'c_nope' }), 404);
  await ops.interviewSave({
    token: id1, summary: 'Strong on APIs.', confidence: 'weird', confirmedReqs: ['Python'], openReqs: ['AWS'],
    followUpQuestions: ['a', 'b', 'c', 'd'], transcript: [{ role: 'ai', text: 'Q' }, { role: 'candidate', text: 'A' }]
  });
  const withInt = (await ops.candidates({ jobId: job.id, key })).candidates.find(c => c.id === id1);
  assert.strictEqual(withInt.interview.confidence, 'medium', 'bad confidence is normalised');
  assert.strictEqual(withInt.interview.transcript, undefined, 'recruiters never get the transcript');
  assert.strictEqual(withInt.interview.followUpQuestions.length, 3);
  assert.strictEqual((await ops.candidateGet({ token: id1 })).candidate.interview.transcript.length, 2, 'candidate keeps their transcript');

  /* ---- manual candidates, removal, erasure ---- */
  const man = await ops.candidateAdd({ jobId: job.id, key, name: 'Pasted Person', cv: CV });
  assert.strictEqual(man.candidate.source, 'manual');
  await rejects(ops.candidateAdd({ jobId: job.id, key: 'wrong', name: 'x', cv: CV }), 403);
  await ops.candidateRemove({ jobId: job.id, key, candId: man.candidate.id });
  assert.strictEqual((await ops.candidates({ jobId: job.id, key })).candidates.length, 3);

  assert.deepStrictEqual(await ops.candidateDelete({ token: a2.token }), { deleted: true });
  await rejects(ops.candidateGet({ token: a2.token }), 404);
  assert.strictEqual((await ops.candidates({ jobId: job.id, key })).candidates.length, 2, 'erased candidate is gone from the recruiter list');

  /* ---- expiry ---- */
  t += 31 * 24 * 3600 * 1000;
  await rejects(ops.candidateGet({ token: id1 }), 404);
  assert.strictEqual((await ops.candidates({ jobId: job.id, key })).candidates.length, 0, 'expired candidates vanish');
  assert.ok((await ops.jobGet({ id: job.id })).job, 'the job outlives candidate records');

  /* ---- local browser storage adapter ---- */
  const bag = {};
  const fakeStorage = {
    getItem: k => (k in bag ? bag[k] : null),
    setItem: (k, v) => { bag[k] = String(v); },
    removeItem: k => { delete bag[k]; }
  };
  const lk = Core.localKV(fakeStorage, 'scout2:', clock);
  assert.strictEqual(lk.kind, 'local');
  const lops = Core.createCore(lk, { now: clock });
  const lj = await lops.jobCreate({ title: 'Local role', requirements: REQS });
  const lc = await lops.apply({ jobId: lj.job.id, name: 'Local Person', cv: CV, consent: true, phone: '+2348031234567' });
  assert.strictEqual((await lops.candidates({ jobId: lj.job.id, key: lj.key })).candidates[0].name, 'Local Person');
  assert.ok(Object.keys(bag).some(k => k.startsWith('scout2:d:job:')), 'data really lands in storage');
  const lops2 = Core.createCore(Core.localKV(fakeStorage, 'scout2:', clock), { now: clock });
  assert.strictEqual((await lops2.candidateGet({ token: lc.token })).candidate.name, 'Local Person', 'survives a reload');

  const blocked = Core.localKV({ setItem() { throw new Error('blocked'); }, getItem() { return null; }, removeItem() {} }, 'x:', clock);
  assert.strictEqual(blocked.kind, 'memory-fallback', 'blocked storage falls back to memory');

  /* ---- Redis (Upstash) command shapes ---- */
  const sent = [];
  const fakeRedis = async (url, init) => {
    assert.strictEqual(url, 'https://example.upstash.io');
    assert.strictEqual(init.headers.Authorization, 'Bearer tok');
    const cmd = JSON.parse(init.body);
    sent.push(cmd);
    return { ok: true, json: async () => ({ result: cmd[0] === 'GET' ? JSON.stringify({ hello: 1 }) : cmd[0] === 'SMEMBERS' ? ['a', 'b'] : 'OK' }) };
  };
  const rk = Core.upstashKV('https://example.upstash.io', 'tok', fakeRedis);
  await rk.set('k', { a: 1 }, 30 * 24 * 3600 * 1000);
  assert.deepStrictEqual(sent[0], ['SET', 'k', '{"a":1}', 'EX', '2592000']);
  assert.deepStrictEqual(await rk.get('k'), { hello: 1 });
  assert.deepStrictEqual(await rk.smembers('s'), ['a', 'b']);
  await rk.sadd('s', 'm');
  assert.deepStrictEqual(sent.slice(-2).map(c => c[0]), ['SADD', 'EXPIRE']);
  const failing = Core.upstashKV('https://example.upstash.io', 'tok', async () => ({ ok: false, json: async () => ({ error: 'nope' }) }));
  await assert.rejects(failing.get('k'), /Store error/);

  console.log('All core tests passed successfully!');
})().catch((e) => { console.error(e); process.exit(1); });
