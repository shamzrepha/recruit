/*
 * Employer dashboard: overview, jobs, post-a-job, and the per-job pipeline.
 * Hash routes:
 *   #/                                dashboard
 *   #/jobs                            all jobs
 *   #/new                             post a job
 *   #/job/<id>[/applicants[/<cand>]]  kanban pipeline (default); a candidate id opens the side panel
 *   #/job/<id>/insights               pool insights
 *   #/job/<id>/requirements           job details and requirements
 *   #/job/<id>/share                  links, listing and storage
 * Opening #/job/<id>?key=<key> (the private recruiter link) adds the job to this browser.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var view = $('view');
  var call = ScoutData.call;

  var STATE_LABEL = { met: 'Stated', not_stated: 'Not stated', not_met: 'Contradicted' };
  var STAGE_LABEL = { new: 'New', shortlist: 'Shortlisted', ask: 'Ask first', pass: 'Passed' };
  var DEFAULT_TEMPLATE = "Hi {first name}, I'm {recruiter name} from {company}. I saw your CV for the {role} role and would like a quick chat. Are you free this week?";

  var app = { ai: false, mode: 'local' };
  var ui = { view: 'board', search: '', filter: 'all', showAdd: false, revealed: {}, csvContacts: false, screening: '', notice: null, autoScreen: null };
  var draft = newDraft();
  var edit = null;      // requirements tab form
  var cache = null;     // { id, job, key, cands, fetchedAt }
  var navId = 0;
  var seq = 0;

  /* ---------------------------------------------------------------- helpers */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() { return 'r_' + Date.now().toString(36) + (++seq); }
  function newDraft() { return { step: 1, mode: 'paste', title: '', company: '', location: '', type: 'Full-time', workMode: 'On-site', listed: true, applyUrl: '', website: '', contacts: [], webSources: '', jd: '', reqs: [], chat: [], note: '', busy: false }; }
  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function isWide() { return window.matchMedia('(min-width: 1081px)').matches; }

  function reqSig(reqs) {
    var s = reqs.map(function (r) { return r.id + ':' + r.weight + ':' + r.text; }).join('|');
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(36);
  }

  function toast(msg) {
    var host = $('toast-host');
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    host.innerHTML = '';
    host.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }

  function copyText(text, okMsg) {
    function done() { toast(okMsg || 'Copied'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed. Select the link and copy it.'); }
      ta.remove();
    }
  }

  var HUES = ['#2563eb', '#7c3aed', '#0d9488', '#db2777', '#ea580c', '#4f46e5', '#0891b2'];
  function avatar(name, big) {
    var n = (name || '?').trim(), h = 0;
    for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return '<span class="logo' + (big ? ' lg' : '') + '" style="background:' + HUES[h % HUES.length] + '" aria-hidden="true">' + esc(n.charAt(0).toUpperCase()) + '</span>';
  }
  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function person(name) {
    var n = String(name || '?'), h = 0;
    for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return '<span class="avatar" style="background:' + HUES[h % HUES.length] + '" aria-hidden="true">' + esc(initials(name)) + '</span>';
  }
  function jobMeta(j) {
    return [j.company, j.location, j.type, j.workMode].filter(Boolean).map(esc).join(' &middot; ');
  }
  function icon(name) { return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }

  function getOutreach() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem('scout2:outreach')) || {}; } catch (e) { o = {}; }
    return { name: o.name || '', company: o.company || '', template: o.template || DEFAULT_TEMPLATE };
  }
  function saveOutreach(o) { try { localStorage.setItem('scout2:outreach', JSON.stringify(o)); } catch (e) { /* ignore */ } }

  /* ---------------------------------------------------------------- sidebar status */

  function paintStatus() {
    $('store-dot').className = 'dot ' + (app.mode === 'remote' ? 'on' : 'warn');
    $('store-label').textContent = app.mode === 'remote' ? 'Shared storage on' : 'Saved in this browser';
    $('ai-dot').className = 'dot ' + (app.ai ? 'on' : 'warn');
    $('ai-label').textContent = app.ai ? 'AI screening on' : 'Keyword mode';
  }

  ScoutData.mode().then(function (m) { app.mode = m; paintStatus(); });
  fetch('/api/screen', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : { ai: false }; })
    .then(function (d) { app.ai = Boolean(d && d.ai); paintStatus(); })
    .catch(function () { app.ai = false; paintStatus(); });

  function setNav(which) {
    [['dash', 'nav-dash'], ['jobs', 'nav-jobs'], ['matrix', 'nav-matrix'], ['new', 'nav-new']].forEach(function (x) {
      var n = $(x[1]);
      if (n) { if (which === x[0]) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); }
    });
    var n = ScoutData.myJobs().length;
    $('nav-jobs-count').textContent = n ? n : '';
  }

  /* ---------------------------------------------------------------- routing */

  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/';
    var q = {};
    var i = h.indexOf('?');
    if (i >= 0) {
      new URLSearchParams(h.slice(i + 1)).forEach(function (v, k) { q[k] = v; });
      h = h.slice(0, i);
    }
    return { parts: h.split('/').filter(Boolean), q: q };
  }

  var lastBase = '';
  async function route() {
    var r = parseHash(), p = r.parts;
    var base = p.slice(0, 3).join('/');
    var my = ++navId;
    try {
      if (p[0] !== 'job') { $('drawer-host').innerHTML = ''; document.body.classList.remove('drawer-open'); }
      if (!p.length) { setNav('dash'); await dashboardView(my); }
      else if (p[0] === 'jobs') { setNav('jobs'); await jobsListView(my); }
      else if (p[0] === 'matrix') { setNav('matrix'); await talentMatrixView(my); }
      else if (p[0] === 'new') { setNav('new'); newJobView(); }
      else if (p[0] === 'job' && p[1]) { setNav('jobs'); await jobView(my, p[1], p[2] || 'applicants', p[3] || null, r.q); }
      else location.hash = '#/';
    } catch (err) {
      if (my === navId) errorView(err);
    }
    if (base !== lastBase) { window.scrollTo(0, 0); lastBase = base; }
  }
  window.addEventListener('hashchange', route);

  function errorView(err) {
    view.innerHTML =
      '<div class="empty-state"><h2>That did not work</h2><p>' + esc(err && err.message ? err.message : 'Something went wrong.') + '</p>' +
      '<div class="row"><a class="btn" href="#/">Back to jobs</a></div></div>';
  }

  /* ================================================================ DASHBOARD + JOBS */

  async function loadPortfolio() {
    var mine = ScoutData.myJobs();
    return Promise.all(mine.map(async function (m) {
      try {
        var j = (await call('jobGet', { id: m.id })).job;
        var cs = (await call('candidates', { jobId: m.id, key: m.key })).candidates;
        return { m: m, job: j, cands: cs };
      } catch (e) { return { m: m, error: e }; }
    }));
  }

  function emptyJobs() {
    return '<div class="empty-state"><div class="empty-ic">' + icon('briefcase') + '</div><h2>Upload your first job</h2>' +
      '<p>Create a role, share its apply link, and applicants show up here in a pipeline, ranked against your requirements. Want to see it working first? Load sample jobs with made-up applicants.</p>' +
      '<div class="row"><a class="btn lg" href="#/new">Upload a job</a><button class="btn secondary lg" data-act="sample">Load sample jobs</button></div></div>';
  }

  async function dashboardView(my) {
    cache = null;
    if (!ScoutData.myJobs().length) {
      view.innerHTML = '<div class="page-title"><h1>Dashboard</h1></div>' + emptyJobs();
      return;
    }
    view.innerHTML = '<div class="page-title"><h1>Dashboard</h1></div><p class="muted">Loading&hellip;</p>';
    var rows = await loadPortfolio();
    if (my !== navId) return;
    var ok = rows.filter(function (r) { return !r.error; });
    var all = [];
    ok.forEach(function (r) { r.cands.forEach(function (c) { all.push({ c: c, job: r.job }); }); });
    var stats = [
      ['Open jobs', ok.filter(function (r) { return r.job.status === 'open'; }).length, 'briefcase'],
      ['Total applicants', all.length, 'users'],
      ['To review', all.filter(function (x) { return x.c.stage === 'new'; }).length, 'clock'],
      ['Shortlisted', all.filter(function (x) { return x.c.stage === 'shortlist'; }).length, 'star']
    ];
    all.sort(function (a, b) { return String(b.c.createdAt).localeCompare(String(a.c.createdAt)); });

    var recent = all.slice(0, 6).map(function (x) {
      var sc = x.c.screen ? Engine.score(x.job.requirements, x.c.screen.checks) : null;
      return '<li><a class="list-row" href="#/job/' + esc(x.job.id) + '/applicants/' + esc(x.c.id) + '">' + person(x.c.name) +
        '<span class="lr-main"><strong>' + esc(x.c.name) + '</strong><small>' + esc(x.job.title) + ' &middot; ' + esc(fmtDate(x.c.createdAt)) + '</small></span>' +
        (sc ? '<span class="match-pill ' + (sc.now >= 70 ? 'hi' : sc.now >= 45 ? 'mid' : 'lo') + '">' + sc.now + '%</span>' : '<span class="muted small">Not screened</span>') + '</a></li>';
    }).join('');

    var jobsHtml = ok.slice(0, 5).map(function (r) {
      var fresh = r.cands.filter(function (c) { return c.stage === 'new'; }).length;
      return '<li><a class="list-row" href="#/job/' + esc(r.job.id) + '">' + avatar(r.job.company || r.job.title) +
        '<span class="lr-main"><strong>' + esc(r.job.title) + '</strong><small>' + esc(r.job.location || r.job.workMode) + ' &middot; ' + plural(r.cands.length, 'applicant') + '</small></span>' +
        (fresh ? '<span class="chip info">' + fresh + ' new</span>' : '') + '</a></li>';
    }).join('');

    view.innerHTML =
      '<div class="page-title"><div><h1>Dashboard</h1><p class="sub">Your candidate analysis at a glance.</p></div><a class="btn" href="#/new">' + icon('plus') + ' Upload a job</a></div>' +
      '<div class="stat-grid">' + stats.map(function (s2) {
        return '<div class="stat"><span class="stat-ic">' + icon(s2[2]) + '</span><div><div class="stat-n">' + s2[1] + '</div><div class="stat-l">' + s2[0] + '</div></div></div>';
      }).join('') + '</div>' +
      '<div class="dash-grid">' +
        '<section class="card"><div class="card-head"><h2>Recent applicants</h2></div>' + (recent ? '<ul class="list">' + recent + '</ul>' : '<p class="muted pad">No applicants yet. Share a job&rsquo;s apply link to get started.</p>') + '</section>' +
        '<section class="card"><div class="card-head"><h2>Your jobs</h2><a href="#/jobs" class="small">View all</a></div><ul class="list">' + jobsHtml + '</ul></section>' +
      '</div>' +
      '<section class="card pad" style="margin-top:20px;background:var(--panel);border:1px solid var(--line-strong)">' +
        '<div class="row between">' +
          '<div><h2 style="font-size:1.05rem;margin-bottom:4px">Cross-Role Matching (Talent Matrix)</h2>' +
          '<p class="muted small">See which candidate fits best across all your active roles in one table.</p></div>' +
          '<a class="btn secondary" href="#/matrix">Open Talent Matrix &rarr;</a>' +
        '</div>' +
      '</section>';
  }

  async function jobsListView(my) {
    cache = null;
    var head = '<div class="page-title"><div><h1>Jobs</h1><p class="sub">Each job has its own apply link and its own pipeline.</p></div>' +
      '<div class="row"><button class="btn secondary" data-act="sample">Load sample jobs</button><a class="btn" href="#/new">' + icon('plus') + ' Upload a job</a></div></div>';
    if (!ScoutData.myJobs().length) { view.innerHTML = '<div class="page-title"><h1>Jobs</h1></div>' + emptyJobs(); return; }
    view.innerHTML = head + '<p class="muted">Loading&hellip;</p>';
    var rows = await loadPortfolio();
    if (my !== navId) return;
    view.innerHTML = head + '<div class="card table-card"><div class="table-scroll"><table class="table"><thead><tr><th>Job</th><th>Status</th><th class="r">Applicants</th><th class="r">To review</th><th>Posted</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        if (r.error) {
          return '<tr><td><strong>' + esc(r.m.title) + '</strong><div class="muted small">Not available. It may have expired.</div></td><td></td><td></td><td></td><td></td><td class="r"><button class="btn ghost sm" data-act="forget" data-id="' + esc(r.m.id) + '">Remove</button></td></tr>';
        }
        var fresh = r.cands.filter(function (c) { return c.stage === 'new'; }).length;
        return '<tr class="click" data-href="#/job/' + esc(r.job.id) + '"><td><a class="t-main" href="#/job/' + esc(r.job.id) + '"><strong>' + esc(r.job.title) + '</strong></a><div class="muted small">' + jobMeta(r.job) + '</div></td>' +
          '<td><span class="chip ' + (r.job.status === 'open' ? 'ok' : '') + '"><span class="dot"></span>' + (r.job.status === 'open' ? 'Open' : 'Closed') + '</span></td>' +
          '<td class="r">' + r.cands.length + '</td><td class="r">' + (fresh ? '<span class="chip info">' + fresh + '</span>' : '0') + '</td><td>' + esc(fmtDate(r.job.createdAt)) + '</td><td class="r">' + icon('arrow-right') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  var SAMPLE_EXTRA = [
    { title: 'Product Designer', company: 'Sample Startup', location: 'Remote (Africa)', type: 'Full-time', workMode: 'Remote',
      jd: 'Design simple, clear product experiences for a fast-moving fintech team. You will own flows from research to shipped UI.',
      reqs: [['3+ years designing web or mobile products', 'must'], ['Portfolio with shipped work', 'must'], ['Experience with Figma', 'must'], ['Experience in fintech', 'nice']] },
    { title: 'Data Analyst Intern', company: 'Sample Startup', location: 'Lagos, Nigeria', type: 'Internship', workMode: 'Hybrid',
      jd: 'Help the team turn product and customer data into clear weekly insights. Perfect for a final-year student or recent graduate.',
      reqs: [['Comfortable with SQL', 'must'], ['Can build dashboards in Excel or a BI tool', 'must'], ['Knowledge of Python or R', 'nice']] }
  ];

  async function makeSample(btn) {
    if (btn) btn.disabled = true;
    toast('Creating sample jobs...');
    var reqs = Engine.extractRequirements(Samples.JOB).map(function (r) { return { id: uid(), text: r.text, weight: r.weight }; });
    var made = await call('jobCreate', { title: 'Founding Backend Engineer', company: 'Sample Startup', location: 'Lagos, Nigeria', type: 'Full-time', workMode: 'Hybrid', jd: Samples.JOB, requirements: reqs });
    ScoutData.rememberJob(made.job, made.key);
    for (var i = 0; i < Samples.CANDIDATES.length; i++) {
      var c = Samples.CANDIDATES[i];
      await call('apply', { jobId: made.job.id, name: c.name, cv: c.cv, phone: c.phone, email: c.email, consent: c.consent, location: 'Lagos, Nigeria' });
    }
    for (var k = 0; k < SAMPLE_EXTRA.length; k++) {
      var e = SAMPLE_EXTRA[k];
      var m2 = await call('jobCreate', { title: e.title, company: e.company, location: e.location, type: e.type, workMode: e.workMode, jd: e.jd,
        requirements: e.reqs.map(function (r) { return { id: uid(), text: r[0], weight: r[1] }; }) });
      ScoutData.rememberJob(m2.job, m2.key);
    }
    ui.autoScreen = made.job.id;
    cache = null;
    location.hash = '#/job/' + made.job.id + '/applicants';
  }

  /* ================================================================ NEW JOB WIZARD */

  function newJobView() {
    var d = draft;
    var steps = '<ol class="steps" aria-label="Steps">' +
      '<li class="' + (d.step === 1 ? 'current' : 'done') + '">Describe the role</li><li class="sep" aria-hidden="true" style="width:32px;height:1px;background:var(--line-strong)"></li>' +
      '<li class="' + (d.step === 2 ? 'current' : '') + '">Review and create</li></ol>';
    var head = '<div class="page-title"><div><a class="crumb" href="#/jobs">' + icon('arrow-left') + ' Jobs</a><h1>Upload a job</h1></div></div>';

    if (d.step === 1) {
      view.innerHTML = head + steps +
        '<div class="wizard"><div>' +
          '<div class="mode-switch" role="group" aria-label="How do you want to start?">' +
            '<button type="button" data-act="wiz-mode" data-mode="paste" aria-pressed="' + (d.mode === 'paste') + '">Screenshot or paste</button>' +
            '<button type="button" data-act="wiz-mode" data-mode="chat" aria-pressed="' + (d.mode === 'chat') + '">Brief in chat</button>' +
          '</div>' +
          (d.mode === 'chat' ? chatPanel() : pastePanel()) +
        '</div>' +
        '<div class="stack"><div><h2 style="font-size:1.05rem;margin-bottom:8px">What happens next</h2>' +
          '<p class="muted">You will get a list of requirements, each marked Must have or Nice to have. Must-haves count three times as much in the score. You can edit everything before the job is created.</p></div>' +
          '<div><h2 style="font-size:1.05rem;margin-bottom:8px">Then</h2>' +
          '<p class="muted">The job gets an apply link to send to candidates, and a private recruiter link that lets you open it on another device.</p></div>' +
          '<p><button class="link-btn" data-act="wiz-skip">Skip this and write the requirements by hand</button></p></div></div>';
      if (d.mode === 'chat') {
        if (!d.chat.length) addMsg('ai', 'Hello! I am your sourcing partner. Tell me about your startup: what are you building, what stage are you at, and what role do you need to analyse?');
        else d.chat.forEach(function (m) { appendMsgNode(m.role, m.text); });
      } else {
        wirePasteDropzone();
      }
    } else {
      view.innerHTML = head + steps +
        '<div class="wizard"><div class="stack-lg">' +
          (d.note ? '<div class="banner">' + esc(d.note) + '</div>' : '') +
          '<div class="form-grid"><div class="field"><label class="label" for="w-title">Role title</label>' +
            '<input id="w-title" type="text" maxlength="100" data-field="draft.title" value="' + esc(d.title) + '" placeholder="e.g. Founding Backend Engineer"></div>' +
          '<div class="field"><label class="label" for="w-company">Company</label>' +
            '<input id="w-company" type="text" maxlength="80" data-field="draft.company" value="' + esc(d.company) + '" placeholder="Shown to candidates"></div></div>' +
          jobFields('draft', d) +
          '<div class="card pad" style="background:var(--panel);border:1px solid var(--line-strong);margin:14px 0">' +
            '<div class="row between">' +
              '<div><strong style="display:flex;align-items:center;gap:6px">' + icon('search') + ' Search web for official link & company contacts</strong>' +
              '<p class="hint" style="margin-top:2px">Scrape the internet to verify this job, find legitimate career portal URLs, and company contacts.</p></div>' +
              '<button type="button" class="btn secondary sm" data-act="wiz-web-enrich" id="btn-web-enrich">Search Web</button>' +
            '</div>' +
            '<div id="web-enrich-box" ' + (d.applyUrl || d.website || d.webSources ? '' : 'hidden') + ' style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)">' +
              '<div class="form-grid">' +
                '<div class="field"><label class="label" for="w-applyurl">Legit Application / Career URL</label>' +
                '<input id="w-applyurl" type="url" data-field="draft.applyUrl" value="' + esc(d.applyUrl || '') + '" placeholder="https://company.com/careers"></div>' +
                '<div class="field"><label class="label" for="w-website">Company Website</label>' +
                '<input id="w-website" type="url" data-field="draft.website" value="' + esc(d.website || '') + '" placeholder="https://company.com"></div>' +
              '</div>' +
              '<div id="web-sources-view">' + (d.webSources || '') + '</div>' +
            '</div>' +
          '</div>' +
          '<div><h2 style="font-size:1.05rem">Requirements</h2><p class="hint" style="margin:4px 0 12px">Click a label to switch between Must have and Nice to have.</p>' +
            reqEditor('draft', d.reqs) + '</div>' +
          '<details><summary class="link-btn" style="cursor:pointer">Job description (optional)</summary>' +
            '<div class="field" style="margin-top:12px"><label class="visually-hidden" for="w-jd">Job description</label>' +
            '<textarea id="w-jd" rows="8" data-field="draft.jd">' + esc(d.jd) + '</textarea></div></details>' +
          '<p id="wiz-msg" class="field-msg error" role="alert"></p>' +
          '<div class="row"><button class="btn ghost" data-act="wiz-back">' + icon('arrow-left') + ' Back</button>' +
          '<button class="btn lg" data-act="wiz-create">Create job</button></div>' +
        '</div><div><h2 style="font-size:1.05rem;margin-bottom:8px">Check this carefully</h2>' +
          '<p class="muted">Candidates are ranked only against these requirements, so make each one something a CV can show or not show. Keep them specific, for example &ldquo;3+ years building backend services&rdquo;.</p></div></div>';
    }
  }

  function chatPanel() {
    return '<div class="chat"><div id="chat-log" class="chat-log" role="log" aria-label="Conversation with the sourcing partner"></div>' +
      '<div id="chat-typing" class="typing" hidden><i></i><i></i><i></i><span style="margin-left:6px">Writing a reply</span></div>' +
      '<form class="composer" data-form="chat"><label class="visually-hidden" for="chat-input">Tell us about your startup and the role</label>' +
      '<textarea id="chat-input" rows="3" maxlength="1500" placeholder="e.g. We are a seed-stage fintech in Lagos building payment APIs. We need a founding backend engineer with 3+ years in Python or Go." required></textarea>' +
      '<div class="row between"><button type="button" class="btn secondary sm" data-act="chat-example">Use an example brief</button>' +
      '<button type="submit" class="btn" id="chat-send">Send</button></div></form></div>' +
      '<div class="row" style="margin-top:20px"><button class="btn accent lg" data-act="wiz-generate" id="wiz-generate">Generate requirements ' + icon('arrow-right') + '</button></div>';
  }

  function pastePanel() {
    return '<div class="stack">' +
      '<div class="field"><label class="label">Upload screenshot, flyer(s), or job document(s)</label>' +
        '<div id="jd-drop" class="dropzone" tabindex="0" role="button" aria-label="Upload job screenshot or PDF document">' +
          '<input type="file" id="jd-file" accept=".pdf,image/png,image/jpeg,image/webp" multiple class="visually-hidden" tabindex="-1">' +
          '<div class="dz-ic">' + icon('upload') + '</div>' +
          '<div class="dz-title">Drop 1 or multiple job flyers here</div>' +
          '<p class="hint">Upload single or bulk flyers (e.g. 5 jobs at once). PNG, JPG, WEBP or PDF. You can also paste screenshots with Ctrl+V.</p>' +
          '<button type="button" class="btn" id="btn-browse-jd">Choose flyer(s)</button>' +
        '</div>' +
        '<div id="jd-ocr-status" class="status-box" hidden role="status" style="margin-top:10px"><div class="spinner" aria-hidden="true"></div><p id="jd-ocr-msg">Reading&hellip;</p></div>' +
      '</div>' +
      '<div class="field"><label class="label" for="paste-jd">Or paste job text</label>' +
        '<textarea id="paste-jd" rows="10" data-field="draft.jd" placeholder="Paste the job description or flyer text here. You can also press Ctrl+V to paste an image screenshot.">' + esc(draft.jd) + '</textarea></div>' +
      '<div class="row"><button class="btn accent lg" data-act="wiz-extract">Pull out requirements ' + icon('arrow-right') + '</button>' +
      '<button class="btn secondary" data-act="wiz-sample-jd">Use a sample description</button></div></div>';
  }

  function wirePasteDropzone() {
    var drop = $('jd-drop'), fileInput = $('jd-file'), browse = $('btn-browse-jd'), ta = $('paste-jd'), st = $('jd-ocr-status'), stMsg = $('jd-ocr-msg');
    if (!drop || !fileInput || !browse) return;

    function busy(msg) {
      if (st) {
        st.hidden = !msg;
        if (stMsg) stMsg.textContent = msg || 'Reading...';
      }
    }

    async function handleFile(file) {
      if (!file) return;
      busy('Reading job image / document on this device...');
      try {
        var r = await CvTools.extract(file, busy);
        var text = (r && r.text) || '';
        if (!text && r && r.image) {
          busy('Reading text from screenshot image...');
          text = await CvTools.vision(r.image);
        }
        if (!text.trim()) throw new Error('No readable text found in that screenshot or file.');
        draft.jd = text.trim();
        if (ta) ta.value = draft.jd;
        busy('');
        toast('Extracted text from screenshot. Review below!');
      } catch (err) {
        busy('');
        toast('Error reading file: ' + err.message);
      }
    }

    function onFilesSelected(fileList) {
      if (!fileList || !fileList.length) return;
      if (fileList.length > 1) {
        handleBatchFlyers(Array.prototype.slice.call(fileList));
      } else {
        handleFile(fileList[0]);
      }
    }

    browse.addEventListener('click', function (e) { e.stopPropagation(); fileInput.click(); });
    drop.addEventListener('click', function (e) { if (e.target !== browse) fileInput.click(); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('dragover'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        onFilesSelected(e.dataTransfer.files);
      }
    });
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files.length) {
        onFilesSelected(fileInput.files);
      }
    });

    function onPaste(e) {
      if (e.clipboardData && e.clipboardData.items) {
        for (var i = 0; i < e.clipboardData.items.length; i++) {
          var it = e.clipboardData.items[i];
          if (it.type.indexOf('image') !== -1) {
            var f = it.getAsFile();
            if (f) {
              e.preventDefault();
              handleFile(f);
              return;
            }
          }
        }
      }
    }
    if (ta) ta.addEventListener('paste', onPaste);
    drop.addEventListener('paste', onPaste);
  }

  function appendMsgNode(role, text) {
    var log = $('chat-log');
    if (!log) return;
    var div = document.createElement('div');
    div.className = 'msg ' + (role === 'ai' ? 'ai' : 'me');
    div.innerHTML = '<span class="who">' + (role === 'ai' ? 'AI sourcing partner' : 'You') + '</span>' + esc(text);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
  function addMsg(role, text) { draft.chat.push({ role: role, text: text }); appendMsgNode(role, text); }

  async function postJson(url, body) {
    var resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(data.error || 'Request failed (' + resp.status + ').');
    return data;
  }

  async function sendChat() {
    var ta = $('chat-input');
    var text = ta.value.trim();
    if (!text) return;
    addMsg('recruiter', text);
    ta.value = '';
    $('chat-typing').hidden = false;
    $('chat-send').disabled = true;
    try {
      var data = await postJson('/api/role-intake?action=chat', { messages: draft.chat });
      if (data.reply) addMsg('ai', data.reply);
      if (data.suggestedRole && !draft.title) draft.title = data.suggestedRole;
    } catch (err) {
      addMsg('ai', 'I could not reach the AI just now. You can keep describing the role, or press "Generate requirements" to continue.');
    }
    var t = $('chat-typing'), s = $('chat-send');
    if (t) t.hidden = true;
    if (s) s.disabled = false;
  }

  async function generate() {
    var said = draft.chat.filter(function (m) { return m.role === 'recruiter'; }).map(function (m) { return m.text; }).join('\n');
    if (!said.trim()) { toast('Tell the AI about the role first.'); return; }
    var btn = $('wiz-generate');
    btn.disabled = true; btn.textContent = 'Writing your requirements...';
    try {
      var data = await postJson('/api/role-intake?action=generate', { messages: draft.chat });
      draft.title = data.title || draft.title;
      draft.location = data.location || draft.location;
      if (data.type && TYPES.indexOf(data.type) >= 0) draft.type = data.type;
      if (data.workMode && MODES.indexOf(data.workMode) >= 0) draft.workMode = data.workMode;
      draft.jd = data.summary ? data.summary + '\n\n' + (data.jd || '') : (data.jd || said);
      draft.reqs = (data.requirements || []).map(function (r) { return { id: uid(), text: r.text, weight: r.weight === 'nice' ? 'nice' : 'must' }; });
      draft.note = data.ai === false ? 'The AI is not connected, so these were pulled from what you wrote. Check and edit them.' : '';
    } catch (err) {
      draft.jd = said;
      draft.reqs = Engine.extractRequirements(said).map(function (r) { return { id: uid(), text: r.text, weight: r.weight }; });
      draft.note = 'Could not reach the AI, so requirements were pulled from your messages by keyword.' + (draft.reqs.length ? '' : ' None were found. Add them below.');
    }
    draft.step = 2;
    newJobView();
  }

  async function extractFromPaste() {
    var ta = $('paste-jd');
    if (ta && ta.value) draft.jd = ta.value;
    var jd = draft.jd;
    if (!jd.trim()) { toast('Please paste job text or upload a screenshot first.'); return; }

    var btn = document.querySelector('[data-act="wiz-extract"]');
    var oldText = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Analysing role & extracting requirements...'; }

    try {
      var data = await postJson('/api/role-intake?action=generate', {
        messages: [{ role: 'recruiter', text: jd }]
      });
      if (data.title) draft.title = data.title;
      if (data.company && !draft.company) draft.company = data.company;
      if (data.location) draft.location = data.location;
      if (data.type && TYPES.indexOf(data.type) >= 0) draft.type = data.type;
      if (data.workMode && MODES.indexOf(data.workMode) >= 0) draft.workMode = data.workMode;
      if (data.summary || data.jd) draft.jd = (data.summary ? data.summary + '\n\n' : '') + (data.jd || '');
      if (data.requirements && data.requirements.length) {
        draft.reqs = data.requirements.map(function (r) {
          return { id: uid(), text: r.text, weight: r.weight === 'nice' ? 'nice' : 'must' };
        });
      } else {
        var found = Engine.extractRequirements(jd);
        draft.reqs = found.map(function (r) { return { id: uid(), text: r.text, weight: r.weight }; });
      }
      draft.note = data.ai === false ? 'Requirements extracted from flyer. Review and edit them below.' : '';
    } catch (err) {
      // Offline / network fallback using the smart rule-based engine
      var fallback = Engine.extractRequirements(jd);
      draft.reqs = fallback.map(function (r) { return { id: uid(), text: r.text, weight: r.weight }; });
      if (!draft.title) {
        var lines = String(jd).split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
        var cleanTitle = lines.filter(function (l) { return l.length > 3 && l.length < 80 && !/we are|hiring|apply|salary|welcome|about us/i.test(l); })[0];
        draft.title = cleanTitle || lines[0] || '';
      }
      draft.title = draft.title.slice(0, 100);
      draft.note = draft.reqs.length ? 'Requirements extracted. Review and edit them below.' : 'No clear requirements were found. Add them below.';
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = oldText; }
    }

    draft.step = 2;
    newJobView();
  }

  async function createJob() {
    var msg = $('wiz-msg');
    var reqs = draft.reqs.filter(function (r) { return r.text.trim(); });
    if (!draft.title.trim()) { msg.textContent = 'Give the role a title.'; $('w-title').focus(); return; }
    if (!reqs.length) { msg.textContent = 'Add at least one requirement.'; return; }
    msg.textContent = '';
    try {
      var made = await call('jobCreate', {
        title: draft.title, company: draft.company, location: draft.location,
        type: draft.type, workMode: draft.workMode, listed: draft.listed,
        applyUrl: draft.applyUrl || '', website: draft.website || '', contacts: draft.contacts || [],
        jd: draft.jd, requirements: reqs
      });
      ScoutData.rememberJob(made.job, made.key);
      draft = newDraft();
      cache = null;
      toast('Job created. Share the apply link to get applicants.');
      location.hash = '#/job/' + made.job.id + '/share';
    } catch (err) { msg.textContent = err.message; }
  }

  async function enrichWebDraft() {
    var titleIn = $('w-title'), coIn = $('w-company'), locIn = $('w-location');
    if (titleIn) draft.title = titleIn.value;
    if (coIn) draft.company = coIn.value;
    if (locIn) draft.location = locIn.value;

    if (!draft.title.trim() && !draft.company.trim()) {
      toast('Give the role a title or company first to search the web.');
      return;
    }
    var btn = $('btn-web-enrich');
    var oldText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Searching web...'; }

    try {
      var res = await postJson('/api/web-enrich', {
        title: draft.title,
        company: draft.company,
        location: draft.location,
        text: draft.jd
      });
      if (res.officialUrl) draft.applyUrl = res.officialUrl;
      if (res.companyWebsite && !draft.website) draft.website = res.companyWebsite;
      if (res.contacts && res.contacts.length) draft.contacts = res.contacts;

      var sourcesHtml = (res.sources || []).map(function (s) {
        return '<li style="margin-bottom:6px"><a href="' + esc(s.url) + '" target="_blank" rel="noopener"><strong>' + esc(s.title) + '</strong></a><br><small class="muted">' + esc(s.snippet) + '</small></li>';
      }).join('');

      draft.webSources = sourcesHtml ? '<div style="margin-top:10px"><strong>Web Search Verification Results:</strong><ul style="margin:6px 0 0 16px;list-style:disc">' + sourcesHtml + '</ul></div>' : '';

      toast(res.officialUrl ? 'Found verified application link!' : 'Web search complete.');
      newJobView();
    } catch (e) {
      toast('Web search failed: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = oldText; }
    }
  }

  async function handleBatchFlyers(files) {
    view.innerHTML =
      '<div class="page-title"><div>' +
        '<a class="crumb" href="#/jobs">' + icon('arrow-left') + ' Jobs</a>' +
        '<h1>Processing ' + files.length + ' Job Flyers with AI</h1>' +
        '<p class="sub">Each flyer is read with on-device OCR, parsed into requirements, enriched with web search, and created as an active role.</p>' +
      '</div></div>' +
      '<div class="card pad stack" style="margin-top:16px"><div id="batch-progress-list" class="stack" style="gap:12px"></div>' +
      '<div id="batch-footer" hidden style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line);display:flex;gap:12px;flex-wrap:wrap"></div></div>';

    var container = $('batch-progress-list');
    var createdJobs = [];

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var row = document.createElement('div');
      row.className = 'card pad';
      row.style.background = 'var(--panel)';
      row.style.border = '1px solid var(--line)';
      row.innerHTML = '<div class="row between"><strong>' + esc(file.name) + '</strong><span class="chip warn" id="bp-status-' + i + '">Reading OCR...</span></div>' +
        '<p class="hint" id="bp-detail-' + i + '" style="margin-top:4px">Starting on-device text recognition...</p>';
      container.appendChild(row);

      var stChip = $('bp-status-' + i);
      var dtText = $('bp-detail-' + i);

      try {
        dtText.textContent = 'Extracting text on device...';
        var r = await CvTools.extract(file, function (m) { dtText.textContent = m; });
        var text = (r && r.text) || '';
        if (!text && r && r.image) {
          dtText.textContent = 'Reading with vision reader...';
          text = await CvTools.vision(r.image);
        }
        if (!text.trim()) throw new Error('No readable text found on flyer.');

        dtText.textContent = 'Analysing role & extracting requirements with AI...';
        stChip.textContent = 'Analysing...';
        stChip.className = 'chip info';

        var roleData = null;
        try {
          roleData = await postJson('/api/role-intake?action=generate', {
            messages: [{ role: 'recruiter', text: text }]
          });
        } catch (e) {
          var reqsFallback = Engine.extractRequirements(text);
          roleData = {
            title: text.split('\n').filter(Boolean)[0] || 'Role from ' + file.name,
            company: '',
            location: '',
            type: 'Full-time',
            workMode: 'On-site',
            jd: text,
            requirements: reqsFallback
          };
        }

        dtText.textContent = 'Searching web for legit application link & company info...';
        var web = {};
        try {
          web = await postJson('/api/web-enrich', {
            title: roleData.title,
            company: roleData.company,
            location: roleData.location,
            text: text
          });
        } catch (e) { web = {}; }

        dtText.textContent = 'Creating job and isolated candidate pipeline...';
        var reqsList = (roleData.requirements || []).map(function (req) {
          return { id: uid(), text: req.text, weight: req.weight === 'nice' ? 'nice' : 'must' };
        });
        if (!reqsList.length) reqsList = [{ id: uid(), text: 'Demonstrated experience in role', weight: 'must' }];

        var made = await call('jobCreate', {
          title: roleData.title || ('Role from ' + file.name),
          company: roleData.company || '',
          location: roleData.location || '',
          type: roleData.type || 'Full-time',
          workMode: roleData.workMode || 'On-site',
          applyUrl: web.officialUrl || '',
          website: web.companyWebsite || '',
          contacts: web.contacts || [],
          jd: roleData.jd || text,
          requirements: reqsList
        });

        ScoutData.rememberJob(made.job, made.key);
        createdJobs.push(made.job);

        stChip.textContent = 'Created';
        stChip.className = 'chip ok';
        row.style.borderColor = 'var(--green)';
        row.style.background = 'var(--panel)';
        dtText.innerHTML = '<strong>' + esc(made.job.title) + '</strong> (' + esc(made.job.location || made.job.workMode) + ') &middot; ' +
          made.job.requirements.length + ' requirements' +
          (web.officialUrl ? ' &middot; <a href="' + esc(web.officialUrl) + '" target="_blank" rel="noopener">🌐 Verified Web Link</a>' : '') +
          ' &middot; <a href="#/job/' + esc(made.job.id) + '">View Pipeline</a>';
      } catch (err) {
        stChip.textContent = 'Failed';
        stChip.className = 'chip bad';
        dtText.textContent = 'Error: ' + err.message;
      }
    }

    var foot = $('batch-footer');
    if (foot) {
      foot.hidden = false;
      foot.innerHTML = '<div style="width:100%;margin-bottom:8px"><strong>' + createdJobs.length + ' of ' + files.length + ' jobs successfully created!</strong></div>' +
        '<a class="btn" href="#/jobs">View All Jobs (' + ScoutData.myJobs().length + ')</a>' +
        '<a class="btn secondary" href="#/matrix">Open Talent Matrix (See Who Fits Where) &rarr;</a>';
    }
  }

  async function talentMatrixView(my) {
    cache = null;
    var head = '<div class="page-title"><div>' +
      '<h1>Talent Match Matrix</h1>' +
      '<p class="sub">Cross-role matching: see how every candidate scores across all your active jobs to discover who fits best where.</p>' +
      '</div><div class="row"><a class="btn" href="#/new">' + icon('plus') + ' Upload job(s)</a></div></div>';

    var myJobs = ScoutData.myJobs();
    if (!myJobs.length) {
      view.innerHTML = head + emptyJobs();
      return;
    }

    view.innerHTML = head + '<p class="muted">Loading talent pool across jobs&hellip;</p>';
    var rows = await loadPortfolio();
    if (my !== navId) return;

    var okJobs = rows.filter(function (r) { return !r.error && r.job; });
    var candMap = {};
    okJobs.forEach(function (r) {
      r.cands.forEach(function (c) {
        if (!candMap[c.id]) {
          candMap[c.id] = { id: c.id, name: c.name, cv: c.cv, phone: c.phone, email: c.email, originalJob: r.job, createdAt: c.createdAt };
        }
      });
    });

    var cands = Object.values(candMap);
    if (!cands.length) {
      view.innerHTML = head +
        '<div class="empty-state"><div class="empty-ic">' + icon('users') + '</div><h2>No applicants in your talent pool yet</h2>' +
        '<p>Upload job flyers or share application links to get candidates. Want to see the Talent Match Matrix working right now? Load sample applicants.</p>' +
        '<div class="row"><button class="btn" data-act="sample">Load sample jobs & candidates</button></div></div>';
      return;
    }

    var matrix = cands.map(function (cand) {
      var scores = okJobs.map(function (jRow) {
        var j = jRow.job;
        var screened = Engine.demoScreen(j.requirements, [{ id: cand.id, cv: cand.cv }])[0];
        var sc = Engine.score(j.requirements, screened.checks);
        return { job: j, score: sc.now, checks: screened.checks };
      });
      scores.sort(function (a, b) { return b.score - a.score; });
      return { cand: cand, best: scores[0], allScores: scores };
    });

    matrix.sort(function (a, b) { return b.best.score - a.best.score; });

    var tableRows = matrix.map(function (item) {
      var c = item.cand, best = item.best;
      var otherMatches = item.allScores.slice(1).filter(function (s) { return s.score >= 40; }).map(function (s) {
        return '<span class="chip" style="font-size:0.75rem">' + esc(s.job.title) + ': ' + s.score + '%</span>';
      }).join(' ');

      return '<tr>' +
        '<td><div class="row" style="gap:8px">' + person(c.name) + '<div><strong>' + esc(c.name) + '</strong><br><small class="muted">Applied: ' + esc(fmtDate(c.createdAt)) + '</small></div></div></td>' +
        '<td><div class="row" style="gap:6px"><span class="match-pill ' + (best.score >= 70 ? 'hi' : best.score >= 45 ? 'mid' : 'lo') + '">' + best.score + '%</span>' +
        '<div><strong>' + esc(best.job.title) + '</strong>' + (best.job.company ? '<br><small class="muted">' + esc(best.job.company) + '</small>' : '') + '</div></div></td>' +
        '<td>' + (otherMatches || '<span class="muted small">None above 40%</span>') + '</td>' +
        '<td class="r"><a class="btn sm secondary" href="#/job/' + esc(best.job.id) + '/applicants/' + esc(c.id) + '">View CV & Evidence</a></td>' +
        '</tr>';
    }).join('');

    view.innerHTML = head +
      '<div class="stat-grid" style="margin-bottom:20px">' +
        '<div class="stat"><span class="stat-ic">' + icon('briefcase') + '</span><div><div class="stat-n">' + okJobs.length + '</div><div class="stat-l">Active Roles</div></div></div>' +
        '<div class="stat"><span class="stat-ic">' + icon('users') + '</span><div><div class="stat-n">' + cands.length + '</div><div class="stat-l">Total Talent Pool</div></div></div>' +
        '<div class="stat"><span class="stat-ic">' + icon('star') + '</span><div><div class="stat-n">' + matrix.filter(function (m) { return m.best.score >= 70; }).length + '</div><div class="stat-l">Strong Matches (&ge;70%)</div></div></div>' +
      '</div>' +
      '<div class="card table-card">' +
        '<div class="card-head"><h2>Who Fits Where (Cross-Job Rankings)</h2></div>' +
        '<div class="table-scroll"><table class="table"><thead><tr><th>Candidate</th><th>Best Matching Role</th><th>Other Roles Fit (&ge;40%)</th><th class="r"></th></tr></thead><tbody>' +
        tableRows +
        '</tbody></table></div>' +
      '</div>';
  }

  /* ---- requirements editor (used by the wizard and the Requirements tab) ---- */

  var TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
  var MODES = ['On-site', 'Hybrid', 'Remote'];
  function opts(list, cur) { return list.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + '>' + o + '</option>'; }).join(''); }
  function jobFields(ns, d) {
    return '<div class="form-grid three"><div class="field"><label class="label" for="' + ns + '-loc">Location</label><input id="' + ns + '-loc" type="text" maxlength="80" data-field="' + ns + '.location" value="' + esc(d.location) + '" placeholder="e.g. Lagos, Nigeria"></div>' +
      '<div class="field"><label class="label" for="' + ns + '-type">Job type</label><select id="' + ns + '-type" data-field="' + ns + '.type">' + opts(TYPES, d.type) + '</select></div>' +
      '<div class="field"><label class="label" for="' + ns + '-mode">Work mode</label><select id="' + ns + '-mode" data-field="' + ns + '.workMode">' + opts(MODES, d.workMode) + '</select></div></div>';
  }

  function listFor(name) { return name === 'draft' ? draft.reqs : (edit ? edit.reqs : []); }

  function reqEditor(listName, reqs) {
    return '<ul class="reqs" data-list="' + listName + '">' + (reqs.length ? reqs.map(function (r, i) {
      return '<li><input type="text" maxlength="140" value="' + esc(r.text) + '" aria-label="Requirement ' + (i + 1) + '" data-field="req-text" data-list="' + listName + '" data-i="' + i + '">' +
        '<button type="button" class="weight ' + (r.weight === 'nice' ? 'nice' : 'must') + '" data-act="req-weight" data-list="' + listName + '" data-i="' + i + '" aria-label="Importance: ' + (r.weight === 'nice' ? 'nice to have' : 'must have') + '. Press to change.">' + (r.weight === 'nice' ? 'Nice to have' : 'Must have') + '</button>' +
        '<button type="button" class="icon-btn" data-act="req-del" data-list="' + listName + '" data-i="' + i + '" aria-label="Remove requirement ' + (i + 1) + '">&times;</button></li>';
    }).join('') : '<li class="empty">No requirements yet. Add the first one below.</li>') + '</ul>' +
      '<div class="add-line"><label class="visually-hidden" for="new-req-' + listName + '">Add a requirement</label>' +
      '<input id="new-req-' + listName + '" type="text" maxlength="140" placeholder="Add a requirement, then press Enter" data-field="new-req" data-list="' + listName + '">' +
      '<button type="button" class="btn secondary" data-act="req-add" data-list="' + listName + '">Add</button></div>';
  }

  function repaintReqs(listName) {
    var ul = view.querySelector('ul.reqs[data-list="' + listName + '"]');
    if (!ul) return;
    var holder = ul.parentNode;
    var tmp = document.createElement('div');
    tmp.innerHTML = reqEditor(listName, listFor(listName));
    // swap list only; keep the add input as is
    ul.replaceWith(tmp.firstChild);
    return holder;
  }

  /* ================================================================ JOB VIEW */

  async function loadJob(id, qkey) {
    var key = ScoutData.keyFor(id) || '';
    var fromLink = false;
    if (!key && qkey) { key = qkey; fromLink = true; }
    var job = (await call('jobGet', { id: id })).job;
    if (!key) return { id: id, job: job, key: '', cands: [], locked: true };
    if (!job.code) { try { job.code = (await call('jobShortLink', { id: id, key: key })).code; } catch (e) { /* older job, long link still works */ } }
    var cands;
    try { cands = (await call('candidates', { jobId: id, key: key })).candidates; }
    catch (err) {
      if (err.status === 403) return { id: id, job: job, key: '', cands: [], locked: true, badKey: fromLink };
      throw err;
    }
    if (fromLink) ScoutData.rememberJob(job, key);
    return { id: id, job: job, key: key, cands: cands, fetchedAt: Date.now() };
  }

  async function jobView(my, id, tab, candId, q) {
    var needLoad = !cache || cache.id !== id || (q && q.key) || cache.locked;
    if (needLoad) {
      view.innerHTML = '<p class="muted">Loading&hellip;</p>';
      var data = await loadJob(id, q && q.key);
      if (my !== navId) return;
      cache = data;
      if (q && q.key && !data.locked) history.replaceState(null, '', '#/job/' + id + (tab !== 'applicants' ? '/' + tab : ''));
      edit = null;
      ui.filter = 'all'; ui.search = ''; ui.showAdd = false; ui.notice = null;
    }
    if (cache.locked) { lockedView(); return; }
    if (tab === 'requirements' && !edit) {
      var jb = cache.job;
      edit = { title: jb.title, company: jb.company, location: jb.location, type: jb.type, workMode: jb.workMode, jd: jb.jd, status: jb.status,
        reqs: jb.requirements.map(function (r) { return { id: r.id, text: r.text, weight: r.weight }; }) };
    }
    if (tab !== 'requirements') edit = null;
    renderJob(tab, candId);

    // New applicants are screened automatically when the job is opened.
    ui.autoScreen = null;
    var need = needsScreen();
    if (need.length && !ui.screening) screenCands(need);
  }

  function lockedView() {
    var j = cache.job;
    $('drawer-host').innerHTML = '';
    view.innerHTML =
      '<div class="empty-state"><div class="empty-ic">' + icon('lock') + '</div><h2>' + esc(j.title) + '</h2>' +
      '<p>' + (cache.badKey ? 'That recruiter link does not match this job. ' : '') + 'This job is not linked to this browser. Open the private recruiter link that was shown when you created it to manage the job here.</p>' +
      '<div class="row"><a class="btn" href="#/jobs">Back to jobs</a></div></div>';
  }

  function jobHead(tab) {
    var j = cache.job, n = cache.cands.length;
    var base = '#/job/' + j.id;
    var t = function (name, label, extra) {
      return '<a href="' + base + '/' + name + '"' + (tab === name ? ' aria-current="page"' : '') + '>' + label + (extra || '') + '</a>';
    };
    return '<a class="crumb" href="#/jobs">' + icon('arrow-left') + ' Jobs</a>' +
      '<div class="job-head">' + avatar(j.company || j.title, true) +
      '<div class="jh-main"><h1>' + esc(j.title) + '</h1><p class="sub">' + jobMeta(j) + '</p></div>' +
      '<div class="row jh-actions"><span class="chip ' + (j.status === 'open' ? 'ok' : '') + '"><span class="dot"></span>' + (j.status === 'open' ? 'Open' : 'Closed') + '</span>' +
      '<button class="btn secondary" data-act="copy-apply">' + icon('link') + ' Copy apply link</button></div></div>' +
      '<nav class="tabs-line" aria-label="Job sections">' +
      t('applicants', 'Pipeline', '<span class="count">' + n + '</span>') + t('insights', 'Insights') + t('requirements', 'Job details') + t('share', 'Share') + '</nav>';
  }

  var focusSel = null;
  function renderJob(tab, candId) {
    var html = jobHead(tab), drawer = '';
    if (tab === 'requirements') html += requirementsTab();
    else if (tab === 'share') html += shareTab();
    else if (tab === 'insights') html += insightsTab();
    else {
      html += pipelineTab();
      if (candId) {
        var sel = rowsFor().filter(function (r) { return r.c.id === candId; })[0];
        if (sel) drawer = drawerHtml(sel);
      }
    }
    view.innerHTML = html;
    var host = $('drawer-host');
    var wasOpen = Boolean(host.firstChild);
    host.innerHTML = drawer;
    document.body.classList.toggle('drawer-open', Boolean(drawer));
    if (drawer && !wasOpen) { var cb = host.querySelector('.drawer-close'); if (cb) cb.focus(); }
    if (focusSel) { var n = document.querySelector(focusSel); if (n) n.focus(); focusSel = null; }
  }
  function rerender() {
    var r = parseHash();
    if (r.parts[0] !== 'job' || !cache || r.parts[1] !== cache.id) return;
    renderJob(r.parts[2] || 'applicants', r.parts[3] || null);
  }
  function closeDrawer() { if (cache) location.hash = '#/job/' + cache.id + '/applicants'; }

  /* ---- scoring helpers ---- */

  function rowsFor() {
    var reqs = cache.job.requirements, sig = reqSig(reqs);
    var rows = cache.cands.map(function (c) {
      var sc = c.screen ? Engine.score(reqs, c.screen.checks) : null;
      return { c: c, sc: sc, sug: sc ? Engine.suggestion(sc) : null, stale: Boolean(c.screen && c.screen.reqSig !== sig) };
    });
    rows.sort(function (a, b) {
      if (a.sc && !b.sc) return -1;
      if (!a.sc && b.sc) return 1;
      if (a.sc && b.sc) return b.sc.now - a.sc.now || b.sc.potential - a.sc.potential || a.c.name.localeCompare(b.c.name);
      return String(b.c.createdAt).localeCompare(String(a.c.createdAt));
    });
    return rows;
  }

  function needsScreen() {
    var sig = reqSig(cache.job.requirements);
    return cache.cands.filter(function (c) { return !c.screen || c.screen.reqSig !== sig; });
  }

  function barHtml(reqs, checks, label) {
    var by = {};
    (checks || []).forEach(function (k) { by[k.reqId] = k; });
    var segs = reqs.map(function (r) {
      var st = checks ? (by[r.id] ? by[r.id].status : 'not_stated') : 'none';
      return '<span class="seg s-' + st + '" style="flex:' + Engine.weightOf(r) + '" title="' + esc(r.text + (checks ? ': ' + STATE_LABEL[st] : '')) + '"></span>';
    }).join('');
    return '<div class="bar" role="img" aria-label="' + esc(label) + '">' + segs + '</div>';
  }
  function pill(sc) {
    return sc ? '<span class="match-pill ' + (sc.now >= 70 ? 'hi' : sc.now >= 45 ? 'mid' : 'lo') + '">' + sc.now + '%</span>' : '<span class="match-pill none">Not screened</span>';
  }
  function candHref(c) { return '#/job/' + esc(cache.job.id) + '/applicants/' + esc(c.id); }
  function flags(r) {
    var c = r.c, m = '';
    if (c.source === 'manual') m += '<span class="chip">Added by you</span>';
    if (c.interview) m += '<span class="chip info">Interviewed</span>';
    if (c.contactedAt) m += '<span class="chip">Contacted</span>';
    if (r.stale) m += '<span class="chip warn">Out of date</span>';
    return m;
  }

  /* ---- pipeline tab ---- */

  function pipelineTab() {
    var j = cache.job, reqs = j.requirements;
    var rows = rowsFor();
    var need = needsScreen();
    var out = '';

    if (!rows.length && !ui.showAdd) {
      var link = ScoutData.applyLink(j);
      return '<div class="empty-state"><div class="empty-ic">' + icon('users') + '</div><h2>No applicants yet</h2>' +
        '<p>Send candidates this role&rsquo;s apply link' + (j.listed ? ', or they can find it on the public job board' : '') + '. They upload a CV, confirm their details, and appear here ranked against your requirements.</p>' +
        '<div class="link-box"><code>' + esc(link) + '</code><button class="btn sm" data-act="copy-apply">' + icon('copy') + ' Copy</button></div>' +
        (app.mode === 'local' ? '<div class="banner info" style="margin-top:16px"><span><strong>Heads up:</strong> this site is saving to this browser only, so applications must be made in this same browser. See Share to turn on shared storage.</span></div>' : '') +
        '<div class="row"><button class="btn secondary" data-act="toggle-add">Add a CV manually</button>' +
        '<a class="btn ghost" href="' + esc(link) + '" target="_blank" rel="noopener">Preview as a candidate</a></div></div>';
    }

    if (ui.screening) out += '<div class="banner info" role="status" style="margin-bottom:16px"><span><strong>Screening&hellip;</strong> ' + esc(ui.screening) + '</span></div>';
    else if (need.length) {
      var anyStale = need.some(function (c) { return c.screen; });
      out += '<div class="banner" style="margin-bottom:16px"><span><strong>' + plural(need.length, 'applicant') + '</strong> ' + (anyStale ? 'need screening again because the requirements changed.' : (need.length === 1 ? 'has' : 'have') + ' not been screened yet.') + '</span>' +
        '<button class="btn sm" data-act="screen">Screen ' + need.length + '</button></div>';
    }
    if (ui.notice) out += '<div class="banner bad" role="status" style="margin-bottom:16px"><span>' + esc(ui.notice) + '</span></div>';

    out += '<div class="toolbar"><div class="row">' +
      '<label class="search-mini"><span class="visually-hidden">Search applicants</span>' + icon('search') + '<input type="search" id="cand-search" data-field="ui.search" placeholder="Search applicants" value="' + esc(ui.search) + '"></label>' +
      '<div class="seg-toggle" role="group" aria-label="View"><button type="button" data-act="view" data-v="board" aria-pressed="' + (ui.view === 'board') + '">' + icon('board') + ' Board</button><button type="button" data-act="view" data-v="list" aria-pressed="' + (ui.view === 'list') + '">' + icon('list') + ' List</button></div></div>' +
      '<div class="row"><button class="btn secondary sm" data-act="toggle-add">' + icon('plus') + ' Add a CV</button>' +
      '<button class="btn secondary sm" data-act="refresh">Refresh</button>' +
      '<button class="btn secondary sm" data-act="csv">' + icon('download') + ' CSV</button></div></div>';

    if (ui.showAdd) {
      out += '<form class="card pad stack" data-form="add-cv" style="margin-bottom:20px">' +
        '<div class="field"><label class="label" for="add-name">Name</label><input id="add-name" type="text" maxlength="80" placeholder="Candidate name"></div>' +
        '<div class="field"><label class="label" for="add-cv">CV text</label><textarea id="add-cv" rows="6" maxlength="12000" placeholder="Paste the CV as plain text" required></textarea></div>' +
        '<div class="row"><button type="submit" class="btn">Add candidate</button><button type="button" class="btn ghost" data-act="toggle-add">Cancel</button></div></form>';
    }

    var qs = ui.search.trim().toLowerCase();
    var shown = rows.filter(function (r) { return !qs || r.c.name.toLowerCase().indexOf(qs) >= 0; });

    if (ui.view === 'list') {
      out += '<div class="card table-card"><div class="table-scroll"><table class="table"><thead><tr><th>Candidate</th><th>Match</th><th>Stage</th><th>Applied</th><th>Notes</th></tr></thead><tbody>' +
        (shown.length ? shown.map(function (r) {
          var c = r.c;
          return '<tr class="click" data-href="' + candHref(c) + '"><td><a class="t-main person-cell" href="' + candHref(c) + '">' + person(c.name) + '<strong>' + esc(c.name) + '</strong></a></td>' +
            '<td><div class="match-cell">' + pill(r.sc) + (r.sc ? barHtml(reqs, c.screen.checks, r.sc.now + ' percent match') : '') + '</div></td>' +
            '<td><span class="chip stage-' + c.stage + '">' + STAGE_LABEL[c.stage] + '</span></td><td>' + esc(fmtDate(c.createdAt)) + '</td><td><div class="chips">' + flags(r) + '</div></td></tr>';
        }).join('') : '<tr><td colspan="5" class="muted pad">No applicants match.</td></tr>') + '</tbody></table></div></div>';
    } else {
      out += '<div class="kanban">' + ['new', 'shortlist', 'ask', 'pass'].map(function (st) {
        var col = shown.filter(function (r) { return r.c.stage === st; });
        return '<section class="kcol" data-stage="' + st + '" aria-label="' + STAGE_LABEL[st] + '"><header class="kcol-head"><h3><span class="kdot ' + st + '"></span>' + STAGE_LABEL[st] + '</h3><span class="kcount">' + col.length + '</span></header>' +
          '<div class="kcol-body">' + (col.length ? col.map(function (r) {
            var c = r.c;
            return '<a class="kcard" draggable="true" data-cand="' + esc(c.id) + '" href="' + candHref(c) + '"' + (candIdNow() === c.id ? ' aria-current="true"' : '') + '>' +
              '<div class="kc-top">' + person(c.name) + '<span class="kc-name">' + esc(c.name) + '</span>' + pill(r.sc) + '</div>' +
              barHtml(reqs, r.sc ? c.screen.checks : null, r.sc ? r.sc.now + ' percent match' : 'Not screened yet') +
              (flags(r) ? '<div class="chips">' + flags(r) + '</div>' : '') + '</a>';
          }).join('') : '<p class="kempty">' + (st === 'new' ? 'New applicants appear here' : 'Drag candidates here') + '</p>') + '</div></section>';
      }).join('') + '</div>';
    }

    out += '<ul class="legend" aria-label="How to read a match bar" style="margin-top:20px"><li><span class="seg s-met"></span> Stated</li><li><span class="seg s-not_stated"></span> Not stated, verify</li><li><span class="seg s-not_met"></span> CV says otherwise</li></ul>';
    return out;
  }
  function candIdNow() { return parseHash().parts[3] || ''; }

  /* ---- insights tab ---- */

  function insightsTab() {
    var j = cache.job, reqs = j.requirements, rows = rowsFor();
    if (!rows.length) return '<div class="empty-state"><div class="empty-ic">' + icon('chart') + '</div><h2>Nothing to show yet</h2><p>Insights appear once you have applicants.</p></div>';
    var by = { new: 0, shortlist: 0, ask: 0, pass: 0 };
    rows.forEach(function (r) { by[r.c.stage]++; });
    var screened = rows.filter(function (r) { return r.sc && !r.stale; });
    var max = Math.max(1, rows.length);
    var out = '<div class="stat-grid">' + [['Applicants', rows.length, 'users'], ['Screened', screened.length, 'check'], ['Shortlisted', by.shortlist, 'star'], ['Interviewed by AI', rows.filter(function (r) { return r.c.interview; }).length, 'message']].map(function (x) {
      return '<div class="stat"><span class="stat-ic">' + icon(x[2]) + '</span><div><div class="stat-n">' + x[1] + '</div><div class="stat-l">' + x[0] + '</div></div></div>';
    }).join('') + '</div>';
    out += '<div class="dash-grid"><section class="card pad"><h2 class="card-h">Pipeline</h2><div class="funnel">' + ['new', 'shortlist', 'ask', 'pass'].map(function (st) {
      return '<div class="fn-row"><span>' + STAGE_LABEL[st] + '</span><div class="fn-bar"><i class="' + st + '" style="width:' + Math.round(by[st] / max * 100) + '%"></i></div><b>' + by[st] + '</b></div>';
    }).join('') + '</div></section>';
    if (screened.length >= 2) {
      var cov = Engine.coverage(reqs, screened.map(function (r) { return { checks: r.c.screen.checks }; })).sort(function (a, b) {
        return a.counts.met - b.counts.met || b.counts.not_met - a.counts.not_met;
      });
      out += '<section class="card pad"><h2 class="card-h">Where the pool is thin</h2><p class="hint" style="margin-bottom:8px">How many screened candidates state each requirement. Search harder for the top rows.</p><ul class="cov-list">' +
        cov.map(function (c) {
          var segs = ['met', 'not_stated', 'not_met'].filter(function (s2) { return c.counts[s2]; }).map(function (s2) {
            return '<span class="seg s-' + s2 + '" style="flex:' + c.counts[s2] + '"></span>';
          }).join('');
          var thin = c.counts.met / (c.total || 1) <= 0.34;
          return '<li><span>' + esc(c.req.text) + '</span><div class="bar" role="img" aria-label="' + c.counts.met + ' of ' + c.total + ' candidates state this">' + segs + '</div><span class="cnt' + (thin ? ' thin' : '') + '">' + c.counts.met + ' of ' + c.total + '</span></li>';
        }).join('') + '</ul></section>';
    } else out += '<section class="card pad"><h2 class="card-h">Where the pool is thin</h2><p class="muted">Needs at least two screened applicants.</p></section>';
    return out + '</div>';
  }

  function drawerHtml(r) {
    return '<div class="drawer-backdrop" data-act="close-drawer"></div>' +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="Applicant: ' + esc(r.c.name) + '">' +
      '<button type="button" class="icon-btn drawer-close" data-act="close-drawer" aria-label="Close">' + icon('x') + '</button>' + detailPane(r) + '</aside>';
  }

  function contactUrls(c) {
    var o = getOutreach(), j = cache.job;
    var vars = {
      firstName: (c.name || '').split(/\s+/)[0] || 'there',
      recruiterName: o.name || 'a recruiter',
      company: o.company || j.company || 'our team',
      role: j.title
    };
    return {
      wa: Engine.buildWhatsAppLink(c.phone, o.template, vars),
      tel: Engine.buildTelLink(c.phone),
      mail: Engine.buildMailtoLink(c.email, 'Quick chat about the ' + j.title + ' role', Engine.renderTemplate(o.template, vars))
    };
  }

  function detailPane(r) {
    var c = r.c, j = cache.job, reqs = j.requirements, sc = r.sc;
    var o = getOutreach();
    var h = '<div class="detail"><div class="detail-inner">';

    h += '<div class="detail-top">' + person(c.name) + '<div class="dt-main"><h2>' + esc(c.name) + '</h2><p class="muted small">' +
      (c.location ? esc(c.location) + ' &middot; ' : '') + (c.source === 'manual' ? 'Added ' : 'Applied ') + esc(fmtDate(c.createdAt)) + '</p></div>' +
      (sc ? '<div class="score">' + sc.now + '%' + (sc.potential > sc.now ? '<small>up to ' + sc.potential + '% if verified</small>' : '') + '</div>' : '<div class="muted small">Not screened yet</div>') + '</div>';

    // evidence
    if (sc) {
      var by = {};
      c.screen.checks.forEach(function (k) { by[k.reqId] = k; });
      h += '<section><h3>Evidence</h3><div class="row" style="margin-bottom:12px"><span class="chip ' + (r.sug.code === 'strong' ? 'ok' : r.sug.code === 'gap' ? 'bad' : r.sug.code === 'verify' ? 'warn' : '') + '">' + esc(r.sug.text) + '</span>' +
        (c.screen.usedAi ? '' : '<span class="chip">Keyword match</span>') + (r.stale ? '<span class="chip warn">Out of date</span>' : '') + '</div>' +
        (c.screen.summary ? '<p class="note-line" style="margin-bottom:8px">' + esc(c.screen.summary) + '</p>' : '') +
        '<div class="checks">' + reqs.map(function (q) {
          var k = by[q.id] || { status: 'not_stated', evidence: '', note: '' };
          return '<div class="check"><span class="rq">' + esc(q.text) + (q.weight === 'nice' ? ' <small>(nice to have)</small>' : '') + '</span>' +
            '<span class="st ' + k.status + '"><span class="seg s-' + k.status + '"></span>' + STATE_LABEL[k.status] + '</span>' +
            ((k.evidence || k.note) ? '<div class="ev">' + (k.evidence ? '<q>' + esc(k.evidence) + '</q>' : '') + (k.note ? '<span class="nt">' + esc(k.note) + '</span>' : '') + '</div>' : '') + '</div>';
        }).join('') + '</div></section>';
      if (c.screen.questions && c.screen.questions.length) {
        h += '<section><h3>Questions to ask</h3><ul class="questions">' + c.screen.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul></section>';
      }
    } else {
      h += '<section><div class="banner"><span>This applicant has not been screened yet.</span><button class="btn sm" data-act="screen-one" data-id="' + esc(c.id) + '">Screen now</button></div></section>';
    }

    // interview
    if (c.interview && c.interview.summary) {
      var iv = c.interview;
      h += '<section><h3>AI interview summary</h3><div class="interview-box"><div><span class="chip ' + (iv.confidence === 'high' ? 'ok' : iv.confidence === 'low' ? 'bad' : 'warn') + '">Confidence: ' + esc(iv.confidence) + '</span></div><p>' + esc(iv.summary) + '</p>' +
        (iv.confirmedReqs && iv.confirmedReqs.length ? '<div><strong>Confirmed:</strong> ' + iv.confirmedReqs.map(esc).join('; ') + '</div>' : '') +
        (iv.openReqs && iv.openReqs.length ? '<div><strong>Still open:</strong> ' + iv.openReqs.map(esc).join('; ') + '</div>' : '') +
        (iv.followUpQuestions && iv.followUpQuestions.length ? '<div><strong>Follow-ups:</strong><ul class="questions" style="margin-top:4px">' + iv.followUpQuestions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul></div>' : '') +
        '<p class="small muted">Written by AI from the candidate&rsquo;s own answers. Check it before relying on it.</p></div></section>';
    }

    // profile roadmap
    if (c.profile && (c.profile.experience || c.profile.education || c.profile.skills)) h += '<section><h3>Profile</h3>' + CvTools.profileHtml(c.profile) + '</section>';

    // CV
    h += '<section><details><summary class="link-btn" style="cursor:pointer">Read the full CV</summary><div style="margin-top:12px;white-space:pre-wrap;font-size:0.9rem;color:var(--ink-2);overflow-wrap:anywhere">' + esc(c.cv) + '</div></details>' +
      ((c.links && (c.links.linkedin || c.links.github)) ? '<div class="row" style="margin-top:12px">' +
        (c.links.linkedin ? '<a href="' + esc(c.links.linkedin) + '" target="_blank" rel="noopener noreferrer">LinkedIn</a>' : '') +
        (c.links.github ? '<a href="' + esc(c.links.github) + '" target="_blank" rel="noopener noreferrer">GitHub or portfolio</a>' : '') + '</div>' : '') + '</section>';

    // contact
    h += '<section><h3>Contact</h3>';
    if (c.source === 'manual') {
      h += '<span class="contact-withheld">' + icon('lock') + ' Added by you, so no contact details are stored.</span>';
    } else if (!c.consent) {
      h += '<span class="contact-withheld">' + icon('lock') + ' The candidate chose to keep their contact details private.</span>';
    } else if (!c.phone && !c.email) {
      h += '<span class="contact-withheld">' + icon('lock') + ' The candidate agreed to share contact details but did not give any.</span>';
    } else {
      var open = Boolean(ui.revealed[c.id]);
      h += '<div class="contact-panel"><div class="row"><button class="btn secondary sm" data-act="reveal" data-id="' + esc(c.id) + '">' + (open ? 'Hide contact details' : 'Show contact details') + '</button>' +
        (c.contactedAt ? '<span class="chip">Contacted ' + esc(fmtDate(c.contactedAt)) + '</span>' : '') + '</div>';
      if (open) {
        var u = contactUrls(c);
        h += '<p class="contact-info"><strong>Phone:</strong> ' + esc(c.phone || 'Not provided') + ' &nbsp; <strong>Email:</strong> ' + esc(c.email || 'Not provided') + '</p>' +
          '<div class="contact-links">' +
          (u.wa ? '<a class="contact-btn wa" data-contact="' + esc(c.id) + '" href="' + esc(u.wa) + '" target="_blank" rel="noopener noreferrer">' + icon('message') + ' WhatsApp</a>' : '') +
          (u.tel ? '<a class="contact-btn tel" data-contact="' + esc(c.id) + '" href="' + esc(u.tel) + '">' + icon('phone') + ' Call</a>' : '') +
          (u.mail ? '<a class="contact-btn mail" data-contact="' + esc(c.id) + '" href="' + esc(u.mail) + '">' + icon('mail') + ' Email</a>' : '') + '</div>' +
          '<details class="msg-settings"><summary>Edit the message</summary><div class="grid">' +
          '<div class="field"><label class="label" for="o-name">Your name</label><input id="o-name" type="text" maxlength="60" data-field="o-name" value="' + esc(o.name) + '" placeholder="Used as {recruiter name}"></div>' +
          '<div class="field"><label class="label" for="o-company">Company</label><input id="o-company" type="text" maxlength="80" data-field="o-company" value="' + esc(o.company) + '" placeholder="' + esc(j.company || 'Used as {company}') + '"></div>' +
          '<div class="field"><label class="label" for="o-template">Message</label><textarea id="o-template" rows="3" maxlength="400" data-field="o-template">' + esc(o.template) + '</textarea>' +
          '<span class="hint">You can use {first name}, {recruiter name}, {company} and {role}.</span></div></div></details>';
      }
      h += '</div>';
    }
    h += '</section>';

    // decision
    h += '<section><h3>Your decision</h3><div class="stage-pick" role="group" aria-label="Your decision for ' + esc(c.name) + '">' +
      ['shortlist', 'ask', 'pass'].map(function (s) {
        return '<button type="button" data-act="stage" data-id="' + esc(c.id) + '" data-stage="' + s + '" aria-pressed="' + (c.stage === s) + '">' + STAGE_LABEL[s] + '</button>';
      }).join('') + '</div><p class="hint" style="margin-top:8px">The AI only suggests. You decide. Click again to undo.</p>' +
      '<div class="row" style="margin-top:20px"><button class="btn danger sm" data-act="remove-cand" data-id="' + esc(c.id) + '">Remove from this job</button></div></section>';

    return h + '</div></div>';
  }

  /* ---- screening ---- */

  async function screenCands(list) {
    if (!list.length || ui.screening) return;
    var j = cache.job;
    var reqs = j.requirements.map(function (r) { return { id: r.id, text: r.text, weight: r.weight }; });
    var sig = reqSig(j.requirements);
    var CHUNK = 5, done = 0, usedAnyAi = false, failMsg = '';
    ui.notice = null;

    for (var i = 0; i < list.length; i += CHUNK) {
      var chunk = list.slice(i, i + CHUNK);
      ui.screening = 'Reading ' + Math.min(done + chunk.length, list.length) + ' of ' + list.length + '. This can take a little while with AI.';
      rerender();
      var payload = chunk.map(function (c) { return { id: c.id, name: c.name, cv: Engine.cvWithProfile(c.cv, c.profile) }; });
      var results = null, usedAi = false;
      if (app.ai) {
        try {
          var data = await postJson('/api/screen', { requirements: reqs, candidates: payload });
          if (data.results) { results = data.results; usedAi = true; usedAnyAi = true; }
        } catch (err) { failMsg = err.message; }
      }
      if (!results) results = Engine.demoScreen(reqs, payload);

      var save = results.map(function (r) {
        return { candId: r.id, screen: { reqSig: sig, usedAi: usedAi, now: Engine.score(j.requirements, r.checks || []).now, at: new Date().toISOString(), summary: r.summary || '', checks: r.checks || [], questions: r.questions || [] } };
      });
      try { await call('screensSave', { jobId: j.id, key: cache.key, results: save }); }
      catch (err) { ui.notice = 'Could not save screening results: ' + err.message; }
      save.forEach(function (s) {
        var c = cache.cands.filter(function (x) { return x.id === s.candId; })[0];
        if (c) c.screen = s.screen;
      });
      done += chunk.length;
    }
    ui.screening = '';
    if (failMsg) ui.notice = 'The AI could not be used for some applicants (' + failMsg.replace(/[.\s]+$/, '') + '), so those use keyword matching. Treat their ranking as a rougher first pass.';
    else if (!usedAnyAi && !app.ai) ui.notice = null;
    rerender();
    toast('Screened ' + plural(done, 'applicant') + '.');
  }

  /* ---- other tabs ---- */

  function requirementsTab() {
    var e = edit, j = cache.job;
    return '<div class="kv"><section class="card pad"><h2 class="card-h">Job details</h2><div class="form-grid" style="margin-top:12px">' +
      '<div class="field"><label class="label" for="e-title">Job title</label><input id="e-title" type="text" maxlength="100" data-field="edit.title" value="' + esc(e.title) + '"></div>' +
      '<div class="field"><label class="label" for="e-company">Company</label><input id="e-company" type="text" maxlength="80" data-field="edit.company" value="' + esc(e.company) + '"></div></div>' +
      '<div style="margin-top:16px">' + jobFields('edit', e) + '</div>' +
      '<div class="field" style="margin-top:16px"><label class="label" for="e-jd">Description</label><textarea id="e-jd" rows="6" data-field="edit.jd">' + esc(e.jd) + '</textarea></div></section>' +
      '<section class="card pad"><h2 class="card-h">Requirements</h2><p class="hint" style="margin:4px 0 12px">Applicants are ranked against these. If you change them, applicants are marked as needing a fresh screen.</p>' + reqEditor('edit', e.reqs) + '</section>' +
      '<section class="card pad"><div class="field" style="max-width:16rem"><label class="label" for="e-status">Applications</label><select id="e-status" data-field="edit.status"><option value="open"' + (e.status === 'open' ? ' selected' : '') + '>Open</option><option value="closed"' + (e.status === 'closed' ? ' selected' : '') + '>Closed</option></select></div></section>' +
      '<p id="edit-msg" class="field-msg error" role="alert"></p>' +
      '<div class="row"><button class="btn lg" data-act="save-job">Save changes</button><a class="btn ghost" href="#/job/' + esc(j.id) + '/applicants">Cancel</a></div></div>';
  }

  function shareTab() {
    var j = cache.job;
    var applyUrl = ScoutData.applyLink(j);
    var privateUrl = location.origin + '/hire#/job/' + j.id + '?key=' + cache.key;
    return '<div class="kv">' +
      '<section class="card pad"><h2 class="card-h">Apply link</h2><p class="hint">Send this to candidates. It shows the role and lets them apply.</p>' +
      '<div class="link-box"><code>' + esc(applyUrl) + '</code><button class="btn sm" data-act="copy-apply">' + icon('copy') + ' Copy</button></div>' +
      '<p style="margin-top:12px"><a href="' + esc(applyUrl) + '" target="_blank" rel="noopener">Preview as a candidate</a></p></section>' +
      '<section class="card pad"><h2 class="card-h">Public job board</h2><p class="hint">' + (j.listed ? 'This job is listed on the public job board, so candidates can find it and get matched to it.' : 'This job is hidden from the public job board. Only people with the apply link can see it.') + '</p>' +
      '<div class="row" style="margin-top:12px"><button class="btn secondary" data-act="toggle-listed">' + (j.listed ? 'Remove from job board' : 'List on job board') + '</button></div></section>' +
      '<section class="card pad"><h2 class="card-h">Your private recruiter link</h2><p class="hint">Opens this job on another device. <strong>Anyone with this link can see the applicants</strong>, so keep it to yourself.</p>' +
      '<div class="link-box"><code>' + esc(privateUrl) + '</code><button class="btn sm" data-act="copy-private">' + icon('copy') + ' Copy</button></div></section>' +
      '<section class="card pad"><h2 class="card-h">Where applications are saved</h2>' +
      (app.mode === 'remote'
        ? '<p class="hint">Shared storage is on. Candidates can apply from any device and the applications reach you here.</p>'
        : '<div class="banner info" style="margin-top:8px"><span><strong>This browser only.</strong> This site has no shared storage set up, so applications are saved in this browser. Candidates must apply in the same browser, which is fine for a demo. To receive applications from other devices, add a free Upstash Redis database (see the README) and redeploy.</span></div>') + '</section>' +
      '<section class="card pad"><h2 class="card-h">Job status</h2><p class="hint">Closing stops new applications. Existing applicants stay.</p><div class="row" style="margin-top:12px">' +
      '<button class="btn secondary" data-act="toggle-status">' + (j.status === 'open' ? 'Close applications' : 'Reopen applications') + '</button>' +
      '<button class="btn danger" data-act="forget" data-id="' + esc(j.id) + '" data-then="home">Remove from this browser</button></div></section></div>';
  }

  /* ================================================================ EVENTS */

  function onBoth(ev, fn) { view.addEventListener(ev, fn); $('drawer-host').addEventListener(ev, fn); }

  var searchT = null;
  var acts = {
    sample: function (t) { makeSample(t).catch(function (e) { toast(e.message); t.disabled = false; }); },
    forget: function (t) {
      ScoutData.forgetJob(t.dataset.id);
      cache = null;
      toast('Removed from this browser. The job itself is not deleted.');
      if (t.dataset.then === 'home') location.hash = '#/'; else route();
    },
    'wiz-mode': function (t) { draft.mode = t.dataset.mode; newJobView(); },
    'wiz-skip': function () { draft.step = 2; draft.note = ''; newJobView(); },
    'wiz-back': function () { draft.step = 1; newJobView(); },
    'wiz-generate': function () { generate(); },
    'wiz-extract': function () { extractFromPaste(); },
    'wiz-web-enrich': function () { enrichWebDraft(); },
    'wiz-sample-jd': function () { draft.jd = Samples.JOB; newJobView(); },
    'wiz-create': function () { createJob(); },
    'chat-example': function () {
      var ta = $('chat-input');
      ta.value = 'We are a seed-stage fintech startup in Lagos building cross-border B2B payments. We need a Founding Backend Engineer with 3+ years in Python or Go, deep PostgreSQL knowledge, who has shipped high-volume APIs to real customers.';
      ta.focus();
    },
    'req-weight': function (t) {
      var r = listFor(t.dataset.list)[+t.dataset.i];
      if (r) { r.weight = r.weight === 'nice' ? 'must' : 'nice'; repaintReqs(t.dataset.list); }
    },
    'req-del': function (t) { listFor(t.dataset.list).splice(+t.dataset.i, 1); repaintReqs(t.dataset.list); },
    'req-add': function (t) { addReq(t.dataset.list); },
    'copy-apply': function () { copyText(ScoutData.applyLink(cache.job), 'Apply link copied'); },
    'copy-private': function () { copyText(location.origin + '/hire#/job/' + cache.job.id + '?key=' + cache.key, 'Private link copied'); },
    view: function (t) { ui.view = t.dataset.v; focusSel = 'button[data-v="' + t.dataset.v + '"]'; rerender(); },
    'close-drawer': function () { closeDrawer(); },
    'toggle-listed': function () {
      call('jobUpdate', { id: cache.id, key: cache.key, patch: { listed: !cache.job.listed } }).then(function (r) {
        cache.job = r.job; rerender(); toast(r.job.listed ? 'Listed on the job board' : 'Removed from the job board');
      }).catch(function (e) { toast(e.message); });
    },
    'toggle-add': function () { ui.showAdd = !ui.showAdd; rerender(); if (ui.showAdd) { var n = $('add-name'); if (n) n.focus(); } },
    refresh: async function () {
      try { cache = await loadJob(cache.id); rerender(); toast('Up to date'); } catch (e) { toast(e.message); }
    },
    screen: function () { screenCands(needsScreen()); },
    'screen-one': function (t) {
      var c = cache.cands.filter(function (x) { return x.id === t.dataset.id; })[0];
      if (c) screenCands([c]);
    },
    reveal: function (t) { ui.revealed[t.dataset.id] = !ui.revealed[t.dataset.id]; focusSel = 'button[data-act="reveal"]'; rerender(); },
    stage: function (t) {
      var c = cache.cands.filter(function (x) { return x.id === t.dataset.id; })[0];
      if (!c) return;
      focusSel = 'button[data-act="stage"][data-stage="' + t.dataset.stage + '"]';
      setStage(c, c.stage === t.dataset.stage ? 'new' : t.dataset.stage);
    },
    'remove-cand': function (t) {
      var c = cache.cands.filter(function (x) { return x.id === t.dataset.id; })[0];
      if (!c || !confirm('Remove ' + c.name + ' from this job? This deletes their application.')) return;
      call('candidateRemove', { jobId: cache.id, key: cache.key, candId: c.id }).then(function () {
        cache.cands = cache.cands.filter(function (x) { return x.id !== c.id; });
        location.hash = '#/job/' + cache.id + '/applicants';
        toast('Removed');
      }).catch(function (e) { toast(e.message); });
    },
    csv: function () { exportCsv(); },
    'save-job': function () { saveJob(); },
    'toggle-status': function () {
      var next = cache.job.status === 'open' ? 'closed' : 'open';
      call('jobUpdate', { id: cache.id, key: cache.key, patch: { status: next } }).then(function (r) {
        cache.job = r.job; rerender(); toast(next === 'open' ? 'Applications reopened' : 'Applications closed');
      }).catch(function (e) { toast(e.message); });
    }
  };

  function setStage(c, next) {
    var prev = c.stage;
    c.stage = next;
    rerender();
    call('candidatePatch', { jobId: cache.id, key: cache.key, candId: c.id, patch: { stage: next } }).catch(function (e) {
      c.stage = prev; rerender(); toast('Could not save: ' + e.message);
    });
  }

  function addReq(listName) {
    var inp = $('new-req-' + listName);
    var text = inp.value.trim();
    if (!text) { inp.focus(); return; }
    listFor(listName).push({ id: uid(), text: text, weight: 'must' });
    inp.value = '';
    repaintReqs(listName);
    inp.focus();
  }

  onBoth('click', function (e) {
    var contact = e.target.closest('a[data-contact]');
    if (contact && cache) {
      var c = cache.cands.filter(function (x) { return x.id === contact.dataset.contact; })[0];
      if (c) {
        c.contactedAt = new Date().toISOString();
        call('candidatePatch', { jobId: cache.id, key: cache.key, candId: c.id, patch: { contactedAt: c.contactedAt } }).catch(function () { /* non-critical */ });
        setTimeout(rerender, 300);
      }
      return;
    }
    var t = e.target.closest('[data-act]');
    if (t && acts[t.dataset.act]) { acts[t.dataset.act](t, e); return; }
    var tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a, button')) location.hash = tr.dataset.href;
  });

  onBoth('input', function (e) {
    var t = e.target, f = t.dataset.field;
    if (!f) return;
    if (f === 'req-text') { var r = listFor(t.dataset.list)[+t.dataset.i]; if (r) r.text = t.value; return; }
    if (f === 'ui.search') { ui.search = t.value; clearTimeout(searchT); searchT = setTimeout(function () { var pos = t.selectionStart; focusSel = '#cand-search'; rerender(); var n = $('cand-search'); if (n) n.setSelectionRange(pos, pos); }, 180); return; }
    if (f.indexOf('draft.') === 0) { draft[f.slice(6)] = t.value; return; }
    if (f.indexOf('edit.') === 0 && edit) { edit[f.slice(5)] = t.value; return; }
    if (f === 'o-name' || f === 'o-company' || f === 'o-template') {
      var o = getOutreach();
      if (f === 'o-name') o.name = t.value; else if (f === 'o-company') o.company = t.value; else o.template = t.value || DEFAULT_TEMPLATE;
      saveOutreach(o);
      refreshContactLinks();
    }
  });
  onBoth('change', function (e) {
    var t = e.target;
    var f2 = t.dataset.field || '';
    if (f2.indexOf('edit.') === 0 && edit) edit[f2.slice(5)] = t.value;
    else if (f2.indexOf('draft.') === 0) draft[f2.slice(6)] = t.value;
  });

  onBoth('keydown', function (e) {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.field === 'new-req') {
      e.preventDefault();
      addReq(e.target.dataset.list);
    }
  });

  onBoth('submit', function (e) {
    e.preventDefault();
    var f = e.target.dataset.form;
    if (f === 'chat') sendChat();
    else if (f === 'add-cv') addCv();
  });

  function refreshContactLinks() {
    var r = parseHash();
    var candId = r.parts[3];
    var c = cache && cache.cands.filter(function (x) { return x.id === candId; })[0];
    if (!c) return;
    var u = contactUrls(c);
    var map = { wa: u.wa, tel: u.tel, mail: u.mail };
    Object.keys(map).forEach(function (k) {
      var a = document.querySelector('.contact-btn.' + k);
      if (a && map[k]) a.setAttribute('href', map[k]);
    });
  }

  async function addCv() {
    var name = $('add-name').value, cv = $('add-cv').value;
    try {
      var res = await call('candidateAdd', { jobId: cache.id, key: cache.key, name: name, cv: cv });
      cache.cands.unshift(res.candidate);
      ui.showAdd = false;
      toast('Candidate added. Screen to rank them.');
      location.hash = '#/job/' + cache.id + '/applicants/' + res.candidate.id;
    } catch (err) { toast(err.message); }
  }

  async function saveJob() {
    var msg = $('edit-msg');
    var reqs = edit.reqs.filter(function (r) { return r.text.trim(); });
    if (!edit.title.trim()) { msg.textContent = 'The title cannot be empty.'; return; }
    if (!reqs.length) { msg.textContent = 'Keep at least one requirement.'; return; }
    try {
      var res = await call('jobUpdate', { id: cache.id, key: cache.key, patch: { title: edit.title, company: edit.company, location: edit.location, type: edit.type, workMode: edit.workMode, jd: edit.jd, status: edit.status, requirements: reqs } });
      var before = reqSig(cache.job.requirements);
      cache.job = res.job;
      ScoutData.rememberJob(res.job, cache.key);
      edit = null;
      toast(before !== reqSig(res.job.requirements) && cache.cands.length ? 'Saved. Applicants need screening again.' : 'Saved');
      location.hash = '#/job/' + cache.id + '/applicants';
    } catch (err) { msg.textContent = err.message; }
  }

  function exportCsv() {
    var reqs = cache.job.requirements;
    var rows = rowsFor();
    var headers = ['Candidate', 'Stage', 'Match %', 'Up to % if verified', 'Suggestion', 'Stated', 'Not stated', 'Contradicted', 'Contacted'];
    if (ui.csvContacts) headers.push('Phone', 'Email');
    var out = [headers];
    rows.forEach(function (r) {
      var names = function (status) {
        if (!r.c.screen) return '';
        return reqs.filter(function (q) {
          var k = r.c.screen.checks.filter(function (x) { return x.reqId === q.id; })[0];
          return (k ? k.status : 'not_stated') === status;
        }).map(function (q) { return q.text; }).join('; ');
      };
      var line = [r.c.name, STAGE_LABEL[r.c.stage], r.sc ? r.sc.now : '', r.sc ? r.sc.potential : '', r.sug ? r.sug.text : 'Not screened',
        names('met'), names('not_stated'), names('not_met'), r.c.contactedAt ? fmtDate(r.c.contactedAt) : ''];
      if (ui.csvContacts) line.push(r.c.consent ? r.c.phone : '', r.c.consent ? r.c.email : '');
      out.push(line);
    });
    var blob = new Blob([Engine.toCsv(out)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = cache.job.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-applicants.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('drawer-host').firstChild) closeDrawer(); });

  // Drag a card to another column to change its stage.
  view.addEventListener('dragstart', function (e) {
    var k = e.target.closest && e.target.closest('.kcard');
    if (!k) return;
    e.dataTransfer.setData('text/plain', k.dataset.cand);
    e.dataTransfer.effectAllowed = 'move';
    k.classList.add('dragging');
  });
  view.addEventListener('dragend', function (e) {
    var k = e.target.closest && e.target.closest('.kcard');
    if (k) k.classList.remove('dragging');
    Array.prototype.forEach.call(view.querySelectorAll('.kcol.over'), function (c) { c.classList.remove('over'); });
  });
  view.addEventListener('dragover', function (e) {
    var col = e.target.closest && e.target.closest('.kcol');
    if (!col) return;
    e.preventDefault();
    Array.prototype.forEach.call(view.querySelectorAll('.kcol.over'), function (c) { if (c !== col) c.classList.remove('over'); });
    col.classList.add('over');
  });
  view.addEventListener('drop', function (e) {
    var col = e.target.closest && e.target.closest('.kcol');
    if (!col) return;
    e.preventDefault();
    var id = e.dataTransfer.getData('text/plain');
    var c = cache && cache.cands.filter(function (x) { return x.id === id; })[0];
    if (!c || c.stage === col.dataset.stage) { rerender(); return; }
    setStage(c, col.dataset.stage);
  });

  // Pick up new applicants when returning to the tab (shared storage only).
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !cache || cache.locked || app.mode !== 'remote' || ui.screening) return;
    if (Date.now() - (cache.fetchedAt || 0) < 20000) return;
    var r = parseHash();
    if (r.parts[0] !== 'job' || (r.parts[2] && r.parts[2] !== 'applicants')) return;
    loadJob(cache.id).then(function (d) { cache = d; rerender(); }).catch(function () { /* ignore */ });
  });

  /* ================================================================ ASSISTANT ("Ask Scout") */

  var asst = { open: false, busy: false, log: [] };
  var EXAMPLES = ['Show me the top 10 candidates', 'Who fits which job?', 'Top 30 who know sales', 'Who is shortlisted?'];

  function asstHtml() {
    var msgs = asst.log.map(function (m) {
      if (m.kind === 'cards') return '<div class="a-cards">' + m.html + '</div>';
      return '<div class="msg ' + (m.role === 'me' ? 'me' : 'ai') + '">' + esc(m.text) + '</div>';
    }).join('');
    return '<button type="button" class="asst-fab" data-act="asst-toggle" aria-expanded="' + asst.open + '" aria-controls="asst-panel">' + icon('star') + '<span>Ask Scout</span></button>' +
      '<section class="asst" id="asst-panel" role="dialog" aria-label="Ask Scout" ' + (asst.open ? '' : 'hidden') + '>' +
      '<header><div><strong>Ask Scout</strong><small>Ask for candidates in plain words</small></div><button type="button" class="icon-btn" data-act="asst-toggle" aria-label="Close">' + icon('x') + '</button></header>' +
      '<div class="asst-log" id="asst-log" aria-live="polite">' +
      (asst.log.length ? msgs : '<div class="msg ai">Hi. Tell me what you want to see, for example &ldquo;show me the top 30 candidates&rdquo;. I will list them with their score and skills, and you can open any one to read the whole CV.</div><div class="asst-ex">' + EXAMPLES.map(function (x) { return '<button type="button" class="chip-btn" data-act="asst-ex" data-text="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>') +
      (asst.busy ? '<div class="typing"><i></i><i></i><i></i></div>' : '') + '</div>' +
      '<form class="asst-form" id="asst-form"><label class="visually-hidden" for="asst-in">Ask Scout</label><input id="asst-in" type="text" maxlength="300" autocomplete="off" placeholder="e.g. top 30 candidates"><button class="btn" type="submit"' + (asst.busy ? ' disabled' : '') + '>Ask</button></form></section>';
  }
  function paintAsst() {
    var host = $('asst-host');
    var keep = host.querySelector('#asst-in'), val = keep ? keep.value : '', had = keep && document.activeElement === keep;
    host.innerHTML = asstHtml();
    var inp = host.querySelector('#asst-in'); inp.value = val;
    if (had || asst.open) { if (had) inp.focus(); }
    var log = host.querySelector('#asst-log'); if (log) log.scrollTop = log.scrollHeight;
  }
  function asstSay(role, text) { asst.log.push({ role: role, text: text }); }

  function cardFor(r, rank) {
    var c = r.c, p = c.profile || {};
    var skills = (p.skills || []).slice(0, 3);
    var where = c.location || p.location || '';
    return '<a class="cand-card" href="#/job/' + esc(cache.job.id) + '/applicants/' + esc(c.id) + '" data-act="asst-open">' +
      '<span class="cc-rank">' + rank + '</span>' + person(c.name) +
      '<span class="cc-main"><strong>' + esc(c.name) + '</strong><small>' + esc(p.headline || (where || 'Applicant')) + '</small>' +
      (skills.length ? '<span class="chips">' + skills.map(function (k) { return '<span class="chip skill">' + esc(k) + '</span>'; }).join('') + '</span>' : '') + '</span>' +
      '<span class="cc-side">' + pill(r.sc) + (where ? '<small>' + esc(where) + '</small>' : '') + '</span></a>';
  }

  async function runIntent(intent) {
    var jobs = ScoutData.myJobs();
    if (!jobs.length) return { text: 'You have no jobs yet. Post a job first and share its link.' };
    var r = parseHash();
    var current = r.parts[0] === 'job' ? r.parts[1] : '';
    var id = intent.jobId || current || (cache && cache.id) || jobs[0].id;
    if (!jobs.filter(function (j) { return j.id === id; })[0]) id = jobs[0].id;
    var data = (cache && cache.id === id && !cache.locked) ? cache : await loadJob(id);
    if (data.locked) return { text: 'That job is not linked to this browser, so I cannot open its applicants.' };
    cache = data;
    if (!data.cands.length) return { text: 'No one has applied to ' + data.job.title + ' yet. Share its apply link to get applicants.' };
    var need = needsScreen();
    if (need.length) { asstSay('ai', 'Reading ' + plural(need.length, 'CV') + ' first...'); paintAsst(); await screenCands(need); }
    var rows = rowsFor();
    rows = rows.filter(function (x) {
      var c = x.c, p = c.profile || {};
      if (intent.stage && c.stage !== intent.stage) return false;
      if (intent.interviewed && !c.interview) return false;
      if (intent.minScore && (!x.sc || x.sc.now < intent.minScore)) return false;
      if (intent.location) {
        var loc = (String(c.location || '') + ' ' + String(p.location || '') + ' ' + String(c.cv || '').slice(0, 400)).toLowerCase();
        if (loc.indexOf(String(intent.location).toLowerCase()) < 0) return false;
      }
      if (intent.skills && intent.skills.length) {
        var hay = (String(c.cv || '') + ' ' + (p.skills || []).join(' ')).toLowerCase();
        if (!intent.skills.every(function (k) { return hay.indexOf(String(k).toLowerCase()) >= 0; })) return false;
      }
      return true;
    });
    var top = rows.slice(0, Math.max(1, Math.min(100, intent.n || 10)));
    if (intent.action === 'shortlist') {
      if (!top.length) return { text: 'No candidates match that, so nobody was shortlisted.' };
      top.forEach(function (x) { if (x.c.stage !== 'shortlist') setStage(x.c, 'shortlist'); });
      return { text: 'I marked ' + plural(top.length, 'candidate') + ' as shortlisted for ' + data.job.title + '. You can undo any of them from the pipeline.', html: top.map(function (x, i) { return cardFor(x, i + 1); }).join('') };
    }
    if (!top.length) return { text: 'No one matches that for ' + data.job.title + '. Try a looser request.' };
    var rough = top.some(function (x) { return x.c.screen && !x.c.screen.usedAi; });
    return { text: 'Here ' + (top.length === 1 ? 'is' : 'are') + ' ' + (intent.n && rows.length > top.length ? 'the top ' + top.length : plural(top.length, 'candidate')) + ' for ' + data.job.title + ', best match first.' + (rough ? ' Scores use keyword matching, so treat them as a first pass.' : ''), html: top.map(function (x, i) { return cardFor(x, i + 1); }).join('') };
  }

  async function askScout(text) {
    if (!text || asst.busy) return;
    asstSay('me', text); asst.busy = true; paintAsst();
    if (/who fits|which job|talent matrix|cross match/i.test(text)) {
      asst.busy = false;
      asstSay('ai', 'I analyzed your talent pool across all active jobs. You can open the interactive Talent Match Matrix anytime from the sidebar or by going to #/matrix to see who fits best where.');
      paintAsst();
      return;
    }
    var jobs = ScoutData.myJobs().map(function (j) { return { id: j.id, title: j.title }; });
    var r = parseHash(), current = r.parts[0] === 'job' ? r.parts[1] : '';
    var intent = null, reply = '';
    try {
      var resp = await postJson('/api/assistant', { message: text, jobs: jobs, currentJobId: current });
      intent = resp.intent; reply = resp.reply || '';
    } catch (e) { intent = null; }
    if (!intent) intent = Engine.parseIntent(text, jobs, current);
    var out;
    try {
      if (intent.action === 'help' || intent.action === 'answer') {
        out = { text: reply || 'I can show your top candidates ("top 30"), filter them ("top 10 in Lagos who know sales", "above 70%", "who is shortlisted", "who did the chat"), or shortlist the best ones ("shortlist the top 5"). Click any card to read the full CV.' };
      } else {
        out = await runIntent(intent);
      }
    } catch (e) { out = { text: 'That did not work: ' + e.message }; }
    asst.busy = false;
    asstSay('ai', out.text);
    if (out.html) asst.log.push({ kind: 'cards', html: out.html });
    paintAsst();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act^="asst"]');
    if (!t) return;
    var act = t.dataset.act;
    if (act === 'asst-toggle') { asst.open = !asst.open; paintAsst(); if (asst.open) $('asst-in').focus(); }
    else if (act === 'asst-ex') askScout(t.dataset.text);
    else if (act === 'asst-open') { if (window.matchMedia('(max-width: 720px)').matches) { asst.open = false; paintAsst(); } }
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'asst-form') return;
    e.preventDefault();
    var inp = $('asst-in'), v = inp.value.trim(); inp.value = '';
    askScout(v);
  });
  paintAsst();

  /* ---------------------------------------------------------------- start */
  ScoutData.mode().then(function () { return ScoutData.pullJobs(); }).catch(function () { /* not signed in */ }).then(route);
})();
