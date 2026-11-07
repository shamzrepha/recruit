/*
 * POST /api/role-intake
 *
 * An interactive AI chatbot that interviews the recruiter/founder about:
 * - What their startup does and what stage they are at
 * - What engineering/product challenges they face
 * - What role they are looking to hire
 * - What their non-negotiable must-haves vs nice-to-haves are
 *
 * Actions:
 *   ?action=chat      Next message in the recruiter intake conversation
 *   ?action=generate  Synthesizes the conversation into structured job description and requirements
 */

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => String(s || '').slice(0, n);

const RECRUITER_CHAT_SYSTEM = [
  'You are an expert talent scout and founding recruiter assistant for early-stage startups at Sourcing Sprints.',
  'Your mission is to interview the founder/recruiter in a friendly, conversational manner to deeply understand their hiring need.',
  'Ask one focused question at a time about:',
  '1. What their startup builds, their product, and current stage (pre-seed, seed, series A).',
  '2. The specific role they need (e.g. Founding Backend Engineer, Fullstack Lead).',
  '3. Their core tech stack, engineering challenges, and team culture.',
  '4. What their absolute must-have requirements are vs nice-to-haves.',
  'Keep your responses concise, encouraging, and highly professional.',
  'Return JSON format: {"reply": string, "suggestedRole": string, "isReadyToGenerate": boolean}'
].join('\n');

const RECRUITER_GENERATE_SYSTEM = [
  'You are an expert recruitment architect.',
  'Analyze the entire transcript between the recruiter/founder and the AI intake chatbot.',
  'Extract and synthesize the role into a structured job description and a list of requirements with weights (must or nice).',
  'Return JSON only in this exact shape:',
  '{',
  '  "title": string,',
  '  "summary": string,',
  '  "jd": string,',
  '  "requirements": [',
  '    { "text": string, "weight": "must" | "nice" }',
  '  ]',
  '}'
].join('\n');

async function callGroq(apiKey, model, messages, attempt = 0) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })
  });

  if (resp.status === 429 && attempt < 1) {
    const ra = parseFloat(resp.headers && resp.headers.get && resp.headers.get('retry-after'));
    await sleep((Number.isFinite(ra) ? Math.min(ra, 10) : 4) * 1000);
    return callGroq(apiKey, model, messages, attempt + 1);
  }

  if (!resp.ok) {
    const err = new Error('Groq returned ' + resp.status);
    err.status = resp.status;
    throw err;
  }

  return resp.json();
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST.' });
  }

  const action = req.query && req.query.action;
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  if (!body) return res.status(400).json({ error: 'Invalid JSON request body.' });

  const messages = Array.isArray(body.messages) ? body.messages : [];

  // Offline / Fallback mode
  if (!apiKey) {
    if (action === 'chat') {
      const step = messages.length;
      let reply = "Great! Tell me a bit about your tech stack and what architectural challenges this hire will tackle.";
      if (step <= 2) {
        reply = "Nice to meet you! What does your startup build, and what stage are you at (e.g., seed, series A)?";
      } else if (step <= 4) {
        reply = "Got it. What are the 2 or 3 non-negotiable must-haves for this role versus nice-to-haves?";
      } else {
        reply = "Awesome! I have enough context about your startup and role. Click 'Generate Role Profile' below to convert this into your screening requirements.";
      }
      return res.status(200).json({
        reply,
        suggestedRole: 'Founding Backend Engineer',
        isReadyToGenerate: step >= 4,
        demo: true
      });
    }

    if (action === 'generate') {
      return res.status(200).json({
        title: 'Founding Backend Engineer',
        summary: 'Seed-stage startup building high-scale fintech systems.',
        jd: [
          'Founding Backend Engineer (Seed-stage Startup)',
          '',
          'Requirements',
          '- 3+ years building backend services',
          '- Python or Go in production',
          '- PostgreSQL or distributed database experience',
          '- Shipped an API used by real customers',
          '',
          'Nice to have',
          '- Experience at an early-stage startup',
          '- AWS or GCP infrastructure experience'
        ].join('\n'),
        requirements: [
          { text: '3+ years building backend services', weight: 'must' },
          { text: 'Python or Go in production', weight: 'must' },
          { text: 'PostgreSQL or distributed database experience', weight: 'must' },
          { text: 'Shipped an API used by real customers', weight: 'must' },
          { text: 'Experience at an early-stage startup', weight: 'nice' },
          { text: 'AWS or GCP infrastructure experience', weight: 'nice' }
        ],
        demo: true
      });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  }

  // Live Groq Mode
  try {
    if (action === 'chat') {
      const groqMessages = [
        { role: 'system', content: RECRUITER_CHAT_SYSTEM },
        ...messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: clip(m.text, 2000) }))
      ];

      const groqResp = await callGroq(apiKey, model, groqMessages);
      const text = groqResp.choices[0].message.content;
      const parsed = safeParse(text) || {
        reply: text,
        suggestedRole: 'Senior Engineer',
        isReadyToGenerate: messages.length >= 4
      };

      return res.status(200).json({
        reply: clip(parsed.reply, 1000),
        suggestedRole: clip(parsed.suggestedRole || 'Software Engineer', 100),
        isReadyToGenerate: Boolean(parsed.isReadyToGenerate || messages.length >= 6)
      });
    }

    if (action === 'generate') {
      const transcriptText = messages.map(m => `${m.role === 'ai' ? 'Scout Assistant' : 'Recruiter'}: ${m.text}`).join('\n');
      const groqMessages = [
        { role: 'system', content: RECRUITER_GENERATE_SYSTEM },
        { role: 'user', content: `Analyze this recruiter intake conversation and generate the role title, job description, and structured requirements list:\n\n${transcriptText}` }
      ];

      const groqResp = await callGroq(apiKey, model, groqMessages);
      const text = groqResp.choices[0].message.content;
      const parsed = safeParse(text);
      if (!parsed || !Array.isArray(parsed.requirements)) {
        throw new Error('Failed to parse generated role structure.');
      }

      return res.status(200).json({
        title: clip(parsed.title || 'Software Engineer', 100),
        summary: clip(parsed.summary || '', 300),
        jd: clip(parsed.jd || '', 4000),
        requirements: parsed.requirements.slice(0, 15).map(r => ({
          text: clip(r.text, 140),
          weight: r.weight === 'nice' ? 'nice' : 'must'
        }))
      });
    }

    return res.status(400).json({ error: 'Action must be chat or generate.' });
  } catch (err) {
    console.error('Role intake API error:', err.message);
    if (err.status === 429) {
      return res.status(429).json({ error: 'The AI assistant is busy. Please wait a moment.' });
    }
    return res.status(502).json({ error: 'AI role intake failed. Try again in a moment.' });
  }
};
