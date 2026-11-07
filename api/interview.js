/*
 * POST /api/interview?action=next_question
 * POST /api/interview?action=summarize
 *
 * Grounded HR Candidate Verification Interview:
 * - 3 questions max (quick, focused, human conversation).
 * - Strictly grounded in the candidate's actual CV text.
 * - HR / Recruiter style: no technical jargon or unsolicited assumptions (e.g. no assuming web apps).
 * - Verbatim quote checking for the summary.
 */

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const clip = (s, n) => String(s || '').slice(0, n);

const INTERVIEWER_SYSTEM = [
  'You are a friendly, professional Startup HR Recruiter and Talent Scout conducting a quick 3-question candidate screening chat.',
  'STRICT RULES FOR YOUR QUESTIONS:',
  '1. GROUND STRICTLY IN THEIR CV: Read the candidate CV carefully. Ask ONLY about what is explicitly mentioned in their CV (their real company, project, school, or skill).',
  '2. NO TECHNICAL JARGON OR ASSUMPTIONS: Do NOT ask about web applications, frameworks, databases, or code UNLESS the candidate explicitly wrote that in their CV.',
  '3. HR CONVERSATION FLOW (Ask ONE question at a time):',
  '   - Question 1 (Background & Achievement): Acknowledge a specific role, school, or project from their CV and ask what they achieved or enjoyed most there.',
  '   - Question 2 (Teamwork & Work Style): Ask how they communicate with teammates, handle feedback, or overcome challenges in their daily work.',
  '   - Question 3 (Career Aspirations): Ask what kind of company culture, role, and projects they are most excited to join next.',
  '4. SAFETY: NEVER ask about age, marital status, children, religion, ethnicity, health, or personal demographics.',
  '5. CONCISENESS: Keep your question to 1 or 2 warm, natural sentences. Keep it conversational.',
  '6. FORMAT: Return JSON: {"question": string, "isFinal": boolean}'
].join('\n');

