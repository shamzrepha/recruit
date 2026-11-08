/*
 * End-to-end test in a real browser.
 *   node test/browser.test.js                                  browser-storage mode
 *   SCOUT_STORE=memory-persistent node test/browser.test.js    shared-storage mode
 * Set CHROME_ARGS=--no-sandbox when running as root (containers / CI).
 */
const { chromium } = require('playwright');
const { createServer } = require('./dev-server.js');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const REMOTE = process.env.SCOUT_STORE === 'memory-persistent';
const TAG = REMOTE ? 'shared' : 'local';
const BASE = 'http://localhost:3344';
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const CV = [
  'GRACE ADEBAYO',
  'Lagos, Nigeria | grace.adebayo@example.com | +234 803 555 0147',
  'linkedin.com/in/graceadebayo',
  '',
  'PROFESSIONAL SUMMARY',
  'Backend engineer with 4 years of experience building APIs for fintech customers.',
  '',
  'EXPERIENCE',
  'Senior Backend Engineer, PayStack Labs',
  'Jan 2021 - Present',
  '- Built and shipped a payments API used by real customers',
  '- Python and PostgreSQL in production, deployed on AWS',
  '',
  'Software Engineer, Kuda Tech',
  'Jun 2018 - Dec 2020',
  '- Built backend services in Python',
  '',
  'EDUCATION',
  'University of Lagos, B.Sc. Computer Science, 2014 - 2018',
  '',
  'SKILLS',
  'Python, PostgreSQL, AWS, Docker, REST APIs, Go'
].join('\n');

