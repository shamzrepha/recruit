/*
 * Job seeker page: upload a CV once, get a profile, see open roles ranked for you
 * (with where you would stand), pick roles and apply. Also browse every open role.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = CvTools.esc;
  var call = ScoutData.call;
  var st = { text: '', image: null, profile: null, parsedAi: false, matches: [], selected: {}, ai: false, jobs: [], applied: null };

  function icon(n) { return '<svg class="ic" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
  function ago(iso) {
    var d = Math.floor((Date.now() - new Date(iso)) / 86400000);
    return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 30 ? d + ' days ago' : 'Over a month ago';
  }
  var HUES = ['#2563eb', '#7c3aed', '#0d9488', '#db2777', '#ea580c', '#4f46e5', '#0891b2'];
  function avatar(name, big) {
    var n = (name || '?').trim(), h = 0;
    for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return '<span class="logo' + (big ? ' lg' : '') + '" style="background:' + HUES[h % HUES.length] + '" aria-hidden="true">' + esc(n.charAt(0).toUpperCase()) + '</span>';
  }
  function badges(j) { return '<span class="badge">' + esc(j.type) + '</span><span class="badge">' + esc(j.workMode) + '</span>'; }
  var STATE = { met: 'Stated', not_stated: 'Not stated', not_met: 'Contradicted' };

  fetch('/api/screen', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (d) { st.ai = Boolean(d && d.ai); }).catch(function () {});

  /* ------------------------------------------------------------ tabs */
  function showTab(which) {
    $('match-panel').hidden = which !== 'match';
    $('browse-panel').hidden = which !== 'browse';
    $('tab-match').setAttribute('aria-pressed', String(which === 'match'));
    $('tab-browse').setAttribute('aria-pressed', String(which === 'browse'));
    if (which !== 'match') $('apply-bar').hidden = true; else updateBar();
    if (which === 'browse' && !browseLoaded) loadBrowse();
  }
  $('tab-match').addEventListener('click', function () { showTab('match'); });
  $('tab-browse').addEventListener('click', function () { showTab('browse'); });

  function setStep(n) {
    Array.prototype.forEach.call(document.querySelectorAll('#stepper li'), function (li, i) {
      li.classList.toggle('done', i + 1 < n);
      li.classList.toggle('current', i + 1 === n);
      if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    [1, 2, 3, 4].forEach(function (k) { $('step-' + k).hidden = k !== n; });
    $('apply-bar').hidden = n !== 3;
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------ my applications (this browser) */
  function myApps() { try { return JSON.parse(localStorage.getItem('scout2:myapps')) || []; } catch (e) { return []; } }
  function saveApps(a) { try { localStorage.setItem('scout2:myapps', JSON.stringify(a)); } catch (e) { /* blocked */ } }
  function paintApps(remote) {
    var apps = remote && remote.length ? remote.map(function (r) { return { token: r.token, jobId: r.jobId, title: r.title, company: r.company, at: r.appliedAt, chatted: r.interviewed, label: r.statusLabel }; }) : myApps();
    var box = $('apps-box');
    if (!apps.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<h2 class="card-h">Your applications</h2><ul class="list">' + apps.map(function (a) {
      return '<li><div class="list-row">' + avatar(a.company || a.title) + '<span class="lr-main"><strong>' + esc(a.title) + '</strong><small>' + esc(a.company || '') + ' &middot; applied ' + esc(ago(a.at)) + (a.label ? ' &middot; ' + esc(a.label) : '') + '</small></span>' +
        '<a class="btn secondary sm" href="/interview?token=' + encodeURIComponent(a.token) + '">' + (a.chatted ? 'View chat' : 'Short chat') + '</a></div></li>';
    }).join('') + '</ul>';
  }

  /* ------------------------------------------------------------ step 1: upload */
  function uploadError(m) { $('upload-msg').textContent = m || ''; }
  function busy(msg) { var b = $('ocr-status'); b.hidden = !msg; if (msg) $('ocr-msg').textContent = msg; }

  async function handleFile(file) {
    uploadError(''); $('vision-box').hidden = true; busy('Reading your CV...');
    try {
      var r = await CvTools.extract(file, busy);
      st.image = r.image;
      if (r.image) $('vision-box').hidden = false;
      if (r.text.replace(/\s/g, '').length < 40) { busy(''); uploadError('Almost nothing could be read from that file. Try a clearer photo, the vision reader below, or paste your CV text.'); return; }
      await buildProfile(r.text);
    } catch (err) { busy(''); uploadError(err.message); }
  }

  async function buildProfile(text) {
    busy('Building your profile...');
    st.text = text;
    var p = await CvTools.parse(text);
    busy('');
    st.profile = p.profile; st.parsedAi = p.ai;
    paintProfile(p);
    setStep(2);
  }

  CvTools.wireDropzone($('dropzone'), $('cvfile'), $('browse-btn'), handleFile);
  var imgBtn = $('browse-img-btn'), imgInput = $('cvfile-img');
  if (imgBtn && imgInput) {
    imgBtn.addEventListener('click', function (e) { e.stopPropagation(); imgInput.click(); });
    imgInput.addEventListener('change', function () { if (imgInput.files && imgInput.files[0]) handleFile(imgInput.files[0]); });
  }
  $('btn-paste').addEventListener('click', function () { $('paste-box').hidden = false; $('paste-cv').focus(); });
  $('btn-use-paste').addEventListener('click', function () {
    var t = $('paste-cv').value.trim();
    if (t.length < 40) { uploadError('Paste a bit more of your CV (at least a few lines).'); return; }
    uploadError(''); buildProfile(t).catch(function (e) { busy(''); uploadError(e.message); });
  });
  $('btn-vision').addEventListener('click', async function () {
    if (!st.image) return;
    if (!confirm('Your CV image will be sent securely to a Groq vision model. Continue?')) return;
    busy('Reading with the vision model...');
    try { var t = await CvTools.vision(st.image); if (t) await buildProfile(t); else { busy(''); uploadError('The vision reader found no text.'); } }
    catch (e) { busy(''); uploadError(e.message); }
  });

  /* ------------------------------------------------------------ step 2: profile */
  var phoneIn = $('f-phone'), phoneFb = $('phone-feedback');
  phoneIn.addEventListener('input', function () {
    var v = phoneIn.value.trim();
    if (!v) { phoneFb.textContent = ''; phoneFb.className = 'field-msg'; return; }
    var n = Engine.normalizePhone(v);
    if (n.valid) { phoneFb.textContent = 'Saved as ' + n.e164; phoneFb.className = 'field-msg success'; }
    else { phoneFb.textContent = n.error; phoneFb.className = 'field-msg error'; }
  });

  function paintProfile(p) {
    var pr = st.profile;
    $('profile-card').innerHTML = '<div class="card-head tight"><h2>Your profile</h2><span class="chip ' + (p.ai ? 'ok' : '') + '">' + (p.ai ? 'Built by AI' : 'Basic reader') + '</span></div>' + CvTools.profileHtml(pr) +
      (pr.suggestedRoles && pr.suggestedRoles.length ? '<div class="pf-block"><h4>Roles that could suit you</h4><div class="chips">' + pr.suggestedRoles.map(function (r) { return '<span class="chip info">' + esc(r) + '</span>'; }).join('') + '</div></div>' : '');
    $('parse-note').textContent = p.ai ? 'We filled these in from your CV. Fix anything that is wrong.' : (p.note || 'The AI is not connected, so a basic reader filled these in. Please check them and fix anything that is wrong.');
    $('f-name').value = pr.name || ''; $('f-email').value = pr.email || ''; $('f-phone').value = pr.phone || '';
    $('f-location').value = pr.location || '';
    if (!$('f-want').value && pr.suggestedRoles && pr.suggestedRoles[0]) $('f-want').value = pr.suggestedRoles[0];
    phoneIn.dispatchEvent(new Event('input'));
  }

  $('btn-restart').addEventListener('click', function () { st.text = ''; st.profile = null; setStep(1); });

  $('profile-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('f-name').value.trim(), phone = $('f-phone').value.trim();
    var msg = $('form-msg'); msg.textContent = '';
    if (!name) { msg.textContent = 'Please enter your name.'; $('f-name').focus(); return; }
    if (phone) { var n = Engine.normalizePhone(phone); if (!n.valid) { msg.textContent = 'Check your phone number: ' + n.error; phoneIn.focus(); return; } phone = n.e164; }
    st.profile.name = name; st.profile.email = $('f-email').value.trim(); st.profile.phone = phone; st.profile.location = $('f-location').value.trim();
    st.me = { name: name, email: st.profile.email, phone: phone, location: st.profile.location, want: $('f-want').value.trim(), consent: $('f-consent').checked };
    if (ScoutData.session()) ScoutData.call('accountSave', { session: ScoutData.session(), profile: st.profile, cvText: st.text, prefs: { want: $('f-want').value.trim(), location: st.profile.location } }).catch(function () {});
    runMatch();
  });

  /* ------------------------------------------------------------ step 3: match */
  var STOP = /^(a|an|the|and|or|for|in|at|of|to|with|jobs?|roles?|work|looking|want|find|remote)$/i;

  async function screenOne(job) {
    var text = Engine.cvWithProfile(st.text, st.profile);
    var reqs = job.requirements.map(function (r) { return { id: r.id, text: r.text, weight: r.weight }; });
    if (st.ai) {
      try {
        var resp = await fetch('/api/screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requirements: reqs, candidates: [{ id: 'me', name: st.profile.name, cv: text }] }) });
        var data = await resp.json();
        if (resp.ok && data.results && data.results[0]) return { checks: data.results[0].checks, ai: true };
      } catch (e) { /* fall back */ }
    }
    return { checks: Engine.demoScreen(reqs, [{ id: 'me', name: st.profile.name, cv: text }])[0].checks, ai: false };
  }

  function prefHit(job, want, loc) {
    var hay = (job.title + ' ' + job.jd).toLowerCase();
    var words = String(want || '').toLowerCase().split(/[^a-z0-9+#]+/).filter(function (w) { return w.length > 2 && !STOP.test(w); });
    var wantRemote = /remote/i.test(want || '');
    var roleHit = words.some(function (w) { return hay.indexOf(w) >= 0; });
    var locHit = Boolean(loc) && Boolean(job.location) && (job.location.toLowerCase().indexOf(String(loc).toLowerCase().split(',')[0].trim()) >= 0 || (wantRemote && job.workMode === 'Remote'));
    if (wantRemote && job.workMode === 'Remote') locHit = true;
    return { role: roleHit, place: locHit };
  }

  async function runMatch() {
    setStep(3);
    $('match-results').innerHTML = '';
    var status = $('match-status'); status.hidden = false;
    $('match-msg').textContent = 'Looking at the open roles...';
    var jobs = [];
    try { jobs = (await call('jobsOpen', {})).jobs || []; } catch (e) { jobs = []; }
    st.jobs = jobs;
    if (!jobs.length) {
      status.hidden = true;
      $('match-results').innerHTML = '<div class="empty-state"><div class="empty-ic">' + icon('briefcase') + '</div><h2>No open roles yet</h2><p>Employers have not listed any roles here yet. Your profile is ready, so come back soon. If you were sent a link to a specific role, open that link instead.</p><div class="row"><button class="btn secondary" id="back-profile">Back to my profile</button></div></div>';
      $('back-profile').onclick = function () { setStep(2); };
      return;
    }
    var out = [];
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      $('match-msg').textContent = 'Checking your CV against role ' + (i + 1) + ' of ' + jobs.length + ': ' + j.title;
      var r = await screenOne(j);
      var sc = Engine.score(j.requirements, r.checks);
      var dist = []; try { dist = (await call('jobScores', { id: j.id })).scores || []; } catch (e) { dist = []; }
      var pf = prefHit(j, st.me.want, st.me.location);
      out.push({ job: j, checks: r.checks, ai: r.ai, sc: sc, sug: Engine.suggestion(sc), rank: Engine.percentile(sc.now, dist), pref: pf, key: sc.now + (pf.role ? 8 : 0) + (pf.place ? 4 : 0) });
    }
    status.hidden = true;
    out.sort(function (a, b) { return b.key - a.key || b.sc.potential - a.sc.potential; });
    st.matches = out; st.selected = {};
    var done = myApps().map(function (a) { return a.jobId; });
    out.forEach(function (m) { if (done.indexOf(m.job.id) >= 0) m.applied = true; });
    paintMatches();
  }

  function rankLine(m) {
    if (m.applied) return '<span class="rank done">' + icon('check') + ' You applied</span>';
    if (!m.rank.enough) return '<span class="rank">' + (m.rank.n === 0 ? 'No applicants yet. You could be the first.' : 'Too few applicants to rank you yet.') + '</span>';
    return '<span class="rank ' + (m.rank.top <= 25 ? 'good' : '') + '">You would be ahead of ' + m.rank.ahead + '% of the ' + m.rank.n + ' applicants so far (top ' + m.rank.top + '%).</span>';
  }

  function paintMatches() {
    var any = st.matches.some(function (m) { return m.pref.role || m.pref.place; });
    $('match-results').innerHTML =
      '<div class="page-sub"><h2>Roles for ' + esc((st.profile.name || '').split(/\s+/)[0] || 'you') + '</h2><p class="muted">' + st.matches.length + ' open role' + (st.matches.length === 1 ? '' : 's') + ', best fit first.' + (st.matches.some(function (m) { return !m.ai; }) ? ' ' + (st.ai ? 'Some' : 'All') + ' matches use keyword checking, so treat them as a first pass.' : '') + ' Pick the ones you want to apply to.</p></div>' +
      '<ul class="match-list">' + st.matches.map(function (m, i) {
        var j = m.job, id = esc(j.id);
        var met = m.checks.filter(function (k) { return k.status === 'met'; });
        var open = m.checks.filter(function (k) { return k.status === 'not_stated'; }).length;
        var gap = m.checks.filter(function (k) { return k.status === 'not_met'; }).length;
        var by = {}; m.checks.forEach(function (k) { by[k.reqId] = k; });
        var bar = '<div class="bar" role="img" aria-label="' + m.sc.now + ' percent match">' + j.requirements.map(function (r) {
          var s = by[r.id] ? by[r.id].status : 'not_stated';
          return '<span class="seg s-' + s + '" style="flex:' + Engine.weightOf(r) + '" title="' + esc(r.text + ': ' + STATE[s]) + '"></span>';
        }).join('') + '</div>';
        return '<li class="match-card' + (st.selected[j.id] ? ' picked' : '') + '">' +
          '<label class="mc-pick"><input type="checkbox" data-pick="' + id + '"' + (st.selected[j.id] ? ' checked' : '') + (m.applied ? ' disabled' : '') + '><span class="visually-hidden">Apply to ' + esc(j.title) + '</span></label>' +
          avatar(j.company || j.title, true) +
          '<div class="mc-main"><div class="mc-top"><div><h3>' + esc(j.title) + (i === 0 && !m.applied ? ' <span class="chip ok">Best fit</span>' : '') + '</h3><p class="jc-co">' + esc(j.company || 'Company') + (j.location ? ' &middot; ' + esc(j.location) : '') + '</p></div>' +
          '<div class="mc-score ' + (m.sc.now >= 70 ? 'hi' : m.sc.now >= 45 ? 'mid' : 'lo') + '"><b>' + m.sc.now + '%</b><small>' + (m.sc.potential > m.sc.now ? 'up to ' + m.sc.potential + '%' : 'match') + '</small></div></div>' +
          '<div class="jc-badges">' + badges(j) + (m.pref.role ? '<span class="badge soft">Matches the role you want</span>' : '') + (m.pref.place ? '<span class="badge soft">Near you</span>' : '') + '</div>' +
          bar +
          '<p class="mc-sum">' + esc(m.sug.text) + '. ' + met.length + ' of ' + j.requirements.length + ' requirements shown on your CV' + (open ? ', ' + open + ' not stated' : '') + (gap ? ', ' + gap + ' contradicted' : '') + '.</p>' +
          '<p class="mc-rank">' + rankLine(m) + '</p>' +
          '<details class="why"><summary>Why this score</summary><ul class="why-list">' + j.requirements.map(function (r) {
            var k = by[r.id] || { status: 'not_stated', note: '', evidence: '' };
            return '<li><span class="st ' + k.status + '"><span class="seg s-' + k.status + '"></span>' + STATE[k.status] + '</span><span>' + esc(r.text) + (k.status === 'not_stated' ? '<small>Add it to your CV if it applies to you.</small>' : '') + (k.evidence ? '<small>&ldquo;' + esc(k.evidence) + '&rdquo;</small>' : '') + '</span></li>';
          }).join('') + '</ul></details></div></li>';
      }).join('') + '</ul>';
    updateBar();
  }

  function pickedIds() { return Object.keys(st.selected).filter(function (k) { return st.selected[k]; }); }
  function updateBar() {
    var onMatch = !$('step-3').hidden && !$('match-panel').hidden;
    var n = pickedIds().length;
    $('apply-bar').hidden = !onMatch || !st.matches.length;
    $('apply-count').textContent = n ? n + (n === 1 ? ' role selected' : ' roles selected') : 'Pick the roles you want to apply to';
    $('btn-apply').textContent = n ? 'Apply to ' + n + (n === 1 ? ' role' : ' roles') : 'Apply';
    $('btn-apply').disabled = !n;
  }
  $('match-results').addEventListener('change', function (e) {
    var id = e.target.dataset && e.target.dataset.pick;
    if (!id) return;
    st.selected[id] = e.target.checked;
    e.target.closest('.match-card').classList.toggle('picked', e.target.checked);
    updateBar();
  });
  $('btn-select-best').addEventListener('click', function () {
    st.matches.forEach(function (m) { if (!m.applied && m.sc.now >= 60) st.selected[m.job.id] = true; });
    if (!pickedIds().length && st.matches[0] && !st.matches[0].applied) st.selected[st.matches[0].job.id] = true;
    paintMatches();
  });

  $('btn-apply').addEventListener('click', async function () {
    var ids = pickedIds();
    if (!ids.length) return;
    var btn = $('btn-apply'); btn.disabled = true; btn.textContent = 'Applying...';
    var ok = [], failed = [];
    for (var i = 0; i < ids.length; i++) {
      var m = st.matches.filter(function (x) { return x.job.id === ids[i]; })[0];
      try {
        var res = await call('apply', {
          jobId: m.job.id, name: st.profile.name, cv: st.text, phone: st.me.phone, email: st.me.email, location: st.me.location,
          consent: st.me.consent, links: { linkedin: st.profile.links && st.profile.links.linkedin, github: st.profile.links && (st.profile.links.github || st.profile.links.portfolio) },
          profile: st.profile, session: ScoutData.session() || undefined
        });
        ok.push({ m: m, token: res.token });
      } catch (err) { failed.push({ m: m, msg: err.message }); }
    }
    var apps = myApps();
    ok.forEach(function (o) { apps.unshift({ token: o.token, jobId: o.m.job.id, title: o.m.job.title, company: o.m.job.company, at: new Date().toISOString() }); o.m.applied = true; st.selected[o.m.job.id] = false; });
    saveApps(apps); paintApps();
    st.applied = { ok: ok, failed: failed };
    paintDone();
  });

  /* ------------------------------------------------------------ step 4 */
  function paintDone() {
    var a = st.applied;
    $('step-4').innerHTML =
      '<div class="done-card card pad"><div class="done-ic">' + icon('check') + '</div><h2>' + (a.ok.length ? 'You applied to ' + a.ok.length + (a.ok.length === 1 ? ' role' : ' roles') : 'No applications were sent') + '</h2>' +
      '<p class="muted">' + (st.me.consent ? 'Recruiters can see your CV, your profile and the contact details you shared.' : 'Recruiters can see your CV and profile. Your phone and email were not stored.') + '</p>' +
      (a.ok.length ? '<ul class="list" style="margin-top:20px">' + a.ok.map(function (o) {
        return '<li><div class="list-row">' + avatar(o.m.job.company || o.m.job.title) + '<span class="lr-main"><strong>' + esc(o.m.job.title) + '</strong><small>' + esc(o.m.job.company || '') + (o.m.rank.enough ? ' &middot; estimated top ' + o.m.rank.top + '%' : '') + '</small></span>' +
          '<a class="btn sm" href="/interview?token=' + encodeURIComponent(o.token) + '">Do the short chat</a></div></li>';
      }).join('') + '</ul><p class="hint" style="margin-top:12px">The chat is three friendly questions and is optional. It helps the recruiter get to know you.</p>' : '') +
      (a.failed.length ? '<div class="banner bad" style="margin-top:16px"><span>' + a.failed.map(function (f) { return esc(f.m.job.title) + ': ' + esc(f.msg); }).join('<br>') + '</span></div>' : '') +
      '<div id="track-cta" class="banner info" hidden style="margin-top:20px;text-align:left"></div>' +
      '<div class="row" style="margin-top:24px"><button class="btn secondary" id="more-roles">Back to my matches</button><button class="btn ghost" id="new-cv">Use a different CV</button></div></div>';
    setStep(4);
    ScoutData.accountsAvailable().then(function (ok) {
      if (!ok) return;
      var c = $('track-cta'); if (!c) return; c.hidden = false;
      c.innerHTML = ScoutData.session()
        ? '<span><strong>Track these applications.</strong> Your status updates appear in your account as recruiters review them.</span><a class="btn sm" href="/account">Open my account</a>'
        : '<span><strong>Want to track these?</strong> Create a free account to see each status update, and keep your profile for next time.</span><a class="btn sm" href="/account?next=%2Fjobs#create">Create account</a>';
    });
    $('more-roles').onclick = function () { paintMatches(); setStep(3); };
    $('new-cv').onclick = function () { st.text = ''; st.profile = null; setStep(1); };
  }

  /* ------------------------------------------------------------ browse all roles */
  var browseLoaded = false, jobs = [], type = 'All', q = '', loc = '', selected = '';
  var TYPES = ['All', 'Full-time', 'Part-time', 'Contract', 'Internship'];

  async function loadBrowse() {
    try { jobs = (await call('jobsOpen', {})).jobs || []; } catch (e) { jobs = []; }
    browseLoaded = true;
    paintBrowse();
  }
  function filtered() {
    return jobs.filter(function (j) {
      if (type !== 'All' && j.type !== type) return false;
      if (q && (j.title + ' ' + j.company + ' ' + j.jd).toLowerCase().indexOf(q.toLowerCase()) < 0) return false;
      if (loc && (j.location + ' ' + j.workMode).toLowerCase().indexOf(loc.toLowerCase()) < 0) return false;
      return true;
    });
  }
  function paintBrowse() {
    var list = filtered();
    $('type-filters').innerHTML = TYPES.map(function (t) { return '<button type="button" data-type="' + t + '" aria-pressed="' + (type === t) + '">' + t + '</button>'; }).join('');
    $('count').textContent = list.length + (list.length === 1 ? ' open role' : ' open roles');
    var split = $('split');
    if (!jobs.length) { split.className = 'board-split empty'; split.innerHTML = '<div class="empty-state"><h2>No open roles yet</h2><p>Employers have not listed any roles here yet. If you were sent a link to a specific role, open that link instead.</p></div>'; return; }
    if (!list.length) { split.className = 'board-split empty'; split.innerHTML = '<div class="empty-state"><h2>No roles match</h2><p>Try a different keyword or clear a filter.</p><div class="row"><button class="btn secondary" id="clear">Clear filters</button></div></div>'; $('clear').onclick = function () { type = 'All'; q = ''; loc = ''; $('q').value = ''; $('loc').value = ''; paintBrowse(); }; return; }
    var sel = list.filter(function (j) { return j.id === selected; })[0];
    if (!sel && !selected && window.matchMedia('(min-width: 901px)').matches) sel = list[0];
    split.className = 'board-split' + (selected && sel ? ' has-selection' : '');
    split.innerHTML = '<ul class="job-cards" aria-label="Open roles">' + list.map(function (j) {
      return '<li><button type="button" class="job-card" data-job="' + esc(j.id) + '"' + (sel && sel.id === j.id ? ' aria-current="true"' : '') + '>' + avatar(j.company || j.title) +
        '<div class="jc-body"><h3>' + esc(j.title) + '</h3><p class="jc-co">' + esc(j.company || 'Company') + '</p><p class="jc-meta">' + (j.location ? icon('pin') + esc(j.location) : '') + '</p><div class="jc-badges">' + badges(j) + '</div></div><span class="jc-ago">' + ago(j.createdAt) + '</span></button></li>';
    }).join('') + '</ul><div class="job-detail">' + (sel ? detail(sel) : '') + '</div>';
  }
  function detail(j) {
    var must = j.requirements.filter(function (r) { return r.weight !== 'nice'; });
    var nice = j.requirements.filter(function (r) { return r.weight === 'nice'; });
    var link = ScoutData.applyLink(j).replace(location.origin, '');
    return '<article class="jd"><button type="button" class="crumb back-mobile" data-back>' + icon('arrow-left') + ' All jobs</button>' +
      '<header class="jd-head">' + avatar(j.company || j.title, true) + '<div><h2>' + esc(j.title) + '</h2><p class="jd-co">' + esc(j.company || 'Company') + (j.location ? ' &middot; ' + esc(j.location) : '') + '</p><div class="jc-badges">' + badges(j) + '<span class="badge soft">' + icon('clock') + ' ' + ago(j.createdAt) + '</span></div></div></header>' +
      '<div class="jd-apply"><a class="btn lg" href="' + esc(link) + '">Apply to this role</a><button type="button" class="btn secondary lg" data-matchme>See how my CV matches</button>' +
      (j.applyUrl ? '<a class="btn ghost lg" href="' + esc(j.applyUrl) + '" target="_blank" rel="noopener">🌐 Verified company post &rarr;</a>' : '') + '</div>' +
      (j.jd ? '<section><h3>About the role</h3><div class="prose">' + esc(j.jd) + '</div></section>' : '') +
      (must.length ? '<section><h3>What we are looking for</h3><ul class="ticks">' + must.map(function (r) { return '<li>' + icon('check') + esc(r.text) + '</li>'; }).join('') + '</ul></section>' : '') +
      (nice.length ? '<section><h3>Nice to have</h3><ul class="ticks soft">' + nice.map(function (r) { return '<li>' + icon('check') + esc(r.text) + '</li>'; }).join('') + '</ul></section>' : '') +
      '<section class="jd-note">' + icon('shield') + '<p><strong>How your application is reviewed.</strong> AI suggests how your CV matches these requirements. A person reads every application and makes every decision. If something is not on your CV it is marked &ldquo;verify&rdquo;, not rejected. Your phone and email are shared only if you tick the box.</p></section></article>';
  }
  $('type-filters').addEventListener('click', function (e) { var b = e.target.closest('[data-type]'); if (b) { type = b.dataset.type; selected = ''; paintBrowse(); } });
  $('split').addEventListener('click', function (e) {
    var c = e.target.closest('[data-job]'); if (c) { selected = c.dataset.job; paintBrowse(); if (!window.matchMedia('(min-width: 901px)').matches) window.scrollTo(0, 0); return; }
    if (e.target.closest('[data-back]')) { selected = ''; paintBrowse(); return; }
    if (e.target.closest('[data-matchme]')) showTab('match');
  });
  $('search-form').addEventListener('submit', function (e) { e.preventDefault(); q = $('q').value.trim(); loc = $('loc').value.trim(); selected = ''; paintBrowse(); });

  /* ------------------------------------------------------------ account (optional) */
  var acct = null;
  ScoutData.me().then(function (m) {
    acct = m;
    if (!m) return;
    var a = m.account;
    paintApps(m.apps);
    if (a.profile && a.cvText) {
      var box = $('saved-cv'); box.hidden = false;
      box.innerHTML = '<div class="lr-main"><strong>Welcome back, ' + esc((a.name || '').split(/\s+/)[0]) + '</strong><small>Your saved CV and profile are ready. No need to upload again.</small></div>' +
        '<div class="row"><button type="button" class="btn" id="use-saved">Use my saved CV</button><a class="btn ghost" href="/account">My account</a></div>';
      $('use-saved').onclick = function () {
        st.text = a.cvText; st.profile = JSON.parse(JSON.stringify(a.profile)); st.parsedAi = true;
        paintProfile({ ai: true, note: '' });
        $('parse-note').textContent = 'This is your saved profile. Update anything that has changed.';
        if (a.prefs && a.prefs.want) $('f-want').value = a.prefs.want;
        if (a.prefs && a.prefs.location && !$('f-location').value) $('f-location').value = a.prefs.location;
        if (a.email && !$('f-email').value) $('f-email').value = a.email;
        setStep(2);
      };
    }
  }).catch(function () {});

  paintApps();
  if (/^#\/?j_/.test(location.hash)) { selected = location.hash.replace(/^#\/?/, ''); showTab('browse'); $('tab-browse').click(); }
})();
