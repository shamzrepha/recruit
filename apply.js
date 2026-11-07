(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // Configure PDF.js worker
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  var currentImageBase64 = null;
  var currentAppId = null;
  var currentRoadmap = null;
  var currentPercentile = 'Top 10%';
  var currentJobId = null;
  var activeJobsList = [];

  // Step indicator: 1 upload, 2 confirm, 3 optional AI chat
  function setStep(n) {
    var items = document.querySelectorAll('#stepper li');
    Array.prototype.forEach.call(items, function (li, i) {
      li.classList.toggle('done', i + 1 < n);
      li.classList.toggle('current', i + 1 === n);
      if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }

  function uploadError(msg) {
    var el = $('upload-msg');
    if (el) el.textContent = msg || '';
  }

  function submitError(msg, focusEl) {
    var el = $('submit-status');
    el.textContent = msg;
    el.className = 'status error';
    if (focusEl) focusEl.focus();
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
    $('vision-fallback-box').hidden = true;
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
        $('vision-fallback-box').hidden = false;
      } else {
        throw new Error('Tesseract is not loaded.');
      }
    } catch (err) {
      hideOcrStatus();
      console.error(err);
      uploadError('Reading the image on this device failed. You can paste your CV text below or use Groq Vision.');
      $('vision-fallback-box').hidden = false;
    }
  }

  // Vision fallback (explicit consent required)
  $('btn-use-vision').addEventListener('click', async function () {
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

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Load and Render Devpost-style Job Board
  async function loadJobs() {
    try {
      var resp = await fetch('/api/data?action=list_jobs');
      var data = await resp.json();
      activeJobsList = data.jobs || [];
      renderJobBoard();
    } catch (e) {
      console.warn('Jobs load notice:', e);
    }
  }

  function renderJobBoard() {
    var container = $('job-board-grid');
    if (!container || !activeJobsList.length) return;

    container.innerHTML = activeJobsList.map(function (job, idx) {
      var isSelected = (currentJobId === job.id) || (!currentJobId && idx === 0);
      if (isSelected && !currentJobId) {
        currentJobId = job.id;
        if ($('f-role') && !$('f-role').value) $('f-role').value = job.title;
      }

      var reqsSnippet = (job.mustHaves || []).slice(0, 3).map(function (m) {
        return '<li>' + esc(m) + '</li>';
      }).join('');

      return '<div class="job-card ' + (isSelected ? 'selected' : '') + '" data-job-id="' + esc(job.id) + '">' +
        '<div class="job-card-head">' +
          '<div>' +
            '<p class="job-card-company">' + esc(job.company) + '</p>' +
            '<h3 class="job-card-title">' + esc(job.title) + '</h3>' +
          '</div>' +
          (isSelected ? '<span class="tag green">Selected</span>' : '') +
        '</div>' +
        '<div class="job-card-meta">' +
          '<span class="meta-tag">' + esc(job.location) + '</span>' +
          '<span class="meta-tag">' + esc(job.type || 'Full-time') + '</span>' +
        '</div>' +
        '<p class="job-card-desc">' + esc(job.description.slice(0, 110)) + '…</p>' +
        '<ul class="job-card-reqs">' + reqsSnippet + '</ul>' +
        '<div class="job-card-action">' +
          '<button type="button" class="btn-quiet select-job-btn" data-job-id="' + esc(job.id) + '">' +
            (isSelected ? '✓ Applying to this role' : 'Select role') +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  if ($('job-board-grid')) {
    $('job-board-grid').addEventListener('click', function (e) {
      var card = e.target.closest('.job-card');
      if (!card) return;
      var jid = card.dataset.jobId;
      var found = activeJobsList.find(function (j) { return j.id === jid; });
      if (!found) return;

      currentJobId = found.id;
      if ($('f-role')) $('f-role').value = found.title;
      renderJobBoard();

      var cvVal = $('f-cv') ? $('f-cv').value.trim() : '';
      if (cvVal.length >= 20) {
        runMatchDiagnostics(cvVal, currentJobId);
      }
    });
  }

  // Scrape full CV into Career Roadmap Profile
  async function buildRoadmapAndDiagnostics(cvText) {
    if (!cvText || cvText.length < 20) return;
    showOcrStatus('AI is analyzing your CV and building your Career Roadmap Profile…');

    try {
      var resp = await fetch('/api/parse-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv: cvText })
      });
      var result = await resp.json();
      hideOcrStatus();

      if (result.ok && result.profile) {
        currentRoadmap = result.profile;
        renderRoadmapProfile(currentRoadmap);

        if (currentRoadmap.name && !$('f-name').value) $('f-name').value = currentRoadmap.name;
        if (currentRoadmap.phone && !$('f-phone').value) {
          $('f-phone').value = currentRoadmap.phone;
          phoneInput.dispatchEvent(new Event('input'));
        }
        if (currentRoadmap.email && !$('f-email').value) $('f-email').value = currentRoadmap.email;
        if (currentRoadmap.location && !$('f-location').value) $('f-location').value = currentRoadmap.location;
        if (currentRoadmap.links) {
          if (currentRoadmap.links.linkedin && !$('f-linkedin').value) $('f-linkedin').value = currentRoadmap.links.linkedin;
          if (currentRoadmap.links.github && !$('f-github').value) $('f-github').value = currentRoadmap.links.github;
        }
      }
    } catch (e) {
      hideOcrStatus();
      console.warn('Roadmap build notice:', e.message);
    }

    runMatchDiagnostics(cvText, currentJobId);
  }

  function renderRoadmapProfile(rm) {
    var rmBox = $('roadmap-display');
    if (!rmBox) return;

    if ($('rm-name')) $('rm-name').textContent = rm.name || 'Candidate Roadmap';
    if ($('rm-headline')) $('rm-headline').textContent = rm.headline || 'Software Engineer';
    if ($('rm-summary')) $('rm-summary').textContent = rm.summary || '';

    var contactLinks = [];
    if (rm.location) contactLinks.push('<span>📍 ' + esc(rm.location) + '</span>');
    if (rm.email) contactLinks.push('<span>✉ ' + esc(rm.email) + '</span>');
    if (rm.phone) contactLinks.push('<span>📞 ' + esc(rm.phone) + '</span>');
    if (rm.links && rm.links.linkedin) contactLinks.push('<a href="' + esc(rm.links.linkedin) + '" target="_blank">LinkedIn</a>');
    if (rm.links && rm.links.github) contactLinks.push('<a href="' + esc(rm.links.github) + '" target="_blank">GitHub</a>');
    if ($('rm-contacts')) $('rm-contacts').innerHTML = contactLinks.join(' &bull; ');

    var timelineBox = $('rm-timeline');
    if (timelineBox && rm.roadmap && rm.roadmap.length) {
      timelineBox.innerHTML = rm.roadmap.map(function (item) {
        var bullets = (item.highlights || []).map(function (h) {
          return '<li>' + esc(h) + '</li>';
        }).join('');
        var scaleBadge = item.scale ? '<span class="timeline-scale">⚡ ' + esc(item.scale) + '</span>' : '';

        return '<div class="timeline-item">' +
          '<div class="timeline-head">' +
            '<div>' +
              '<span class="timeline-role">' + esc(item.role) + '</span> ' +
              '<span class="timeline-company">@ ' + esc(item.company) + '</span>' +
            '</div>' +
            '<span class="timeline-duration">' + esc(item.duration) + '</span>' +
          '</div>' +
          scaleBadge +
          '<ul class="timeline-bullets">' + bullets + '</ul>' +
        '</div>';
      }).join('');
    }

    var eduBox = $('rm-education');
    if (eduBox && rm.education && rm.education.length) {
      eduBox.innerHTML = rm.education.map(function (ed) {
        return '<div class="education-card">' +
          '<div class="education-school">🎓 ' + esc(ed.school) + '</div>' +
          '<div class="education-degree">' + esc(ed.degree) + ' in ' + esc(ed.field) + '</div>' +
          '<div class="education-year">' + esc(ed.year) + (ed.details ? ' &bull; ' + esc(ed.details) : '') + '</div>' +
        '</div>';
      }).join('');
    }

    var skillsBox = $('rm-skills');
    if (skillsBox && rm.skills) {
      var categories = Object.keys(rm.skills);
      skillsBox.innerHTML = categories.map(function (cat) {
        var tags = (rm.skills[cat] || []).map(function (t) {
          return '<span class="skill-pill">' + esc(t) + '</span>';
        }).join('');
        if (!tags) return '';
        return '<div class="skill-row">' +
          '<span class="skill-category">' + esc(cat) + '</span>' +
          '<div class="skill-tags">' + tags + '</div>' +
        '</div>';
      }).join('');
    }

    rmBox.hidden = false;
  }

  async function runMatchDiagnostics(cvText, jobId) {
    var diagBox = $('diagnostics-display');
    if (!diagBox) return;

    try {
      var resp = await fetch('/api/data?action=match_role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv: cvText, jobId: jobId })
      });
      var data = await resp.json();

      if (data.ok) {
        currentPercentile = data.percentile || 'Top 10%';

        var badge = $('diag-rank-badge');
        badge.textContent = '🏆 ' + currentPercentile + ' Applicant';
        badge.className = 'rank-badge ' + (currentPercentile.includes('5%') ? 'top-5' : currentPercentile.includes('10%') ? 'top-10' : 'top-25');

        $('diag-score').textContent = (data.score || 85) + '%';
        $('diag-role-title').textContent = (data.job && data.job.title ? data.job.title : 'Selected Role') + ' Match Diagnostics';

        var passedUl = $('diag-passed-list');
        passedUl.innerHTML = (data.passedRequirements && data.passedRequirements.length)
          ? data.passedRequirements.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('')
          : '<li>Core software development background</li>';

        var missingUl = $('diag-missing-list');
        missingUl.innerHTML = (data.missingRequirements && data.missingRequirements.length)
          ? data.missingRequirements.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('')
          : '<li>No critical gaps detected!</li>';

        var recUl = $('diag-rec-list');
        recUl.innerHTML = (data.recommendations && data.recommendations.length)
          ? data.recommendations.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('')
          : '<li>Take the 5-minute AI interview below to verify unstated claims for recruiters.</li>';

        diagBox.hidden = false;
      }
    } catch (e) {
      console.warn('Diagnostics notice:', e);
    }
  }

  if ($('btn-parse-roadmap')) {
    $('btn-parse-roadmap').addEventListener('click', function () {
      var text = $('f-cv').value.trim();
      if (!text) {
        uploadError('Please paste your CV text first.');
        return;
      }
      buildRoadmapAndDiagnostics(text);
    });
  }

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

    setStep(2);
    $('review-section').scrollIntoView({ behavior: 'smooth' });

    buildRoadmapAndDiagnostics(text);
  }

  // Handle form submission
  $('apply-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    var name = $('f-name').value.trim();
    var phone = $('f-phone').value.trim();
    var email = $('f-email').value.trim();
    var location = $('f-location').value.trim();
    var linkedin = $('f-linkedin').value.trim();
    var github = $('f-github').value.trim();
    var cvText = $('f-cv').value.trim();
    var role = $('f-role').value.trim();
    var consent = $('f-consent').checked;

    $('submit-status').className = 'status';
    $('submit-status').textContent = '';
    if (!name) { submitError('Please enter your full name.', $('f-name')); return; }
    if (!cvText || cvText.length < 30) { submitError('Please add your CV text (at least 30 characters).', $('f-cv')); return; }

    var normPhone = { valid: false, e164: '' };
    if (phone) {
      normPhone = Engine.normalizePhone(phone);
      if (!normPhone.valid) {
        submitError('Check your phone number: ' + normPhone.error, $('f-phone'));
        return;
      }
    }

    var submitBtn = $('submit-btn');
    submitBtn.disabled = true;
    $('submit-status').textContent = 'Submitting application…';

    var candidateData = {
      name: name,
      role: role,
      phone: normPhone.e164 || phone,
      email: email,
      location: location,
      links: { linkedin: linkedin, github: github },
      cv: cvText,
      consent: consent,
      roadmapProfile: currentRoadmap,
      rankingPercentile: currentPercentile,
      targetJobId: currentJobId,
      createdAt: new Date().toISOString()
    };

    try {
      var resp = await fetch('/api/data?action=apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(candidateData)
      });
      var result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Failed to save application');

      currentAppId = result.id || ('app_' + Math.random().toString(36).slice(2, 10));
      showSuccess(currentAppId, candidateData);
    } catch (err) {
      console.warn('Backend storage unavailable, saving to local browser storage fallback:', err.message);
      currentAppId = 'local_' + Math.random().toString(36).slice(2, 12);
      candidateData.id = currentAppId;
      var saved = JSON.parse(localStorage.getItem('scout_candidates') || '[]');
      saved.push(candidateData);
      localStorage.setItem('scout_candidates', JSON.stringify(saved));
      showSuccess(currentAppId, candidateData);
    } finally {
      submitBtn.disabled = false;
      $('submit-status').textContent = '';
    }
  });

  function showSuccess(appId, candidateData) {
    if ($('apply-form')) $('apply-form').reset();
    if ($('review-section')) $('review-section').hidden = true;
    if ($('upload-section')) $('upload-section').hidden = true;
    if ($('success-section')) $('success-section').hidden = false;

    var candidateUrl = window.location.origin + '/interview?token=' + appId;
    $('cand-link').textContent = candidateUrl;
    setStep(3);

    $('copy-link-btn').onclick = function () {
      var btn = $('copy-link-btn');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(candidateUrl).then(function () {
          btn.lastChild.textContent = ' Copied';
          setTimeout(function () { btn.lastChild.textContent = ' Copy link'; }, 1800);
        }).catch(function () {});
      }
    };

    $('start-interview-btn').onclick = function () {
      window.location.href = '/interview?token=' + appId;
    };

    $('delete-app-btn').onclick = async function () {
      if (!confirm('Are you sure you want to delete your application and all related data?')) return;
      try {
        await fetch('/api/data?action=delete&id=' + appId, { method: 'POST' });
      } catch (e) {
        // Fallback for local storage
        var saved = JSON.parse(localStorage.getItem('scout_candidates') || '[]');
        saved = saved.filter(function (x) { return x.id !== appId; });
        localStorage.setItem('scout_candidates', JSON.stringify(saved));
      }
      alert('Your application and interview data have been permanently deleted.');
      window.location.href = '/apply';
    };

    $('success-section').scrollIntoView({ behavior: 'smooth' });
  }

  loadJobs();
})();
