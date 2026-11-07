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
    $('vision-fallback-box').hidden = true;

    var type = file.type;
    var name = file.name || '';

    if (type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
      await extractFromPdf(file);
    } else if (type.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(name)) {
      await extractFromImage(file);
    } else {
      alert('Please upload a PDF document or an image file (PNG, JPG, WEBP).');
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
        alert('Could not find a text layer in this PDF. If it is a scanned document, please take a photo or screenshot instead.');
        return;
      }
      populateExtractedData(fullText);
    } catch (err) {
      hideOcrStatus();
      console.error(err);
      alert('Failed to read PDF: ' + (err.message || 'Unknown error'));
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
      alert('Browser OCR encountered an error. You can paste your text below or use Groq Vision.');
      $('vision-fallback-box').hidden = false;
    }
  }

  // Vision fallback (explicit consent required)
  $('btn-use-vision').addEventListener('click', async function () {
    if (!currentImageBase64) {
      alert('Please upload an image first.');
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
      alert('Groq Vision error: ' + err.message);
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

    $('review-section').scrollIntoView({ behavior: 'smooth' });
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

    if (!name) { alert('Please enter your full name.'); return; }
    if (!cvText || cvText.length < 30) { alert('Please enter or extract your CV text (at least 30 characters).'); return; }

    var normPhone = { valid: false, e164: '' };
    if (phone) {
      normPhone = Engine.normalizePhone(phone);
      if (!normPhone.valid) {
        alert('Please correct the phone number error: ' + normPhone.error);
        $('f-phone').focus();
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

})();
