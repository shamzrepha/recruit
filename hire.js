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
    chatMessages: []
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
  var sectionIntake = $('section-intake');
  var sectionScreen = $('section-screen');

  function switchTab(target) {
    if (target === 'intake') {
      tabIntakeBtn.classList.add('active');
      tabIntakeBtn.setAttribute('aria-selected', 'true');
      tabScreenBtn.classList.remove('active');
      tabScreenBtn.setAttribute('aria-selected', 'false');
      sectionIntake.hidden = false;
      sectionScreen.hidden = true;
    } else {
      tabScreenBtn.classList.add('active');
      tabScreenBtn.setAttribute('aria-selected', 'true');
      tabIntakeBtn.classList.remove('active');
      tabIntakeBtn.setAttribute('aria-selected', 'false');
      sectionScreen.hidden = false;
      sectionIntake.hidden = true;
    }
  }

  tabIntakeBtn.addEventListener('click', function () { switchTab('intake'); });
  tabScreenBtn.addEventListener('click', function () { switchTab('screen'); });

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
    } catch (err) {
      typingIndicator.hidden = true;
      $('rec-send-btn').disabled = false;
      appendChatMessage('ai', "Understood. What are the key non-negotiable technical requirements for this role versus nice-to-haves?");
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
        consent: Boolean(c.consent)
      };
    });
    renderReqs();
    renderCands();
    say('Sample role and made-up candidates loaded. Press Screen candidates.');
  });

  $('load-applicants').addEventListener('click', async function () {
    say('Loading applicants from portal…');
    try {
      var resp = await fetch('/api/data?action=list_candidates');
      var list = [];
      if (resp.ok) {
        var data = await resp.json();
        list = data.candidates || [];
      } else {
        list = JSON.parse(localStorage.getItem('scout_candidates') || '[]');
      }
      if (!list.length) {
        say('No candidate applications found yet. Candidates can apply at /apply.', true);
        return;
      }
      state.cands = list.map(function (c) {
        return {
          id: c.id || uid('c'),
          name: c.name,
          cv: c.cv,
          phone: c.phone || '',
          email: c.email || '',
          consent: Boolean(c.consent),
          interviewSummary: c.interviewSummary || null,
          interviewConfidence: c.interviewConfidence || null
        };
      });
      renderCands();
      say('Loaded ' + list.length + ' candidate(s) from portal.');
    } catch (err) {
      say('Could not load applicants: ' + err.message, true);
    }
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
          interviewSummary: c.interviewSummary || null,
          interviewConfidence: c.interviewConfidence || null
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
      res.interviewSummary = orig.interviewSummary || null;
      res.interviewConfidence = orig.interviewConfidence || null;
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

    $('ranking').innerHTML = rows.map(function (row, i) {
      var r = row.r, sc = row.sc, sug = row.sug;
      var byId = {};
      r.checks.forEach(function (k) { byId[k.reqId] = k; });

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

      // Interview summary (Phase 3)
      var interviewHtml = '';
      if (r.interviewSummary) {
        interviewHtml = '<div class="interview-summary-card">' +
          '<h4>AI Verification Interview Summary</h4>' +
          (r.interviewConfidence ? '<span class="tag ' + (r.interviewConfidence === 'high' ? 'strong' : 'look') + '">Confidence: ' + esc(r.interviewConfidence) + '</span>' : '') +
          '<p class="interview-text">' + esc(r.interviewSummary) + '</p>' +
        '</div>';
      }

      var prevEl = document.querySelector('details.person[data-id="' + r.id + '"]');
      var wasOpen = Boolean(state.revealedContacts[r.id] || (prevEl && prevEl.open));

      var decided = state.decisions[r.id] || '';
      return '<li>' +
        '<details class="person" data-id="' + esc(r.id) + '"' + (wasOpen ? ' open' : '') + '>' +
          '<summary>' +
            '<span class="rank">' + (i + 1) + '</span>' +
            '<span class="who"><span class="avatar" aria-hidden="true">' + esc(initials(r.name)) + '</span>' +
              '<span class="who-text"><strong>' + esc(r.name) + '</strong>' +
                '<span class="who-meta"><span class="tag ' + sug.code + '">' + esc(sug.text) + '</span>' +
                '<span class="decided" data-for="' + esc(r.id) + '">' + (decided ? esc(DECISION_LABEL[decided]) : '') + '</span></span></span></span>' +
            barHtml(reqs, r.checks, label) +
            '<span class="pct"><b>' + sc.now + '%</b>' + up + '</span>' +
            '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
          '</summary>' +
          '<div class="detail">' +
            '<p class="suggest">' + esc(r.summary || '') + '</p>' +
            '<table class="checks"><thead><tr><th>Requirement</th><th>Status</th><th>Evidence from the CV</th></tr></thead><tbody>' + trs + '</tbody></table>' +
            qs +
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

  initRecruiterChat();
  renderReqs();
  renderCands();
})();
