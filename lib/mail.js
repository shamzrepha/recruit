/*
 * Email and Google sign-in helpers (no dependencies, plain fetch).
 *
 * Email providers, first one configured wins:
 *   BREVO_API_KEY   + MAIL_FROM   Brevo: free 300/day, send from one verified address (a Gmail works)
 *   RESEND_API_KEY  + MAIL_FROM   Resend: needs a verified domain to email other people
 * MAIL_FROM looks like:  Scout <you@gmail.com>   or just   you@gmail.com
 *
 * Google sign-in: GOOGLE_CLIENT_ID (the Web client ID from Google Cloud Console).
 */

function parseFrom(s) {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(String(s || ''));
  if (m) return { name: (m[1] || 'Scout').trim() || 'Scout', email: m[2].trim() };
  return { name: 'Scout', email: String(s || '').trim() };
}

function mailer(env, doFetch) {
  env = env || process.env;
  doFetch = doFetch || fetch;
  const from = parseFrom(env.MAIL_FROM);
  if (!from.email) return null;

  if (env.BREVO_API_KEY) {
    return async function (m) {
      const r = await doFetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { name: from.name, email: from.email }, to: [{ email: m.to }], subject: m.subject, textContent: m.text })
      });
      if (!r.ok) throw new Error('Brevo returned ' + r.status);
    };
  }
  if (env.RESEND_API_KEY) {
    return async function (m) {
      const r = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ from: from.name + ' <' + from.email + '>', to: [m.to], subject: m.subject, text: m.text })
      });
      if (!r.ok) throw new Error('Resend returned ' + r.status);
    };
  }
  return null;
}

// Checks a Google ID token with Google and makes sure it was issued for THIS site's client ID.
function googleVerifier(env, doFetch) {
  env = env || process.env;
  doFetch = doFetch || fetch;
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) return null;
  return async function (credential) {
    if (!credential || credential.length > 4000) return null;
    const r = await doFetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!r.ok) return null;
    const t = await r.json();
    if (t.aud !== clientId) return null;
    if (!/^(https:\/\/)?accounts\.google\.com$/.test(String(t.iss || ''))) return null;
    if (Number(t.exp) * 1000 < Date.now()) return null;
    return { email: t.email, verified: t.email_verified === true || t.email_verified === 'true', name: t.name || '' };
  };
}

module.exports = { mailer, googleVerifier, parseFrom };
