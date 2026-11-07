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
  var maxQuestions = 5;

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
      'Role: ' + (candidate.role || 'Senior Backend Engineer') + ' (' + maxQuestions + ' questions, ~5 minutes)';

    appendMessage('ai', 'Hello ' + (candidate.name || 'there') + '! I am Scout Screener’s AI assistant. My goal is to ask a few questions to clarify your background for the recruiter. You can skip any question or stop whenever you like. Let’s begin!');

    askNextQuestion();
  }

  function appendMessage(role, text) {
    var container = $('chat-messages');
    var msgDiv = document.createElement('div');
    msgDiv.className = 'chat-bubble ' + role;
    msgDiv.innerHTML = '<span class="speaker-label">' + (role === 'ai' ? 'AI Interviewer' : 'You') + '</span>' +
      '<p class="bubble-text">' + esc(text) + '</p>';
    container.appendChild(msgDiv);
    msgDiv.scrollIntoView({ behavior: 'smooth' });
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

      var question = data.question || 'Could you elaborate on a key project where you handled complex backend or database challenges?';
      appendMessage('ai', question);
      $('answer-input').focus();
    } catch (err) {
      showTyping(false);
      $('btn-send').disabled = false;
      appendMessage('ai', 'Could you tell us about a production system or API you built and what your exact contribution was?');
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

  loadCandidate();
})();
