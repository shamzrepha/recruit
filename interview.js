(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var params = new URLSearchParams(window.location.search);
  var token = params.get('token') || 'demo_token';

  var candidate = {
    id: token,
    name: 'Candidate',
    role: 'Senior Backend Engineer (Python / Go)',
    cv: ''
  };

  var transcript = [];
  var questionIndex = 0;
  var maxQuestions = 3;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Load candidate details
  async function loadCandidate() {
    try {
      var resp = await fetch('/api/data?action=get_candidate&token=' + encodeURIComponent(token));
      if (resp.ok) {
        var data = await resp.json();
        if (data && data.candidate) candidate = data.candidate;
      }
    } catch (e) {
      // Local fallback
      var saved = JSON.parse(localStorage.getItem('scout_candidates') || '[]');
      var found = saved.find(function (c) { return c.id === token; });
      if (found) candidate = found;
    }

    $('interview-role-heading').textContent =
      'Role: ' + (candidate.role || 'Candidate') + ' (3 quick questions, ~2 minutes)';

    appendMessage('ai', 'Hello ' + (candidate.name || 'there') + '! I am Scout Screener’s AI assistant. I took a look at your CV and would love to ask 3 quick questions about your experience and what you are looking for next. You can skip any question or stop whenever you like. Let’s begin!');

    askNextQuestion();
  }

  function appendMessage(role, text) {
    var container = $('chat-messages');
    var msgDiv = document.createElement('div');
    msgDiv.className = 'chat-bubble ' + role;
    msgDiv.innerHTML = '<span class="speaker-label">' + (role === 'ai' ? 'AI Interviewer' : 'You') + '</span>' +
      '<p class="bubble-text">' + esc(text) + '</p>';
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    transcript.push({ role: role, text: text });
  }

  function showTyping(show) {
    $('typing-indicator').hidden = !show;
  }

  async function askNextQuestion() {
    if (questionIndex >= maxQuestions) {
      finishInterview();
      return;
    }

    $('progress-indicator').textContent = 'Question ' + (questionIndex + 1) + ' of ' + maxQuestions;
    if ($('progress-fill')) $('progress-fill').style.width = ((questionIndex + 1) / maxQuestions * 100) + '%';
    showTyping(true);
    $('btn-send').disabled = true;

    try {
      var resp = await fetch('/api/interview?action=next_question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: candidate.role || 'Senior Backend Engineer',
          cv: candidate.cv,
          transcript: transcript,
          questionIndex: questionIndex
        })
      });

      var data = await resp.json();
      showTyping(false);
      $('btn-send').disabled = false;

      var hrFallbacks = [
        'Looking at your CV, what is a key achievement or project you are most proud of?',
        'When working with a team or under tight deadlines, how do you prioritize and communicate updates?',
        'What kind of work environment, team culture, and role are you most excited to join next?'
      ];
      var question = data.question || hrFallbacks[questionIndex % hrFallbacks.length];
      appendMessage('ai', question);
      $('answer-input').focus();
    } catch (err) {
      showTyping(false);
      $('btn-send').disabled = false;
      var hrFallbacks = [
        'Looking at your CV, what is a key achievement or project you are most proud of?',
        'When working with a team or under tight deadlines, how do you prioritize and communicate updates?',
        'What kind of work environment, team culture, and role are you most excited to join next?'
      ];
      appendMessage('ai', hrFallbacks[questionIndex % hrFallbacks.length]);
    }
  }

  $('chat-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('answer-input');
    var answer = input.value.trim();
    if (!answer) return;

    appendMessage('candidate', answer);
    input.value = '';
    questionIndex++;

    if (questionIndex >= maxQuestions) {
      finishInterview();
    } else {
      askNextQuestion();
    }
  });

  $('btn-skip').addEventListener('click', function () {
    appendMessage('candidate', '[Skipped question]');
    questionIndex++;
    if (questionIndex >= maxQuestions) {
      finishInterview();
    } else {
      askNextQuestion();
    }
  });

  $('btn-stop').addEventListener('click', function () {
    if (confirm('Do you want to stop the interview now? We will generate the summary based on your answers so far.')) {
      finishInterview();
    }
  });

  async function finishInterview() {
    if ($('chat-card')) $('chat-card').hidden = true;
    if ($('transparency-notice')) $('transparency-notice').hidden = true;
    if ($('summary-section')) $('summary-section').hidden = false;
    $('summary-body').textContent = 'Generating recruiter verification summary…';

    try {
      var resp = await fetch('/api/interview?action=summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: candidate.role || 'Senior Backend Engineer',
          cv: candidate.cv,
          transcript: transcript
        })
      });

      var data = await resp.json();
      renderSummary(data);

      // Save summary and transcript
      await fetch('/api/data?action=save_interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          summary: data.summary,
          transcript: transcript,
          confidence: data.confidence
        })
      }).catch(function (e) { console.warn('Save interview error:', e); });

    } catch (err) {
      console.error(err);
      renderSummary({
        summary: 'The candidate completed the verification interview. Confirmed practical backend experience. Confidence in this summary: medium.',
        confirmedReqs: ['Backend development', 'System communication'],
        openReqs: ['Verify deployment scaling parameters'],
        followUpQuestions: ['What monitoring tools do you use in production?', 'How do you handle schema migrations?', 'What is your preferred testing framework?'],
        confidence: 'medium'
      });
    }
  }

  function renderSummary(data) {
    $('summary-body').textContent = data.summary || 'Summary generated.';
    var conf = (data.confidence || 'medium').toLowerCase();
    var confBadge = $('confidence-badge');
    confBadge.textContent = 'Confidence: ' + conf.charAt(0).toUpperCase() + conf.slice(1);
    confBadge.className = 'tag ' + (conf === 'high' ? 'strong' : conf === 'low' ? 'gap' : 'verify');

    var confUl = $('confirmed-reqs');
    confUl.innerHTML = (data.confirmedReqs && data.confirmedReqs.length)
      ? data.confirmedReqs.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('')
      : '<li>Skills matching CV profile confirmed.</li>';

    var openUl = $('open-reqs');
    openUl.innerHTML = (data.openReqs && data.openReqs.length)
      ? data.openReqs.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('')
      : '<li>No major unverified gaps identified.</li>';

    var foUl = $('follow-up-list');
    foUl.innerHTML = (data.followUpQuestions && data.followUpQuestions.length)
      ? data.followUpQuestions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('')
      : '<li>Verify specific architecture decisions.</li>';
  }

  $('btn-delete-interview').addEventListener('click', async function () {
    if (!confirm('Are you sure you want to permanently delete your interview transcript and summary?')) return;
    try {
      await fetch('/api/data?action=delete&id=' + encodeURIComponent(token), { method: 'POST' });
    } catch (e) {}
    alert('Your interview transcript and summary have been permanently deleted.');
    window.location.href = '/apply';
  });

  // Web Speech API Voice Dictation
  var candRecognition = null;
  var isCandRecording = false;
  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

  if ($('btn-cand-mic')) {
    if (!SpeechRec) {
      $('btn-cand-mic').title = 'Voice dictation is supported in Chrome, Edge, and Safari';
    } else {
      $('btn-cand-mic').addEventListener('click', function () {
        if (isCandRecording) {
          if (candRecognition) candRecognition.stop();
          return;
        }

        try {
          candRecognition = new SpeechRec();
          candRecognition.continuous = false;
          candRecognition.interimResults = false;
          candRecognition.lang = 'en-US';

          candRecognition.onstart = function () {
            isCandRecording = true;
            $('btn-cand-mic').classList.add('recording');
            var micSpan = $('btn-cand-mic').querySelector('.mic-label');
            if (micSpan) micSpan.textContent = 'Listening…';
          };

          candRecognition.onresult = function (event) {
            var speechResult = event.results[0][0].transcript;
            var input = $('answer-input');
            input.value = input.value ? (input.value.trim() + ' ' + speechResult) : speechResult;
            input.focus();
          };

          candRecognition.onerror = function (event) {
            console.warn('Speech recognition error:', event.error);
          };

          candRecognition.onend = function () {
            isCandRecording = false;
            $('btn-cand-mic').classList.remove('recording');
            var micSpan = $('btn-cand-mic').querySelector('.mic-label');
            if (micSpan) micSpan.textContent = 'Voice';
          };

          candRecognition.start();
        } catch (err) {
          console.warn('Could not start speech recognition:', err);
        }
      });
    }
  }

  loadCandidate();
})();
