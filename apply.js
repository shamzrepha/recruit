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

  $('btn-paste').addEventListener('click', function () { showReview(); $('f-cv').focus(); });
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

  // Configure PDF.js worker
  function configPdf() {
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }
  window.addEventListener('load', configPdf);

  var currentImageBase64 = null;
  
  function uploadError(msg) {
    var el = $('upload-msg');
    if (el) el.textContent = msg || '';
  }

  // Phone validation on input
  var phoneInput = $('f-phone');
  var phoneFeedback = $('phone-feedback');

  phoneInput.addEventListener('input', function () {
    var val = phoneInput.value.trim();
    if (!val) {
      phoneFeedback.textContent = '';
      phoneFeedback.className = 'field-msg';
      return;
    }
    var norm = Engine.normalizePhone(val);
    if (norm.valid) {
      phoneFeedback.textContent = '✓ Normalised to E.164: ' + norm.e164;
      phoneFeedback.className = 'field-msg success';
    } else {
      phoneFeedback.textContent = '⚠ ' + norm.error;
      phoneFeedback.className = 'field-msg error';
    }
  });

  // Dropzone setup
  var dropzone = $('dropzone');
  var fileInput = $('cvfile');
  var browseBtn = $('browse-btn');

  browseBtn.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('click', function (e) {
    if (e.target !== browseBtn) fileInput.click();
  });
  dropzone.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === dropzone) {
      e.preventDefault();
      fileInput.click();
    }
  });

  dropzone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', function () {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) {
      handleFile(fileInput.files[0]);
    }
  });

  function showOcrStatus(msg) {
    var box = $('ocr-status');
    box.hidden = false;
    $('ocr-msg').textContent = msg;
  }

  function hideOcrStatus() {
    $('ocr-status').hidden = true;
  }

  async function handleFile(file) {
    if (!file) return;
    currentImageBase64 = null;
    uploadError('');
    $('vision-box').hidden = true;
    if (file.size > 5 * 1024 * 1024) {
      uploadError('That file is over 5 MB. Try a smaller photo or a screenshot.');
      return;
    }

    var type = file.type;
    var name = file.name || '';

    if (type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
      await extractFromPdf(file);
    } else if (type.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(name)) {
      await extractFromImage(file);
    } else {
      uploadError('Please choose a PDF or an image (PNG, JPG or WEBP).');
    }
  }

  async function extractFromPdf(file) {
    showOcrStatus('Reading PDF text layer on your device…');
    try {
      var arrayBuffer = await file.arrayBuffer();
      configPdf();
      if (!window.pdfjsLib) throw new Error('PDF.js library failed to load.');
      var pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      var pagesText = [];

      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var textContent = await page.getTextContent();
        var pageStr = textContent.items.map(function (item) { return item.str; }).join(' ');
        pagesText.push(pageStr);
      }

      var fullText = pagesText.join('\n\n').trim();
      hideOcrStatus();
      if (!fullText) {
        uploadError('This PDF has no readable text (it may be a scan). Take a photo or screenshot of it instead.');
        return;
      }
      populateExtractedData(fullText);
    } catch (err) {
      hideOcrStatus();
      console.error(err);
      uploadError('Could not read that PDF: ' + (err.message || 'unknown error') + '. You can also paste your CV text below.');
    }
  }

  async function extractFromImage(file) {
    showOcrStatus('Reading CV image with Tesseract.js (free & private in browser)…');
    try {
      // Store base64 for optional Groq Vision fallback
      var reader = new FileReader();
      reader.onload = function (e) { currentImageBase64 = e.target.result; };
      reader.readAsDataURL(file);

      if (window.Tesseract && window.Tesseract.recognize) {
        var res = await window.Tesseract.recognize(file, 'eng', {
          logger: function (m) {
            if (m.status === 'recognizing text') {
              showOcrStatus('Recognizing text: ' + Math.round((m.progress || 0) * 100) + '%');
            }
          }
        });
        hideOcrStatus();
        var text = (res && res.data && res.data.text) || '';
        populateExtractedData(text);
        $('vision-box').hidden = false;
      } else {
        throw new Error('Tesseract is not loaded.');
      }
    } catch (err) {
      hideOcrStatus();
      console.error(err);
      uploadError('Reading the image on this device failed. You can paste your CV text below or use Groq Vision.');
      $('vision-box').hidden = false;
    }
  }

  // Vision fallback (explicit consent required)
  $('btn-vision').addEventListener('click', async function () {
    if (!currentImageBase64) {
      uploadError('Please upload an image first.');
      return;
    }
    var agree = confirm('To use AI Vision, your CV image will be sent securely to Groq Vision serverless API. Do you want to proceed?');
    if (!agree) return;

    showOcrStatus('Sending image to Groq Vision model for enhanced transcription…');
    try {
      var resp = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: currentImageBase64 })
      });
      var data = await resp.json();
      hideOcrStatus();
      if (!resp.ok) throw new Error(data.error || 'Vision OCR failed');

      if (data.text) {
        populateExtractedData(data.text, data.fields);
      }
    } catch (err) {
      hideOcrStatus();
      uploadError('Groq Vision could not read it: ' + err.message);
    }
  });

  function populateExtractedData(text, preFields) {
    $('f-cv').value = text;
    var detected = Engine.extractContacts(text);

    if (preFields) {
      if (preFields.name) detected.name = preFields.name;
      if (preFields.phone) detected.phone = preFields.phone;
      if (preFields.email) detected.email = preFields.email;
      if (preFields.location) detected.location = preFields.location;
      if (preFields.links) {
        if (preFields.links.linkedin) detected.links.linkedin = preFields.links.linkedin;
        if (preFields.links.github) detected.links.github = preFields.links.github;
        if (preFields.links.portfolio) detected.links.portfolio = preFields.links.portfolio;
      }
    }

    if (detected.name && !$('f-name').value) $('f-name').value = detected.name;
    if (detected.phone && !$('f-phone').value) {
      $('f-phone').value = detected.phone;
      phoneInput.dispatchEvent(new Event('input'));
    }
    if (detected.email && !$('f-email').value) $('f-email').value = detected.email;
    if (detected.location && !$('f-location').value) $('f-location').value = detected.location;
    if (detected.links.linkedin && !$('f-linkedin').value) $('f-linkedin').value = detected.links.linkedin;
    if (detected.links.github && !$('f-github').value) $('f-github').value = detected.links.github;
    if (detected.links.portfolio && !$('f-github').value) $('f-github').value = detected.links.portfolio;

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
      var res = await ScoutData.call('apply', {
        jobId: jobId, name: name, cv: cvText, phone: e164, email: $('f-email').value.trim(),
        location: $('f-location').value.trim(), consent: $('f-consent').checked,
        links: { linkedin: $('f-linkedin').value.trim(), github: $('f-github').value.trim() }
      });
      showSuccess(res.token);
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

  init();
})();