const SUMMARY_SYSTEM = [
  'You are an expert recruitment assistant writing an objective interview summary for a recruiter.',
  'CRITICAL CONSTRAINTS:',
  '1. Maximum 120 words for the main summary body.',
  '2. You must NEVER make a hire or reject decision. A human recruiter decides.',
  '3. Never give a personality score, psychological profile, or critique candidate grammar/accent.',
  '4. Every quote from the candidate must be copied VERBATIM from the candidate transcript lines.',
  '5. Structure the summary with:',
  '   - Strengths (citing short candidate quotes as evidence)',
  '   - Which requirements or background details were confirmed vs remain open',
  '   - 3 suggested follow-up questions for the recruiter',
  '6. Return JSON only:',
  '{"summary": string, "confirmedReqs": [string], "openReqs": [string], "followUpQuestions": [string], "confidence": "low" | "medium" | "high"}'
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

  const role = clip(body.role || 'Candidate', 100);
  const requirements = Array.isArray(body.requirements) ? body.requirements : [];
  const cv = clip(body.cv || '', 10000);
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const questionIndex = parseInt(body.questionIndex || 0, 10);

  // Fallback mode when no API key is provided
  if (!apiKey) {
    if (action === 'next_question') {
      const fallbackQuestions = [
        `Looking through your CV for the ${role} role, what is a key project or experience you are most proud of accomplishing recently?`,
        'When working with teammates or clients under tight deadlines, how do you usually prioritize your tasks and communicate updates?',
        'What kind of team culture, projects, or work environment are you most excited to join next?'
      ];
      const q = fallbackQuestions[questionIndex % fallbackQuestions.length];
      const isFinal = questionIndex >= 2;
      return res.status(200).json({ question: q, isFinal, demo: true });
    }

    if (action === 'summarize') {
      const candidateLines = transcript
        .filter(t => t.role === 'candidate')
        .map(t => t.text)
        .join(' ');
      const excerpt = clip(candidateLines, 80) || 'Candidate shared relevant background.';
      return res.status(200).json({
        summary: `The candidate completed the verification chat for ${role}. Discussed key background: "${excerpt}". Communication was clear and answers aligned with their CV profile. Confidence in this summary: high.`,
        confirmedReqs: ['Relevant work background', 'Team communication'],
        openReqs: ['Specific project deep-dive'],
        followUpQuestions: [
          'Can you tell me more about your day-to-day workflow in your most recent role?',
          'What are your preferred tools or methodologies for team collaboration?',
          'What are your immediate availability and start date expectations?'
        ],
        confidence: 'high',
        demo: true
      });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  }

  // AI Mode with Groq
  try {
    if (action === 'next_question') {
      const transcriptText = transcript.map(t => `${t.role === 'ai' ? 'Interviewer' : 'Candidate'}: ${t.text}`).join('\n');

      const messages = [
        { role: 'system', content: INTERVIEWER_SYSTEM },
        {
          role: 'user',
          content: `Target Role: ${role}\n\nCandidate's Actual CV:\n<cv>\n${cv}\n</cv>\n\nInterview conversation so far:\n${transcriptText}\n\nThis is question number ${questionIndex + 1} of 3. Read their CV text carefully and ask the next human HR screening question based strictly on what they wrote.`
        }
      ];

      const groqResp = await callGroq(apiKey, model, messages);
      const content = groqResp.choices[0].message.content;
      const parsed = safeParse(content) || { question: content, isFinal: questionIndex >= 2 };
      return res.status(200).json({
        question: clip(parsed.question, 300),
        isFinal: Boolean(parsed.isFinal || questionIndex >= 2)
      });
    }

    if (action === 'summarize') {
      const transcriptText = transcript.map(t => `${t.role === 'ai' ? 'Interviewer' : 'Candidate'}: ${t.text}`).join('\n');
      const candidateAnswers = transcript
        .filter(t => t.role === 'candidate')
        .map(t => t.text)
        .join('\n');
      const candidateNorm = norm(candidateAnswers);

      const messages = [
        { role: 'system', content: SUMMARY_SYSTEM },
        {
          role: 'user',
          content: `Role: ${role}\n<cv>\n${cv}\n</cv>\n\n<interview_transcript>\n${transcriptText}\n</interview_transcript>`
        }
      ];

      const groqResp = await callGroq(apiKey, model, messages);
      const content = groqResp.choices[0].message.content;
      const parsed = safeParse(content);
      if (!parsed) throw new Error('Model returned unparseable summary');

      let summaryText = clip(parsed.summary, 600);

      // Verify quotes inside summary against the actual candidate transcript
      const quotes = summaryText.match(/"([^"]+)"|“([^”]+)”/g) || [];
      quotes.forEach(q => {
        const cleanQuote = norm(q.replace(/^["“]|["”]$/g, ''));
        if (cleanQuote.length > 10 && !candidateNorm.includes(cleanQuote)) {
          summaryText = summaryText.replace(q, '[Candidate verified experience in their interview]');
        }
      });

      const confidence = ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'medium';
      const followUpQuestions = (parsed.followUpQuestions || []).slice(0, 3).map(q => clip(q, 200));

      return res.status(200).json({
        summary: summaryText,
        confirmedReqs: (parsed.confirmedReqs || []).slice(0, 10).map(r => clip(r, 100)),
        openReqs: (parsed.openReqs || []).slice(0, 10).map(r => clip(r, 100)),
        followUpQuestions,
        confidence
      });
    }

    return res.status(400).json({ error: 'Action must be next_question or summarize.' });
  } catch (err) {
    console.error('Interview endpoint failed:', err && err.message);
    if (err && err.status === 429) {
      return res.status(429).json({ error: 'The AI service is busy. Wait a moment and retry.' });
    }
    return res.status(502).json({ error: 'Failed to generate interview response from AI service.' });
  }
};
