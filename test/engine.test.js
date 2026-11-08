const assert = require('assert');
const E = require('../engine.js');
const S = require('../samples.js');

const reqs = E.extractRequirements(S.JOB);
assert.strictEqual(reqs.length, 6, 'sample role should give 6 requirements');
assert.deepStrictEqual(reqs.map((r) => r.weight), ['must', 'must', 'must', 'must', 'nice', 'nice']);

const cands = S.CANDIDATES.map((c, i) => ({ id: 'c' + i, name: c.name, cv: c.cv }));
const out = E.demoScreen(reqs, cands);
const scores = {};
out.forEach((r) => { scores[r.name] = E.score(reqs, r.checks); });

assert.strictEqual(scores['Adaeze Okafor'].now, 100);
assert.strictEqual(scores['Ibrahim Sule'].now, 71);
assert.strictEqual(scores['Ibrahim Sule'].potential, 100, 'unstated items should lift the potential score');
assert.strictEqual(scores['Tunde Bakare'].now, 50);
assert.ok(scores['Chiamaka Eze'].missingMust, 'a CV with 6 months should fail the 3+ years must-have');
assert.strictEqual(E.suggestion(scores['Chiamaka Eze']).code, 'gap');
assert.strictEqual(E.suggestion(scores['Adaeze Okafor']).code, 'strong');
assert.strictEqual(E.suggestion(scores['Ibrahim Sule']).code, 'verify');

// "Go" the language should not match the English word "go".
const goReq = { id: 'x', text: 'Go in production', weight: 'must' };
assert.strictEqual(E.checkRequirement(goReq, 'I like to go hiking and go to the gym').status, 'not_stated');
assert.strictEqual(E.checkRequirement(goReq, 'Built services in Go and Python').status, 'met');

// Spreadsheet formula injection is neutralised in CSV export.
assert.strictEqual(E.toCsv([['=HYPERLINK("x")']]).charAt(0), '"');
assert.ok(E.toCsv([['=SUM(A1)']]).startsWith("'="));

console.log('engine tests passed');

// ---- CV profile, years from dates, intent parsing, percentile ----
(function () {
  const cv = `ADAEZE OKAFOR
Lagos, Nigeria | adaeze@example.com | 0803 123 4567

WORK EXPERIENCE
Operations Associate, Jumia Logistics   Jan 2021 – Present
- Managed 40 daily deliveries across Lagos
Customer Support Agent, Paystack  2019 - 2020
- Handled 60 tickets per day

EDUCATION
Federal University of Technology, Owerri
B.Eng Mechatronics Engineering  2014 - 2019

SKILLS
Excel, SQL, Customer service`;
  const p = E.parseCv(cv);
  assert.strictEqual(p.name, 'Adaeze Okafor', 'all-caps name is tidied');
  assert.strictEqual(p.phone, '+2348031234567');
  assert.strictEqual(p.experience.length, 2);
  assert.strictEqual(p.experience[0].company, 'Jumia Logistics');
  assert.strictEqual(p.experience[0].end, 'Present');
  assert.strictEqual(p.education[0].school, 'Federal University of Technology, Owerri');
  assert.deepStrictEqual(p.skills, ['Excel', 'SQL', 'Customer service']);
  const yrs = E.experienceYears(cv, new Date('2026-11-08'));
  assert.ok(yrs > 7 && yrs < 7.6, 'years come from work date ranges only, not the degree: ' + yrs);
  const chk = E.checkRequirement({ id: 'r', text: '3+ years of work experience' }, cv);
  assert.strictEqual(chk.status, 'met', 'a general years requirement is judged from dates');
  const short = E.checkRequirement({ id: 'r', text: '10+ years of work experience' }, cv);
  assert.strictEqual(short.status, 'not_met');
  assert.ok(E.cvWithProfile('cv', { skills: ['Python'] }).includes('Skills: Python'));

  const jobs = [{ id: 'j1', title: 'Backend Engineer' }, { id: 'j2', title: 'Product Designer' }];
  const i1 = E.parseIntent('can I see the top 30 candidates who know Python and SQL in Lagos', jobs, 'j1');
  assert.strictEqual(i1.n, 30); assert.deepStrictEqual(i1.skills, ['python', 'sql']); assert.strictEqual(i1.location, 'lagos');
  assert.strictEqual(E.parseIntent('show shortlisted designers', jobs, 'j1').jobId, 'j2', 'job found by title');
  assert.strictEqual(E.parseIntent('show shortlisted designers', jobs, 'j1').stage, 'shortlist');
  assert.strictEqual(E.parseIntent('shortlist the top 5', jobs, 'j1').action, 'shortlist');
  assert.strictEqual(E.parseIntent('help', jobs, 'j1').action, 'help');

  assert.deepStrictEqual(E.percentile(70, [10, 20, 30, 50, 80]), { enough: true, n: 5, ahead: 80, top: 20 });
  assert.strictEqual(E.percentile(70, [10, 20]).enough, false, 'too few applicants to rank');
  console.log('CV profile and assistant parsing tests passed.');
})();
