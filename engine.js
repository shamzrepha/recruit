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

  return {
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