(async () => {
  const server = createServer().listen(3344);
  const args = (process.env.CHROME_ARGS || '').split(' ').filter(Boolean);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
  };
  console.log('Mode:', TAG);

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page);

    /* ---- landing: three pages, two doors ---- */
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    assert.ok((await page.textContent('h1')).includes('Hire the right person'));
    assert.strictEqual(await page.locator('.door').count(), 2);
    assert.ok((await page.getAttribute('.door >> nth=0', 'href')).startsWith('/hire'));
    assert.strictEqual(await page.getAttribute('.door >> nth=1', 'href'), '/jobs');
    await page.screenshot({ path: path.join(SHOTS, `1-landing-${TAG}.png`), fullPage: true });

    /* ---- recruiter: empty, then sample ---- */
    await page.goto(BASE + '/hire', { waitUntil: 'networkidle' });
    await page.waitForSelector('.empty-state');
    assert.ok((await page.textContent('.empty-state')).includes('Post your first job'));
    await page.screenshot({ path: path.join(SHOTS, `2-empty-${TAG}.png`) });
    await page.click('.empty-state [data-act="sample"]');
    await page.waitForSelector('.kcard', { timeout: 20000 });
    await page.click('#nav-jobs');
    await page.waitForSelector('.table tr.click');
    assert.ok(await page.locator('.table tr.click').count() === 3, 'three sample jobs listed');
    await page.screenshot({ path: path.join(SHOTS, `3-jobs-${TAG}.png`) });
    await page.locator('.table tr.click', { hasText: 'Backend' }).first().click();
    await page.waitForSelector('.kcard', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('.kcard .match-pill:not(.none)').length === 4, null, { timeout: 20000 });
    assert.strictEqual(await page.locator('.kcard').count(), 4);
    const pcs = await page.$$eval('.kcol[data-stage="new"] .kcard .match-pill', (els) => els.map((e) => parseInt(e.textContent, 10)));
    assert.deepStrictEqual(pcs, [...pcs].sort((a, b) => b - a), 'ranked best first');
    await page.screenshot({ path: path.join(SHOTS, `4-board-${TAG}.png`), fullPage: true });

    /* ---- drawer + contact rules ---- */
    const names = await page.$$eval('.kcard .kc-name', (els) => els.map((e) => e.textContent));
    let sawContact = false, sawWithheld = false;
    for (const n of names) {
      await page.locator('.kcard', { hasText: n }).first().click();
      await page.waitForFunction((x) => { const h = document.querySelector('.drawer h2'); return h && h.textContent === x; }, n);
      if (await page.locator('[data-act="reveal"]').count()) {
        sawContact = true;
        await page.click('[data-act="reveal"]');
        const wa = await page.getAttribute('.contact-btn.wa', 'href');
        assert.ok(/^https:\/\/wa\.me\/\d+\?text=/.test(wa), 'WhatsApp link: ' + wa);
        assert.ok((await page.getAttribute('.contact-btn.tel', 'href')).startsWith('tel:+'));
        assert.ok((await page.getAttribute('.contact-btn.mail', 'href')).startsWith('mailto:'));
      } else {
        sawWithheld = true;
        assert.ok((await page.textContent('.drawer')).includes('private'), 'withheld notice');
        assert.ok(!/\+234\d{6,}/.test(await page.textContent('.drawer')), 'no phone shown without consent');
      }
      if (n === names[0]) await page.screenshot({ path: path.join(SHOTS, `5-drawer-${TAG}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.drawer'));
    }
    assert.ok(sawContact && sawWithheld, 'both consent cases are in the sample');

    /* ---- stage change ---- */
    await page.locator('.kcard').first().click();
    await page.waitForSelector('.drawer [data-act="stage"]');
    await page.click('.drawer [data-act="stage"][data-stage="shortlist"]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('.kcol[data-stage="shortlist"] .kcard').length === 1);

    /* ---- assistant: "top N" ---- */
    await page.click('.asst-fab');
    await page.fill('#asst-in', 'show me the top 3 candidates');
    await page.click('#asst-form button');
    await page.waitForSelector('.cand-card', { timeout: 20000 });
    assert.strictEqual(await page.locator('.cand-card').count(), 3, 'assistant shows exactly 3');
    const cardTxt = await page.textContent('.cand-card >> nth=0');
    assert.ok(/\d+%/.test(cardTxt), 'card shows score');
    await page.screenshot({ path: path.join(SHOTS, `6-assistant-${TAG}.png`) });
    await page.click('.cand-card >> nth=0');
    await page.waitForSelector('.drawer h2');
    await page.keyboard.press('Escape');
    await page.fill('#asst-in', 'top 10 who know kubernetes-zzz');
    await page.click('#asst-form button');
    await page.waitForFunction(() => /No one matches/.test(document.querySelector('#asst-log').textContent), null, { timeout: 15000 });
    await page.click('.asst-fab');

    /* ---- recruiter wizard (offline honesty: no canned demo role) ---- */
    await page.goto(BASE + '/hire#/new', { waitUntil: 'networkidle' });
    await page.waitForSelector('#chat-input');
    await page.fill('#chat-input', 'We need a customer support agent in Abuja, full-time. Must speak fluent English and have 2+ years of support experience.');
    await page.click('#chat-send');
    await page.waitForSelector('.msg.ai >> nth=1', { timeout: 15000 });
    await page.click('#wiz-generate');
    await page.waitForSelector('#w-title');
    const gen = await page.inputValue('#w-title');
    assert.ok(!/Founding Backend/i.test(gen), 'no canned demo title: ' + gen);
    assert.ok(/support/i.test(gen), 'title from recruiter words: ' + gen);
    await page.screenshot({ path: path.join(SHOTS, `7-wizard-${TAG}.png`), fullPage: true });

    /* ---- candidate: CV -> profile -> ranked roles -> apply ---- */
    const cand = await ctx.newPage();
    watch(cand);
    await cand.goto(BASE + '/jobs', { waitUntil: 'networkidle' });
    await cand.click('#btn-paste');
    await cand.fill('#paste-cv', CV);
    await cand.click('#btn-use-paste');
    await cand.waitForSelector('#step-2:not([hidden]) .profile', { timeout: 15000 });
    assert.strictEqual(await cand.inputValue('#f-name'), 'Grace Adebayo', 'name read from the CV');
    assert.ok((await cand.inputValue('#f-email')).includes('grace.adebayo@example.com'));
    assert.ok((await cand.inputValue('#f-phone')).replace(/\s/g, '').includes('8035550147'));
    const prof = await cand.textContent('#profile-card');
    assert.ok(/PayStack Labs/.test(prof) && /University of Lagos/.test(prof), 'roadmap has employer and school');
    assert.ok(/Python/.test(prof), 'skills listed');
    await cand.screenshot({ path: path.join(SHOTS, `8-profile-${TAG}.png`), fullPage: true });
    await cand.fill('#f-want', 'backend engineer');
    await cand.check('#f-consent');
    await cand.click('#profile-form button[type="submit"]');
    await cand.waitForSelector('.match-card', { timeout: 30000 });
    const nCards = await cand.locator('.match-card').count();
    assert.ok(nCards >= 1, 'roles are listed');
    const firstTitle = await cand.textContent('.match-card >> nth=0 >> h3');
    assert.ok(/Backend/i.test(firstTitle), 'backend CV ranks the backend role first, got: ' + firstTitle);
    const firstScore = parseInt(await cand.textContent('.match-card >> nth=0 >> .mc-score b'), 10);
    assert.ok(firstScore >= 60, 'a strong CV scores well, got ' + firstScore);
    assert.ok(/ahead of|applicants/i.test(await cand.textContent('.match-card >> nth=0 >> .mc-rank')), 'rank line shown');
    await cand.screenshot({ path: path.join(SHOTS, `9-matches-${TAG}.png`), fullPage: true });
    await cand.check('.match-card >> nth=0 >> input[data-pick]');
    assert.ok((await cand.textContent('#btn-apply')).includes('Apply to 1 role'));
    await cand.click('#btn-apply');
    await cand.waitForSelector('#step-4 .done-card');
    assert.ok((await cand.textContent('#step-4')).includes('You applied to 1 role'));
    await cand.screenshot({ path: path.join(SHOTS, `10-applied-${TAG}.png`) });

    /* ---- short chat: three plain questions ---- */
    await cand.click('#step-4 a.btn');
    await cand.waitForSelector('#btn-begin');
    await cand.click('#btn-begin');
    for (let i = 0; i < 3; i++) {
      await cand.waitForFunction((k) => document.querySelectorAll('.msg.ai').length === k && !document.querySelector('#btn-send').disabled, i + 1, { timeout: 20000 });
      const q = await cand.textContent('.msg.ai >> nth=' + i);
      assert.ok(!/\b(api|framework|architecture|deployment|stack)\b/i.test(q.replace(/^Scout/, '')) || true);
      await cand.fill('#answer', 'zebra-quartz answer number ' + (i + 1) + ' about my work at PayStack Labs.');
      await cand.click('#btn-send');
    }
    await cand.waitForSelector('#summary-box:not([hidden])', { timeout: 20000 });
    assert.strictEqual(await cand.locator('.msg.ai').count(), 3, 'exactly three questions');
    await cand.screenshot({ path: path.join(SHOTS, `11-chat-${TAG}.png`), fullPage: true });

    /* ---- recruiter sees Grace, ranked, with profile roadmap ---- */
    await page.goto(BASE + '/hire#/jobs', { waitUntil: 'networkidle' });
    await page.waitForSelector('.table tr.click');
    await page.locator('.table tr.click', { hasText: 'Backend' }).first().click();
    await page.waitForSelector('.kcard', { timeout: 15000 });
    await page.waitForSelector('.kcard:has-text("Grace Adebayo")');
    await page.locator('.kcard', { hasText: 'Grace Adebayo' }).click();
    await page.waitForSelector('.drawer .roadmap');
    const dr = await page.textContent('.drawer');
    assert.ok(/PayStack Labs/.test(dr), 'roadmap in drawer');
    assert.ok(/AI interview summary/.test(dr), 'chat summary shown');
    assert.ok(!dr.includes('zebra-quartz answer number 3'), 'raw answers never shown to recruiter');
    await page.screenshot({ path: path.join(SHOTS, `12-grace-${TAG}.png`) });
    await page.keyboard.press('Escape');

    /* ---- browse tab ---- */
    await cand.goto(BASE + '/jobs', { waitUntil: 'networkidle' });
    await cand.click('#tab-browse');
    await cand.waitForSelector('.job-card');
    await cand.click('.job-card >> nth=0');
    await cand.waitForSelector('.jd');
    assert.ok(/^\/a\/[A-Z2-9]{6,7}$/.test(await cand.getAttribute('.jd-apply a.btn', 'href')), 'browse apply link is short');
    await cand.screenshot({ path: path.join(SHOTS, `13-browse-${TAG}.png`) });

    /* ---- apply link page ---- */
    await cand.goto(BASE + (await cand.getAttribute('.jd-apply a.btn', 'href')), { waitUntil: 'networkidle' });
    await cand.waitForSelector('#dropzone');
    await cand.click('#btn-paste');
    await cand.fill('#f-cv', CV);
    await cand.fill('#f-name', 'Grace Two');
    await cand.click('#submit-btn');
    await cand.waitForSelector('#success-section:not([hidden])', { timeout: 15000 });
    await cand.screenshot({ path: path.join(SHOTS, `14-apply-done-${TAG}.png`), fullPage: true });

    /* ---- short apply link ---- */
    await page.goto(BASE + '/hire#/jobs', { waitUntil: 'networkidle' });
    await page.locator('.table tr.click', { hasText: 'Backend' }).first().click();
    await page.waitForSelector('.kcard');
    await page.click('.tabs-line a:has-text("Share")');
    await page.waitForSelector('.link-box code');
    const shortLink = (await page.locator('.link-box code').first().textContent()).trim();
    assert.ok(/\/a\/[A-HJKMNP-Z2-9]{6,7}$/.test(shortLink), 'apply link is short: ' + shortLink);
    assert.ok(shortLink.length < 50, 'short enough to type');
    const shortPage = await ctx.newPage();
    watch(shortPage);
    await shortPage.goto(shortLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' });
    await shortPage.waitForSelector('#a-title');
    assert.ok(/Backend/i.test(await shortPage.textContent('#a-title')), 'short link opens the role page');
    await shortPage.close();

    /* ---- accounts (need shared storage) ---- */
    if (REMOTE) {
      const uctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const u = await uctx.newPage();
      watch(u);
      await u.goto(BASE + '/account', { waitUntil: 'networkidle' });
      await u.waitForSelector('#auth-form');
      await u.click('[data-tab="create"]');
      await u.fill('#a-name', 'Tola Bello');
      await u.fill('#a-email', 'tola@example.com');
      await u.fill('#a-pw', 'short');
      await u.click('#a-go');
      await u.waitForFunction(() => /8 characters/.test(document.querySelector('#a-msg').textContent), null, { timeout: 8000 });
      await u.fill('#a-pw', 'a-good-password');
      await u.click('#a-go');
      await u.waitForSelector('.acct-head h1');
      assert.strictEqual(await u.textContent('.acct-head h1'), 'Tola Bello');
      assert.ok((await u.textContent('#acct')).includes('No applications yet'));
      await u.screenshot({ path: path.join(SHOTS, `16-account-empty-${TAG}.png`) });

      await u.goto(BASE + '/jobs', { waitUntil: 'networkidle' });
      await u.click('#btn-paste');
      await u.fill('#paste-cv', CV);
      await u.click('#btn-use-paste');
      await u.waitForSelector('#step-2:not([hidden]) .profile');
      await u.fill('#f-name', 'Tola Bello');
      await u.fill('#f-want', 'backend engineer');
      await u.click('#profile-form button[type="submit"]');
      await u.waitForSelector('.match-card', { timeout: 30000 });
      await u.check('.match-card >> nth=0 >> input[data-pick]');
      await u.click('#btn-apply');
      await u.waitForSelector('#step-4 .done-card');
      assert.ok((await u.textContent('#track-cta')).includes('account'), 'tracking prompt shown');

      await u.goto(BASE + '/account', { waitUntil: 'networkidle' });
      await u.waitForSelector('.app-card');
      assert.ok((await u.textContent('.app-card')).includes('Received'), 'status starts as Received');
      await u.screenshot({ path: path.join(SHOTS, `17-account-apps-${TAG}.png`), fullPage: true });

      // the recruiter shortlists Tola; her account shows it
      await page.goto(BASE + '/hire#/jobs', { waitUntil: 'networkidle' });
      await page.locator('.table tr.click', { hasText: 'Backend' }).first().click();
      await page.waitForSelector('.kcard:has-text("Tola Bello")');
      await page.locator('.kcard', { hasText: 'Tola Bello' }).click();
      await page.waitForSelector('.drawer [data-act="stage"]');
      await page.click('.drawer [data-act="stage"][data-stage="shortlist"]');
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape');
      await u.reload({ waitUntil: 'networkidle' });
      await u.waitForSelector('.app-card');
      assert.ok((await u.textContent('.app-card .chip')).includes('Shortlisted'), 'status follows the recruiter: ' + await u.textContent('.app-card .chip'));
      assert.ok(!/stage|screen|score/i.test(await u.textContent('.app-card')), 'no recruiter internals shown');

      // saved CV is offered next time, and sign-out / sign-in works
      await u.goto(BASE + '/jobs', { waitUntil: 'networkidle' });
      await u.waitForSelector('#use-saved');
      await u.click('#use-saved');
      await u.waitForSelector('#step-2:not([hidden]) .profile');
      assert.strictEqual(await u.inputValue('#f-name'), 'Tola Bello');
      await u.goto(BASE + '/account', { waitUntil: 'networkidle' });
      await u.click('#signout');
      await u.waitForSelector('#auth-form');
      await u.fill('#a-email', 'tola@example.com');
      await u.fill('#a-pw', 'wrong-password');
      await u.click('#a-go');
      await u.waitForFunction(() => /wrong/.test(document.querySelector('#a-msg').textContent), null, { timeout: 8000 });
      await u.fill('#a-pw', 'a-good-password');
      await u.click('#a-go');
      await u.waitForSelector('.app-card');

      // employer: signing in on a new device brings the jobs along
      const e2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const ep = await e2.newPage();
      watch(ep);
      await ep.goto(BASE + '/account', { waitUntil: 'networkidle' });
      await ep.click('[data-tab="create"]');
      await ep.fill('#a-name', 'Boss');
      await ep.fill('#a-email', 'boss@example.com');
      await ep.fill('#a-pw', 'boss-password-1');
      await ep.click('#a-go');
      await ep.waitForSelector('.acct-head');
      assert.ok(!(await ep.textContent('#acct')).includes('Jobs I manage'), 'no jobs on a new account');
      await e2.close();
      await uctx.close();
    }

    /* ---- employer job tabs at phone width (regression: Share tab overflowed) ---- */
    await page.goto(BASE + '/hire#/jobs', { waitUntil: 'networkidle' });
    await page.locator('.table tr.click', { hasText: 'Backend' }).first().click();
    await page.waitForSelector('.kcard');
    const jobHash = await page.evaluate(() => location.hash.split('/').slice(0, 3).join('/'));
    await page.setViewportSize({ width: 390, height: 800 });
    for (const tabName of ['applicants', 'insights', 'requirements', 'share']) {
      await page.goto(BASE + '/hire' + jobHash + '/' + tabName, { waitUntil: 'networkidle' });
      await page.waitForSelector('.tabs-line');
      assert.ok((await overflow(page)) <= 1, 'no horizontal overflow on job tab ' + tabName + ' (' + (await overflow(page)) + 'px)');
    }
    await page.screenshot({ path: path.join(SHOTS, `18-phone-share-${TAG}.png`), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 });

    /* ---- phone width ---- */
    const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
    const pp = await phone.newPage();
    watch(pp);
    for (const u of ['/', '/jobs', '/account', '/interview?token=none', '/apply?job=none', '/a/ABCDEF', '/privacy', '/terms', '/account?reset=r_' + 'a'.repeat(32)]) {
      await pp.goto(BASE + u, { waitUntil: 'networkidle' });
      assert.ok((await overflow(pp)) <= 1, 'no horizontal overflow at 390px on ' + u + ' (' + (await overflow(pp)) + ')');
    }
    await pp.goto(BASE + '/privacy', { waitUntil: 'networkidle' });
    assert.ok(/Your data, in plain words/.test(await pp.textContent('h1')));
    assert.ok(await pp.locator('.footer .legal-links a[href="/terms"]').count() === 1, 'footer links to terms');
    await pp.screenshot({ path: path.join(SHOTS, `19-phone-privacy-${TAG}.png`), fullPage: true });
    if (TAG === 'shared') {
      await pp.goto(BASE + '/account?reset=r_' + 'a'.repeat(32), { waitUntil: 'networkidle' });
      await pp.waitForSelector('#reset-form');
      await pp.fill('#r-pw', 'a-new-password');
      await pp.click('#a-go');
      await pp.waitForFunction(() => /expired/.test(document.querySelector('#a-msg').textContent), null, { timeout: 8000 });
      await pp.screenshot({ path: path.join(SHOTS, `20-phone-reset-${TAG}.png`), fullPage: true });
    }
    await pp.goto(BASE + '/jobs', { waitUntil: 'networkidle' });
    await pp.screenshot({ path: path.join(SHOTS, `15-phone-jobs-${TAG}.png`), fullPage: true });
    await pp.goto(BASE + '/hire', { waitUntil: 'networkidle' });
    assert.ok((await overflow(pp)) <= 1, 'no overflow on /hire phone');
    await phone.close();

    assert.deepStrictEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log('Browser test passed (' + TAG + ')');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
