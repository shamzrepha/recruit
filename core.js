/*
 * Scout core: the rules for jobs, applicants and privacy.
 *
 * The same file runs on the server (api/data.js, backed by Redis) and in the
 * browser (local mode, backed by localStorage), so both enforce identical rules:
 *
 *   - A job has a public id (put in the apply link) and a private recruiter key
 *     (only a hash of it is stored). Recruiter operations need both.
 *   - A candidate gets an unguessable token. It is their only way back in.
 *   - Contact details are removed from what a recruiter receives unless the
 *     candidate agreed. Interview transcripts are never sent to recruiters.
 *   - Candidate records expire after 30 days and can be deleted at any time.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScoutCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;
  var CANDIDATE_TTL = 30 * DAY;
  var JOB_TTL = 90 * DAY;
  var SESSION_TTL = 30 * DAY;
  var ACCT_TTL = 365 * DAY;
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var STATUS_LABEL = { new: 'Received', ask: 'Under review', shortlist: 'Shortlisted', pass: 'Not selected' };
  var JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
  var WORK_MODES = ['On-site', 'Hybrid', 'Remote'];
  function pick(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }
  var STAGES = ['new', 'shortlist', 'ask', 'pass'];
  var MAX_REQS = 20;

  /* ---------------------------------------------------------------- helpers */

  function fail(status, message) {
    var e = new Error(message);
    e.status = status;
    return e;
  }

  function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }

  // The structured profile built from a CV. Everything is length-limited text.
  function cleanProfile(p) {
    if (!p || typeof p !== 'object') return null;
    var strs = function (x, n, m) { return (Array.isArray(x) ? x : []).slice(0, n).map(function (v) { return clip(v, m).trim(); }).filter(Boolean); };
    var rows = function (x, n, fields) {
      return (Array.isArray(x) ? x : []).slice(0, n).map(function (r) {
        var o = {};
        Object.keys(fields).forEach(function (k) { o[k] = clip(r && r[k], fields[k]).trim(); });
        if (fields.highlights !== undefined) o.highlights = strs(r && r.highlights, 4, 200);
        return o;
      });
    };
    var links = p.links || {};
    var yrs = parseFloat(p.yearsExperience);
    return {
      name: clip(p.name, 80).trim(), headline: clip(p.headline, 120).trim(), location: clip(p.location, 80).trim(),
      email: clip(p.email, 80).trim(), phone: clip(p.phone, 30).trim(),
      links: { linkedin: cleanUrl(links.linkedin), github: cleanUrl(links.github), portfolio: cleanUrl(links.portfolio) },
      summary: clip(p.summary, 400).trim(),
      skills: strs(p.skills, 30, 40),
      yearsExperience: isFinite(yrs) ? Math.max(0, Math.min(60, yrs)) : null,
      education: rows(p.education, 6, { school: 100, qualification: 100, field: 100, start: 12, end: 12 }),
      experience: rows(p.experience, 10, { company: 100, title: 100, start: 12, end: 12, highlights: 0 }),
      certifications: strs(p.certifications, 10, 100),
      languages: strs(p.languages, 8, 30),
      suggestedRoles: strs(p.suggestedRoles, 4, 80)
    };
  }

  function webcrypto() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto;
    return require('crypto').webcrypto;
  }

  function randHex(bytes) {
    var a = new Uint8Array(bytes);
    webcrypto().getRandomValues(a);
    var out = '';
    for (var i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2);
    return out;
  }

  async function sha256(text) {
    var buf = await webcrypto().subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    var a = new Uint8Array(buf), out = '';
    for (var i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2);
    return out;
  }

  function sameText(a, b) {
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function randCode(n) {
    var out = '';
    while (out.length < n) {
      var a = new Uint8Array(n * 2);
      webcrypto().getRandomValues(a);
      for (var i = 0; i < a.length && out.length < n; i++) if (a[i] < 248) out += CODE_CHARS.charAt(a[i] % CODE_CHARS.length);
    }
    return out;
  }

  function hexBytes(h) {
    var a = new Uint8Array(h.length / 2);
    for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
    return a;
  }

  async function hashPassword(password, saltHex) {
    var c = webcrypto();
    var key = await c.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    var bits = await c.subtle.deriveBits({ name: 'PBKDF2', salt: hexBytes(saltHex), iterations: 100000, hash: 'SHA-256' }, key, 256);
    var a = new Uint8Array(bits), out = '';
    for (var i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2);
    return out;
  }

  function cleanEmail(e) {
    e = clip(e, 120).trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : '';
  }

  function cleanUrl(s) {
    s = clip(s, 200).trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }

  function cleanReqs(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    return list.map(function (r) {
      var text = clip(r && r.text, 140).trim();
      var id = clip(r && r.id, 24).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!id || seen[id]) id = 'r_' + randHex(3);
      seen[id] = true;
      return { id: id, text: text, weight: r && r.weight === 'nice' ? 'nice' : 'must' };
    }).filter(function (r) { return r.text; }).slice(0, MAX_REQS);
  }

  /* ---------------------------------------------------------------- storage adapters
   * Every adapter offers: get, set(key, value, ttlMs), del, sadd, srem, smembers.
   * Values are plain JSON objects.
   */

  function memoryKV(now) {
    now = now || Date.now;
    var data = {}, sets = {};
    return {
      kind: 'memory',
      get: async function (k) {
        var e = data[k];
        if (!e) return null;
        if (e.exp && e.exp <= now()) { delete data[k]; return null; }
        return JSON.parse(e.v);
      },
      set: async function (k, v, ttl) { data[k] = { v: JSON.stringify(v), exp: ttl ? now() + ttl : 0 }; },
      del: async function (k) { delete data[k]; },
      sadd: async function (k, m) { (sets[k] = sets[k] || {})[m] = 1; },
      srem: async function (k, m) { if (sets[k]) delete sets[k][m]; },
      smembers: async function (k) { return Object.keys(sets[k] || {}); }
    };
  }

  // Browser storage. Falls back to memory if the browser blocks storage.
  function localKV(storage, prefix, now) {
    now = now || Date.now;
    prefix = prefix || 'scout2:';
    var mem = memoryKV(now);
    var ok = false;
    try {
      storage.setItem(prefix + '__t', '1');
      storage.removeItem(prefix + '__t');
      ok = true;
    } catch (e) { ok = false; }
    if (!ok) { mem.kind = 'memory-fallback'; return mem; }

    function read(k) {
      try { return JSON.parse(storage.getItem(prefix + k)); } catch (e) { return null; }
    }
    function write(k, v) { storage.setItem(prefix + k, JSON.stringify(v)); }
    return {
      kind: 'local',
      get: async function (k) {
        var e = read('d:' + k);
        if (!e) return null;
        if (e.exp && e.exp <= now()) { storage.removeItem(prefix + 'd:' + k); return null; }
        return e.v;
      },
      set: async function (k, v, ttl) { write('d:' + k, { v: v, exp: ttl ? now() + ttl : 0 }); },
      del: async function (k) { storage.removeItem(prefix + 'd:' + k); },
      sadd: async function (k, m) { var s = read('s:' + k) || []; if (s.indexOf(m) < 0) s.push(m); write('s:' + k, s); },
      srem: async function (k, m) { var s = (read('s:' + k) || []).filter(function (x) { return x !== m; }); write('s:' + k, s); },
      smembers: async function (k) { return read('s:' + k) || []; }
    };
  }

  // Upstash Redis over HTTPS (free tier). Works from any serverless function.
  function upstashKV(url, token, fetchFn) {
    fetchFn = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    async function cmd(args) {
      var r = await fetchFn(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok || j.error) throw new Error('Store error' + (j.error ? ': ' + j.error : ''));
      return j.result;
    }
    var secs = function (ms) { return Math.max(1, Math.round(ms / 1000)); };
    return {
      kind: 'redis',
      get: async function (k) {
        var v = await cmd(['GET', k]);
        return v == null ? null : JSON.parse(v);
      },
      set: async function (k, v, ttl) {
        var args = ['SET', k, JSON.stringify(v)];
        if (ttl) args.push('EX', String(secs(ttl)));
        await cmd(args);
      },
      del: async function (k) { await cmd(['DEL', k]); },
      sadd: async function (k, m) { await cmd(['SADD', k, m]); await cmd(['EXPIRE', k, String(secs(JOB_TTL))]); },
      srem: async function (k, m) { await cmd(['SREM', k, m]); },
      smembers: async function (k) { return (await cmd(['SMEMBERS', k])) || []; }
    };
  }

  /* ---------------------------------------------------------------- core */

  function createCore(kv, opts) {
    opts = opts || {};
    var now = opts.now || Date.now;
    var mail = typeof opts.sendMail === 'function' ? opts.sendMail : null;
    var siteUrl = function () { return String((typeof opts.origin === 'function' ? opts.origin() : opts.origin) || '').replace(/\/+$/, ''); };
    // Email never blocks or breaks the action that triggered it.
    async function notify(to, subject, text) {
      if (!mail || !to) return false;
      try { await Promise.race([mail({ to: to, subject: subject, text: text }), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('mail timeout')); }, 6000); })]); return true; }
      catch (e) { return false; }
    }

    function jobPublic(j) {
      return {
        id: j.id, title: j.title, company: j.company, jd: j.jd,
        location: j.location || '', type: j.type || 'Full-time', workMode: j.workMode || 'On-site',
        listed: j.listed !== false, code: j.code || '',
        applyUrl: j.applyUrl || '', website: j.website || '', contacts: j.contacts || [],
        requirements: j.requirements, status: j.status, createdAt: j.createdAt
      };
    }

    // What a recruiter may see of a candidate.
    function forRecruiter(c) {
      var out = JSON.parse(JSON.stringify(c));
      if (!out.consent) {
        out.phone = ''; out.email = '';
        if (out.profile) { out.profile.phone = ''; out.profile.email = ''; }
      }
      if (out.interview) delete out.interview.transcript;
      delete out.acct;
      return out;
    }

    // What a candidate may see of themselves (no recruiter notes or screening).
    function forCandidate(c) {
      var out = JSON.parse(JSON.stringify(c));
      delete out.stage; delete out.screen; delete out.contactedAt; delete out.acct;
      return out;
    }

    async function loadJob(id) {
      var j = id ? await kv.get('job:' + clip(id, 40)) : null;
      if (!j) throw fail(404, 'That role was not found. It may have expired.');
      return j;
    }

    async function authJob(id, key) {
      var j = await loadJob(id);
      var ok = key && sameText(await sha256(key), j.keyHash);
      if (!ok) throw fail(403, 'This recruiter link does not match that job.');
      return j;
    }

    async function loadCand(id) {
      var c = id ? await kv.get('cand:' + clip(id, 60)) : null;
      if (!c) throw fail(404, 'Application not found. It may have been deleted or expired.');
      return c;
    }

    async function saveCand(c) { await kv.set('cand:' + c.id, c, CANDIDATE_TTL); }

    async function newCode(jobId) {
      for (var i = 0; i < 8; i++) {
        var code = randCode(6 + (i > 3 ? 1 : 0));
        if (!(await kv.get('code:' + code))) { await kv.set('code:' + code, jobId, JOB_TTL); return code; }
      }
      return '';
    }

    var ops = {};

    /* ---- jobs ---- */

    ops.jobCreate = async function (a) {
      var title = clip(a.title, 100).trim();
      var reqs = cleanReqs(a.requirements);
      if (!title) throw fail(400, 'Give the role a title.');
      if (!reqs.length) throw fail(400, 'Add at least one requirement.');
      var key = randHex(16);
      var job = {
        id: 'j_' + randHex(8),
        keyHash: await sha256(key),
        title: title,
        company: clip(a.company, 80).trim(),
        jd: clip(a.jd, 6000),
        location: clip(a.location, 80).trim(),
        type: pick(a.type, JOB_TYPES, 'Full-time'),
        workMode: pick(a.workMode, WORK_MODES, 'On-site'),
        listed: a.listed !== false,
        applyUrl: clip(a.applyUrl, 250).trim(),
        website: clip(a.website, 120).trim(),
        contacts: Array.isArray(a.contacts) ? a.contacts.slice(0, 5).map(function (c) { return clip(c, 80); }) : [],
        requirements: reqs,
        status: 'open',
        createdAt: new Date(now()).toISOString()
      };
      job.code = await newCode(job.id);
      await kv.set('job:' + job.id, job, JOB_TTL);
      await kv.sadd('jobs:index', job.id);
      return { job: jobPublic(job), key: key };
    };

    ops.jobGet = async function (a) { return { job: jobPublic(await loadJob(a.id)) }; };

    ops.jobUpdate = async function (a) {
      var j = await authJob(a.id, a.key);
      var p = a.patch || {};
      if (p.title != null) {
        var t = clip(p.title, 100).trim();
        if (!t) throw fail(400, 'The title cannot be empty.');
        j.title = t;
      }
      if (p.company != null) j.company = clip(p.company, 80).trim();
      if (p.jd != null) j.jd = clip(p.jd, 6000);
      if (p.requirements != null) {
        var reqs = cleanReqs(p.requirements);
        if (!reqs.length) throw fail(400, 'Keep at least one requirement.');
        j.requirements = reqs;
      }
      if (p.location != null) j.location = clip(p.location, 80).trim();
      if (p.type != null) j.type = pick(p.type, JOB_TYPES, j.type || 'Full-time');
      if (p.workMode != null) j.workMode = pick(p.workMode, WORK_MODES, j.workMode || 'On-site');
      if (p.listed != null) j.listed = p.listed !== false;
      if (p.applyUrl != null) j.applyUrl = clip(p.applyUrl, 250).trim();
      if (p.website != null) j.website = clip(p.website, 120).trim();
      if (p.status === 'open' || p.status === 'closed') j.status = p.status;
      await kv.set('job:' + j.id, j, JOB_TTL);
      await kv.sadd('jobs:index', j.id);
      return { job: jobPublic(j) };
    };

    // The public job board: open roles the recruiter chose to list.
    ops.jobsOpen = async function () {
      var ids = await kv.smembers('jobs:index');
      var out = [];
      for (var i = 0; i < ids.length; i++) {
        var j = await kv.get('job:' + ids[i]);
        if (!j) { await kv.srem('jobs:index', ids[i]); continue; }
        if (j.status === 'open' && j.listed !== false) out.push(jobPublic(j));
      }
      out.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
      return { jobs: out };
    };

    // Anonymous match scores of a job's screened applicants, so a candidate can see where they would rank.
    ops.jobScores = async function (a) {
      var job = await loadJob(a.id);
      var ids = await kv.smembers('jobcands:' + job.id);
      var scores = [];
      for (var i = 0; i < ids.length; i++) {
        var c = await kv.get('cand:' + ids[i]);
        if (c && c.screen && typeof c.screen.now === 'number') scores.push(c.screen.now);
      }
      return { scores: scores };
    };

    /* ---- short apply links ---- */

    ops.jobByCode = async function (a) {
      var code = clip(a.code, 12).trim().toUpperCase();
      if (!/^[A-Z2-9]{4,10}$/.test(code)) throw fail(404, 'That apply link is not valid.');
      var id = await kv.get('code:' + code);
      if (!id) throw fail(404, 'That apply link was not found. It may have expired.');
      return { job: jobPublic(await loadJob(id)) };
    };

    ops.jobShortLink = async function (a) {
      var j = await authJob(a.id, a.key);
      if (!j.code) { j.code = await newCode(j.id); await kv.set('job:' + j.id, j, JOB_TTL); }
      return { code: j.code };
    };

    /* ---- accounts (optional: people can still apply without one) ---- */

    async function loadAcct(session) {
      if (!/^s_[0-9a-f]{32}$/.test(String(session || ''))) throw fail(401, 'Please sign in.');
      var s = await kv.get('sess:' + session);
      var a = s ? await kv.get(s.k) : null;
      if (!a || (s.pv || 0) !== (a.pv || 0)) throw fail(401, 'Your session has expired. Please sign in again.');
      return { a: a, k: s.k };
    }
    async function saveAcct(k, a) { await kv.set(k, a, ACCT_TTL); }
    async function newSession(k, acct) { var t = 's_' + randHex(16); await kv.set('sess:' + t, { k: k, pv: (acct && acct.pv) || 0 }, SESSION_TTL); return t; }
    function acctPublic(a) {
      return { id: a.id, email: a.email, name: a.name, profile: a.profile || null, cvText: a.cvText || '', prefs: a.prefs || { want: '', location: '', notify: true }, hasPassword: Boolean(a.hash), google: Boolean(a.google), createdAt: a.createdAt };
    }
    function attachApp(a, token, jobId) {
      a.apps = a.apps || [];
      if (!a.apps.some(function (x) { return x.token === token; })) a.apps.unshift({ token: token, jobId: jobId, at: new Date(now()).toISOString() });
      a.apps = a.apps.slice(0, 100);
    }

    ops.accountSignup = async function (a) {
      var email = cleanEmail(a.email), name = clip(a.name, 80).trim();
      var pw = String(a.password || '');
      if (!email) throw fail(400, 'Enter a valid email address.');
      if (!name) throw fail(400, 'Enter your name.');
      if (pw.length < 8 || pw.length > 100) throw fail(400, 'Use a password of at least 8 characters.');
      var k = 'acct:' + await sha256(email);
      if (await kv.get(k)) throw fail(409, 'An account with that email already exists. Sign in instead.');
      var salt = randHex(16);
      var acct = { id: 'u_' + randHex(8), email: email, name: name, salt: salt, hash: await hashPassword(pw, salt), profile: null, cvText: '',
        prefs: { want: '', location: '', notify: true }, apps: [], jobs: [], pv: 0, verified: false, createdAt: new Date(now()).toISOString() };
      await saveAcct(k, acct);
      return { session: await newSession(k, acct), account: acctPublic(acct) };
    };

    ops.accountLogin = async function (a) {
      var email = cleanEmail(a.email), pw = String(a.password || '').slice(0, 100);
      var k = 'acct:' + await sha256(email || 'none');
      var fk = 'fail:' + k;
      var fails = (await kv.get(fk)) || 0;
      if (fails >= 8) throw fail(429, 'Too many wrong attempts. Try again in 15 minutes.');
      var acct = email ? await kv.get(k) : null;
      var got = await hashPassword(pw, acct ? acct.salt : '00'.repeat(16));
      if (!acct || !acct.hash || !sameText(got, acct.hash)) {
        await kv.set(fk, fails + 1, 15 * 60 * 1000);
        throw fail(401, 'Email or password is wrong.');
      }
      await kv.del(fk);
      return { session: await newSession(k, acct), account: acctPublic(acct) };
    };

    ops.accountLogout = async function (a) {
      if (/^s_[0-9a-f]{32}$/.test(String(a.session || ''))) await kv.del('sess:' + a.session);
      return { ok: true };
    };

    ops.accountMe = async function (a) {
      var u = await loadAcct(a.session), acct = u.a, dirty = false;
      var apps = [];
      for (var i = 0; i < (acct.apps || []).length && i < 50; i++) {
        var ap = acct.apps[i];
        var c = await kv.get('cand:' + ap.token);
        if (!c) { acct.apps.splice(i, 1); i--; dirty = true; continue; }
        var job = await kv.get('job:' + c.jobId);
        apps.push({
          token: c.id, jobId: c.jobId, title: job ? job.title : 'Role no longer listed', company: job ? job.company : '',
          open: job ? job.status === 'open' : false, appliedAt: c.createdAt, expiresAt: c.expiresAt,
          status: c.stage || 'new', statusLabel: STATUS_LABEL[c.stage] || 'Received', interviewed: Boolean(c.interview)
        });
      }
      var jobs = [];
      for (var j = 0; j < (acct.jobs || []).length; j++) {
        var jb = await kv.get('job:' + acct.jobs[j].id);
        if (!jb) { acct.jobs.splice(j, 1); j--; dirty = true; continue; }
        var ids = await kv.smembers('jobcands:' + jb.id);
        jobs.push({ id: jb.id, key: acct.jobs[j].key, title: jb.title, company: jb.company, status: jb.status, code: jb.code || '', createdAt: jb.createdAt, applicants: ids.length });
      }
      if (dirty) await saveAcct(u.k, acct);
      return { account: acctPublic(acct), apps: apps, jobs: jobs };
    };

    ops.accountSave = async function (a) {
      var u = await loadAcct(a.session), acct = u.a;
      if (a.name != null) { var n = clip(a.name, 80).trim(); if (n) acct.name = n; }
      if (a.profile != null) acct.profile = cleanProfile(a.profile);
      if (a.cvText != null) acct.cvText = clip(a.cvText, 12000);
      if (a.prefs && typeof a.prefs === 'object') var old = acct.prefs || {};
        acct.prefs = {
          want: a.prefs.want != null ? clip(a.prefs.want, 120).trim() : (old.want || ''),
          location: a.prefs.location != null ? clip(a.prefs.location, 80).trim() : (old.location || ''),
          notify: a.prefs.notify != null ? a.prefs.notify !== false : old.notify !== false
        };
      await saveAcct(u.k, acct);
      return { account: acctPublic(acct) };
    };

    ops.accountAttach = async function (a) {
      var u = await loadAcct(a.session), acct = u.a, n = 0;
      var tokens = (Array.isArray(a.tokens) ? a.tokens : []).slice(0, 50);
      for (var i = 0; i < tokens.length; i++) {
        var c = await kv.get('cand:' + clip(tokens[i], 60));
        if (c) { attachApp(acct, c.id, c.jobId); n++; }
      }
      await saveAcct(u.k, acct);
      return { attached: n };
    };

    ops.accountSyncJobs = async function (a) {
      var u = await loadAcct(a.session), acct = u.a;
      acct.jobs = acct.jobs || [];
      var list = (Array.isArray(a.jobs) ? a.jobs : []).slice(0, 50);
      for (var i = 0; i < list.length; i++) {
        try {
          var jb = await authJob(list[i].id, list[i].key);
          if (!acct.jobs.some(function (x) { return x.id === jb.id; })) acct.jobs.unshift({ id: jb.id, key: String(list[i].key) });
          if (jb.owner !== u.k) { jb.owner = u.k; await kv.set('job:' + jb.id, jb, JOB_TTL); }
        } catch (e) { /* ignore keys that do not match */ }
      }
      acct.jobs = acct.jobs.slice(0, 100);
      await saveAcct(u.k, acct);
      return { count: acct.jobs.length };
    };

    ops.accountDelete = async function (a) {
      var u = await loadAcct(a.session);
      if (u.a.hash) {
        var got = await hashPassword(String(a.password || '').slice(0, 100), u.a.salt);
        if (!sameText(got, u.a.hash)) throw fail(403, 'That password is not right.');
      }
      await kv.del(u.k);
      await kv.del('sess:' + a.session);
      return { deleted: true };
    };

    /* ---- forgot password, Google sign-in ---- */

    ops.accountForgot = async function (a) {
      var email = cleanEmail(a.email);
      var configured = Boolean(mail);
      if (!email) throw fail(400, 'Enter a valid email address.');
      if (!configured) return { sent: false, configured: false };
      var k = 'acct:' + await sha256(email);
      var tries = (await kv.get('forgot:' + k)) || 0;
      if (tries >= 3) throw fail(429, 'Too many reset requests. Try again in an hour.');
      await kv.set('forgot:' + k, tries + 1, 60 * 60 * 1000);
      var acct = await kv.get(k);
      if (acct) {
        var token = 'r_' + randHex(16);
        await kv.set('reset:' + await sha256(token), k, 30 * 60 * 1000);
        var link = siteUrl() + '/account?reset=' + token;
        await notify(email, 'Reset your Scout password',
          'Hi ' + acct.name + ',\n\nUse this link to choose a new password. It works for 30 minutes:\n' + link + '\n\nIf you did not ask for this, ignore this email. Your password stays the same.');
      }
      // Same answer whether or not the account exists, so emails cannot be probed.
      return { sent: true, configured: true };
    };

    ops.accountReset = async function (a) {
      var token = String(a.token || '');
      var pw = String(a.password || '');
      if (!/^r_[0-9a-f]{32}$/.test(token)) throw fail(400, 'This reset link is not valid.');
      if (pw.length < 8 || pw.length > 100) throw fail(400, 'Use a password of at least 8 characters.');
      var th = await sha256(token);
      var k = await kv.get('reset:' + th);
      var acct = k ? await kv.get(k) : null;
      if (!acct) throw fail(400, 'This reset link has expired. Ask for a new one.');
      acct.salt = randHex(16);
      acct.hash = await hashPassword(pw, acct.salt);
      acct.pv = (acct.pv || 0) + 1;       // signs out every other device
      acct.verified = true;               // they proved they own the email
      await saveAcct(k, acct);
      await kv.del('reset:' + th);
      await kv.del('fail:' + k);
      return { session: await newSession(k, acct), account: acctPublic(acct) };
    };

    ops.accountGoogle = async function (a) {
      if (typeof opts.verifyGoogle !== 'function') throw fail(503, 'Google sign-in is not switched on for this site.');
      var g;
      try { g = await opts.verifyGoogle(String(a.credential || '')); } catch (e) { g = null; }
      var email = g && g.verified ? cleanEmail(g.email) : '';
      if (!email) throw fail(401, 'Google could not confirm that account. Try again.');
      var k = 'acct:' + await sha256(email);
      var acct = await kv.get(k);
      if (!acct) {
        acct = { id: 'u_' + randHex(8), email: email, name: clip(g.name || email.split('@')[0], 80), salt: '', hash: '', google: true, profile: null, cvText: '',
          prefs: { want: '', location: '', notify: true }, apps: [], jobs: [], pv: 0, verified: true, createdAt: new Date(now()).toISOString() };
      } else {
        acct.google = true;
        if (acct.verified === false) {
          // Someone may have registered this email without owning it. Google proves ownership, so
          // remove any password set before and sign out every old session.
          acct.salt = ''; acct.hash = ''; acct.pv = (acct.pv || 0) + 1; acct.verified = true;
        }
      }
      await saveAcct(k, acct);
      return { session: await newSession(k, acct), account: acctPublic(acct) };
    };

    /* ---- candidate side ---- */

    ops.apply = async function (a) {
      var job = await loadJob(a.jobId);
      if (job.status !== 'open') throw fail(410, 'This role is no longer accepting applications.');
      var name = clip(a.name, 80).trim();
      var cv = clip(a.cv, 12000).trim();
      if (!name) throw fail(400, 'Name is required.');
      if (cv.length < 30) throw fail(400, 'Add your CV text (at least 30 characters).');
      var links = a.links || {};
      var t = now();
      var c = {
        id: 'c_' + randHex(16),
        jobId: job.id,
        name: name,
        phone: clip(a.phone, 30),
        email: clip(a.email, 80),
        location: clip(a.location, 80),
        links: { linkedin: cleanUrl(links.linkedin), github: cleanUrl(links.github) },
        cv: cv,
        profile: cleanProfile(a.profile),
        consent: a.consent === true,
        source: 'applied',
        stage: 'new',
        screen: null,
        contactedAt: null,
        interview: null,
        createdAt: new Date(t).toISOString(),
        expiresAt: new Date(t + CANDIDATE_TTL).toISOString()
      };
      await saveCand(c);
      await kv.sadd('jobcands:' + job.id, c.id);
      if (a.session) {
        try {
          var u = await loadAcct(a.session); attachApp(u.a, c.id, job.id); await saveAcct(u.k, u.a);
          c.acct = u.k; await saveCand(c);
          if (u.a.prefs && u.a.prefs.notify !== false) await notify(u.a.email, 'Application received: ' + job.title,
            'Hi ' + u.a.name + ',\n\nYour application for ' + job.title + (job.company ? ' at ' + job.company : '') + ' was received. Follow its status in your account:\n' + siteUrl() + '/account\n\nA person reviews every application.');
        } catch (e) { /* applying works without an account */ }
      }
      if (job.owner) {
        try {
          var owner = await kv.get(job.owner);
          if (owner && (!owner.prefs || owner.prefs.notify !== false)) {
            var n = (await kv.smembers('jobcands:' + job.id)).length;
            if (n <= 5 || n % 10 === 0) await notify(owner.email, 'New applicant for ' + job.title,
              'Someone applied for ' + job.title + ' (' + n + ' applicant' + (n === 1 ? '' : 's') + ' so far). Open your dashboard to see them ranked:\n' + siteUrl() + '/hire');
          }
        } catch (e) { /* never block an application */ }
      }
      return { token: c.id, expiresAt: c.expiresAt };
    };

    ops.candidateGet = async function (a) {
      var c = await loadCand(a.token);
      var job = null;
      try { job = jobPublic(await loadJob(c.jobId)); } catch (e) { job = null; }
      return { candidate: forCandidate(c), job: job };
    };

    ops.interviewSave = async function (a) {
      var c = await loadCand(a.token);
      var arr = function (x, n, m) { return (Array.isArray(x) ? x : []).slice(0, n).map(function (s) { return clip(s, m); }); };
      c.interview = {
        summary: clip(a.summary, 900),
        confidence: ['low', 'medium', 'high'].indexOf(a.confidence) >= 0 ? a.confidence : 'medium',
        confirmedReqs: arr(a.confirmedReqs, 10, 120),
        openReqs: arr(a.openReqs, 10, 120),
        followUpQuestions: arr(a.followUpQuestions, 3, 240),
        transcript: (Array.isArray(a.transcript) ? a.transcript : []).slice(0, 40).map(function (m) {
          return { role: m && m.role === 'ai' ? 'ai' : 'candidate', text: clip(m && m.text, 1500) };
        }),
        at: new Date(now()).toISOString()
      };
      await saveCand(c);
      return { ok: true };
    };

    ops.candidateDelete = async function (a) {
      var c = await loadCand(a.token);
      await kv.del('cand:' + c.id);
      await kv.srem('jobcands:' + c.jobId, c.id);
      return { deleted: true };
    };

    /* ---- recruiter side ---- */

    ops.candidates = async function (a) {
      var job = await authJob(a.jobId, a.key);
      var ids = await kv.smembers('jobcands:' + job.id);
      var out = [];
      for (var i = 0; i < ids.length; i++) {
        var c = await kv.get('cand:' + ids[i]);
        if (!c) { await kv.srem('jobcands:' + job.id, ids[i]); continue; }
        out.push(forRecruiter(c));
      }
      out.sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
      return { candidates: out };
    };

    ops.candidateAdd = async function (a) {
      var job = await authJob(a.jobId, a.key);
      var cv = clip(a.cv, 12000).trim();
      if (cv.length < 20) throw fail(400, 'Paste the CV text first.');
      var t = now();
      var c = {
        id: 'c_' + randHex(16),
        jobId: job.id,
        name: clip(a.name, 80).trim() || 'Unnamed candidate',
        phone: '', email: '', location: '', links: { linkedin: '', github: '' },
        cv: cv, consent: false, source: 'manual', stage: 'new', screen: null,
        contactedAt: null, interview: null,
        createdAt: new Date(t).toISOString(),
        expiresAt: new Date(t + CANDIDATE_TTL).toISOString()
      };
      await saveCand(c);
      await kv.sadd('jobcands:' + job.id, c.id);
      return { candidate: forRecruiter(c) };
    };

    function cleanScreen(s) {
      if (!s || typeof s !== 'object') return null;
      return {
        reqSig: clip(s.reqSig, 400),
        usedAi: s.usedAi === true,
        now: isFinite(parseFloat(s.now)) ? Math.max(0, Math.min(100, Math.round(parseFloat(s.now)))) : null,
        at: clip(s.at, 40),
        summary: clip(s.summary, 400),
        checks: (Array.isArray(s.checks) ? s.checks : []).slice(0, MAX_REQS).map(function (k) {
          return {
            reqId: clip(k && k.reqId, 24),
            status: ['met', 'not_stated', 'not_met'].indexOf(k && k.status) >= 0 ? k.status : 'not_stated',
            evidence: clip(k && k.evidence, 400),
            note: clip(k && k.note, 300)
          };
        }),
        questions: (Array.isArray(s.questions) ? s.questions : []).slice(0, 4).map(function (q) { return clip(q, 240); })
      };
    }

    async function applyPatch(c, p) {
      p = p || {};
      if (p.stage != null) {
        if (STAGES.indexOf(p.stage) < 0) throw fail(400, 'Unknown stage.');
        var before = c.stage;
        c.stage = p.stage;
        if (p.stage === 'shortlist' && before !== 'shortlist' && c.acct) {
          try {
            var ua = await kv.get(c.acct);
            var jb2 = await kv.get('job:' + c.jobId);
            if (ua && (!ua.prefs || ua.prefs.notify !== false)) await notify(ua.email, 'Good news: you were shortlisted' + (jb2 ? ' for ' + jb2.title : ''),
              'Hi ' + ua.name + ',\n\nThe recruiter shortlisted your application' + (jb2 ? ' for ' + jb2.title : '') + '. They may contact you soon. Follow it in your account:\n' + siteUrl() + '/account');
          } catch (e) { /* notification is best effort */ }
        }
      }
      if (p.contactedAt !== undefined) c.contactedAt = p.contactedAt ? clip(p.contactedAt, 40) : null;
      if (p.screen !== undefined) c.screen = cleanScreen(p.screen);
      await saveCand(c);
    }

    ops.candidatePatch = async function (a) {
      var job = await authJob(a.jobId, a.key);
      var c = await loadCand(a.candId);
      if (c.jobId !== job.id) throw fail(404, 'Application not found for this job.');
      await applyPatch(c, a.patch);
      return { candidate: forRecruiter(c) };
    };

    // Save many screening results in one call: [{ candId, screen }]
    ops.screensSave = async function (a) {
      var job = await authJob(a.jobId, a.key);
      var list = Array.isArray(a.results) ? a.results.slice(0, 40) : [];
      var saved = 0;
      for (var i = 0; i < list.length; i++) {
        var c = await kv.get('cand:' + clip(list[i] && list[i].candId, 60));
        if (!c || c.jobId !== job.id) continue;
        await applyPatch(c, { screen: list[i].screen });
        saved++;
      }
      return { saved: saved };
    };

    ops.candidateRemove = async function (a) {
      var job = await authJob(a.jobId, a.key);
      var c = await loadCand(a.candId);
      if (c.jobId !== job.id) throw fail(404, 'Application not found for this job.');
      await kv.del('cand:' + c.id);
      await kv.srem('jobcands:' + job.id, c.id);
      return { removed: true };
    };

    return ops;
  }

  return {
    createCore: createCore,
    memoryKV: memoryKV,
    localKV: localKV,
    upstashKV: upstashKV,
    OPS: ['accountForgot', 'accountReset', 'accountGoogle', 'jobByCode', 'jobShortLink', 'accountSignup', 'accountLogin', 'accountLogout', 'accountMe', 'accountSave', 'accountAttach', 'accountSyncJobs', 'accountDelete', 'jobCreate', 'jobGet', 'jobsOpen', 'jobScores', 'jobUpdate', 'apply', 'candidateGet', 'interviewSave', 'candidateDelete',
      'candidates', 'candidateAdd', 'candidatePatch', 'screensSave', 'candidateRemove'],
    STAGES: STAGES,
    CANDIDATE_TTL: CANDIDATE_TTL
  };
});
