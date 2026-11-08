/*
 * CV tools for the browser: read a file (PDF text or photo OCR on the user's device),
 * build a structured profile (AI if configured, rules otherwise), and draw the profile
 * as a roadmap. Used by the job-seeker page and the apply page.
 */
(function (root) {
  'use strict';

  var PDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  var loading = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function loadScript(url) {
    if (!loading[url]) {
      loading[url] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = url; s.onload = resolve; s.onerror = function () { reject(new Error('Could not load a helper library. Check your connection.')); };
        document.head.appendChild(s);
      });
    }
    return loading[url];
  }

  function readDataUrl(file) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function (e) { resolve(e.target.result); };
      r.onerror = function () { resolve(null); };
      r.readAsDataURL(file);
    });
  }

  // Returns { text, image } where image is a data URL for photos (kept for the optional vision reader).
  async function extract(file, status) {
    status = status || function () {};
    if (!file) throw new Error('Choose a file first.');
    if (file.size > 5 * 1024 * 1024) throw new Error('That file is over 5 MB. Try a smaller photo or a screenshot.');
    var name = file.name || '', type = file.type || '';
    if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
      status('Reading your PDF on this device...');
      await loadScript(PDF_URL);
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      var pdf = await root.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      var pages = [];
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var tc = await page.getTextContent();
        // Keep line breaks: a new line starts when the text moves down the page.
        var lines = [], lastY = null, cur = '';
        tc.items.forEach(function (it) {
          var y = it.transform ? Math.round(it.transform[5]) : 0;
          if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(cur); cur = ''; }
          cur += it.str + (it.hasEOL ? '' : ' ');
          lastY = y;
        });
        lines.push(cur);
        pages.push(lines.map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n'));
      }
      var text = pages.join('\n\n').trim();
      if (!text) throw new Error('This PDF has no readable text (it may be a scan). Take a photo or screenshot of it instead.');
      return { text: text, image: null };
    }
    if (/^image\//.test(type) || /\.(png|jpe?g|webp)$/i.test(name)) {
      status('Reading your CV image on this device...');
      var image = await readDataUrl(file);
      await loadScript(TESS_URL);
      var res = await root.Tesseract.recognize(file, 'eng', {
        logger: function (m) { if (m.status === 'recognizing text') status('Recognising text: ' + Math.round((m.progress || 0) * 100) + '%'); }
      });
      var t = ((res && res.data && res.data.text) || '').trim();
      return { text: t, image: image };
    }
    throw new Error('Please choose a PDF or an image (PNG, JPG or WEBP).');
  }

  async function vision(image) {
    var resp = await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: image }) });
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(data.error || 'The vision reader could not read that image.');
    return data.text || '';
  }

  // Build the profile. The AI does it when configured; otherwise the rule-based reader does.
  async function parse(text) {
    try {
      var resp = await fetch('/api/cv-parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) });
      var data = await resp.json().catch(function () { return {}; });
      if (resp.ok && data.profile) return { profile: data.profile, ai: Boolean(data.ai), note: data.note || '' };
    } catch (e) { /* offline: fall through */ }
    return { profile: root.Engine.parseCv(text), ai: false, note: '' };
  }

  function wireDropzone(zone, input, browse, onFile) {
    browse.addEventListener('click', function (e) { e.stopPropagation(); input.click(); });
    zone.addEventListener('click', function (e) { if (e.target !== browse) input.click(); });
    zone.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === zone) { e.preventDefault(); input.click(); }
    });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('dragover'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault(); zone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', function () { if (input.files && input.files[0]) onFile(input.files[0]); });
  }

  /* ---- profile as a roadmap ---- */

  function years(a, b) {
    var s = [a, b].filter(Boolean).join(' – ');
    return s;
  }

  function profileHtml(p, opts) {
    opts = opts || {};
    if (!p) return '';
    var items = [];
    (p.experience || []).forEach(function (e) {
      items.push({ kind: 'work', title: e.title || 'Role', org: e.company, when: years(e.start, e.end), notes: e.highlights || [] });
    });
    (p.education || []).forEach(function (e) {
      items.push({ kind: 'edu', title: [e.qualification, e.field].filter(Boolean).join(', ') || 'Studies', org: e.school, when: years(e.start, e.end), notes: [] });
    });
    var head = '<header class="pf-head"><div><h3>' + esc(p.name || 'Unnamed') + '</h3>' +
      '<p class="pf-sub">' + [p.headline, p.location].filter(Boolean).map(esc).join(' &middot; ') + '</p></div>' +
      (p.yearsExperience != null && p.yearsExperience > 0 ? '<span class="chip info">' + (Math.round(p.yearsExperience * 10) / 10) + ' yrs experience</span>' : '') + '</header>';
    var summary = p.summary ? '<p class="pf-summary">' + esc(p.summary) + '</p>' : '';
    var skills = (p.skills && p.skills.length) ? '<div class="pf-block"><h4>Skills</h4><div class="chips">' + p.skills.slice(0, opts.maxSkills || 30).map(function (s) { return '<span class="chip skill">' + esc(s) + '</span>'; }).join('') + '</div></div>' : '';
    var road = items.length ? '<div class="pf-block"><h4>Roadmap</h4><ol class="roadmap">' + items.map(function (it) {
      return '<li class="rm-' + it.kind + '"><span class="rm-dot" aria-hidden="true"></span><div class="rm-body"><div class="rm-top"><strong>' + esc(it.title) + '</strong>' + (it.when ? '<span class="rm-when">' + esc(it.when) + '</span>' : '') + '</div>' +
        (it.org ? '<div class="rm-org">' + esc(it.org) + '</div>' : '') +
        (it.notes.length ? '<ul>' + it.notes.slice(0, 3).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') + '</div></li>';
    }).join('') + '</ol></div>' : '';
    var more = '';
    if (p.certifications && p.certifications.length) more += '<div class="pf-block"><h4>Certifications</h4><ul class="plain">' + p.certifications.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>';
    if (p.languages && p.languages.length) more += '<div class="pf-block"><h4>Languages</h4><div class="chips">' + p.languages.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</div></div>';
    return '<div class="profile">' + head + summary + skills + road + more + '</div>';
  }

  root.CvTools = { extract: extract, vision: vision, parse: parse, wireDropzone: wireDropzone, profileHtml: profileHtml, esc: esc };
})(typeof self !== 'undefined' ? self : this);
