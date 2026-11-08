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
  var STAGES = ['new', 'shortlist', 'ask', 'pass'];
  var MAX_REQS = 20;

  /* ---------------------------------------------------------------- helpers */

  function fail(status, message) {
    var e = new Error(message);
    e.status = status;
    return e;
  }

  function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }

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

    function jobPublic(j) {
      return {
        id: j.id, title: j.title, company: j.company, jd: j.jd,
        requirements: j.requirements, status: j.status, createdAt: j.createdAt
      };
    }

    // What a recruiter may see of a candidate.
    function forRecruiter(c) {
      var out = JSON.parse(JSON.stringify(c));
      if (!out.consent) { out.phone = ''; out.email = ''; }
      if (out.interview) delete out.interview.transcript;
      return out;
    }

    // What a candidate may see of themselves (no recruiter notes or screening).
    function forCandidate(c) {
      var out = JSON.parse(JSON.stringify(c));
      delete out.stage; delete out.screen; delete out.contactedAt;
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
        requirements: reqs,
        status: 'open',
        createdAt: new Date(now()).toISOString()
      };
      await kv.set('job:' + job.id, job, JOB_TTL);
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
      if (p.status === 'open' || p.status === 'closed') j.status = p.status;
      await kv.set('job:' + j.id, j, JOB_TTL);
      return { job: jobPublic(j) };
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
        c.stage = p.stage;
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
    OPS: ['jobCreate', 'jobGet', 'jobUpdate', 'apply', 'candidateGet', 'interviewSave', 'candidateDelete',
      'candidates', 'candidateAdd', 'candidatePatch', 'screensSave', 'candidateRemove'],
    STAGES: STAGES,
    CANDIDATE_TTL: CANDIDATE_TTL
  };
});
