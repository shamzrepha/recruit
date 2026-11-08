(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var jobId = params.get('job') || '';
  var snap = params.get('s') ? ScoutData.readSnapshot(params.get('s')) : null;
  var job = null;
  var currentImageBase64 = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStep(n) {
    Array.prototype.forEach.call(document.querySelectorAll('#stepper li'), function (li, i) {
      li.classList.toggle('done', i + 1 < n);
      li.classList.toggle('current', i + 1 === n);
      if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }
  function submitError(msg, focusEl) {
    var el = $('submit-status');
    el.textContent = msg;
    if (focusEl) focusEl.focus();
  }
  function stateCard(title, body) {
    $('flow').hidden = true;
    $('state').innerHTML = '<div class="empty-state"><h2>' + esc(title) + '</h2><p>' + esc(body) + '</p><div class="row"><a class="btn" href="/">Back to home</a></div></div>';
  }

  function showReview() {
    $('upload-section').hidden = true;
    $('review-section').hidden = false;
    setStep(2);
    $('f-name').focus();
    window.scrollTo(0, 0);
  }

  $('btn-paste').addEventListener('click', function () { showReview(); $('f-cv').parentNode.open = true; $('f-cv').focus(); });
  $('btn-back').addEventListener('click', function () {
    $('review-section').hidden = true;
    $('upload-section').hidden = false;
    setStep(1);
  });

  async function init() {
    if (!jobId) { stateCard('This link is incomplete', 'It does not say which job you are applying for. Ask the recruiter to send the apply link again.'); return; }
    var mode = await ScoutData.mode();
    try {
      job = (await ScoutData.call('jobGet', { id: jobId })).job;
    } catch (err) {
      if (mode === 'local' && snap) {
        paintRole(snap);
        $('flow').hidden = false;
        $('upload-section').hidden = true;
        $('stepper').hidden = true;
        $('state').innerHTML = '<div class="banner info"><span><strong>Applications are not open from this device yet.</strong> This site saves applications in the recruiter&rsquo;s own browser, so they can only be received there. Ask the recruiter to turn on shared storage.</span></div>';
        return;
      }
      stateCard('We could not find this job', 'It may have expired or the link may be wrong. Ask the recruiter for a fresh apply link.');
      return;
    }
    if (job.status === 'closed') { stateCard(job.title, 'This job is no longer taking applications.'); return; }
    paintRole(job);
    $('flow').hidden = false;
  }

  function paintRole(j) {
    $('a-company').textContent = j.company || 'Open role';
    $('a-title').textContent = j.title;
    document.title = 'Apply: ' + j.title + ' - Scout Screener';
    $('a-reqs').innerHTML = (j.requirements || []).map(function (r) { return '<li>' + esc(r.text) + (r.weight === 'nice' ? ' <span class="muted">(nice to have)</span>' : '') + '</li>'; }).join('');
  }

  // Phone validation on input
  var phoneInput = $('f-phone');
  var phoneFeedback = $('phone-feedback');
  phoneInput.addEventListener('input', function () {
    var val = phoneInput.value.trim();
    if (!val) { phoneFeedback.textContent = ''; phoneFeedback.className = 'field-msg'; return; }
    var n = Engine.normalizePhone(val);
    if (n.valid) { phoneFeedback.textContent = 'Saved as ' + n.e164; phoneFeedback.className = 'field-msg success'; }
    else { phoneFeedback.textContent = n.error; phoneFeedback.className = 'field-msg error'; }
  });

  var currentProfile = null, parsedText = '';
  function uploadError(msg) { var el = $('upload-msg'); if (el) el.textContent = msg || ''; }
  function busy(msg) { var b = $('ocr-status'); b.hidden = !msg; if (msg) $('ocr-msg').textContent = msg; }

  CvTools.wireDropzone($('dropzone'), $('cvfile'), $('browse-btn'), handleFile);

  async function handleFile(file) {
    uploadError(''); currentImageBase64 = null; $('vision-box').hidden = true; busy('Reading your CV...');
    try {
      var r = await CvTools.extract(file, busy);
      currentImageBase64 = r.image;
      if (r.image) $('vision-box').hidden = false;
      if (r.text.replace(/\s/g, '').length < 40) { busy(''); uploadError('Almost nothing could be read. Try the vision reader or paste your CV text.'); return; }
      await populate(r.text);
    } catch (err) { busy(''); uploadError(err.message); }
  }

  $('btn-vision').addEventListener('click', async function () {
    if (!currentImageBase64) { uploadError('Please upload an image first.'); return; }
    if (!confirm('Your CV image will be sent securely to a Groq vision model. Continue?')) return;
    busy('Reading with the vision model...');
    try { var t = await CvTools.vision(currentImageBase64); if (t) await populate(t); else { busy(''); uploadError('The vision reader found no text.'); } }
    catch (err) { busy(''); uploadError(err.message); }
  });

  async function populate(text) {
    busy('Building your profile...');
    parsedText = text;
    var p = await CvTools.parse(text);
    busy('');
    currentProfile = p.profile;
    $('f-cv').value = text;
    var pr = p.profile, links = pr.links || {};
    $('profile-card').innerHTML = CvTools.profileHtml(pr);
    $('parse-note').textContent = p.ai ? 'We filled these in from your CV. Fix anything that is wrong.' : (p.note || 'The AI is not connected, so a basic reader filled these in. Please check them.');
    if (pr.name && !$('f-name').value) $('f-name').value = pr.name;
    if (pr.phone && !$('f-phone').value) { $('f-phone').value = pr.phone; phoneInput.dispatchEvent(new Event('input')); }
    if (pr.email && !$('f-email').value) $('f-email').value = pr.email;
    if (pr.location && !$('f-location').value) $('f-location').value = pr.location;
    if (links.linkedin && !$('f-linkedin').value) $('f-linkedin').value = links.linkedin;
    var gh = links.github || links.portfolio;
    if (gh && !$('f-github').value) $('f-github').value = gh;
    showReview();
  }

  $('apply-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = $('f-name').value.trim();
    var phone = $('f-phone').value.trim();
    var cvText = $('f-cv').value.trim();
    $('submit-status').textContent = '';
    if (!name) { submitError('Please enter your full name.', $('f-name')); return; }
    if (cvText.length < 30) { submitError('Please add your CV text (at least 30 characters).', $('f-cv')); return; }
    var e164 = '';
    if (phone) {
      var np = Engine.normalizePhone(phone);
      if (!np.valid) { submitError('Check your phone number: ' + np.error, phoneInput); return; }
      e164 = np.e164;
    }
    var btn = $('submit-btn');
    btn.disabled = true;
    try {
      if (!currentProfile) { currentProfile = (await CvTools.parse(cvText)).profile; }
      if (cvText !== parsedText && parsedText) { currentProfile = (await CvTools.parse(cvText)).profile; parsedText = cvText; }
      var res = await ScoutData.call('apply', {
        jobId: jobId, name: name, cv: cvText, phone: e164, email: $('f-email').value.trim(),
        location: $('f-location').value.trim(), consent: $('f-consent').checked,
        links: { linkedin: $('f-linkedin').value.trim(), github: $('f-github').value.trim() },
        profile: currentProfile ? Object.assign({}, currentProfile, { name: name }) : undefined
      });
      showSuccess(res.token);
      showFit(cvText);
    } catch (err) {
      submitError(err.message || 'Could not submit. Try again.');
      btn.disabled = false;
    }
  });

  function showSuccess(token) {
    $('review-section').hidden = true;
    $('upload-section').hidden = true;
    $('success-section').hidden = false;
    setStep(3);
    var consent = $('f-consent').checked;
    $('done-sub').textContent = consent
      ? 'The recruiter can see your CV and the contact details you shared.'
      : 'The recruiter can see your CV. Your phone and email were not stored.';
    var url = location.origin + '/interview?token=' + encodeURIComponent(token);
    $('cand-link').textContent = url;
    $('start-interview').setAttribute('href', url);
    $('copy-link').onclick = function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { $('copy-link').textContent = 'Copied'; setTimeout(function () { $('copy-link').textContent = 'Copy'; }, 1800); }).catch(function () {});
      }
    };
    $('delete-app').onclick = async function () {
      if (!confirm('Delete your application and everything attached to it?')) return;
      try { await ScoutData.call('candidateDelete', { token: token }); } catch (err) { /* already gone */ }
      $('success-section').innerHTML = '<div class="block-head"><h2>Deleted.</h2><p>Your application has been removed.</p></div>';
    };
    window.scrollTo(0, 0);
  }

  async function showFit(cvText) {
    if (!job || !job.requirements) return;
    try {
      var text = Engine.cvWithProfile(cvText, currentProfile);
      var reqs = job.requirements.map(function (r) { return { id: r.id, text: r.text, weight: r.weight }; });
      var checks = Engine.demoScreen(reqs, [{ id: 'me', name: 'me', cv: text }])[0].checks;
      try {
        var st = await fetch('/api/screen', { cache: 'no-store' }).then(function (r) { return r.json(); });
        if (st && st.ai) {
          var resp = await fetch('/api/screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requirements: reqs, candidates: [{ id: 'me', name: 'me', cv: text }] }) });
          var d = await resp.json(); if (resp.ok && d.results && d.results[0]) checks = d.results[0].checks;
        }
      } catch (e) { /* keep rule-based */ }
      var sc = Engine.score(job.requirements, checks), sug = Engine.suggestion(sc);
      var dist = []; try { dist = (await ScoutData.call('jobScores', { id: jobId })).scores || []; } catch (e) { /* none */ }
      var rk = Engine.percentile(sc.now, dist);
      var by = {}; checks.forEach(function (k) { by[k.reqId] = k; });
      var gaps = job.requirements.filter(function (r) { return !by[r.id] || by[r.id].status !== 'met'; });
      var box = $('fit-card'); box.hidden = false;
      box.innerHTML = '<h3 class="card-h">How your CV fits this role</h3><div class="fit-row"><div class="mc-score ' + (sc.now >= 70 ? 'hi' : sc.now >= 45 ? 'mid' : 'lo') + '"><b>' + sc.now + '%</b><small>match</small></div><div><p><strong>' + esc(sug.text) + '.</strong></p><p class="muted">' +
        (rk.enough ? 'Estimated: ahead of ' + rk.ahead + '% of ' + rk.n + ' applicants so far (top ' + rk.top + '%).' : 'Too few applicants so far to estimate a ranking.') + ' This is a first pass, and a person makes the decision.</p></div></div>' +
        (gaps.length ? '<p class="small" style="margin-top:12px"><strong>To strengthen your CV for this role:</strong></p><ul class="plain">' + gaps.slice(0, 4).map(function (r) { return '<li>' + esc(r.text) + '</li>'; }).join('') + '</ul>' : '');
    } catch (e) { /* the fit card is optional */ }
  }

  init();
})();
