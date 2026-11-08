/* Account page: sign in or create an account, track applications, keep a profile, see jobs you manage. */
(function () {
  'use strict';
  var root = document.getElementById('acct');
  var esc = CvTools.esc;
  var call = ScoutData.call;
  var params = new URLSearchParams(location.search);
  var next = params.get('next') || '';
  if (!/^\/[^/\\]/.test(next)) next = '';
  var tab = location.hash === '#create' ? 'create' : 'login';
  var resetToken = /^r_[0-9a-f]{32}$/.test(params.get('reset') || '') ? params.get('reset') : '';
  var cfg = { googleClientId: '', mail: false };

  function icon(n) { return '<svg class="ic" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
  function fmt(iso) { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  var HUES = ['#2563eb', '#7c3aed', '#0d9488', '#db2777', '#ea580c', '#4f46e5', '#0891b2'];
  function logo(name) { var n = (name || '?').trim(), h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return '<span class="logo" style="background:' + HUES[h % HUES.length] + '">' + esc(n.charAt(0).toUpperCase()) + '</span>'; }

  function track(status) {
    var steps = [['new', 'Received'], ['ask', 'Under review'], ['shortlist', 'Shortlisted']];
    if (status === 'pass') return '<div class="track"><span class="on">Received</span><i></i><span class="on no">Not selected</span></div>';
    var at = Math.max(0, steps.map(function (s) { return s[0]; }).indexOf(status));
    return '<div class="track">' + steps.map(function (s, i) {
      return '<span class="' + (i <= at ? 'on' : '') + (s[0] === 'shortlist' ? ' good' : '') + '">' + s[1] + '</span>' + (i < steps.length - 1 ? '<i></i>' : '');
    }).join('') + '</div>';
  }

  function unavailable() {
    root.innerHTML = '<div class="empty-state"><div class="empty-ic">' + icon('lock') + '</div><h2>Accounts are not switched on</h2><p>Accounts need shared storage on the server. The site owner needs to connect the Upstash Redis storage in Vercel. Until then, applying and hiring still work, saved only in this browser.</p><div class="row"><a class="btn" href="/jobs">Find work</a><a class="btn secondary" href="/hire">Employers</a></div></div>';
  }

  function authView() {
    var create = tab === 'create';
    root.innerHTML = '<div class="card auth-card"><div class="mode-switch" role="group" aria-label="Sign in or create account" style="margin-bottom:20px"><button type="button" data-tab="login" aria-pressed="' + !create + '">Sign in</button><button type="button" data-tab="create" aria-pressed="' + create + '">Create account</button></div>' +
      (cfg.googleClientId ? '<div id="g-btn" class="g-btn"></div><div class="or-line"><span>or use email</span></div>' : '') +
      '<form id="auth-form" novalidate>' +
      (create ? '<div class="field"><label class="label" for="a-name">Your name</label><input id="a-name" type="text" maxlength="80" autocomplete="name" required></div>' : '') +
      '<div class="field"><label class="label" for="a-email">Email</label><input id="a-email" type="email" maxlength="120" autocomplete="email" required></div>' +
      '<div class="field"><label class="label" for="a-pw">Password</label><input id="a-pw" type="password" maxlength="100" autocomplete="' + (create ? 'new-password' : 'current-password') + '" required>' + (create ? '<p class="hint">At least 8 characters.</p>' : '') + '</div>' +
      '<p id="a-msg" class="field-msg error" role="alert"></p>' +
      '<button class="btn lg" type="submit" id="a-go">' + (create ? 'Create account' : 'Sign in') + '</button>' +
      (!create && cfg.mail ? '<p class="hint"><button type="button" class="link-btn" id="forgot-link">Forgot your password?</button></p>' : '') +
      '<p class="hint">' + (create ? 'Job seekers keep their profile and track applications. Employers get their jobs on every device.' : 'Use the email and password you created here.') + '</p></form></div>';
    mountGoogle();
  }

  function mountGoogle() {
    var box = document.getElementById('g-btn');
    if (!box || !cfg.googleClientId) return;
    function render() {
      if (!window.google || !google.accounts || !google.accounts.id) return;
      google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogle, ux_mode: 'popup', auto_select: false });
      google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: tab === 'create' ? 'signup_with' : 'signin_with', shape: 'rectangular', width: Math.max(200, Math.min(340, box.parentNode.clientWidth - 40)) });
    }
    if (window.google && google.accounts) return render();
    var sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = render;
    sc.onerror = function () { box.innerHTML = '<p class="hint">Google sign-in could not load. Use your email instead.</p>'; };
    document.head.appendChild(sc);
  }

  async function onGoogle(resp) {
    var msg = document.getElementById('a-msg');
    try { await finishSignIn(await call('accountGoogle', { credential: resp.credential })); }
    catch (err) { if (msg) msg.textContent = err.message; }
  }

  async function finishSignIn(res) {
    ScoutData.setSession(res.session);
    await ScoutData.adoptLocal();
    await ScoutData.pullJobs();
    if (next) { location.href = next; return; }
    start();
  }

  function forgotView(done) {
    root.innerHTML = '<div class="card auth-card"><h2 class="card-h">Reset your password</h2>' + (done
      ? '<p>If an account exists for that email, a reset link is on its way. It works for 30 minutes. Check your spam folder too.</p><p><button type="button" class="btn secondary" data-tab="login">Back to sign in</button></p>'
      : '<form id="forgot-form" novalidate><p class="muted">Enter your email and we will send you a link to choose a new password.</p><div class="field"><label class="label" for="f-email">Email</label><input id="f-email" type="email" maxlength="120" autocomplete="email" required></div><p id="a-msg" class="field-msg error" role="alert"></p><button class="btn lg" type="submit" id="a-go">Send reset link</button><p class="hint"><button type="button" class="link-btn" data-tab="login">Back to sign in</button></p></form>') + '</div>';
  }

  function resetView() {
    root.innerHTML = '<div class="card auth-card"><h2 class="card-h">Choose a new password</h2><form id="reset-form" novalidate><div class="field"><label class="label" for="r-pw">New password</label><input id="r-pw" type="password" maxlength="100" autocomplete="new-password" required><p class="hint">At least 8 characters. This signs you out of other devices.</p></div><p id="a-msg" class="field-msg error" role="alert"></p><button class="btn lg" type="submit" id="a-go">Save and sign in</button></form></div>';
  }

  async function submitAuth(e) {
    e.preventDefault();
    var msg = document.getElementById('a-msg'); msg.textContent = '';
    var btn = document.getElementById('a-go'); btn.disabled = true;
    try {
      var body = { email: document.getElementById('a-email').value, password: document.getElementById('a-pw').value };
      var res;
      if (tab === 'create') { body.name = document.getElementById('a-name').value; res = await call('accountSignup', body); }
      else res = await call('accountLogin', body);
      await finishSignIn(res);
    } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  }

  function appsHtml(apps) {
    if (!apps.length) return '<div class="empty-state" style="margin:8px auto"><p>No applications yet. Upload your CV and apply to roles that fit.</p><div class="row"><a class="btn" href="/jobs">Find roles for me</a></div></div>';
    return apps.map(function (a) {
      return '<div class="app-card"><div class="app-top">' + logo(a.company || a.title) + '<span class="lr-main"><strong>' + esc(a.title) + '</strong><small>' + esc(a.company || '') + ' &middot; applied ' + esc(fmt(a.appliedAt)) + (a.open ? '' : ' &middot; role closed') + '</small></span><span class="chip ' + (a.status === 'shortlist' ? 'ok' : a.status === 'pass' ? '' : 'info') + '">' + esc(a.statusLabel) + '</span></div>' +
        track(a.status) +
        '<div class="row"><a class="btn secondary sm" href="/interview?token=' + encodeURIComponent(a.token) + '">' + (a.interviewed ? 'View chat summary' : 'Do the short chat') + '</a><button class="btn danger sm" data-withdraw="' + esc(a.token) + '">Withdraw</button></div>' +
        '<p class="hint">Your application is kept for 30 days, until ' + esc(fmt(a.expiresAt)) + '.</p></div>';
    }).join('');
  }

  function jobsHtml(jobs) {
    return jobs.map(function (j) {
      var link = location.origin + (j.code ? '/a/' + j.code : '/apply?job=' + j.id);
      return '<div class="app-card"><div class="app-top">' + logo(j.company || j.title) + '<span class="lr-main"><strong>' + esc(j.title) + '</strong><small>' + j.applicants + ' applicant' + (j.applicants === 1 ? '' : 's') + ' &middot; ' + (j.status === 'open' ? 'Open' : 'Closed') + '</small></span><a class="btn sm" href="/hire#/job/' + esc(j.id) + '/applicants">Open</a></div>' +
        '<div class="link-box"><code class="short-link">' + esc(link) + '</code><button class="btn sm secondary" data-copy="' + esc(link) + '">Copy</button></div></div>';
    }).join('');
  }

  function dashboard(m) {
    var a = m.account;
    root.innerHTML =
      '<div class="acct-head"><div><p class="eyebrow">My account</p><h1>' + esc(a.name) + '</h1><p class="sub">' + esc(a.email) + '</p></div><div class="row"><a class="btn" href="/jobs">Find roles</a><button class="btn secondary" id="signout">Sign out</button></div></div>' +
      '<div class="stack-lg">' +
      '<section class="card pad"><h2 class="card-h">My applications</h2>' + appsHtml(m.apps) + '</section>' +
      '<section class="card pad"><div class="card-head tight"><h2>My profile</h2><a class="btn secondary sm" href="/jobs">Update my CV</a></div>' +
      (a.profile ? CvTools.profileHtml(a.profile) : '<p class="muted">No profile yet. Upload your CV on the Find roles page and Scout builds it for you. Next time you will not need to upload it again.</p>') + '</section>' +
      (m.jobs.length ? '<section class="card pad"><h2 class="card-h">Jobs I manage</h2>' + jobsHtml(m.jobs) + '<p class="hint">Short links like these are easy to share on WhatsApp.</p></section>' : '') +
      '<section class="card pad"><h2 class="card-h">Email updates</h2><label class="check-row"><input type="checkbox" id="notify-box"' + (!a.prefs || a.prefs.notify !== false ? ' checked' : '') + '> <span>Email me when an application is received or shortlisted' + (m.jobs.length ? ', and when someone applies to my jobs' : '') + '.</span></label>' + (cfg.mail ? '' : '<p class="hint">Email is not switched on for this site yet, so no emails are sent for now.</p>') + '</section>' +
      '<section class="card pad"><h2 class="card-h">Delete my account</h2><p class="muted">This removes your account and saved profile. Applications you already sent stay with each recruiter until they expire; withdraw them first if you want them gone.</p>' +
      '<form id="del-form" class="pw-row" style="margin-top:12px">' + (a.hasPassword === false ? '' : '<label class="visually-hidden" for="del-pw">Password</label><input id="del-pw" type="password" placeholder="Your password" autocomplete="current-password">') + '<button class="btn danger" type="submit">Delete account</button></form><p id="del-msg" class="field-msg error"></p></section>' +
      '</div>';
  }

  async function start() {
    if (!(await ScoutData.accountsAvailable())) { unavailable(); return; }
    cfg = await ScoutData.config();
    var m = await ScoutData.me();
    if (!m) { if (resetToken) resetView(); else authView(); return; }
    dashboard(m);
    var l = document.getElementById('nav-account'); if (l) l.textContent = 'My account';
  }

  root.addEventListener('click', async function (e) {
    if (e.target.id === 'forgot-link') { forgotView(false); return; }
    var t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; history.replaceState(null, '', tab === 'create' ? '#create' : location.pathname + location.search); authView(); return; }
    if (e.target.id === 'signout') { try { await call('accountLogout', { session: ScoutData.session() }); } catch (x) { /* ignore */ } ScoutData.setSession(''); authView(); return; }
    var w = e.target.closest('[data-withdraw]');
    if (w) {
      if (!confirm('Withdraw this application? The recruiter will no longer see it.')) return;
      try { await call('candidateDelete', { token: w.dataset.withdraw }); } catch (x) { /* already gone */ }
      try { var apps = (JSON.parse(localStorage.getItem('scout2:myapps')) || []).filter(function (a) { return a.token !== w.dataset.withdraw; }); localStorage.setItem('scout2:myapps', JSON.stringify(apps)); } catch (x) { /* ignore */ }
      start(); return;
    }
    var c = e.target.closest('[data-copy]');
    if (c && navigator.clipboard) { navigator.clipboard.writeText(c.dataset.copy).then(function () { c.textContent = 'Copied'; setTimeout(function () { c.textContent = 'Copy'; }, 1500); }).catch(function () {}); }
  });
  root.addEventListener('change', async function (e) {
    if (e.target.id !== 'notify-box') return;
    try { await call('accountSave', { session: ScoutData.session(), prefs: { notify: e.target.checked } }); } catch (x) { e.target.checked = !e.target.checked; }
  });
  root.addEventListener('submit', async function (e) {
    if (e.target.id === 'auth-form') return submitAuth(e);
    if (e.target.id === 'forgot-form') {
      e.preventDefault();
      var fm = document.getElementById('a-msg'); fm.textContent = '';
      try { await call('accountForgot', { email: document.getElementById('f-email').value }); forgotView(true); }
      catch (err) { fm.textContent = err.message; }
      return;
    }
    if (e.target.id === 'reset-form') {
      e.preventDefault();
      var rm = document.getElementById('a-msg'); rm.textContent = '';
      try {
        var rr = await call('accountReset', { token: resetToken, password: document.getElementById('r-pw').value });
        history.replaceState(null, '', location.pathname); resetToken = '';
        await finishSignIn(rr);
      } catch (err) { rm.textContent = err.message; }
      return;
    }
    if (e.target.id === 'del-form') {
      e.preventDefault();
      var msg = document.getElementById('del-msg');
      try {
        await call('accountDelete', { session: ScoutData.session(), password: (document.getElementById('del-pw') || {}).value || '' });
        ScoutData.setSession(''); tab = 'create'; authView();
      } catch (err) { msg.textContent = err.message; }
    }
  });

  start();
})();
