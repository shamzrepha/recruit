(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var seq = 0;
  var uid = function (p) { return p + (++seq); };

  var STATE_LABEL = { met: 'Stated', not_stated: 'Not stated', not_met: 'Contradicted' };
  var DECISION_LABEL = { shortlist: 'Shortlisted', ask: 'Ask first', pass: 'Passed' };

  var state = {
    reqs: [],
    cands: [{ id: uid('c'), name: '', cv: '', phone: '', email: '', consent: false }],
    out: null,
    decisions: {},
    ai: true,
    revealedContacts: {},
    chatMessages: [],
    activeFilter: 'all'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function say(msg, isError) {
    var el = $('status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (isError ? ' error' : '');
  }

  /* =========================================================================
     TAB NAVIGATION
     ========================================================================= */
  var tabIntakeBtn = $('tab-intake-btn');
  var tabScreenBtn = $('tab-screen-btn');
  var tabJobsBtn = $('tab-jobs-btn');
  var sectionIntake = $('section-intake');
  var sectionScreen = $('section-screen');
  var sectionJobs = $('section-jobs');

  function switchTab(target) {
    var tabs = [
      { id: 'intake', btn: tabIntakeBtn, panel: sectionIntake },
      { id: 'screen', btn: tabScreenBtn, panel: sectionScreen },
      { id: 'jobs', btn: tabJobsBtn, panel: sectionJobs }
    ];

    tabs.forEach(function (t) {
      if (!t.btn || !t.panel) return;
      var isActive = t.id === target;
      t.btn.classList.toggle('active', isActive);
      t.btn.setAttribute('aria-selected', String(isActive));
      t.panel.hidden = !isActive;
    });

    if (target === 'jobs') {
      loadRecruiterJobs();
    }
  }

  if (tabIntakeBtn) tabIntakeBtn.addEventListener('click', function () { switchTab('intake'); });
  if (tabScreenBtn) tabScreenBtn.addEventListener('click', function () { switchTab('screen'); });
  if (tabJobsBtn) tabJobsBtn.addEventListener('click', function () { switchTab('jobs'); });

  /* =========================================================================
     TAB 1: RECRUITER AI INTAKE CHAT
     ========================================================================= */
  var chatMessagesEl = $('recruiter-chat-messages');
  var chatForm = $('recruiter-chat-form');
  var chatInput = $('rec-chat-input');
  var typingIndicator = $('recruiter-typing');

  function appendChatMessage(role, text) {
    var div = document.createElement('div');
    div.className = 'chat-bubble ' + (role === 'ai' ? 'ai' : 'candidate');
    div.innerHTML = '<span class="speaker-label">' + (role === 'ai' ? 'AI Sourcing Partner' : 'You') + '</span>' +
      '<p class="bubble-text">' + esc(text) + '</p>';
    chatMessagesEl.appendChild(div);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    state.chatMessages.push({ role: role, text: text });
  }

  function initRecruiterChat() {
    appendChatMessage('ai', "Hello! I am your AI Sourcing Partner at Sourcing Sprints. Tell me about your startup: What are you building, what stage are you at, and what key role do you need to hire?");
  }

  chatForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var text = chatInput.value.trim();
    if (!text) return;

    appendChatMessage('recruiter', text);
    chatInput.value = '';
    typingIndicator.hidden = false;
    $('rec-send-btn').disabled = true;

    try {
      var resp = await fetch('/api/role-intake?action=chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: state.chatMessages })
      });
      var data = await resp.json();
      typingIndicator.hidden = true;
      $('rec-send-btn').disabled = false;

      if (data && data.reply) {
        appendChatMessage('ai', data.reply);
      }
      if (data && data.suggestedRole && $('rec-role')) {
        $('rec-role').value = data.suggestedRole;
      }
      if (data && data.action === 'show_candidates') {
        renderChatCandidateCards();
      }
    } catch (err) {
      typingIndicator.hidden = true;
      $('rec-send-btn').disabled = false;
      appendChatMessage('ai', "Understood. What are the key non-negotiable requirements for this role versus nice-to-haves?");
    }
  });

  // Candidate Card Rendering within Chat
  async function renderChatCandidateCards() {
    var validCands = state.cands.filter(function (c) { return c.cv && c.cv.length >= 20; });
    if (!validCands.length) {
      await loadApplicantsAutomatically(true);
      validCands = state.cands.filter(function (c) { return c.cv && c.cv.length >= 20; });
    }

    var div = document.createElement('div');
    div.className = 'chat-bubble ai chat-candidate-deck';

    if (!validCands.length) {
      div.innerHTML = '<span class="speaker-label">AI Sourcing Partner — Candidate Pool</span>' +
        '<p class="bubble-text">No candidate applications found in your pool yet.</p>' +
        '<p style="font-size:0.85rem;margin-top:6px;color:var(--muted)">Candidates can submit their CVs at <a href="/apply" target="_blank" style="color:var(--primary);font-weight:700">/apply</a>. You can also load sample candidates in the Screening tab!</p>';
      chatMessagesEl.appendChild(div);
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      return;
    }

    var cardsHtml = validCands.slice(0, 30).map(function (c, idx) {
      var rm = c.roadmapProfile || {};
      var headline = rm.headline || c.role || 'Applicant';
      var percentile = c.rankingPercentile || (rm.suggestedRoles && rm.suggestedRoles[0] && rm.suggestedRoles[0].percentile) || 'Top 10%';
      var school = (rm.education && rm.education[0] && rm.education[0].school) ? rm.education[0].school : '';

      var skills = [];
      if (rm.skills) {
        Object.keys(rm.skills).forEach(function (cat) {
          skills = skills.concat(rm.skills[cat] || []);
        });
      }
      var skillTags = skills.slice(0, 4).map(function (s) {
        return '<span class="chat-skill-pill">' + esc(s) + '</span>';
      }).join('');

      var pClass = 'pill-top-5';
      if (/10%/.test(percentile)) pClass = 'pill-top-10';
      else if (/25%/.test(percentile)) pClass = 'pill-top-25';

      return '<div class="chat-cand-card">' +
        '<div class="chat-cand-top">' +
          '<div class="chat-cand-avatar">' + initials(c.name || 'Candidate') + '</div>' +
          '<div class="chat-cand-info">' +
            '<div class="chat-cand-name-row">' +
              '<span class="chat-cand-name">' + esc(c.name || 'Applicant ' + (idx + 1)) + '</span>' +
              '<span class="chat-ranking-badge ' + pClass + '">' + esc(percentile) + '</span>' +
            '</div>' +
            '<div class="chat-cand-headline">' + esc(headline) + '</div>' +
            (school ? '<div class="chat-cand-school">🎓 ' + esc(school) + '</div>' : '') +
          '</div>' +
        '</div>' +
        (skillTags ? '<div class="chat-cand-skills">' + skillTags + '</div>' : '') +
        '<div class="chat-cand-actions">' +
          '<button type="button" class="chat-btn-action view-rm" data-act="chat-view-roadmap" data-id="' + esc(c.id) + '">' +
            '🔍 View Full CV & Roadmap' +
          '</button>' +
          '<button type="button" class="chat-btn-action screen-it" data-act="chat-screen-cand" data-id="' + esc(c.id) + '">' +
            '⚡ Screen in Dashboard' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    div.innerHTML = '<span class="speaker-label">AI Sourcing Partner — Candidate Pool</span>' +
      '<div class="chat-deck-header">' +
        '<strong>Found ' + validCands.length + ' Candidate(s) in Pool</strong>' +
        '<span style="font-size:0.8rem;color:var(--muted)">Review work badges, skills & full CVs</span>' +
      '</div>' +
      '<div class="chat-cands-grid">' + cardsHtml + '</div>';

    chatMessagesEl.appendChild(div);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  // Delegated click on chat messages for candidate actions
  chatMessagesEl.addEventListener('click', function (e) {
    var rmBtn = e.target.closest('button[data-act="chat-view-roadmap"]');
    if (rmBtn) {
      openRoadmapModal(rmBtn.dataset.id);
      return;
    }
    var screenBtn = e.target.closest('button[data-act="chat-screen-cand"]');
    if (screenBtn) {
      switchTab('screen');
      say('Switched to Screening Dashboard. Review requirements and click "Screen candidates".');
      return;
    }
  });

  // Example brief button
  $('btn-quick-sample-chat').addEventListener('click', function () {
    appendChatMessage('recruiter', "We are a seed-stage fintech startup in Lagos building cross-border B2B payments. We need a Founding Backend Engineer with 3+ years in Python or Go, deep PostgreSQL knowledge, who has shipped high-volume APIs to real customers.");
    appendChatMessage('ai', "Terrific! A founding role in a seed-stage payments startup requires both high technical rigor and execution ownership. I'll structure this into must-have technical criteria (Python/Go, PostgreSQL, high-traffic APIs) and nice-to-haves (early-stage startup experience, AWS/GCP). Click 'Generate Role & Screening Requirements' to load this into your screening dashboard.");
  });

  // Generate Role Profile & Requirements
  $('btn-generate-role').addEventListener('click', async function () {
    var btn = $('btn-generate-role');
    btn.disabled = true;
    btn.textContent = 'Writing your requirements…';

    try {
      var resp = await fetch('/api/role-intake?action=generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: state.chatMessages })
      });
      var data = await resp.json();

      if (data.title && $('rec-role')) $('rec-role').value = data.title;
      if (data.jd && $('jd')) $('jd').value = data.jd;

      if (Array.isArray(data.requirements) && data.requirements.length) {
        state.reqs = data.requirements.map(function (r) {
          return { id: uid('r'), text: r.text, weight: r.weight || 'must' };
        });
      } else if (data.jd) {
        state.reqs = Engine.extractRequirements(data.jd).map(function (r) {
          return { id: uid('r'), text: r.text, weight: r.weight };
        });
      }

      renderReqs();
      switchTab('screen');
      say('Role and ' + state.reqs.length + ' requirements created from your chat. Check them, then add candidates.');
    } catch (err) {
      console.error(err);
      // Fallback to sample role
      $('jd').value = Samples.JOB;
      state.reqs = Engine.extractRequirements(Samples.JOB).map(function (r) {
        return { id: uid('r'), text: r.text, weight: r.weight };
      });
      renderReqs();
      switchTab('screen');
      say('Could not reach the AI, so a sample role was loaded. Edit the requirements before screening.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate role and requirements →';
    }
  });

  /* =========================================================================
     TAB 2: SCREENING DASHBOARD & OUTREACH
     ========================================================================= */

  function renderReqs() {
    var ul = $('reqs');
    if (!ul) return;
    if ($('req-count')) $('req-count').textContent = state.reqs.length;
    if (!state.reqs.length) {
      ul.innerHTML = '<li class="empty">No requirements yet. Paste a job description and press &ldquo;Pull out requirements&rdquo;, or brief the AI in step 1.</li>';
      return;
    }
    ul.innerHTML = state.reqs.map(function (r) {
      return '<li data-id="' + r.id + '">' +
        '<input type="text" maxlength="140" value="' + esc(r.text) + '" aria-label="Requirement">' +
        '<button type="button" class="weight ' + (r.weight === 'nice' ? 'nice' : 'must') + '" data-act="weight" ' +
          'aria-label="Importance: ' + (r.weight === 'nice' ? 'nice to have' : 'must have') + '. Press to change.">' +
          (r.weight === 'nice' ? 'Nice to have' : 'Must have') + '</button>' +
        '<button type="button" class="icon-btn" data-act="del" aria-label="Remove requirement">&times;</button>' +
        '</li>';
    }).join('');
  }

  $('reqs').addEventListener('input', function (e) {
    var li = e.target.closest('li[data-id]');
    if (!li) return;
    var r = state.reqs.filter(function (x) { return x.id === li.dataset.id; })[0];
    if (r) r.text = e.target.value;
  });

  $('reqs').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    var li = e.target.closest('li[data-id]');
    if (!btn || !li) return;
    var id = li.dataset.id;
    if (btn.dataset.act === 'del') {
      state.reqs = state.reqs.filter(function (x) { return x.id !== id; });
    } else {
      state.reqs.forEach(function (x) { if (x.id === id) x.weight = x.weight === 'nice' ? 'must' : 'nice'; });
    }
    renderReqs();
  });

  function addReq() {
    var inp = $('newreq');
    var text = inp.value.trim();
    if (!text) { inp.focus(); return; }
    state.reqs.push({ id: uid('r'), text: text, weight: 'must' });
    inp.value = '';
    renderReqs();
    inp.focus();
  }
  $('addreq').addEventListener('click', addReq);
  $('newreq').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addReq(); } });

  $('extract').addEventListener('click', function () {
    var found = Engine.extractRequirements($('jd').value);
    if (!found.length) {
      say('No requirements found. Use bullet points in the job description, or add them by hand.', true);
      return;
    }
    state.reqs = found.map(function (r) { return { id: uid('r'), text: r.text, weight: r.weight }; });
    renderReqs();
    say('Found ' + found.length + ' requirements. Edit them before screening.');
  });

  function renderCands() {
    if ($('cand-count')) $('cand-count').textContent = state.cands.length;
    $('cands').innerHTML = state.cands.map(function (c, i) {
      var chip = (c.phone || c.email)
        ? (c.consent ? '<span class="chip ok">Contact shared</span>' : '<span class="chip">Contact private</span>')
        : '';
      return '<div class="cand" data-id="' + c.id + '">' +
        '<div class="cand-head">' +
          '<span class="avatar" aria-hidden="true">' + esc(initials(c.name)) + '</span>' +
          '<input type="text" maxlength="80" value="' + esc(c.name) + '" placeholder="Name (optional)" aria-label="Candidate ' + (i + 1) + ' name">' +
          chip +
          '<button type="button" class="icon-btn" data-act="delcand" aria-label="Remove candidate ' + (i + 1) + '">&times;</button>' +
        '</div>' +
        '<label class="visually-hidden" for="cv-' + c.id + '">CV text for candidate ' + (i + 1) + '</label>' +
        '<textarea id="cv-' + c.id + '" rows="5" maxlength="12000" placeholder="Paste the CV text here">' + esc(c.cv) + '</textarea>' +
        '</div>';
    }).join('');
  }

  $('cands').addEventListener('input', function (e) {
    var box = e.target.closest('.cand');
    if (!box) return;
    var c = state.cands.filter(function (x) { return x.id === box.dataset.id; })[0];
    if (!c) return;
    if (e.target.tagName === 'TEXTAREA') c.cv = e.target.value; else c.name = e.target.value;
  });

  $('cands').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act="delcand"]');
    if (!btn) return;
    var id = btn.closest('.cand').dataset.id;
    state.cands = state.cands.filter(function (x) { return x.id !== id; });
    if (!state.cands.length) state.cands.push({ id: uid('c'), name: '', cv: '' });
    renderCands();
  });

  $('addcand').addEventListener('click', function () {
    if (state.cands.length >= 15) { say('The limit is 15 candidates per screen.', true); return; }
    state.cands.push({ id: uid('c'), name: '', cv: '' });
    renderCands();
  });

  $('sample').addEventListener('click', function () {
    $('jd').value = Samples.JOB;
    $('rec-role').value = 'Founding Backend Engineer';
    state.reqs = Engine.extractRequirements(Samples.JOB).map(function (r) { return { id: uid('r'), text: r.text, weight: r.weight }; });
    state.cands = Samples.CANDIDATES.map(function (c) {
      return {
        id: uid('c'),
        name: c.name,
        cv: c.cv,
        phone: c.phone || '',
        email: c.email || '',
        consent: Boolean(c.consent),
        roadmapProfile: c.roadmapProfile || null,
        rankingPercentile: c.rankingPercentile || null,
        interviewSummary: c.interviewSummary || null,
        interviewConfidence: c.interviewConfidence || null,
        interviewTranscript: c.interviewTranscript || null
      };
    });
    renderReqs();
    renderCands();
    say('Sample role and made-up candidates loaded. Press Screen candidates.');
  });

  async function loadApplicantsAutomatically(silent) {
    if (!silent) say('Loading applicants from portal…');
    try {
      var resp = await fetch('/api/data?action=list_candidates');
      var list = [];
      if (resp.ok) {
        var data = await resp.json();
        list = data.candidates || [];
      } else {
        list = JSON.parse(localStorage.getItem('scout_candidates') || '[]');
      }
      if (!list || !list.length) {
        if (!silent) say('No candidate applications found yet. Candidates can apply at /apply.', true);
        return false;
      }
      state.cands = list.map(function (c) {
        return {
          id: c.id || uid('c'),
          name: c.name,
          cv: c.cv,
          phone: c.phone || '',
          email: c.email || '',
          consent: Boolean(c.consent),
          roadmapProfile: c.roadmapProfile || null,
          rankingPercentile: c.rankingPercentile || null,
          interviewSummary: c.interviewSummary || null,
          interviewConfidence: c.interviewConfidence || null,
          interviewTranscript: c.interviewTranscript || null
        };
      });
      renderCands();
      if (!silent) say('Loaded ' + list.length + ' candidate(s) from portal.');
      return true;
    } catch (err) {
      if (!silent) say('Could not load applicants: ' + err.message, true);
      return false;
    }
  }

  $('load-applicants').addEventListener('click', function () {
    loadApplicantsAutomatically(false);
  });

  /* ---------- Run Screening ---------- */
  $('run').addEventListener('click', run);

  async function run() {
    var reqs = state.reqs
      .map(function (r) { return { id: r.id, text: r.text.trim(), weight: r.weight }; })
      .filter(function (r) { return r.text; });
    var cands = state.cands
      .map(function (c, i) {
        return {
          id: c.id,
          name: c.name.trim() || Engine.guessName(c.cv, i),
          cv: c.cv.trim(),
          phone: c.phone || '',
          email: c.email || '',
          consent: Boolean(c.consent),
          roadmapProfile: c.roadmapProfile || null,
          rankingPercentile: c.rankingPercentile || null,
          interviewSummary: c.interviewSummary || null,
          interviewConfidence: c.interviewConfidence || null,
          interviewTranscript: c.interviewTranscript || null
        };
      })
      .filter(function (c) { return c.cv.length >= 20; });

    if (!reqs.length) { say('Add or extract at least one requirement first.', true); return; }
    if (!cands.length) { say('Add at least one candidate with CV text.', true); return; }

    var btn = $('run');
    btn.disabled = true;
    say('Screening ' + cands.length + ' candidate(s)… this can take up to a minute.');

    var list = null, usedAi = false, failMsg = '';
    try {
      var resp = await fetch('/api/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirements: reqs, candidates: cands })
      });
      var data = await resp.json().catch(function () { return {}; });
      if (resp.ok && data.results) {
        list = data.results;
        usedAi = true;
      } else {
        throw new Error(data.error || 'Server error ' + resp.status);
      }
    } catch (err) {
      failMsg = err.message;
    }

    if (!list) list = Engine.demoScreen(reqs, cands);

    var candMap = {};
    cands.forEach(function (c) { candMap[c.id] = c; });
    list.forEach(function (res) {
      var orig = candMap[res.id] || {};
      res.phone = orig.phone || '';
      res.email = orig.email || '';
      res.consent = Boolean(orig.consent);
      res.roadmapProfile = orig.roadmapProfile || null;
      res.rankingPercentile = orig.rankingPercentile || null;
      res.interviewSummary = orig.interviewSummary || null;
      res.interviewConfidence = orig.interviewConfidence || null;
      res.interviewTranscript = orig.interviewTranscript || null;
    });

    state.out = { list: list, reqs: reqs, usedAi: usedAi, failMsg: failMsg };
    state.decisions = {};
    btn.disabled = false;
    say('Done. ' + list.length + ' candidate(s) ranked below.');
    renderResults();
  }

  function barHtml(reqs, checks, label) {
    var byId = {};
    checks.forEach(function (k) { byId[k.reqId] = k; });
    var segs = reqs.map(function (r) {
      var k = byId[r.id] || { status: 'not_stated' };
      return '<span class="seg s-' + k.status + '" style="flex:' + Engine.weightOf(r) + '" title="' +
        esc(r.text + ': ' + STATE_LABEL[k.status]) + '"></span>';
    }).join('');
    return '<div class="bar" role="img" aria-label="' + esc(label) + '">' + segs + '</div>';
  }

  function renderResults(quiet) {
    var out = state.out;
    var reqs = out.reqs;

    var rows = out.list.map(function (r) {
      var sc = Engine.score(reqs, r.checks);
      return { r: r, sc: sc, sug: Engine.suggestion(sc) };
    }).sort(function (a, b) {
      return b.sc.now - a.sc.now || b.sc.potential - a.sc.potential || a.r.name.localeCompare(b.r.name);
    });

    var fb = $('fallback');
    if (out.failMsg) {
      fb.hidden = false;
      fb.textContent = 'The AI could not be used this time (' + String(out.failMsg).replace(/[.\s]+$/, '') + '), so these are keyword-match results. Quotes come straight from the CV, but treat the ranking as a rougher first pass.';
    } else {
      fb.hidden = true;
    }

    // Update filter counts
    if ($('count-all')) $('count-all').textContent = rows.length;
    if ($('count-strong')) $('count-strong').textContent = rows.filter(function (x) { return x.sug.code === 'strong'; }).length;
    if ($('count-look')) $('count-look').textContent = rows.filter(function (x) { return x.sug.code === 'look'; }).length;
    if ($('count-skip')) $('count-skip').textContent = rows.filter(function (x) { return x.sug.code === 'skip'; }).length;

    var filteredRows = state.activeFilter === 'all'
      ? rows
      : rows.filter(function (x) { return x.sug.code === state.activeFilter; });

    if (!filteredRows.length) {
      $('ranking').innerHTML = '<li class="cand-empty" style="padding:28px;text-align:center;color:var(--muted)">No candidates match the selected &ldquo;' + esc(state.activeFilter) + '&rdquo; filter.</li>';
    } else {
      $('ranking').innerHTML = filteredRows.map(function (row, i) {
        var r = row.r, sc = row.sc, sug = row.sug;
        var byId = {};
        r.checks.forEach(function (k) { byId[k.reqId] = k; });

        var mustReqs = reqs.filter(function (q) { return q.weight === 'must'; });
        var niceReqs = reqs.filter(function (q) { return q.weight === 'nice'; });
        var mustMet = r.checks.filter(function (k) {
          var mq = byId[k.reqId];
          return mq && mq.weight === 'must' && k.status === 'met';
        }).length;
        var niceMet = r.checks.filter(function (k) {
          var mq = byId[k.reqId];
          return mq && mq.weight === 'nice' && k.status === 'met';
        }).length;

        var breakdownHtml = '<div class="breakdown-pill">' +
          '<span><strong>Must:</strong> ' + mustMet + '/' + mustReqs.length + '</span>' +
          '&bull; <span><strong>Nice:</strong> ' + niceMet + '/' + niceReqs.length + '</span>' +
        '</div>';

        var trs = reqs.map(function (req) {
          var k = byId[req.id] || { status: 'not_stated', evidence: '', note: '' };
          return '<tr>' +
            '<td class="req-text">' + esc(req.text) + (req.weight === 'nice' ? ' <small>(nice to have)</small>' : '') + '</td>' +
            '<td><span class="state ' + k.status + '"><span class="seg s-' + k.status + '"></span>' + STATE_LABEL[k.status] + '</span></td>' +
            '<td>' + (k.evidence ? '<p class="quote">' + esc(k.evidence) + '</p>' : '') +
              (k.note ? '<p class="note">' + esc(k.note) + '</p>' : '') + '</td></tr>';
        }).join('');

        var qs = (r.questions || []).length
          ? '<h4>Questions to ask</h4><ul class="questions">' + r.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul>'
          : '';

        var label = sc.now + ' percent match. ' + sc.counts.met + ' of ' + reqs.length + ' requirements stated.';
        var up = sc.potential > sc.now ? '<small>up to ' + sc.potential + '% if verified</small>' : '';

        // Contact Buttons (Phase 2)
        var contactHtml = '';
        var isRevealed = Boolean(state.revealedContacts[r.id]);
        if (r.consent) {
          var firstName = (r.name || '').split(/\s+/)[0] || 'there';
          var recName = ($('rec-name') && $('rec-name').value) || 'Recruiter';
          var recCompany = ($('rec-company') && $('rec-company').value) || 'Our Team';
          var recRole = ($('rec-role') && $('rec-role').value) || 'Backend Engineer';
          var tpl = ($('rec-template') && $('rec-template').value) ||
            "Hi {first name}, I'm {recruiter name} from {company}. I saw your CV for the {role} role and would like a quick chat. Are you free this week?";

          var vars = { firstName: firstName, recruiterName: recName, company: recCompany, role: recRole };
          var waUrl = Engine.buildWhatsAppLink(r.phone, tpl, vars);
          var telUrl = Engine.buildTelLink(r.phone);
          var mailUrl = Engine.buildMailtoLink(r.email, 'Interview for ' + recRole + ' role at ' + recCompany,
            Engine.renderTemplate(tpl, vars));

          var linksHtml = isRevealed ? (
            '<div class="contact-panel">' +
              '<p class="contact-info"><strong>Phone:</strong> ' + esc(r.phone || 'Not provided') + ' &bull; <strong>Email:</strong> ' + esc(r.email || 'Not provided') + '</p>' +
              '<div class="contact-links">' +
                (waUrl ? '<a href="' + esc(waUrl) + '" target="_blank" rel="noopener noreferrer" class="contact-btn wa"><svg class="ic" aria-hidden="true"><use href="#i-message"/></svg> WhatsApp</a>' : '') +
                (telUrl ? '<a href="' + esc(telUrl) + '" class="contact-btn tel"><svg class="ic" aria-hidden="true"><use href="#i-phone"/></svg> Call</a>' : '') +
                (mailUrl ? '<a href="' + esc(mailUrl) + '" class="contact-btn mail"><svg class="ic" aria-hidden="true"><use href="#i-mail"/></svg> Email</a>' : '') +
              '</div>' +
            '</div>'
          ) : '';

          contactHtml = '<div class="contact-block">' +
            '<button type="button" class="btn-quiet toggle-contact" data-act="toggle-contact" data-id="' + esc(r.id) + '">' +
              (isRevealed ? 'Hide contact details' : 'Show contact details') +
            '</button>' +
            linksHtml +
          '</div>';
        } else {
          contactHtml = '<div class="contact-block"><span class="contact-withheld"><svg class="ic" aria-hidden="true"><use href="#i-lock"/></svg> Contact details withheld by candidate</span></div>';
        }

        // Interview summary & transcript (Phase 3 & 4)
        var interviewHtml = '';
        var hasTranscript = Boolean(r.interviewTranscript && r.interviewTranscript.length);
        if (r.interviewSummary || hasTranscript) {
          interviewHtml = '<div class="interview-summary-card">' +
            '<h4>AI Verification Interview</h4>' +
            (r.interviewConfidence ? '<span class="tag ' + (r.interviewConfidence === 'high' ? 'strong' : 'look') + '">Confidence: ' + esc(r.interviewConfidence) + '</span>' : '') +
            (r.interviewSummary ? '<p class="interview-text">' + esc(r.interviewSummary) + '</p>' : '') +
            (hasTranscript ? '<button type="button" class="btn-quiet btn-transcript" data-act="view-transcript" data-id="' + esc(r.id) + '" style="margin-top:8px"><svg class="ic" aria-hidden="true"><use href="#i-quote"/></svg> View interview transcript</button>' : '') +
          '</div>';
        }

        var roadmapBtn = r.roadmapProfile ? (
          '<div style="margin:10px 0">' +
            '<button type="button" class="btn-quiet btn-roadmap" data-act="view-roadmap" data-id="' + esc(r.id) + '">' +
              '<svg class="ic" aria-hidden="true"><use href="#i-briefcase"/></svg> View Career Roadmap Profile' +
            '</button>' +
          '</div>'
        ) : '';

        var prevEl = document.querySelector('details.person[data-id="' + r.id + '"]');
        var wasOpen = Boolean(state.revealedContacts[r.id] || (prevEl && prevEl.open));

        var decided = state.decisions[r.id] || '';
        var rankBadge = r.rankingPercentile
          ? '<span class="tag ' + (r.rankingPercentile.includes('5%') ? 'strong' : 'look') + '" style="margin-left:4px">🏆 ' + esc(r.rankingPercentile) + '</span>'
          : '';

        return '<li>' +
          '<details class="person" data-id="' + esc(r.id) + '"' + (wasOpen ? ' open' : '') + '>' +
            '<summary>' +
              '<span class="rank">' + (i + 1) + '</span>' +
              '<span class="who"><span class="avatar" aria-hidden="true">' + esc(initials(r.name)) + '</span>' +
                '<span class="who-text"><strong>' + esc(r.name) + '</strong>' +
                  '<span class="who-meta"><span class="tag ' + sug.code + '">' + esc(sug.text) + '</span>' +
                  rankBadge +
                  '<span class="decided" data-for="' + esc(r.id) + '">' + (decided ? esc(DECISION_LABEL[decided]) : '') + '</span></span>' +
                  breakdownHtml +
                '</span></span>' +
              barHtml(reqs, r.checks, label) +
              '<span class="pct"><b>' + sc.now + '%</b>' + up + '</span>' +
              '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
            '</summary>' +
            '<div class="detail">' +
              '<p class="suggest">' + esc(r.summary || '') + '</p>' +
              '<table class="checks"><thead><tr><th>Requirement</th><th>Status</th><th>Evidence from the CV</th></tr></thead><tbody>' + trs + '</tbody></table>' +
              qs +
              roadmapBtn +
              interviewHtml +
              '<div class="detail-foot">' +
                contactHtml +
                '<div class="pick" role="group" aria-label="Your decision for ' + esc(r.name) + '"><span class="label">Your decision</span>' +
                  ['shortlist', 'ask', 'pass'].map(function (v) {
                    return '<button type="button" data-act="decide" data-id="' + esc(r.id) + '" data-val="' + v + '" aria-pressed="' + (decided === v) + '">' + DECISION_LABEL[v] + '</button>';
                  }).join('') +
                '</div>' +
              '</div>' +
            '</div>' +
          '</details></li>';
      }).join('');
    }

    var cov = Engine.coverage(reqs, out.list).sort(function (a, b) {
      return a.counts.met - b.counts.met || b.counts.not_met - a.counts.not_met;
    });
    $('coverage').innerHTML = cov.map(function (c) {
      var t = c.total || 1;
      var segs = ['met', 'not_stated', 'not_met'].filter(function (s) { return c.counts[s]; }).map(function (s) {
        return '<span class="seg s-' + s + '" style="flex:' + c.counts[s] + '" title="' + c.counts[s] + ' ' + STATE_LABEL[s].toLowerCase() + '"></span>';
      }).join('');
      var thin = c.counts.met / t <= 0.34;
      return '<li><span class="req-text">' + esc(c.req.text) + '</span>' +
        '<div class="bar" role="img" aria-label="' + c.counts.met + ' of ' + c.total + ' candidates state this">' + segs + '</div>' +
        '<span class="cov-count' + (thin ? ' thin' : '') + '">' + c.counts.met + ' of ' + c.total + ' state it</span></li>';
    }).join('');

    var res = $('results');
    res.hidden = false;
    updateTally();
    if (quiet) return;
    var h = $('results-h');
    h.tabIndex = -1;
    res.scrollIntoView({ behavior: 'smooth', block: 'start' });
    h.focus({ preventScroll: true });
  }

  function updateTally() {
    var n = state.out.list.length;
    var c = { shortlist: 0, ask: 0, pass: 0 };
    Object.keys(state.decisions).forEach(function (id) { c[state.decisions[id]]++; });
    var undecided = n - c.shortlist - c.ask - c.pass;
    $('tally').textContent = c.shortlist + ' shortlisted, ' + c.ask + ' to ask first, ' + c.pass + ' passed, ' + undecided + ' undecided';
  }

  $('ranking').addEventListener('click', function (e) {
    var rmBtn = e.target.closest('button[data-act="view-roadmap"]');
    if (rmBtn) {
      openRoadmapModal(rmBtn.dataset.id);
      return;
    }

    var viewBtn = e.target.closest('button[data-act="view-transcript"]');
    if (viewBtn) {
      openTranscriptModal(viewBtn.dataset.id);
      return;
    }

    var toggleBtn = e.target.closest('button[data-act="toggle-contact"]');
    if (toggleBtn) {
      var cid = toggleBtn.dataset.id;
      state.revealedContacts[cid] = !state.revealedContacts[cid];
      renderResults(true);
      var again = document.querySelector('button[data-act="toggle-contact"][data-id="' + cid + '"]');
      if (again) again.focus();
      return;
    }

    var btn = e.target.closest('button[data-act="decide"]');
    if (!btn) return;
    var id = btn.dataset.id, val = btn.dataset.val;
    if (state.decisions[id] === val) delete state.decisions[id]; else state.decisions[id] = val;
    var group = btn.parentNode.querySelectorAll('button[data-act="decide"]');
    Array.prototype.forEach.call(group, function (b) {
      b.setAttribute('aria-pressed', String(state.decisions[id] === b.dataset.val));
    });
    var tag = document.querySelector('.decided[data-for="' + id + '"]');
    if (tag) tag.textContent = state.decisions[id] ? DECISION_LABEL[state.decisions[id]] : '';
    updateTally();
  });

  function openTranscriptModal(candId) {
    var modal = $('transcript-modal');
    if (!modal) return;
    var cand = state.out && state.out.list.find(function (c) { return c.id === candId; });
    if (!cand) return;

    $('dialog-title').textContent = 'Interview Transcript: ' + (cand.name || 'Candidate');
    var content = $('dialog-content');

    var transcript = cand.interviewTranscript || [];
    if (!transcript.length && cand.interviewSummary) {
      content.innerHTML = '<div class="interview-summary-card"><h4>Verified Summary</h4><p class="interview-text">' + esc(cand.interviewSummary) + '</p></div>';
    } else if (!transcript.length) {
      content.innerHTML = '<p class="hint" style="padding:16px;text-align:center">No transcript messages recorded for this candidate.</p>';
    } else {
      content.innerHTML = transcript.map(function (m) {
        var isAi = m.role === 'ai';
        return '<div class="transcript-bubble ' + (isAi ? 'ai' : 'candidate') + '">' +
          '<strong>' + (isAi ? 'AI Interviewer' : esc(cand.name || 'Candidate')) + '</strong>' +
          '<span>' + esc(m.text) + '</span>' +
        '</div>';
      }).join('');
    }

    modal.hidden = false;
  }

  function closeTranscriptModal() {
    var modal = $('transcript-modal');
    if (modal) modal.hidden = true;
  }

  if ($('btn-close-dialog')) $('btn-close-dialog').addEventListener('click', closeTranscriptModal);
  if ($('btn-close-dialog-2')) $('btn-close-dialog-2').addEventListener('click', closeTranscriptModal);
  if ($('transcript-modal')) {
    $('transcript-modal').addEventListener('click', function (e) {
      if (e.target === this) closeTranscriptModal();
    });
  }

  // Candidate Career Roadmap Modal
  function openRoadmapModal(candId) {
    var modal = $('roadmap-modal');
    if (!modal) return;
    var cand = (state.out && state.out.list.find(function (c) { return c.id === candId; })) ||
               state.cands.find(function (c) { return c.id === candId; });
    if (!cand) return;

    var rm = cand.roadmapProfile;
    if (!rm) {
      rm = {
        name: cand.name || 'Candidate',
        headline: cand.role || 'Applicant Profile',
        summary: cand.cv ? cand.cv.slice(0, 300) + '...' : 'Candidate profile submitted via portal.',
        roadmap: [{ role: 'Applicant', company: 'Candidate Record', duration: 'Recent', highlights: ['Candidate submitted CV to portal'] }],
        education: [],
        skills: { General: ['Applicant'] }
      };
    }
    $('rm-dialog-title').textContent = (rm.name || cand.name || 'Candidate') + ' — Career Roadmap Profile';
    var content = $('rm-dialog-content');

    var contactLinks = [];
    if (rm.location) contactLinks.push('<span>📍 ' + esc(rm.location) + '</span>');
    if (rm.email) contactLinks.push('<span>✉ ' + esc(rm.email) + '</span>');
    if (rm.phone) contactLinks.push('<span>📞 ' + esc(rm.phone) + '</span>');
    if (rm.links && rm.links.linkedin) contactLinks.push('<a href="' + esc(rm.links.linkedin) + '" target="_blank">LinkedIn</a>');
    if (rm.links && rm.links.github) contactLinks.push('<a href="' + esc(rm.links.github) + '" target="_blank">GitHub</a>');

    var timelineHtml = (rm.roadmap || []).map(function (item) {
      var bullets = (item.highlights || []).map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('');
      var scale = item.scale ? '<span class="timeline-scale">⚡ ' + esc(item.scale) + '</span>' : '';
      return '<div class="timeline-item">' +
        '<div class="timeline-head">' +
          '<div><span class="timeline-role">' + esc(item.role) + '</span> <span class="timeline-company">@ ' + esc(item.company) + '</span></div>' +
          '<span class="timeline-duration">' + esc(item.duration) + '</span>' +
        '</div>' +
        scale +
        '<ul class="timeline-bullets">' + bullets + '</ul>' +
      '</div>';
    }).join('');

    var educationHtml = (rm.education || []).map(function (ed) {
      return '<div class="education-card">' +
        '<div class="education-school">🎓 ' + esc(ed.school) + '</div>' +
        '<div class="education-degree">' + esc(ed.degree) + ' in ' + esc(ed.field) + '</div>' +
        '<div class="education-year">' + esc(ed.year) + (ed.details ? ' &bull; ' + esc(ed.details) : '') + '</div>' +
      '</div>';
    }).join('');

    var skillsHtml = '';
    if (rm.skills) {
      skillsHtml = Object.keys(rm.skills).map(function (cat) {
        var tags = (rm.skills[cat] || []).map(function (t) { return '<span class="skill-pill">' + esc(t) + '</span>'; }).join('');
        if (!tags) return '';
        return '<div class="skill-row"><span class="skill-category">' + esc(cat) + '</span><div class="skill-tags">' + tags + '</div></div>';
      }).join('');
    }

    content.innerHTML = '<div class="roadmap-profile" style="margin:0;padding:0;box-shadow:none;border:none">' +
      '<div class="roadmap-header" style="margin-bottom:14px;padding-bottom:12px">' +
        '<div>' +
          '<h3 style="margin-bottom:4px">' + esc(rm.name || cand.name) + '</h3>' +
          '<p class="roadmap-headline">' + esc(rm.headline || 'Software Engineer') + '</p>' +
          '<div class="roadmap-contacts">' + contactLinks.join(' &bull; ') + '</div>' +
        '</div>' +
      '</div>' +
      (rm.summary ? '<p style="color:var(--ink-2);font-size:0.92rem;margin-bottom:16px">' + esc(rm.summary) + '</p>' : '') +
      '<h4 class="roadmap-section-title"><svg class="ic"><use href="#i-briefcase"/></svg> Career Roadmap & Experience</h4>' +
      '<div class="timeline">' + timelineHtml + '</div>' +
      '<h4 class="roadmap-section-title"><svg class="ic"><use href="#i-file"/></svg> Education & Schools Attended</h4>' +
      '<div class="education-grid">' + educationHtml + '</div>' +
      '<h4 class="roadmap-section-title"><svg class="ic"><use href="#i-check"/></svg> Technical Skills & Tools</h4>' +
      '<div class="skills-taxonomy">' + skillsHtml + '</div>' +
      (cand.cv ?
        '<details class="cand-raw-cv-details" style="margin-top:20px;border-top:1px solid var(--line);padding-top:14px">' +
          '<summary style="cursor:pointer;font-weight:700;font-size:0.9rem;color:var(--primary);margin-bottom:8px">📄 View Full Original CV Text</summary>' +
          '<pre class="raw-cv-pre" style="background:var(--wash);padding:14px;border-radius:8px;font-size:0.82rem;white-space:pre-wrap;max-height:300px;overflow-y:auto;border:1px solid var(--line);color:var(--ink-2);line-height:1.5">' + esc(cand.cv) + '</pre>' +
        '</details>' : '') +
    '</div>';

    modal.hidden = false;
  }

  function closeRoadmapModal() {
    var modal = $('roadmap-modal');
    if (modal) modal.hidden = true;
  }

  if ($('btn-close-rm-dialog')) $('btn-close-rm-dialog').addEventListener('click', closeRoadmapModal);
  if ($('btn-close-rm-dialog-2')) $('btn-close-rm-dialog-2').addEventListener('click', closeRoadmapModal);
  if ($('roadmap-modal')) {
    $('roadmap-modal').addEventListener('click', function (e) {
      if (e.target === this) closeRoadmapModal();
    });
  }

  // Recruiter Job Postings (Devpost style)
  var recruiterJobs = [];

  async function loadRecruiterJobs() {
    try {
      var resp = await fetch('/api/data?action=list_jobs');
      var data = await resp.json();
      recruiterJobs = data.jobs || [];
      renderRecruiterJobs();
    } catch (e) {
      console.warn('Recruiter jobs load notice:', e);
    }
  }

  function renderRecruiterJobs() {
    var container = $('recruiter-jobs-list');
    if (!container) return;

    if (!recruiterJobs.length) {
      container.innerHTML = '<p class="hint">No published jobs yet. Use the form to post an opening.</p>';
      return;
    }

    container.innerHTML = recruiterJobs.map(function (j) {
      return '<div class="card" style="padding:14px;border:1.5px solid var(--line);border-radius:10px;background:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
          '<div>' +
            '<strong style="font-size:0.95rem;color:var(--ink)">' + esc(j.title) + '</strong>' +
            '<p style="font-size:0.82rem;color:var(--muted)">' + esc(j.company) + ' &bull; ' + esc(j.location) + '</p>' +
          '</div>' +
          '<button type="button" class="btn-quiet btn-screen-role" data-job-id="' + esc(j.id) + '" style="padding:4px 10px;font-size:0.8rem">' +
            'Screen role &rarr;' +
          '</button>' +
        '</div>' +
        '<div style="margin-top:8px;font-size:0.82rem;color:var(--ink-2)">' +
          '<strong>Must-haves:</strong> ' + (j.mustHaves || []).join(', ') +
        '</div>' +
      '</div>';
    }).join('');
  }

  if ($('recruiter-jobs-list')) {
    $('recruiter-jobs-list').addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-screen-role');
      if (!btn) return;
      var jid = btn.dataset.jobId;
      var found = recruiterJobs.find(function (x) { return x.id === jid; });
      if (!found) return;

      $('rec-role').value = found.title;
      $('jd').value = found.description + '\n\nRequirements:\n' + (found.mustHaves || []).map(function (m) { return '- ' + m; }).join('\n') +
        '\n\nNice to have:\n' + (found.niceToHaves || []).map(function (n) { return '- ' + n; }).join('\n');

      state.reqs = [
        ...(found.mustHaves || []).map(function (m) { return { id: uid('r'), text: m, weight: 'must' }; }),
        ...(found.niceToHaves || []).map(function (n) { return { id: uid('r'), text: n, weight: 'nice' }; })
      ];

      renderReqs();
      switchTab('screen');
      say('Role "' + found.title + '" loaded with ' + state.reqs.length + ' requirements. Add candidates and press Screen.');
    });
  }

  if ($('post-job-form')) {
    $('post-job-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var title = $('new-job-title').value.trim();
      var company = $('new-job-company').value.trim();
      var location = $('new-job-location').value.trim();
      var desc = $('new-job-desc').value.trim();
      var must = $('new-job-must').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      var nice = $('new-job-nice').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);

      var status = $('post-job-status');
      status.textContent = 'Publishing job ad…';

      try {
        var resp = await fetch('/api/data?action=post_job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title,
            company: company,
            location: location,
            description: desc,
            mustHaves: must,
            niceToHaves: nice
          })
        });
        var data = await resp.json();
        if (data.ok) {
          status.textContent = '✓ Job published live!';
          $('post-job-form').reset();
          loadRecruiterJobs();
        } else {
          status.textContent = '⚠ ' + (data.error || 'Failed to post');
        }
      } catch (err) {
        status.textContent = '⚠ ' + err.message;
      }
    });
  }

  // Filter Pills Handler
  var filterContainer = $('filter-pills');
  if (filterContainer) {
    filterContainer.addEventListener('click', function (e) {
      var pill = e.target.closest('.filter-pill');
      if (!pill) return;
      var f = pill.dataset.filter;
      state.activeFilter = f;
      var allPills = filterContainer.querySelectorAll('.filter-pill');
      Array.prototype.forEach.call(allPills, function (p) {
        var active = p === pill;
        p.classList.toggle('active', active);
        p.setAttribute('aria-selected', String(active));
      });
      if (state.out) renderResults(true);
    });
  }

  // Web Speech API Voice Dictation for Recruiter Role Intake
  var recRecognition = null;
  var isRecRecording = false;
  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

  if ($('btn-rec-mic')) {
    if (!SpeechRec) {
      $('btn-rec-mic').title = 'Voice dictation is supported in Chrome, Edge, and Safari';
    } else {
      $('btn-rec-mic').addEventListener('click', function () {
        if (isRecRecording) {
          if (recRecognition) recRecognition.stop();
          return;
        }

        try {
          recRecognition = new SpeechRec();
          recRecognition.continuous = false;
          recRecognition.interimResults = false;
          recRecognition.lang = 'en-US';

          recRecognition.onstart = function () {
            isRecRecording = true;
            $('btn-rec-mic').classList.add('recording');
            var micSpan = $('btn-rec-mic').querySelector('.mic-label');
            if (micSpan) micSpan.textContent = 'Listening…';
          };

          recRecognition.onresult = function (event) {
            var speechResult = event.results[0][0].transcript;
            var input = $('rec-chat-input');
            input.value = input.value ? (input.value.trim() + ' ' + speechResult) : speechResult;
            input.focus();
          };

          recRecognition.onerror = function (event) {
            console.warn('Speech recognition error:', event.error);
          };

          recRecognition.onend = function () {
            isRecRecording = false;
            $('btn-rec-mic').classList.remove('recording');
            var micSpan = $('btn-rec-mic').querySelector('.mic-label');
            if (micSpan) micSpan.textContent = 'Voice';
          };

          recRecognition.start();
        } catch (err) {
          console.warn('Could not start speech recognition:', err);
        }
      });
    }
  }

  /* ---------- CSV Export ---------- */
  $('export').addEventListener('click', function () {
    var out = state.out;
    if (!out) return;
    var includeContacts = $('csv-contacts') && $('csv-contacts').checked;

    var headers = ['Candidate', 'Match %', 'Up to % if verified', 'Suggestion', 'Your decision', 'Not stated', 'Contradicted'];
    if (includeContacts) {
      headers.push('Phone', 'Email', 'Consent');
    }
    var rows = [headers];

    out.list.map(function (r) {
      var sc = Engine.score(out.reqs, r.checks);
      return { r: r, sc: sc };
    }).sort(function (a, b) { return b.sc.now - a.sc.now; }).forEach(function (x) {
      var names = function (status) {
        return out.reqs.filter(function (q) {
          var k = x.r.checks.filter(function (c) { return c.reqId === q.id; })[0];
          return (k ? k.status : 'not_stated') === status;
        }).map(function (q) { return q.text; }).join('; ');
      };

      var rowData = [
        x.r.name,
        x.sc.now,
        x.sc.potential,
        Engine.suggestion(x.sc).text,
        state.decisions[x.r.id] ? DECISION_LABEL[state.decisions[x.r.id]] : '',
        names('not_stated'),
        names('not_met')
      ];

      if (includeContacts) {
        rowData.push(
          x.r.phone || '',
          x.r.email || '',
          x.r.consent ? 'Consented' : 'Withheld'
        );
      }

      rows.push(rowData);
    });

    var blob = new Blob([Engine.toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'screening-results.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  $('skip-to-screen').addEventListener('click', function () { switchTab('screen'); });

  // Changing the outreach message or role title updates the links already shown.
  ['rec-name', 'rec-company', 'rec-role', 'rec-template'].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('input', function () { if (state.out) renderResults(true); });
  });

  // Show whether the AI is really configured on the server.
  fetch('/api/screen', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : { ai: false }; })
    .then(function (d) {
      var el = $('mode');
      state.ai = Boolean(d && d.ai);
      if (!el) return;
      el.textContent = state.ai ? 'AI screening on' : 'Keyword mode';
      el.className = 'mode' + (state.ai ? ' ai' : '');
    })
    .catch(function () {
      var el = $('mode');
      state.ai = false;
      if (el) { el.textContent = 'Keyword mode'; el.className = 'mode'; }
    });

  loadRecruiterJobs();
  initRecruiterChat();
  renderReqs();
  renderCands();
  loadApplicantsAutomatically(true);
})();
