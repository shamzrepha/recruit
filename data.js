/*
 * Browser data layer. One API for every page.
 *
 *   mode "remote": the server has durable storage (Redis), so calls go to /api/data
 *                  and applicants on any device reach the recruiter.
 *   mode "local" : no durable server storage, so the same rules (core.js) run in
 *                  this browser against localStorage. Applicant and recruiter must
 *                  use the same browser, which is enough for a demo.
 *
 * Recruiters have no accounts. Each job has a private key kept in this browser
 * (and in the private recruiter link). Whoever holds the link can manage the job.
 */
(function (root) {
  'use strict';

  var core = root.ScoutCore;
  var local = null;
  var mode = null;
  var ready = null;

  function storage() {
    try { return root.localStorage; } catch (e) { return null; }
  }

  function getLocal() {
    if (!local) local = core.createCore(core.localKV(storage() || { setItem: function () { throw new Error('x'); } }, 'scout2:'));
    return local;
  }

  function detect() {
    if (!ready) {
      ready = fetch('/api/data?action=status', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : { persistent: false }; })
        .then(function (d) { mode = d && d.persistent ? 'remote' : 'local'; })
        .catch(function () { mode = 'local'; });
    }
    return ready;
  }

  async function call(op, args) {
    await detect();
    if (mode === 'local') return getLocal()[op](args || {});
    var resp = await fetch('/api/data?action=' + encodeURIComponent(op), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    });
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) {
      var e = new Error(data.error || 'Request failed (' + resp.status + ').');
      e.status = resp.status;
      throw e;
    }
    return data;
  }

  /* ---- recruiter bookmarks: which jobs this browser can manage ---- */

  var BOOK = 'scout2:myjobs';

  function myJobs() {
    try { return JSON.parse(storage().getItem(BOOK)) || []; } catch (e) { return []; }
  }
  function saveMyJobs(list) {
    try { storage().setItem(BOOK, JSON.stringify(list)); } catch (e) { /* storage blocked */ }
  }
  function rememberJob(job, key) {
    var list = myJobs().filter(function (j) { return j.id !== job.id; });
    list.unshift({ id: job.id, key: key, title: job.title, company: job.company || '', createdAt: job.createdAt });
    saveMyJobs(list);
  }
  function forgetJob(id) { saveMyJobs(myJobs().filter(function (j) { return j.id !== id; })); }
  function keyFor(id) {
    var j = myJobs().filter(function (x) { return x.id === id; })[0];
    return j ? j.key : '';
  }

  /* ---- shareable apply link ----
   * The role's public details travel inside the link, so the apply page can
   * show the role even when the data lives only in the recruiter's browser.
   */

  function b64(s) {
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(atob(s)));
  }

  function applyLink(job) {
    var snap = { t: job.title, c: job.company || '', r: job.requirements.map(function (r) { return [r.id, r.text, r.weight]; }) };
    return location.origin + '/apply?job=' + encodeURIComponent(job.id) + '&s=' + b64(JSON.stringify(snap));
  }

  function readSnapshot(s) {
    try {
      var o = JSON.parse(unb64(s));
      return {
        title: String(o.t || ''), company: String(o.c || ''),
        requirements: (o.r || []).map(function (x) { return { id: x[0], text: x[1], weight: x[2] === 'nice' ? 'nice' : 'must' }; })
      };
    } catch (e) { return null; }
  }

  root.ScoutData = {
    call: call,
    mode: function () { return detect().then(function () { return mode; }); },
    myJobs: myJobs, rememberJob: rememberJob, forgetJob: forgetJob, keyFor: keyFor,
    applyLink: applyLink, readSnapshot: readSnapshot
  };
})(typeof self !== 'undefined' ? self : this);
