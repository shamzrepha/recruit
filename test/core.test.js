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

/* ---------------- short links and accounts ---------------- */
(async () => {
  const core = require('../core.js');
  const kv = core.memoryKV();
  const c = core.createCore(kv);
  const made = await c.jobCreate({ title: 'Support Agent', requirements: [{ text: '2+ years support experience', weight: 'must' }] });
  assert.ok(/^[A-HJKMNP-Z2-9]{6,7}$/.test(made.job.code), 'short code: ' + made.job.code);
  assert.strictEqual((await c.jobByCode({ code: made.job.code.toLowerCase() })).job.id, made.job.id, 'code lookup is case-insensitive');
  await assert.rejects(() => c.jobByCode({ code: 'ZZZZZZ' }), /not found/);
  await assert.rejects(() => c.jobByCode({ code: '../x' }), /not valid/);
  const codes = new Set();
  for (let i = 0; i < 30; i++) codes.add((await c.jobCreate({ title: 'T' + i, requirements: [{ text: 'x', weight: 'must' }] })).job.code);
  assert.strictEqual(codes.size, 30, 'codes are unique');

  // accounts
  await assert.rejects(() => c.accountSignup({ email: 'bad', password: 'password123', name: 'A' }), /valid email/);
  await assert.rejects(() => c.accountSignup({ email: 'a@b.co', password: 'short', name: 'A' }), /8 characters/);
  const su = await c.accountSignup({ email: 'Ada@Example.com', password: 'correct-horse', name: 'Ada' });
  assert.ok(/^s_[0-9a-f]{32}$/.test(su.session));
  assert.ok(!JSON.stringify(su).includes('hash') && !JSON.stringify(su).includes('salt'), 'no secrets returned');
  await assert.rejects(() => c.accountSignup({ email: 'ada@example.com', password: 'correct-horse', name: 'Ada' }), /already exists/);
  await assert.rejects(() => c.accountLogin({ email: 'ada@example.com', password: 'wrong-password' }), /wrong/);
  const li = await c.accountLogin({ email: 'ADA@example.com', password: 'correct-horse' });
  await assert.rejects(() => c.accountMe({ session: 's_' + '0'.repeat(32) }), /expired|sign in/i);
  await assert.rejects(() => c.accountMe({ session: 'junk' }), /sign in/i);

  // apply with a session attaches the application; status follows the recruiter's stage
  const ap = await c.apply({ jobId: made.job.id, name: 'Ada', cv: 'Customer support agent with 3 years of experience helping customers.', session: li.session });
  let m = await c.accountMe({ session: li.session });
  assert.strictEqual(m.apps.length, 1);
  assert.strictEqual(m.apps[0].statusLabel, 'Received');
  assert.ok(!('screen' in m.apps[0]) && !('notes' in m.apps[0]), 'candidates never see recruiter screening');
  await c.candidatePatch({ jobId: made.job.id, key: made.key, candId: ap.token, patch: { stage: 'shortlist' } });
  m = await c.accountMe({ session: li.session });
  assert.strictEqual(m.apps[0].statusLabel, 'Shortlisted');

  // employer jobs sync: only keys that match are accepted
  await c.accountSyncJobs({ session: li.session, jobs: [{ id: made.job.id, key: made.key }, { id: made.job.id, key: 'wrong' }] });
  m = await c.accountMe({ session: li.session });
  assert.strictEqual(m.jobs.length, 1);
  assert.strictEqual(m.jobs[0].key, made.key);
  await c.accountSyncJobs({ session: li.session, jobs: [{ id: made.job.id, key: 'nope' }] });

  // save profile
  await c.accountSave({ session: li.session, profile: { name: 'Ada', skills: ['Support'] }, cvText: 'my cv', prefs: { want: 'support', location: 'Abuja' } });
  m = await c.accountMe({ session: li.session });
  assert.strictEqual(m.account.profile.skills[0], 'Support');
  assert.strictEqual(m.account.prefs.want, 'support');

  // withdrawn applications disappear from the account
  await c.candidateDelete({ token: ap.token });
  m = await c.accountMe({ session: li.session });
  assert.strictEqual(m.apps.length, 0);

  // lock-out after repeated wrong passwords
  for (let i = 0; i < 8; i++) await c.accountLogin({ email: 'ada@example.com', password: 'bad' + i }).catch(() => {});
  await assert.rejects(() => c.accountLogin({ email: 'ada@example.com', password: 'correct-horse' }), /Too many/);

  // sign-out and delete
  await c.accountLogout({ session: su.session });
  await assert.rejects(() => c.accountMe({ session: su.session }), /expired|sign in/i);
  await assert.rejects(() => c.accountDelete({ session: li.session, password: 'nope' }), /not right/);
  console.log('Short link and account tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });

/* ---------------- reset password, Google sign-in, email alerts ---------------- */
(async () => {
  const core = require('../core.js');
  const { mailer, googleVerifier } = require('../lib/mail.js');
  const kv = core.memoryKV();
  const sent = [];
  const google = { 'tok-ok': { email: 'Squat@Example.com', verified: true, name: 'Real Owner' }, 'tok-unverified': { email: 'x@example.com', verified: false, name: 'X' } };
  const c = core.createCore(kv, {
    origin: 'https://scout.test',
    sendMail: async (m) => { sent.push(m); },
    verifyGoogle: async (t) => google[t] || null
  });

  // reset flow: same answer for unknown emails, no email sent for them
  let r = await c.accountForgot({ email: 'nobody@example.com' });
  assert.strictEqual(r.sent, true);
  assert.strictEqual(sent.length, 0, 'no email for unknown address');

  const su = await c.accountSignup({ email: 'bola@example.com', password: 'first-pass-1', name: 'Bola' });
  await c.accountForgot({ email: 'bola@example.com' });
  assert.strictEqual(sent.length, 1);
  const link = /https:\/\/scout\.test\/account\?reset=(r_[0-9a-f]{32})/.exec(sent[0].text);
  assert.ok(link, 'email holds a reset link');
  await assert.rejects(() => c.accountReset({ token: link[1], password: 'short' }), /8 characters/);
  await assert.rejects(() => c.accountReset({ token: 'r_' + '0'.repeat(32), password: 'second-pass-2' }), /expired/);
  const rs = await c.accountReset({ token: link[1], password: 'second-pass-2' });
  assert.ok(rs.session);
  await assert.rejects(() => c.accountReset({ token: link[1], password: 'third-pass-3' }), /expired/, 'link works once');
  await assert.rejects(() => c.accountMe({ session: su.session }), /expired|sign in/i, 'old sessions are signed out');
  await assert.rejects(() => c.accountLogin({ email: 'bola@example.com', password: 'first-pass-1' }), /not right|wrong|incorrect/i);
  await c.accountLogin({ email: 'bola@example.com', password: 'second-pass-2' });
  // limited to 3 requests an hour
  await c.accountForgot({ email: 'bola@example.com' }); await c.accountForgot({ email: 'bola@example.com' });
  await assert.rejects(() => c.accountForgot({ email: 'bola@example.com' }), /Too many/);

  // email off: honest answer
  const off = core.createCore(core.memoryKV(), {});
  assert.deepStrictEqual(await off.accountForgot({ email: 'a@example.com' }), { sent: false, configured: false });
  await assert.rejects(() => off.accountGoogle({ credential: 'tok-ok' }), /not switched on/);

  // Google: creates account, rejects bad/unverified tokens
  await assert.rejects(() => c.accountGoogle({ credential: 'nope' }), /could not confirm/);
  await assert.rejects(() => c.accountGoogle({ credential: 'tok-unverified' }), /could not confirm/);
  const g = await c.accountGoogle({ credential: 'tok-ok' });
  assert.strictEqual(g.account.email, 'squat@example.com');
  assert.strictEqual(g.account.google, true);
  assert.strictEqual(g.account.hasPassword, false);
  assert.ok((await c.accountMe({ session: g.session })).account);
  // a Google-only account cannot be logged into with an empty password
  await assert.rejects(() => c.accountLogin({ email: 'squat@example.com', password: '' }), /./);
  await c.accountDelete({ session: g.session, password: '' });

  // squatting: someone registers an email they do not own, the real owner signs in with Google
  const sq = await c.accountSignup({ email: 'squat@example.com', password: 'attacker-pass', name: 'Mallory' });
  const owner = await c.accountGoogle({ credential: 'tok-ok' });
  await assert.rejects(() => c.accountMe({ session: sq.session }), /expired|sign in/i, 'attacker session dies');
  await assert.rejects(() => c.accountLogin({ email: 'squat@example.com', password: 'attacker-pass' }), /./, 'attacker password is gone');
  assert.ok(owner.session);

  // emails: application received, shortlisted, employer new applicant
  sent.length = 0;
  const emp = await c.accountSignup({ email: 'boss@example.com', password: 'boss-pass-123', name: 'Boss' });
  const job = await c.jobCreate({ title: 'Sales Rep', company: 'Acme', requirements: [{ text: '2 years sales', weight: 'must' }] });
  await c.accountSyncJobs({ session: emp.session, jobs: [{ id: job.job.id, key: job.key }] });
  const cand = await c.accountSignup({ email: 'cand@example.com', password: 'cand-pass-123', name: 'Cand' });
  const ap = await c.apply({ jobId: job.job.id, cv: 'Sales rep with 3 years of experience selling software.', name: 'Cand', session: cand.session });
  const subjects = sent.map((m) => m.subject + ' -> ' + m.to);
  assert.ok(subjects.some((s) => /Application received: Sales Rep -> cand@example.com/.test(s)), subjects.join('|'));
  assert.ok(subjects.some((s) => /New applicant for Sales Rep -> boss@example.com/.test(s)), subjects.join('|'));
  sent.length = 0;
  await c.candidatePatch({ jobId: job.job.id, key: job.key, candId: ap.token, patch: { stage: 'shortlist' } });
  assert.ok(sent.some((m) => /shortlisted/.test(m.subject) && m.to === 'cand@example.com'));
  sent.length = 0;
  await c.candidatePatch({ jobId: job.job.id, key: job.key, candId: ap.token, patch: { stage: 'shortlist' } });
  assert.strictEqual(sent.length, 0, 'no repeat email');
  // opt out
  await c.accountSave({ session: cand.session, prefs: { notify: false } });
  assert.strictEqual((await c.accountMe({ session: cand.session })).account.prefs.notify, false);
  await c.accountSave({ session: cand.session, prefs: { want: 'sales' } });
  assert.strictEqual((await c.accountMe({ session: cand.session })).account.prefs.notify, false, 'saving other prefs keeps opt-out');
  sent.length = 0;
  await c.candidatePatch({ jobId: job.job.id, key: job.key, candId: ap.token, patch: { stage: 'pass' } });
  await c.candidatePatch({ jobId: job.job.id, key: job.key, candId: ap.token, patch: { stage: 'shortlist' } });
  assert.strictEqual(sent.length, 0, 'opted-out candidate gets no email');
  // a broken mail provider never breaks the action
  const bad = core.createCore(kv, { sendMail: async () => { throw new Error('boom'); }, origin: 'https://x' });
  await bad.candidatePatch({ jobId: job.job.id, key: job.key, candId: ap.token, patch: { stage: 'ask' } });
  // the applicant record never leaks the account key
  const view = await c.candidateGet({ token: ap.token });
  assert.ok(!JSON.stringify(view).includes('acct:'), 'account key stays private');
  const rec = await c.candidates({ jobId: job.job.id, key: job.key });
  assert.ok(!JSON.stringify(rec).includes('acct:'), 'recruiter view has no account key');

  // providers
  const calls = [];
  const fakeFetch = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({}) }; };
  await mailer({ BREVO_API_KEY: 'k', MAIL_FROM: 'Scout <me@gmail.com>' }, fakeFetch)({ to: 'a@b.com', subject: 's', text: 't' });
  assert.ok(/brevo/.test(calls[0].url) && JSON.parse(calls[0].init.body).sender.email === 'me@gmail.com');
  await mailer({ RESEND_API_KEY: 'k', MAIL_FROM: 'me@gmail.com' }, fakeFetch)({ to: 'a@b.com', subject: 's', text: 't' });
  assert.ok(/resend/.test(calls[1].url));
  assert.strictEqual(mailer({ BREVO_API_KEY: 'k' }, fakeFetch), null, 'no sender, no mailer');
  assert.strictEqual(mailer({}, fakeFetch), null);
  const gv = googleVerifier({ GOOGLE_CLIENT_ID: 'cid' }, async () => ({ ok: true, json: async () => ({ aud: 'cid', iss: 'https://accounts.google.com', exp: String(Date.now() / 1000 + 600), email: 'a@b.com', email_verified: 'true', name: 'A' }) }));
  assert.strictEqual((await gv('x')).verified, true);
  const wrongAud = googleVerifier({ GOOGLE_CLIENT_ID: 'other' }, async () => ({ ok: true, json: async () => ({ aud: 'cid', iss: 'accounts.google.com', exp: String(Date.now() / 1000 + 600), email: 'a@b.com', email_verified: 'true' }) }));
  assert.strictEqual(await wrongAud('x'), null, 'token for another site is rejected');
  const expired = googleVerifier({ GOOGLE_CLIENT_ID: 'cid' }, async () => ({ ok: true, json: async () => ({ aud: 'cid', iss: 'accounts.google.com', exp: '1000', email: 'a@b.com', email_verified: 'true' }) }));
  assert.strictEqual(await expired('x'), null);
  assert.strictEqual(googleVerifier({}, fakeFetch), null);
  console.log('Reset, Google sign-in and email tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
