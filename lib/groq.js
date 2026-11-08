// Small shared helper for the Groq chat API (OpenAI-compatible). JSON replies only.
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chatJson(apiKey, model, messages, opts = {}, attempt = 0) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ model, messages, temperature: opts.temperature == null ? 0.2 : opts.temperature, response_format: { type: 'json_object' } })
  });
  if (resp.status === 429 && attempt < 1) {
    const ra = parseFloat(resp.headers && resp.headers.get && resp.headers.get('retry-after'));
    await sleep((Number.isFinite(ra) ? Math.min(ra, 10) : 4) * 1000);
    return chatJson(apiKey, model, messages, opts, attempt + 1);
  }
  if (!resp.ok) { const e = new Error('Groq returned ' + resp.status); e.status = resp.status; throw e; }
  const data = await resp.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  try { return JSON.parse(content); } catch (e) { throw new Error('Model returned unparseable JSON'); }
}

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const model = () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
function body(req) {
  return typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch (e) { return null; } })() : req.body;
}

module.exports = { chatJson, clip, model, body };
