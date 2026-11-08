/*
 * POST /api/assistant   { message, jobs: [{id,title}], currentJobId, history? }
 *   -> { intent: { action, n, jobId, stage, skills[], location, minScore, interviewed }, reply }
 *
 * Turns a recruiter's sentence into an action the app runs itself (show the top 30, list the
 * shortlisted, shortlist the top 5 ...). No candidate data is sent here: only the message and
 * the job titles. The app then runs the action on its own data.
 */
const Engine = require('../engine.js');
const { chatJson, clip, model, body } = require('../lib/groq.js');

const SYSTEM = [
  'You are the assistant inside a recruiting dashboard. The recruiter types a request; you turn it into ONE action for the app to run on its own data.',
  'You never see candidate data and must not guess any. You do not make hiring decisions.',
  'Actions: "top" (show ranked candidates), "shortlist" (mark the top n as shortlisted), "help" (explain what you can do), "answer" (a short plain answer to a general question about how Scout works, with no candidate data).',
  'Fields: n (how many, 1-100, default 10), jobId (one of the given job ids, or "" for the current job), stage ("new", "shortlist", "ask", "pass" or ""),',
  'skills (words the candidate profile should mention, lowercase, at most 5), location (a place the candidate should be in, or ""), minScore (0-100), interviewed (true only if they ask for people who did the AI chat).',
  'Scores in Scout are the percentage of the role\'s requirements that a CV states. "Not stated" means verify, not reject.',
  '"reply" is one short friendly sentence in plain words, written before the results are shown. Never claim to have shown anything the app has not yet shown.',
  'Reply with JSON only: {"action": string, "n": number, "jobId": string, "stage": string, "skills": [string], "location": string, "minScore": number, "interviewed": boolean, "reply": string}'
].join('\n');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ ai: Boolean(process.env.GROQ_API_KEY) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const b = body(req);
  const message = clip(b && b.message, 500).trim();
  if (!message) return res.status(400).json({ error: 'Type a request first.' });
  const jobs = (Array.isArray(b.jobs) ? b.jobs : []).slice(0, 30).map((j) => ({ id: clip(j.id, 40), title: clip(j.title, 100) }));
  const current = clip(b.currentJobId, 40);

  const local = Engine.parseIntent(message, jobs, current);
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(200).json({ intent: local, reply: '', ai: false });

  try {
    const out = await chatJson(apiKey, model(), [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Jobs: ' + JSON.stringify(jobs) + '\nCurrent job id: ' + (current || 'none') + '\nRequest: ' + message }
    ]);
    const okJob = jobs.some((j) => j.id === out.jobId);
    const intent = {
      action: ['top', 'shortlist', 'help', 'answer'].includes(out.action) ? out.action : local.action,
      n: Math.max(1, Math.min(100, parseInt(out.n, 10) || local.n || 10)),
      jobId: okJob ? out.jobId : (local.jobId || current),
      stage: ['new', 'shortlist', 'ask', 'pass'].includes(out.stage) ? out.stage : '',
      skills: (Array.isArray(out.skills) ? out.skills : []).slice(0, 5).map((s) => clip(s, 40).toLowerCase()).filter(Boolean),
      location: clip(out.location, 60).toLowerCase(),
      minScore: Math.max(0, Math.min(100, parseInt(out.minScore, 10) || 0)),
      interviewed: out.interviewed === true
    };
    return res.status(200).json({ intent, reply: clip(out.reply, 300), ai: true });
  } catch (err) {
    console.error('assistant failed:', err && err.message);
    return res.status(200).json({ intent: local, reply: '', ai: false });
  }
};
