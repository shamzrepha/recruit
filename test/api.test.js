const assert = require('assert');
const handler = require('../api/screen.js');

function fakeRes() {
  return {
    code: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

(async () => {
  // No key: GET says AI is off, POST asks the page to fall back.
  delete process.env.GROQ_API_KEY;
  let res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.deepStrictEqual(res.body, { ai: false });
  res = fakeRes();
  await handler({ method: 'POST', body: {} }, res);
  assert.strictEqual(res.code, 501);

  process.env.GROQ_API_KEY = 'test-key';
  res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.deepStrictEqual(res.body, { ai: true });

  // Bad input is rejected.
  res = fakeRes();
  await handler({ method: 'POST', body: { requirements: [], candidates: [] } }, res);
  assert.strictEqual(res.code, 400);

  // Model output: one real quote, one invented quote, one bad status.
  const cv = 'Jane Doe\nBuilt payment APIs in Python for 5 years.\nUsed PostgreSQL daily.';
  const modelJson = {
    summary: 'Solid backend profile.',
    checks: [
      { reqId: 'r1', status: 'met', evidence: 'Built payment APIs in Python for 5 years.', note: '' },
      { reqId: 'r2', status: 'met', evidence: 'Led a team of twelve engineers at Google', note: '' },
      { reqId: 'r3', status: 'banana', evidence: '', note: '' }
    ],
    questions: ['Q1', 'Q2', 'Q3', 'Q4']
  };
  let sentBody = null;
  global.fetch = async (url, init) => {
    sentBody = JSON.parse(init.body);
    assert.ok(String(url).startsWith('https://api.groq.com/'), 'calls Groq');
    assert.ok(/^Bearer /.test(init.headers.Authorization), 'key travels in a header');
    assert.ok(!String(url).includes('test-key'), 'key must not appear in the URL');
    assert.strictEqual(sentBody.response_format.type, 'json_object');
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: JSON.stringify(modelJson) } }] }) };
  };

  res = fakeRes();
  await handler({
    method: 'POST',
    body: {
      requirements: [
        { id: 'r1', text: 'Python backend', weight: 'must' },
        { id: 'r2', text: 'Led a team', weight: 'nice' },
        { id: 'r3', text: 'PostgreSQL', weight: 'must' }
      ],
      candidates: [{ id: 'c1', name: 'Jane Doe', cv }]
    }
  }, res);

  assert.strictEqual(res.code, 200);
  const r = res.body.results[0];
  assert.strictEqual(r.checks[0].status, 'met', 'a real quote is kept');
  assert.strictEqual(r.checks[1].status, 'not_stated', 'an invented quote is downgraded');
  assert.strictEqual(r.checks[1].evidence, '');
  assert.strictEqual(r.checks[2].status, 'not_stated', 'an unknown status becomes not_stated');
  assert.strictEqual(r.questions.length, 3, 'questions are capped at 3');
  assert.ok(sentBody.messages[0].content.includes('untrusted'), 'prompt marks CV text as untrusted');

  // Upstream failure gives a calm message with no internals.
  global.fetch = async () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) });
  res = fakeRes();
  await handler({ method: 'POST', body: { requirements: [{ id: 'r1', text: 'x', weight: 'must' }], candidates: [{ id: 'c1', name: 'A', cv }] } }, res);
  assert.strictEqual(res.code, 502);
  assert.ok(!/500|groq/i.test(res.body.error));

  // Rate limit: retried once, then a clear "busy" message.
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 429, headers: { get: () => '0' }, json: async () => ({}) }; };
  res = fakeRes();
  await handler({ method: 'POST', body: { requirements: [{ id: 'r1', text: 'x', weight: 'must' }], candidates: [{ id: 'c1', name: 'A', cv }] } }, res);
  assert.strictEqual(res.code, 429);
  assert.strictEqual(calls, 2, 'one retry after a 429');
  assert.ok(/busy/i.test(res.body.error));

  console.log('api tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
