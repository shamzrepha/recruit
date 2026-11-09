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
  'You are a friendly hiring assistant inside Scout, a recruiting product. You interview the founder or recruiter to understand their company and the role they want to fill, like a good recruiter would on a first call.',
  'Ask ONE short question at a time, in plain everyday words. Use no jargon unless the recruiter used it first. The role can be any kind of job, not only technical.',
  'Cover, over the conversation: what the company does and its stage or size; the role and what the person will do day to day; where the role is based and whether it is full-time, part-time, contract or an internship, and on-site, hybrid or remote; the must-haves versus nice-to-haves; and what a great first six months looks like.',
  'Do not ask more than 5 questions in total. If the recruiter already answered something, do not ask it again. After about 4 answers say you have enough and tell them to press the button to create the job.',
  'Never ask for private details about the recruiter. Do not invent facts about the company.',
  'Return JSON only: {"reply": string, "suggestedRole": string, "isReadyToGenerate": boolean}. "suggestedRole" is the job title so far, or "" if unknown.'
].join('\n');

const RECRUITER_GENERATE_SYSTEM = [
  'You turn a job post, recruitment flyer, screenshot OCR text, or intake conversation into a clean role profile and structured requirements list.',
  'Write the job description (jd) in plain, friendly language: a short summary of the role and responsibilities. 150 words at most.',
  'CRITICAL INSTRUCTION FOR REQUIREMENTS:',
  '- ONLY include candidate qualifications, skills, tools, and background (e.g. "3+ years in Python", "Degree in Accounting", "Experience managing fleets").',
  '- NEVER include company descriptions, "We are hiring", deadlines, contact emails, phone numbers, salary ranges, benefits, or how to apply in the requirements list.',
  '- Mark each requirement "must" (core necessity) or "nice" (bonus/preferred). Return 4 to 8 requirements total.',
  'Also extract "title" (the role name), "company" (if mentioned, otherwise ""), "location" (city or "Remote"), "type" (Full-time, Part-time, Contract, Internship), and "workMode" (On-site, Hybrid, Remote).',
  'Return JSON only in this exact shape:',
  '{"title": string, "company": string, "summary": string, "jd": string, "location": string, "type": string, "workMode": string, "requirements": [{"text": string, "weight": "must" | "nice"}]}'
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

  // Offline mode: no AI key. Be honest about it and use only what the recruiter wrote.
  if (!apiKey) {
    const said = messages.filter((m) => m.role !== 'ai').map((m) => clip(m.text, 2000));
    if (action === 'chat') {
      const n = said.length;
      const replies = [
        'Thanks! What does your company do, and how big is the team?',
        'And what will this person do day to day? Where is the job based, and is it full-time, part-time, contract or an internship?',
        'What are the must-haves for this role, and what would be nice to have?',
        'That is enough to start. Press the button below to create your job. (The AI is not connected, so requirements will be pulled from your messages by keyword. You can edit them.)'
      ];
      return res.status(200).json({ reply: replies[Math.min(n - 1, replies.length - 1)] || replies[0], suggestedRole: '', isReadyToGenerate: n >= 3, ai: false });
    }
    if (action === 'generate') {
      const Engine = require('../engine.js');
      const text = said.join('\n');
      const sentences = text.split(/[\n.;]+/).map((x) => x.trim()).filter((x) => x.length > 8);
      let reqs = Engine.extractRequirements(text).map((r) => ({ text: r.text, weight: r.weight }));
      if (!reqs.length) {
        reqs = sentences.filter((x) => /year|experience|skill|degree|knowledge|able to|ability|certif|must|need/i.test(x)).slice(0, 6).map((x) => ({ text: clip(x, 140), weight: 'must' }));
      }
      const t = /(?:hiring|need|looking for|recruiting|want)\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z \-/&]{2,50}?)(?:\s+(?:who|with|to|for|in|at|that)\b|[.,;\n]|$)/i.exec(text);
      const place = /\b(Lagos|Abuja|Port Harcourt|Ibadan|Enugu|Owerri|Kano|Accra|Nairobi|Remote)\b/i.exec(text);
      return res.status(200).json({
        title: clip(t ? t[1].trim() : '', 100),
        summary: '',
        jd: clip(text, 4000),
        location: place ? place[1] : '',
        type: /intern/i.test(text) ? 'Internship' : /part[- ]time/i.test(text) ? 'Part-time' : /contract/i.test(text) ? 'Contract' : 'Full-time',
        workMode: /remote/i.test(text) ? 'Remote' : /hybrid/i.test(text) ? 'Hybrid' : 'On-site',
        requirements: reqs,
        ai: false
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
        suggestedRole: '',
        isReadyToGenerate: messages.length >= 4
      };

      return res.status(200).json({
        reply: clip(parsed.reply, 1000),
        suggestedRole: clip(parsed.suggestedRole || '', 100),
        isReadyToGenerate: Boolean(parsed.isReadyToGenerate || messages.length >= 6)
      });
    }

    if (action === 'generate') {
      const isFlyer = messages.length === 1 && messages[0].text;
      const transcriptText = messages.map(m => `${m.role === 'ai' ? 'Scout Assistant' : 'Recruiter'}: ${m.text}`).join('\n');
      const userPrompt = isFlyer
        ? `Analyze this job posting / recruitment flyer text extracted from an image or paste:\n\n${messages[0].text}\n\nExtract the role title, company (if any), location, clean job summary/responsibilities, and ONLY the candidate requirements (4 to 8 bullet points, distinguishing must-have from nice-to-have). Do NOT include company overview, salary, benefits, or contact/application instructions as requirements.`
        : `Analyze this recruiter intake conversation and generate the role title, job description, and structured requirements list:\n\n${transcriptText}`;

      const groqMessages = [
        { role: 'system', content: RECRUITER_GENERATE_SYSTEM },
        { role: 'user', content: userPrompt }
      ];

      const groqResp = await callGroq(apiKey, model, groqMessages);
      const text = groqResp.choices[0].message.content;
      const parsed = safeParse(text);
      if (!parsed || !Array.isArray(parsed.requirements)) {
        throw new Error('Failed to parse generated role structure.');
      }

      return res.status(200).json({
        title: clip(parsed.title || '', 100),
        company: clip(parsed.company || '', 80),
        summary: clip(parsed.summary || '', 300),
        jd: clip(parsed.jd || '', 4000),
        location: clip(parsed.location || '', 80),
        type: ['Full-time', 'Part-time', 'Contract', 'Internship'].includes(parsed.type) ? parsed.type : 'Full-time',
        workMode: ['On-site', 'Hybrid', 'Remote'].includes(parsed.workMode) ? parsed.workMode : 'On-site',
        ai: true,
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
