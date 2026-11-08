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
  var config = { googleClientId: '', mail: false };

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
        .then(function (d) { mode = d && d.persistent ? 'remote' : 'local'; if (d) config = { googleClientId: d.googleClientId || '', mail: Boolean(d.mail) }; })
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

  /* ---- accounts: an optional sign-in, only when the server has shared storage ---- */

  var SESS = 'scout2:session';
  function session() { try { return storage().getItem(SESS) || ''; } catch (e) { return ''; } }
  function setSession(t) { try { if (t) storage().setItem(SESS, t); else storage().removeItem(SESS); } catch (e) { /* blocked */ } }
  async function accountsAvailable() { await detect(); return mode === 'remote'; }
  // Signed-in info, or null. A dead session is cleared.
  async function me() {
    if (!session() || !(await accountsAvailable())) return null;
    try { return await call('accountMe', { session: session() }); }
    catch (e) { if (e.status === 401) setSession(''); return null; }
  }
  // After signing in: move what this browser already has onto the account.
  async function adoptLocal() {
    try {
      var apps = JSON.parse(storage().getItem('scout2:myapps')) || [];
      if (apps.length) await call('accountAttach', { session: session(), tokens: apps.map(function (a) { return a.token; }) });
      if (myJobs().length) await call('accountSyncJobs', { session: session(), jobs: myJobs().map(function (j) { return { id: j.id, key: j.key }; }) });
    } catch (e) { /* best effort */ }
  }
  // Jobs on the account that this browser does not have yet.
  async function pullJobs() {
    var m = await me();
    if (!m) return;
    m.jobs.forEach(function (j) { rememberJobLocal({ id: j.id, title: j.title, company: j.company, createdAt: j.createdAt }, j.key); });
  }

  /* ---- recruiter bookmarks: which jobs this browser can manage ---- */

  var BOOK = 'scout2:myjobs';

  function myJobs() {
    try { return JSON.parse(storage().getItem(BOOK)) || []; } catch (e) { return []; }
  }
  function saveMyJobs(list) {
    try { storage().setItem(BOOK, JSON.stringify(list)); } catch (e) { /* storage blocked */ }
  }
  function rememberJobLocal(job, key) {
    var list = myJobs().filter(function (j) { return j.id !== job.id; });
    list.unshift({ id: job.id, key: key, title: job.title, company: job.company || '', createdAt: job.createdAt });
    saveMyJobs(list);
  }
  function rememberJob(job, key) {
    rememberJobLocal(job, key);
    // Signed-in employers keep their jobs on every device.
    if (session() && mode === 'remote') call('accountSyncJobs', { session: session(), jobs: [{ id: job.id, key: key }] }).catch(function () {});
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

  // Short link when the job has a code (for example /a/K7X3QP), the long one for older jobs.
  function applyLink(job) {
    if (job.code) return location.origin + '/a/' + job.code;
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

  // Header button reads "My account" once someone has signed in.
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      if (!session()) return;
      var a = document.getElementById('nav-account'), b = document.getElementById('nav-account-label');
      if (a && !b) a.textContent = 'My account';
      if (b) b.textContent = 'My account';
    });
  }

  root.ScoutData = {
    call: call,
    config: function () { return detect().then(function () { return config; }); },
    mode: function () { return detect().then(function () { return mode; }); },
    myJobs: myJobs, rememberJob: rememberJob, forgetJob: forgetJob, keyFor: keyFor,
    applyLink: applyLink, readSnapshot: readSnapshot,
    session: session, setSession: setSession, accountsAvailable: accountsAvailable, me: me, adoptLocal: adoptLocal, pullJobs: pullJobs
  };
})(typeof self !== 'undefined' ? self : this);
