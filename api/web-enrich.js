/*
 * POST /api/web-enrich
 *
 * Searches the web for official job listings, legitimate application links,
 * company careers portals, contact details, and background verification.
 * Uses real-time web search with AI extraction.
 */

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const clip = (s, n) => String(s || '').slice(0, n);

function parseDdHtml(html) {
  const results = [];
  const blocks = html.split('<div class="result results_links');
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const titleM = b.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const snippetM = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    if (titleM) {
      let rawUrl = titleM[1];
      let realUrl = rawUrl;
      const uddg = rawUrl.match(/uddg=([^&]+)/);
      if (uddg) realUrl = decodeURIComponent(uddg[1]);
      const title = titleM[2].replace(/<[^>]+>/g, '').trim();
      const snippet = snippetM ? snippetM[1].replace(/<[^>]+>/g, '').trim() : '';
      if (!realUrl.includes('duckduckgo.com')) {
        results.push({ title, url: realUrl, snippet });
      }
    }
  }
  return results.slice(0, 5);
}

async function searchWeb(query) {
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    return parseDdHtml(html);
  } catch (e) {
    return [];
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) {
    const m = String(s).match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const body = req.body || {};
  const title = clip(body.title, 100).trim();
  const company = clip(body.company, 80).trim();
  const location = clip(body.location, 80).trim();
  const extra = clip(body.text, 500).trim();

  if (!title && !company && !extra) {
    return res.status(400).json({ error: 'Provide a title or company to search.' });
  }

  const query = [company, title, location, 'careers jobs apply'].filter(Boolean).join(' ');
  const searchResults = await searchWeb(query);

  const emailsFound = [];
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  searchResults.forEach(r => {
    const m = (r.title + ' ' + r.snippet).match(emailRegex);
    if (m) m.forEach(em => { if (!emailsFound.includes(em)) emailsFound.push(em); });
  });

  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  let officialUrl = '';
  let companyWebsite = '';
  let summary = '';
  let verified = searchResults.length > 0;

  if (searchResults.length > 0) {
    // Pick first candidate legit link
    const legit = searchResults.find(r => !/myjobmag|jobberman|linkedin\.com\/pulse/i.test(r.url)) || searchResults[0];
    officialUrl = legit ? legit.url : '';
    try {
      const u = new URL(officialUrl);
      companyWebsite = u.origin;
    } catch (e) {}
  }

  // If AI is available, have it synthesize and extract clean contact details & verified application URL
  if (apiKey && searchResults.length > 0) {
    try {
      const prompt = [
        `Role: ${title}`,
        `Company: ${company}`,
        `Location: ${location}`,
        `Web search results:`,
        JSON.stringify(searchResults, null, 2)
      ].join('\n');

      const messages = [
        {
          role: 'system',
          content: 'You analyze web search results to find legitimate application links, official company career portals, contact info, and role details. Return JSON only: {"officialApplyUrl": string, "companyWebsite": string, "contacts": string[], "verified": boolean, "summary": string}'
        },
        { role: 'user', content: prompt }
      ];

      const groqResp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });

      if (groqResp.ok) {
        const data = await groqResp.json();
        const parsed = safeParse(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
        if (parsed) {
          if (parsed.officialApplyUrl) officialUrl = parsed.officialApplyUrl;
          if (parsed.companyWebsite) companyWebsite = parsed.companyWebsite;
          if (parsed.summary) summary = clip(parsed.summary, 300);
          if (typeof parsed.verified === 'boolean') verified = parsed.verified;
          if (Array.isArray(parsed.contacts)) {
            parsed.contacts.forEach(c => { if (!emailsFound.includes(c)) emailsFound.push(c); });
          }
        }
      }
    } catch (e) {
      // Fall through to searchResults heuristics
    }
  }

  return res.status(200).json({
    query,
    verified,
    officialUrl,
    companyWebsite,
    contacts: emailsFound.slice(0, 4),
    summary: summary || (searchResults[0] ? searchResults[0].snippet : ''),
    sources: searchResults.slice(0, 4).map(s => ({ title: s.title, url: s.url, snippet: s.snippet }))
  });
};
