/*
 * POST /api/role-intake
 *
 * An interactive AI assistant that interviews the recruiter/founder and executes actions:
 * - Understands what their startup builds and who they need without endless questioning.
 * - Detects commands like "Show me candidates", "Can I see top candidates", "Who applied?"
 * - Synthesizes the conversation into structured job description and requirements.
 *
 * Actions:
 *   ?action=chat      Next message in the recruiter intake conversation (supports action triggers)
 *   ?action=generate  Synthesizes the conversation into structured job description and requirements
 */

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => String(s || '').slice(0, n);

const RECRUITER_CHAT_SYSTEM = [
  'You are an expert talent scout and proactive recruiter partner for startups at Sourcing Sprints.',
  'YOUR MISSION: Help the recruiter quickly without asking too many tedious questions.',
  'STRICT RULES:',
  '1. BE CONCISE & PROACTIVE: Do not interrogate the recruiter with long lists of questions. Ask at most 1 brief question or offer an immediate solution.',
  '2. ACTION TRIGGERS: If the recruiter asks to see candidates, view applicants, search talent, or asks "Can I see top candidates?", answer enthusiastically and specify "action": "show_candidates".',
  '3. If the recruiter describes their startup or needs, summarize the suggested role title and key must-haves, and invite them to screen.',
  '4. Return JSON only in this exact shape:',
  '{"reply": string, "suggestedRole": string, "action": "chat" | "show_candidates" | "generate_role", "isReadyToGenerate": boolean}'
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
  const lastUserMsg = (messages.filter(m => m.role === 'recruiter').slice(-1)[0] || {}).text || '';
  const isCandidateQuery = /(show|see|list|view|find|search|who|top|give me).*?(candidate|applicant|people|applied|cv|talent|score)/i.test(lastUserMsg);

  // Offline / Fallback mode
  if (!apiKey) {
    if (action === 'chat') {
      if (isCandidateQuery) {
        return res.status(200).json({
          reply: "I've pulled up the top candidates from your applicant pool below! You can review their score badges, key skills, and click to view their full Career Roadmap Profile.",
          suggestedRole: 'Founding Backend Engineer',
          action: 'show_candidates',
          isReadyToGenerate: true,
          demo: true
        });
      }

      const step = messages.length;
      let reply = "Tell me briefly what role you need and your top 2 must-haves, or ask me to show you our top candidates!";
      if (step <= 2) {
        reply = "Hello! Tell me what key role you're hiring for, or ask me to 'show top candidates' to browse our applicant pool.";
      } else {
        reply = "Got it! I can generate the role requirements now, or display top applicants matching your criteria.";
      }
      return res.status(200).json({
        reply,
        suggestedRole: 'Founding Backend Engineer',
        action: 'chat',
        isReadyToGenerate: step >= 2,
        demo: true
      });
    }

    if (action === 'generate') {
      return res.status(200).json({
        title: 'Founding Backend Engineer',
        summary: 'Early-stage startup building core systems.',
        jd: [
          'Founding Backend Engineer',
          '',
          'Requirements',
          '- 3+ years building production backend services',
          '- Python or Go in production',
          '- PostgreSQL database experience',
          '- Shipped an API used by real customers',
          '',
          'Nice to have',
          '- Experience at an early-stage startup',
          '- AWS or GCP infrastructure experience'
        ].join('\n'),
        requirements: [
          { text: '3+ years building backend services', weight: 'must' },
          { text: 'Python or Go in production', weight: 'must' },
          { text: 'PostgreSQL database experience', weight: 'must' },
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
      if (isCandidateQuery) {
        return res.status(200).json({
          reply: "Here are the top candidates from your applicant pool! You can inspect their work badges, match scores, and open their full Career Roadmap Profile below.",
          suggestedRole: 'Founding Backend Engineer',
          action: 'show_candidates',
          isReadyToGenerate: true
        });
      }

      const groqMessages = [
        { role: 'system', content: RECRUITER_CHAT_SYSTEM },
        ...messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: clip(m.text, 2000) }))
      ];

      const groqResp = await callGroq(apiKey, model, groqMessages);
      const text = groqResp.choices[0].message.content;
      const parsed = safeParse(text) || {
        reply: text,
        suggestedRole: 'Senior Engineer',
        action: 'chat',
        isReadyToGenerate: messages.length >= 2
      };

      return res.status(200).json({
        reply: clip(parsed.reply, 1000),
        suggestedRole: clip(parsed.suggestedRole || 'Software Engineer', 100),
        action: parsed.action || (isCandidateQuery ? 'show_candidates' : 'chat'),
        isReadyToGenerate: Boolean(parsed.isReadyToGenerate || messages.length >= 3)
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
