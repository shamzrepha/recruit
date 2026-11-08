(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var token = new URLSearchParams(location.search).get('token') || '';
  var candidate = null, job = null;
  var transcript = [];   // only real questions and answers; sent to the AI
  var qIndex = 0, MAX = 3, finished = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function stateCard(title, body) {
    $('flow').hidden = true;
    $('state').innerHTML = '<div class="empty-state"><h2>' + esc(title) + '</h2><p>' + esc(body) + '</p><div class="row"><a class="btn" href="/">Back to home</a></div></div>';
  }

  async function init() {
    if (!token) { stateCard('This link is incomplete', 'Open the private link you were shown after applying.'); return; }
    try {
      var r = await ScoutData.call('candidateGet', { token: token });
      candidate = r.candidate; job = r.job;
    } catch (err) {
      stateCard('We could not find your application', 'It may have been deleted or expired after 30 days, or this link is for a different device. Apply again from the recruiter\u2019s link.');
      return;
    }
    $('i-company').textContent = job.company || 'Open role';
    $('i-title').textContent = job.title;
    $('i-sub').textContent = 'Hi ' + (candidate.name || 'there').split(/\s+/)[0] + '. Three short questions, about two minutes.';
    $('flow').hidden = false;
    if (candidate.interview && candidate.interview.summary) {
      $('notice').hidden = true; $('begin-row').hidden = true;
      $('summary-section').hidden = false;
      renderSummary(candidate.interview);
      $('sum-status').textContent = 'You have already done the chat. This is what the recruiter sees.';
    }
  }

  function addMsg(role, text) {
    var div = document.createElement('div');
    div.className = 'msg ' + (role === 'ai' ? 'ai' : 'me');
    div.innerHTML = '<span class="who">' + (role === 'ai' ? 'Scout' : 'You') + '</span>' + esc(text);
    $('chat-log').appendChild(div);
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
  }

  $('btn-begin').addEventListener('click', function () {
    $('notice').hidden = true; $('begin-row').hidden = true; $('chat-card').hidden = false;
    askNext();
  });

  function reqs() { return (job.requirements || []).map(function (r) { return { text: r.text, weight: r.weight }; }); }

  async function post(action, body) {
    var resp = await fetch('/api/interview?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function askNext() {
    if (qIndex >= MAX) { finish(); return; }
    $('progress').textContent = 'Question ' + (qIndex + 1) + ' of ' + MAX;
    $('typing').hidden = false; $('btn-send').disabled = true; $('btn-skip').disabled = true;
    var q;
    try {
      var data = await post('next_question', { role: job.title, requirements: reqs(), cv: candidate.cv, transcript: transcript, questionIndex: qIndex });
      q = data.question;
    } catch (err) { q = null; }
    q = q || 'Tell me a little about your most recent job and what a normal week looked like.';
    $('typing').hidden = true; $('btn-send').disabled = false; $('btn-skip').disabled = false;
    addMsg('ai', q);
    transcript.push({ role: 'ai', text: q });
    $('answer').focus();
  }

  function advance() { qIndex++; if (qIndex >= MAX) finish(); else askNext(); }

  $('chat-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var a = $('answer').value.trim();
    if (!a) return;
    addMsg('candidate', a);
    transcript.push({ role: 'candidate', text: a });
    $('answer').value = '';
    advance();
  });
  $('btn-skip').addEventListener('click', function () {
    addMsg('candidate', 'Skipped');
    transcript.push({ role: 'candidate', text: '(skipped)' });
    advance();
  });
  $('btn-stop').addEventListener('click', function () {
    if (confirm('Stop now? A summary is written from your answers so far.')) finish();
  });

  async function finish() {
    if (finished) return;
    finished = true;
    $('chat-card').hidden = true;
    $('summary-section').hidden = false;
    var answered = transcript.filter(function (t) { return t.role === 'candidate' && t.text !== '(skipped)'; });
    var data;
    if (!answered.length) {
      data = { summary: 'The candidate did not answer any questions in the short chat.', confirmedReqs: [], openReqs: [], followUpQuestions: [], confidence: 'low' };
    } else {
      try { data = await post('summarize', { role: job.title, requirements: reqs(), cv: candidate.cv, transcript: transcript }); }
      catch (err) {
        data = { summary: 'The candidate answered ' + answered.length + ' question(s), but the summary could not be written. The recruiter can ask the same questions directly.', confirmedReqs: [], openReqs: [], followUpQuestions: [], confidence: 'low' };
      }
    }
    try {
      await ScoutData.call('interviewSave', {
        token: token, summary: data.summary, confidence: data.confidence, confirmedReqs: data.confirmedReqs,
        openReqs: data.openReqs, followUpQuestions: data.followUpQuestions, transcript: transcript
      });
      $('sum-status').textContent = 'This is what the recruiter will see.';
    } catch (err) {
      $('sum-status').textContent = 'The summary could not be saved: ' + err.message;
    }
    renderSummary(data);
  }

  function li(arr, empty) {
    return (arr && arr.length) ? arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') : '<li class="muted">' + empty + '</li>';
  }
  function renderSummary(d) {
    $('summary-box').hidden = false;
    $('summary-body').textContent = d.summary || '';
    var c = (d.confidence || 'medium').toLowerCase();
    var chip = $('conf-chip');
    chip.textContent = 'Confidence: ' + c;
    chip.className = 'chip ' + (c === 'high' ? 'ok' : c === 'low' ? 'bad' : 'warn');
    $('confirmed').innerHTML = li(d.confirmedReqs, 'Nothing confirmed yet.');
    $('open').innerHTML = li(d.openReqs, 'Nothing flagged.');
    $('followups').innerHTML = li(d.followUpQuestions, 'None suggested.');
  }

  $('btn-delete-interview').addEventListener('click', async function () {
    if (!confirm('Delete your application, chat and summary? This cannot be undone.')) return;
    try { await ScoutData.call('candidateDelete', { token: token }); } catch (e) { /* already gone */ }
    stateCard('Deleted', 'Your application and chat have been removed.');
  });

  init();
})();
