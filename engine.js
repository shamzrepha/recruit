/*
 * Scout Screener engine: requirement parsing, keyword (demo) screening, scoring.
 * Works in the browser (window.Engine) and in Node (require) so it can be tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STOP = new Set((
    'a an and are as at be by for from has have in is it its of on or that the their to with you your we our will can ' +
    'able ability strong good great experience experienced work working worked years year plus least minimum using use ' +
    'used including knowledge understanding proven solid hands-on production role team teams company companies someone ' +
    'ideal candidate must should nice bonus preferred required requirements skills skill familiarity familiar ' +
    'comfortable proficient proficiency across within into over also any all real customer customers similar related equivalent comparable other'
  ).split(' '));

  var KEEP_SHORT = new Set(['go', 'ai', 'ml', 'qa', 'ui', 'ux']);

  // Token -> alternative spellings that count as the same thing in a CV.
  var SYN = {
    postgresql: ['postgres'], postgres: ['postgres'],
    aws: ['aws', 'amazon web services'], gcp: ['gcp', 'google cloud'], azure: ['azure'],
    startup: ['startup', 'start-up', 'early-stage', 'early stage', 'seed-stage', 'series a', 'founding'],
    'early-stage': ['startup', 'start-up', 'early-stage', 'early stage', 'seed-stage', 'series a', 'founding'],
    shipped: ['ship', 'launch', 'deploy', 'released', 'own'],
    startups: ['startup', 'start-up', 'early-stage', 'early stage', 'seed-stage', 'series a', 'founding'],
    backend: ['backend', 'back-end', 'back end', 'server-side', 'rest api', 'apis'],
    build: ['build', 'built', 'develop', 'ship'],
    building: ['build', 'built', 'develop', 'ship'],
    built: ['build', 'built', 'develop', 'ship'],
    services: ['service', 'microservice'],
    javascript: ['javascript', 'node.js', 'nodejs'],
    typescript: ['typescript'],
    python: ['python', 'django', 'flask', 'fastapi'],
    database: ['database', 'sql', 'postgres', 'mysql', 'mongodb', 'nosql'],
    databases: ['database', 'sql', 'postgres', 'mysql', 'mongodb', 'nosql'],
    sql: ['sql', 'postgres', 'mysql'],
    ml: ['machine learning', 'ml'],
    ai: ['ai', 'artificial intelligence', 'llm'],
    docker: ['docker', 'container'],
    kubernetes: ['kubernetes', 'k8s'],
    testing: ['test', 'pytest', 'jest', 'qa']
  };

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function stem(t) {
    t = t.toLowerCase();
    if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
    if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
    if (t.length > 4 && t.endsWith('ly')) return t.slice(0, -2);
    if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
    if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
    return t;
  }

  function tokens(text) {
    var raw = text.toLowerCase().match(/[a-z0-9+#.\-]+/g) || [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i].replace(/^[.\-]+|[.\-]+$/g, '');
      if (!t || STOP.has(t)) continue;
      if (t.length < 3 && !KEEP_SHORT.has(t)) continue;
      if (/^\d+$/.test(t)) continue;
      out.push(t);
    }
    return out;
  }

  var YEARS_RE = /(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/gi;

  function snippet(raw, pos) {
    var start = raw.lastIndexOf('\n', pos) + 1;
    var end = raw.indexOf('\n', pos);
    if (end === -1) end = raw.length;
    var seg = raw.slice(start, end).trim();
    if (seg.length > 180) {
      var from = Math.max(0, pos - start - 80);
      seg = (from > 0 ? '…' : '') + raw.slice(start + from, start + from + 170).trim() + '…';
    }
    return seg;
  }

  // Every position where a token (or one of its synonyms) occurs in the CV.
  function findAll(t, lower, raw) {
    var out = [], m, re;
    if (t === 'go') {
      re = /(^|[^A-Za-z0-9])Go(?![A-Za-z0-9])/g;
      while ((m = re.exec(raw))) out.push(m.index + m[1].length);
      re = /golang/gi;
      while ((m = re.exec(raw))) out.push(m.index);
      return out;
    }
    (SYN[t] || [stem(t)]).forEach(function (f) {
      var r = new RegExp('(^|[^a-z0-9])' + esc(f) + '[a-z]{0,4}(?![a-z0-9])', 'g');
      var x;
      while ((x = r.exec(lower))) {
        out.push(x.index + x[1].length);
        if (r.lastIndex === x.index) r.lastIndex++;
      }
    });
    return out;
  }

  // perToken: one array of positions per matched token. Returns a position on the line that
  // holds the most distinct tokens, so the quoted evidence is the most relevant line.
  function bestLinePos(raw, perToken) {
    var lines = {};
    perToken.forEach(function (positions, ti) {
      positions.forEach(function (p) {
        var ls = raw.lastIndexOf('\n', p) + 1;
        var L = lines[ls] || (lines[ls] = { toks: {}, first: p });
        L.toks[ti] = true;
        if (p < L.first) L.first = p;
      });
    });
    var best = -1, bestN = -1;
    Object.keys(lines).map(Number).sort(function (a, b) { return a - b; }).forEach(function (ls) {
      var n = Object.keys(lines[ls].toks).length;
      if (n > bestN) { best = ls; bestN = n; }
    });
    return best === -1 ? -1 : lines[best].first;
  }

  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var EDU_LINE = /universit|college|polytechnic|school|institute|academy|b\.?\s?sc|b\.?\s?eng|\bb\.?a\b|m\.?\s?sc|m\.?\s?eng|\bhnd\b|\bond\b|diploma|bachelor|master|ph\.?d|waec|ssce|degree|graduat|student/i;
  var RANGE_RE = /(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+)?((?:19|20)\d\d)\s*(?:-|\u2013|\u2014|to|until)\s*(?:(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+)?((?:19|20)\d\d)|(present|current|now|date|ongoing))/gi;
  // Total years of work shown by date ranges (education lines are skipped, overlaps are merged).
  function experienceYears(raw, nowDate) {
    var today = nowDate || new Date();
    var spans = [];
    String(raw || '').split(/\r?\n/).forEach(function (line) {
      if (EDU_LINE.test(line)) return;
      var m;
      RANGE_RE.lastIndex = 0;
      while ((m = RANGE_RE.exec(line))) {
        var a = parseInt(m[2], 10) + (m[1] ? MONTHS[m[1].toLowerCase()] / 12 : 0);
        var b = m[5] ? today.getFullYear() + today.getMonth() / 12 : parseInt(m[4], 10) + (m[3] ? MONTHS[m[3].toLowerCase()] / 12 : 0.5);
        if (b > a && b - a < 45) spans.push([a, b]);
      }
    });
    spans.sort(function (x, y) { return x[0] - y[0]; });
    var total = 0, cur = null;
    spans.forEach(function (sp) {
      if (!cur) cur = sp.slice();
      else if (sp[0] <= cur[1]) cur[1] = Math.max(cur[1], sp[1]);
      else { total += cur[1] - cur[0]; cur = sp.slice(); }
    });
    if (cur) total += cur[1] - cur[0];
    return Math.round(total * 10) / 10;
  }

  function cvYears(raw) {
    var best = null, m;
    YEARS_RE.lastIndex = 0;
    while ((m = YEARS_RE.exec(raw))) {
      var y = parseFloat(m[1]);
      if (y > 0 && y < 50 && (best === null || y > best.years)) best = { years: y, pos: m.index };
    }
    if (!best) {
      var mm = /(\d+)\s*months?/i.exec(raw);
      if (mm) best = { years: Math.round(parseInt(mm[1], 10) / 12 * 10) / 10, pos: mm.index };
    }
    if (!best) {
      var ey = experienceYears(raw);
      if (ey > 0) best = { years: ey, pos: Math.max(0, raw.search(RANGE_RE)) };
      RANGE_RE.lastIndex = 0;
    }
    return best;
  }

  // Demo-mode check of one requirement against one CV. Keyword based, so it can say
  // "met" (found) or "not_stated" (not found). It only says "not_met" for a clear years shortfall.
  function checkRequirement(req, cv) {
    var raw = cv || '';
    var lower = raw.toLowerCase();
    var text = req.text || '';

    var yearsReq = null;
    var ym = /(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i.exec(text);
    if (ym) yearsReq = parseFloat(ym[1]);

    var cleaned = text.replace(/\d+(?:\.\d+)?\s*\+?\s*(?:years?|yrs?)(\s+of)?/gi, ' ');
    var alts = cleaned.split(/\s+or\s+|\/|,|;/i).map(tokens).filter(function (a) { return a.length; });

    var topicPos = -1;
    if (alts.length) {
      for (var a = 0; a < alts.length && topicPos === -1; a++) {
        var hits = 0, perToken = [];
        for (var i = 0; i < alts[a].length; i++) {
          var ps = findAll(alts[a][i], lower, raw);
          if (ps.length) { hits++; perToken.push(ps); }
        }
        if (hits / alts[a].length >= 0.66) topicPos = bestLinePos(raw, perToken);
      }
    }

    var cy = yearsReq !== null ? cvYears(raw) : null;

    if (yearsReq !== null) {
      if (!alts.length && cy) {
        // A general "N+ years of experience" requirement: judge it from the years the CV shows.
        return cy.years >= yearsReq
          ? { status: 'met', evidence: snippet(raw, cy.pos), note: 'The CV shows about ' + cy.years + ' years of experience.' }
          : { status: 'not_met', evidence: snippet(raw, cy.pos), note: 'The CV shows about ' + cy.years + ' year' + (cy.years === 1 ? '' : 's') + ' of experience; the role asks for ' + yearsReq + '+.' };
      }
      if (cy && cy.years < yearsReq) {
        return {
          status: 'not_met',
          evidence: snippet(raw, cy.pos),
          note: 'The CV shows about ' + cy.years + ' year' + (cy.years === 1 ? '' : 's') + ' of experience; the role asks for ' + yearsReq + '+.'
        };
      }
      if (topicPos !== -1 && cy && cy.years >= yearsReq) {
        return { status: 'met', evidence: snippet(raw, cy.pos), note: 'The CV states ' + cy.years + '+ years and covers this area.' };
      }
      if (topicPos !== -1) {
        return { status: 'not_stated', evidence: snippet(raw, topicPos), note: 'The area is covered, but the CV doesn’t state how many years.' };
      }
      return { status: 'not_stated', evidence: '', note: 'Nothing in the CV speaks to this.' };
    }

    if (!alts.length) {
      return { status: 'not_stated', evidence: '', note: 'This requirement can’t be checked by keywords. Verify it by hand.' };
    }
    if (topicPos !== -1) return { status: 'met', evidence: snippet(raw, topicPos), note: '' };
    return { status: 'not_stated', evidence: '', note: 'Not mentioned in the CV.' };
  }

  function questionFor(req, check) {
    var t = req.text.replace(/\.$/, '');
    if (check.status === 'not_met') {
      return 'Your CV points to less experience than the role asks for (\u201C' + t + '\u201D). Is there other relevant work we should count?';
    }
    return 'Does your experience cover \u201C' + t + '\u201D? Please give a specific example.';
  }

  function demoScreen(requirements, candidates) {
    return candidates.map(function (c) {
      var checks = requirements.map(function (r) {
        var res = checkRequirement(r, c.cv);
        return { reqId: r.id, status: res.status, evidence: res.evidence, note: res.note };
      });
      var met = checks.filter(function (k) { return k.status === 'met'; }).length;
      var questions = [];
      checks.forEach(function (k, i) {
        if (k.status !== 'met') questions.push(questionFor(requirements[i], k));
      });
      return {
        id: c.id,
        name: c.name,
        summary: met + ' of ' + requirements.length + ' requirements are backed by the CV text.',
        checks: checks,
        questions: questions.slice(0, 4)
      };
    });
  }

  function weightOf(req) { return req.weight === 'nice' ? 1 : 3; }

  // now: share of weighted requirements clearly met. potential: if every "not stated" turned out true.
  function score(requirements, checks) {
    var total = 0, got = 0, maybe = 0, counts = { met: 0, not_stated: 0, not_met: 0 };
    var byId = {};
    checks.forEach(function (k) { byId[k.reqId] = k; });
    var missingMust = false;
    requirements.forEach(function (r) {
      var w = weightOf(r);
      var k = byId[r.id] || { status: 'not_stated' };
      total += w;
      counts[k.status] = (counts[k.status] || 0) + 1;
      if (k.status === 'met') { got += w; maybe += w; }
      else if (k.status === 'not_stated') { maybe += w; }
      else if (k.status === 'not_met' && r.weight !== 'nice') { missingMust = true; }
    });
    var now = total ? Math.round(got / total * 100) : 0;
    var potential = total ? Math.round(maybe / total * 100) : 0;
    return { now: now, potential: potential, counts: counts, missingMust: missingMust };
  }

  // A suggestion for the recruiter. The decision stays with the human.
  function suggestion(sc) {
    if (sc.missingMust) return { code: 'gap', text: 'Missing a must-have' };
    if (sc.potential - sc.now >= 15 && sc.now < 75) return { code: 'verify', text: 'Verify before deciding' };
    if (sc.now >= 75) return { code: 'strong', text: 'Strong match' };
    if (sc.now >= 50) return { code: 'look', text: 'Worth a closer look' };
    return { code: 'weak', text: 'Weak match' };
  }

  function coverage(requirements, results) {
    return requirements.map(function (r) {
      var c = { met: 0, not_stated: 0, not_met: 0 };
      results.forEach(function (res) {
        var k = res.checks.filter(function (x) { return x.reqId === r.id; })[0];
        c[k ? k.status : 'not_stated']++;
      });
      return { req: r, counts: c, total: results.length };
    });
  }

  var NICE_HEAD = /nice[\s-]*to[\s-]*have|bonus|preferred|would be a plus|a plus/i;
  var MUST_HEAD = /requirements?|qualifications?|must|you have|what you|looking for|about you/i;

  function extractRequirements(text, nextId) {
    var lines = (text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var out = [];
    var section = 'must';
    var bulletRe = /^([-*•●‣]|\d+[.)])\s+/;
    var hasBullets = lines.some(function (l) { return bulletRe.test(l); });
    var id = nextId || 1;

    lines.forEach(function (l) {
      var isBullet = bulletRe.test(l);
      if (!isBullet && l.length < 60 && /:$|^[A-Z][A-Za-z\s\/&-]+$/.test(l)) {
        if (NICE_HEAD.test(l)) section = 'nice';
        else if (MUST_HEAD.test(l)) section = 'must';
        return;
      }
      if (hasBullets && !isBullet) return;
      var body = l.replace(bulletRe, '').trim();
      var weight = section;
      var pref = /^(nice[\s-]*to[\s-]*have|bonus|preferred)\s*[:\-]\s*/i;
      if (pref.test(body)) { weight = 'nice'; body = body.replace(pref, ''); }
      else if (/\((nice to have|bonus|preferred)\)|\ba plus\b/i.test(body)) weight = 'nice';
      body = body.replace(/\s*\((nice to have|bonus|preferred)\)/i, '').replace(/[.;]$/, '');
      if (body.length >= 5 && body.length <= 140) out.push({ id: 'r' + (id++), text: body, weight: weight });
    });

    if (!out.length) {
      var sentences = (text || '').split(/(?<=[.!?])\s+/);
      sentences.forEach(function (s) {
        s = s.trim().replace(/[.;]$/, '');
        if (s.length >= 8 && s.length <= 140 && /experience|years|proficien|knowledge|familiar|skills?|degree/i.test(s)) {
          out.push({ id: 'r' + (id++), text: s, weight: /nice|bonus|plus|preferred/i.test(s) ? 'nice' : 'must' });
        }
      });
    }
    return out.slice(0, 20);
  }

  function guessName(cv, index) {
    var first = (cv || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean)[0] || '';
    if (first && first.length <= 40 && !/[\d@]/.test(first) && first.split(/\s+/).length <= 4) return first;
    return 'Candidate ' + (index + 1);
  }

  function csvCell(v) {
    v = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(v)) v = "'" + v; // stop spreadsheet formula injection
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }

  /* ---------- Contact & Phone Normalisation (Phase 1 & 2) ---------- */

  var NG_PREFIXES = new Set([
    '701', '702', '703', '704', '705', '706', '707', '708', '709',
    '802', '803', '804', '805', '806', '807', '808', '809',
    '810', '811', '812', '813', '814', '815', '816', '817', '818', '819',
    '901', '902', '903', '904', '905', '906', '907', '908', '909',
    '911', '912', '913', '914', '915', '916'
  ]);

  function normalizePhone(input) {
    if (!input || typeof input !== 'string') {
      return { valid: false, e164: '', error: 'Phone number is required.' };
    }
    var raw = input.trim();
    if (!raw) {
      return { valid: false, e164: '', error: 'Phone number cannot be empty.' };
    }

    // Check for letters or illegal characters (allow digits, +, -, space, (, ))
    if (/[^\d+\s\-()]/i.test(raw)) {
      return { valid: false, e164: '', error: 'Phone number contains invalid characters.' };
    }

    // Check leading plus or double-zero
    var hasPlus = raw.startsWith('+');
    var digits = raw.replace(/\D/g, '');

    if (raw.startsWith('00')) {
      hasPlus = true;
      digits = digits.slice(2);
    }

    // Handle Nigerian formats:
    // Case 1: starts with 234 or +234
    if (hasPlus && digits.startsWith('234')) {
      var rest = digits.slice(3);
      if (rest.startsWith('0')) rest = rest.slice(1); // Handle +234080... error
      if (rest.length === 10 && NG_PREFIXES.has(rest.slice(0, 3))) {
        return { valid: true, e164: '+234' + rest, national: '0' + rest, digits: '234' + rest };
      }
      return { valid: false, e164: '', error: 'Invalid Nigerian phone number length or prefix.' };
    }

    if (!hasPlus && digits.startsWith('234') && digits.length === 13) {
      var restNoPlus = digits.slice(3);
      if (restNoPlus.startsWith('0')) restNoPlus = restNoPlus.slice(1);
      if (restNoPlus.length === 10 && NG_PREFIXES.has(restNoPlus.slice(0, 3))) {
        return { valid: true, e164: '+234' + restNoPlus, national: '0' + restNoPlus, digits: '234' + restNoPlus };
      }
    }

    // Case 2: standard Nigerian domestic format (e.g. 0803 123 4567, 11 digits starting with 0)
    if (!hasPlus && digits.length === 11 && digits.startsWith('0')) {
      var pfx = digits.slice(1, 4);
      if (NG_PREFIXES.has(pfx)) {
        return { valid: true, e164: '+234' + digits.slice(1), national: digits, digits: '234' + digits.slice(1) };
      }
      return { valid: false, e164: '', error: 'Unknown Nigerian network prefix (' + pfx + ').' };
    }

    // Case 3: 10 digits without leading 0 (e.g. 8031234567)
    if (!hasPlus && digits.length === 10 && NG_PREFIXES.has(digits.slice(0, 3))) {
      return { valid: true, e164: '+234' + digits, national: '0' + digits, digits: '234' + digits };
    }

    // Case 4: International format with leading + (7 to 15 digits ITU-T E.164 standard)
    if (hasPlus) {
      if (digits.length >= 7 && digits.length <= 15) {
        return { valid: true, e164: '+' + digits, national: digits, digits: digits };
      }
      return { valid: false, e164: '', error: 'International phone numbers must be between 7 and 15 digits.' };
    }

    return { valid: false, e164: '', error: 'Please enter a valid phone number (e.g. 0803 123 4567 or +234 803 123 4567).' };
  }

  function renderTemplate(template, vars) {
    var str = String(template || '');
    var v = vars || {};
    return str.replace(/\{([^{}]+)\}/g, function (_, key) {
      var k = key.trim().toLowerCase();
      if (k === 'first name' || k === 'firstname') return v.firstName || '';
      if (k === 'recruiter name' || k === 'recruitername') return v.recruiterName || '';
      if (k === 'company') return v.company || '';
      if (k === 'role') return v.role || '';
      return v[key] || '';
    });
  }

  function buildWhatsAppLink(phoneE164, template, vars) {
    var norm = normalizePhone(phoneE164);
    if (!norm.valid) return '';
    var msg = renderTemplate(template, vars);
    return 'https://wa.me/' + norm.digits + (msg ? '?text=' + encodeURIComponent(msg) : '');
  }

  function buildTelLink(phoneE164) {
    var norm = normalizePhone(phoneE164);
    if (!norm.valid) return '';
    return 'tel:' + norm.e164;
  }

  function buildMailtoLink(email, subject, body) {
    var addr = String(email || '').trim();
    if (!addr || !addr.includes('@')) return '';
    var params = [];
    if (subject) params.push('subject=' + encodeURIComponent(subject));
    if (body) params.push('body=' + encodeURIComponent(body));
    return 'mailto:' + addr + (params.length ? '?' + params.join('&') : '');
  }

  /* Extract contact fields from OCR text */
  function extractContacts(text) {
    var raw = String(text || '');
    var out = {
      name: '',
      phone: '',
      email: '',
      location: '',
      links: { linkedin: '', github: '', portfolio: '' }
    };

    // 1. Email extraction (handles noisy OCR with spaces around @ or dots)
    var emailRe = /\b([a-zA-Z0-9._%+-]+(?:\s*@\s*|\s*\[at\]\s*)[a-zA-Z0-9.-]+\s*\.\s*[a-zA-Z]{2,})\b/i;
    var em = emailRe.exec(raw);
    if (em) {
      out.email = em[1].replace(/\s+/g, '').replace(/\[at\]/i, '@');
    }

    // 2. Phone extraction (Nigerian domestic or international)
    var phoneMatches = raw.match(/(?:\(\+234\)|(?:\+234|234|0))\s*\(?[789][01]\d{1}\)?[\s\-]?\d{3}[\s\-]?\d{4}|\+?\d{1,3}[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}/g);
    if (phoneMatches) {
      for (var p = 0; p < phoneMatches.length; p++) {
        var cleanCandidate = phoneMatches[p].replace(/[^\d+]/g, '');
        var n = normalizePhone(cleanCandidate);
        if (n.valid) {
          out.phone = n.e164;
          break;
        }
      }
    }

    // 3. Links
    var liRe = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9%_-]+)/i;
    var li = liRe.exec(raw);
    if (li) out.links.linkedin = 'https://linkedin.com/in/' + li[1];

    var ghRe = /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9%_-]+)/i;
    var gh = ghRe.exec(raw);
    if (gh && gh[1].toLowerCase() !== 'features' && gh[1].toLowerCase() !== 'pricing') {
      out.links.github = 'https://github.com/' + gh[1];
    }

    var webRe = /(?:https?:\/\/)([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s)]*)?)/i;
    var wm = webRe.exec(raw);
    if (wm) {
      var url = wm[0];
      if (!url.includes('linkedin.com') && !url.includes('github.com')) {
        out.links.portfolio = url;
      }
    }

    // 4. Location heuristic
    var locRe = /\b(Lagos|Abuja|Port Harcourt|Ibadan|Enugu|Kano|Benin City|Kaduna|Nigeria|Remote|London|New York|Berlin|Toronto|Accra|Nairobi)\b/i;
    var lm = locRe.exec(raw);
    if (lm) out.location = lm[0];

    // 5. Name: candidate name heuristic from top non-header lines
    var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    for (var i = 0; i < Math.min(5, lines.length); i++) {
      var line = lines[i];
      if (line.length >= 3 && line.length <= 40 && !/[\d@:/\\+–—|]/.test(line) && !/curriculum|resume|cv|profile|contact/i.test(line)) {
        var words = line.split(/\s+/);
        if (words.length >= 2 && words.length <= 4) {
          out.name = line;
          break;
        }
      }
    }

    return out;
  }

  /* ------------------------------------------------------------ CV profile (offline fallback) */

  var HEADINGS = {
    summary: /^(professional\s+)?(summary|profile|objective|about( me)?|personal statement)$/i,
    education: /^(education(al)?( background| qualifications?)?|academic( background| qualifications?)?|qualifications?)$/i,
    experience: /^((work|professional|relevant|employment)\s+)?(experience|history)|^employment|^career( history)?$/i,
    skills: /^((key|core|technical|professional|soft)\s+)?(skills|competenc(y|ies)|technologies|tools)( & tools)?$/i,
    certs: /^(certifications?|certificates?|training|courses?|licen[cs]es?)$/i,
    languages: /^languages?$/i,
    projects: /^(projects?|achievements?|awards?|volunteering|interests|references?|hobbies)$/i
  };
  var SCHOOL_RE = /(universit|college|polytechnic|institute|academy|school of|secondary school|high school)/i;
  var QUAL_RE = /(b\.?\s?sc\.?|b\.?\s?eng\.?|b\.?\s?tech|\bb\.?a\.?\b|m\.?\s?sc\.?|m\.?\s?eng\.?|m\.?\s?b\.?\s?a|ph\.?d|\bhnd\b|\bond\b|bachelor[^,;|\n]*|master[^,;|\n]*|diploma[^,;|\n]*|waec|ssce|neco)/i;

  function splitSections(raw) {
    var lines = String(raw || '').split(/\r?\n/);
    var out = { top: [] }, cur = 'top';
    lines.forEach(function (l) {
      var t = l.trim().replace(/[:\-–—_*#=]+$/g, '').replace(/^[#*\-–—\s]+/, '').trim();
      var key = null;
      if (t && t.length <= 40) {
        Object.keys(HEADINGS).forEach(function (k) { if (!key && HEADINGS[k].test(t)) key = k; });
      }
      if (key) { cur = key; out[cur] = out[cur] || []; }
      else (out[cur] = out[cur] || []).push(l);
    });
    return out;
  }

  function yearsIn(line) {
    var ys = String(line).match(/(?:19|20)\d\d/g) || [];
    return { start: ys[0] || '', end: /present|current|now|date|ongoing/i.test(line) ? 'Present' : (ys[1] || '') };
  }

  function parseCv(raw) {
    raw = String(raw || '');
    var c = extractContacts(raw);
    if (c.name && c.name === c.name.toUpperCase()) c.name = c.name.toLowerCase().replace(/(^|[\s'-])([a-z])/g, function (m, p1, p2) { return p1 + p2.toUpperCase(); });
    var sec = splitSections(raw);
    var profile = {
      name: c.name, headline: '', location: c.location, email: c.email, phone: c.phone,
      links: c.links, summary: '', skills: [], yearsExperience: null,
      education: [], experience: [], certifications: [], languages: [], suggestedRoles: []
    };

    if (sec.summary) profile.summary = sec.summary.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);

    var skillText = (sec.skills || []).join('\n');
    profile.skills = skillText.split(/[,;|•·\n]|\s{2,}/).map(function (x) {
      return x.replace(/^[\s\-–*•:]+|[\s.]+$/g, '').replace(/^(languages?|frameworks?|tools?|databases?|programming)\s*:\s*/i, '').trim();
    }).filter(function (x) { return x.length > 1 && x.length <= 40; }).slice(0, 30);

    (sec.certs || []).forEach(function (l) { var t = l.replace(/^[\s\-–*•]+/, '').trim(); if (t) profile.certifications.push(t.slice(0, 100)); });
    profile.certifications = profile.certifications.slice(0, 10);
    (sec.languages || []).join(',').split(/[,;|\n]/).forEach(function (l) { var t = l.replace(/^[\s\-–*•]+/, '').trim(); if (t && t.length < 30) profile.languages.push(t); });
    profile.languages = profile.languages.slice(0, 8);

    var edu = (sec.education || []).filter(function (l) { return l.trim(); });
    edu.forEach(function (l) {
      if (!SCHOOL_RE.test(l) && !QUAL_RE.test(l)) return;
      var yrs = yearsIn(l);
      var q = QUAL_RE.exec(l);
      var school = (l.split(/[|–—•]| - /).filter(function (p) { return SCHOOL_RE.test(p); })[0] || '').replace(/(?:19|20)\d\d/g, '').replace(/[()]/g, '').trim();
      if (QUAL_RE.test(school)) school = (l.split(/[|–—•,]| - /).filter(function (p) { return SCHOOL_RE.test(p) && !QUAL_RE.test(p); })[0] || school).replace(/(?:19|20)\d\d/g, '').trim();
      var rest = l.replace(/(?:19|20)\d\d/g, '').replace(/\s*[-–—]\s*$/, '');
      var fieldTxt = q ? rest.slice(q.index + q[0].length).replace(/^[\s,:\-–]+(in\s+)?/i, '').split(/[,|•(]/)[0].replace(/[()]/g, '').trim() : '';
      if (SCHOOL_RE.test(fieldTxt)) fieldTxt = '';
      profile.education.push({
        school: (school || (SCHOOL_RE.test(rest) ? rest.trim() : '')).slice(0, 100),
        qualification: q ? q[0].trim().slice(0, 100) : '',
        field: fieldTxt.slice(0, 100), start: yrs.start, end: yrs.end
      });
    });
    // merge a school line followed by a qualification line
    for (var i = profile.education.length - 1; i > 0; i--) {
      var a = profile.education[i - 1], b = profile.education[i];
      if (a.school && !a.qualification && !b.school && b.qualification) { a.qualification = b.qualification; a.field = b.field; a.start = a.start || b.start; a.end = a.end || b.end; profile.education.splice(i, 1); }
    }
    profile.education = profile.education.slice(0, 6);

    var ex = (sec.experience || []);
    var cur = null, pend = [];
    var SPLIT = /\s*(?:\||,| - | – | — | at | @ )\s*/;
    function fromHeader(lines, yrs) {
      var parts = lines.length > 1 ? [lines[0], lines[1]] : lines[0].split(SPLIT).filter(Boolean);
      cur = { company: (parts[1] || '').slice(0, 100), title: (parts[0] || '').slice(0, 100), start: yrs ? yrs.start : '', end: yrs ? yrs.end : '', highlights: [] };
      profile.experience.push(cur); pend = [];
    }
    ex.forEach(function (l) {
      var t = l.trim();
      if (!t) return;
      RANGE_RE.lastIndex = 0;
      var isBullet = /^[\s]*[-–*•·]/.test(l);
      if (!isBullet && RANGE_RE.test(t) && !EDU_LINE.test(t)) {
        RANGE_RE.lastIndex = 0;
        var yrs = yearsIn(t);
        var head = t.replace(RANGE_RE, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
        if (head.length > 2) { fromHeader(head.split(SPLIT).filter(Boolean).length > 1 ? [head] : [head], yrs); }
        else if (pend.length) fromHeader(pend, yrs);
        else if (cur && !cur.start) { cur.start = yrs.start; cur.end = yrs.end; }
      } else if (isBullet) {
        if (pend.length) fromHeader(pend, null);
        if (cur && cur.highlights.length < 4) cur.highlights.push(t.replace(/^[-–*•·\s]+/, '').slice(0, 200));
      } else if (t.length < 80 && !/[.!?]$/.test(t)) {
        pend.push(t); if (pend.length > 2) pend.shift();
      }
    });
    if (pend.length) fromHeader(pend, null);
    profile.experience = profile.experience.slice(0, 10);

    var ey = experienceYears(raw);
    var explicit = cvYears(raw);
    profile.yearsExperience = ey > 0 ? ey : (explicit ? explicit.years : null);
    profile.headline = (profile.experience[0] && profile.experience[0].title) || (profile.education[0] && profile.education[0].qualification) || '';
    return profile;
  }

  // The CV plus the profile fields, so keyword checks also see skills that were found.
  function cvWithProfile(cv, profile) {
    if (!profile) return cv || '';
    var extra = [];
    if (profile.skills && profile.skills.length) extra.push('Skills: ' + profile.skills.join(', '));
    (profile.experience || []).forEach(function (e) { extra.push([e.title, e.company].filter(Boolean).join(' at ')); });
    (profile.education || []).forEach(function (e) { extra.push([e.qualification, e.school].filter(Boolean).join(', ')); });
    return String(cv || '') + (extra.length ? '\n\n' + extra.join('\n') : '');
  }

  // Where a score would land among a list of existing scores.
  function percentile(score, scores) {
    var list = (scores || []).filter(function (x) { return typeof x === 'number'; });
    if (list.length < 3) return { enough: false, n: list.length };
    var below = list.filter(function (x) { return x < score; }).length;
    var ahead = Math.round(below / list.length * 100);
    return { enough: true, n: list.length, ahead: ahead, top: Math.max(1, 100 - ahead) };
  }

  /* ------------------------------------------------------------ recruiter assistant (offline intent parser) */

  var PLACES = ['lagos', 'abuja', 'port harcourt', 'ibadan', 'enugu', 'kano', 'owerri', 'benin city', 'kaduna', 'accra', 'nairobi', 'london', 'remote', 'nigeria'];
  var FILLER = /^(the|a|an|me|them|us|candidates?|people|applicants?|who|that|can|could|please|and|or|also|for|to|of|any|all|some|with|in|have|has|know|knows|using|use|skills?|experience|skilled|good|at)$/i;

  function parseIntent(message, jobs, currentJobId) {
    var m = String(message || '').trim();
    var low = m.toLowerCase();
    var out = { action: 'top', n: 10, jobId: currentJobId || '', stage: '', skills: [], location: '', minScore: 0, interviewed: false, text: '' };
    if (!m) return { action: 'help', text: '' };
    if (/^(help|what can you do|how do you work|\?)/.test(low)) return { action: 'help', text: '' };

    var num = /\b(?:top|best|first|strongest)\s+(\d{1,3})\b/.exec(low) || /\b(\d{1,3})\s+(?:best|top|strongest|candidates?|people|applicants?)\b/.exec(low);
    if (num) out.n = Math.max(1, Math.min(100, parseInt(num[1], 10)));
    else if (/\ball\b/.test(low)) out.n = 100;

    if (/\bshortlist(ed)?\b/.test(low) && /\b(them|these|top|mark|add|move)\b/.test(low) && !/\b(show|list|who)\b/.test(low)) out.action = 'shortlist';
    else if (/\bshortlisted\b/.test(low)) out.stage = 'shortlist';
    else if (/\bpassed|rejected\b/.test(low)) out.stage = 'pass';
    else if (/\bask first\b/.test(low)) out.stage = 'ask';
    else if (/\b(new|unreviewed|not reviewed)\b/.test(low)) out.stage = 'new';
    if (/\binterview(ed)?\b/.test(low)) out.interviewed = true;

    var min = /\b(?:above|over|at least|more than|>=?)\s*(\d{2,3})\s*%?/.exec(low);
    if (min) out.minScore = Math.min(100, parseInt(min[1], 10));

    PLACES.forEach(function (pl) { if (!out.location && new RegExp('\\b' + pl + '\\b').test(low)) out.location = pl; });

    var sk = /\b(?:know|knows|knowing|with|using|skilled in|skills? in|experience (?:in|with)|good at|familiar with|proficient in)\s+([a-z0-9#+.,/&\- ]+)/.exec(low);
    if (sk) {
      sk[1].split(/,|\band\b|\bor\b|\//).forEach(function (w) {
        w = w.replace(/\b(in|at|from|for|who|that)\b.*$/, '').trim();
        var words = w.split(/\s+/).filter(function (x) { return x && !FILLER.test(x); });
        if (words.length && words.join(' ').length > 1) out.skills.push(words.join(' '));
      });
      out.skills = out.skills.filter(function (x) { return PLACES.indexOf(x) < 0 && !/^\d+$/.test(x); }).slice(0, 5);
    }

    var best = null, bestScore = 0;
    (jobs || []).forEach(function (j) {
      var toks = String(j.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (t) { return t.length > 3; });
      var hit = toks.filter(function (t) { return low.indexOf(t) >= 0; }).length;
      if (hit > bestScore) { best = j; bestScore = hit; }
    });
    if (best) out.jobId = best.id;
    return out;
  }

  return {
    parseCv: parseCv,
    experienceYears: experienceYears,
    cvWithProfile: cvWithProfile,
    percentile: percentile,
    parseIntent: parseIntent,
    checkRequirement: checkRequirement,
    demoScreen: demoScreen,
    score: score,
    suggestion: suggestion,
    coverage: coverage,
    extractRequirements: extractRequirements,
    guessName: guessName,
    toCsv: toCsv,
    weightOf: weightOf,
    normalizePhone: normalizePhone,
    renderTemplate: renderTemplate,
    buildWhatsAppLink: buildWhatsAppLink,
    buildTelLink: buildTelLink,
    buildMailtoLink: buildMailtoLink,
    extractContacts: extractContacts
  };
});
