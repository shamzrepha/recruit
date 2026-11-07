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
