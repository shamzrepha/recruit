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
const SAMPLE_JD = require('../samples.js').JOB;

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

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
    const rec = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const page = await rec.newPage();
    watch(page);

    /* ---- landing ---- */
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    assert.ok((await page.textContent('.hero-title')).includes('The AI suggests'));
    await page.screenshot({ path: path.join(SHOTS, `1-landing-${TAG}.png`) });

    /* ---- empty recruiter center, then sample job ---- */
    await page.goto(BASE + '/hire', { waitUntil: 'networkidle' });
    await page.waitForSelector('.empty-state');
    assert.ok((await page.textContent('.empty-state')).includes('No jobs yet'));
    await page.screenshot({ path: path.join(SHOTS, `2-empty-${TAG}.png`) });

    await page.click('.empty-state [data-act="sample"]');
    await page.waitForSelector('.cand-item');
    await page.waitForFunction(() => document.querySelectorAll('.cand-item .pc:not(.none)').length === 4, null, { timeout: 15000 });
    assert.strictEqual(await page.locator('.cand-item').count(), 4, 'sample job has four applicants');
    const pcs = await page.$$eval('.cand-item .pc', (els) => els.map((e) => parseInt(e.textContent, 10)));
    assert.deepStrictEqual(pcs, [...pcs].sort((a, b) => b - a), 'ranked best first');
    assert.ok(await page.locator('.detail h2').count(), 'first applicant opens on wide screens');
    await page.screenshot({ path: path.join(SHOTS, `3-applicants-${TAG}.png`), fullPage: true });

    /* ---- contact rules ---- */
    const names = await page.$$eval('.cand-item .nm', (els) => els.map((e) => e.textContent));
    let sawContact = false, sawWithheld = false;
    for (let i = 0; i < names.length; i++) {
      await page.locator('.cand-item').nth(i).click();
      await page.waitForFunction((n) => { const h = document.querySelector('.detail h2'); return h && h.textContent === n; }, names[i]);
      if (await page.locator('[data-act="reveal"]').count()) {
        sawContact = true;
        await page.click('[data-act="reveal"]');
        const wa = await page.getAttribute('.contact-btn.wa', 'href');
        assert.ok(/^https:\/\/wa\.me\/\d+\?text=/.test(wa), 'WhatsApp link: ' + wa);
        assert.ok((await page.getAttribute('.contact-btn.tel', 'href')).startsWith('tel:+'));
        assert.ok((await page.getAttribute('.contact-btn.mail', 'href')).startsWith('mailto:'));
        if (!sawWithheld) await page.screenshot({ path: path.join(SHOTS, `4-detail-${TAG}.png`) });
      } else if (await page.locator('.contact-withheld').count()) sawWithheld = true;
    }
    assert.ok(sawContact && sawWithheld, 'one applicant shares contact, one keeps it private');

    /* ---- decision ---- */
    await page.locator('.cand-item').first().click();
    await page.click('.stage-pick [data-stage="shortlist"]');
    assert.strictEqual(await page.getAttribute('.stage-pick [data-stage="shortlist"]', 'aria-pressed'), 'true');
    await page.click('[data-act="filter"][data-f="shortlist"]');
    assert.strictEqual(await page.locator('.cand-item').count(), 1, 'filter shows only shortlisted');
    await page.click('[data-act="filter"][data-f="all"]');

    /* ---- csv ---- */
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="csv"]')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(csv.startsWith('Candidate,Stage,Match %'), 'csv has headers');
    assert.ok(!/\+234/.test(csv), 'csv contains no phone numbers by default');

    /* ---- create a job by pasting a description ---- */
    await page.goto(BASE + '/hire#/new');
    await page.click('[data-act="wiz-mode"][data-mode="paste"]');
    await page.fill('#paste-jd', SAMPLE_JD);
    await page.click('[data-act="wiz-extract"]');
    await page.waitForSelector('#w-title');
    assert.ok((await page.locator('.reqs li input').count()) >= 3, 'requirements pulled from the description');
    await page.fill('#w-title', 'Backend Engineer');
    await page.fill('#w-company', 'Test Co');
    await page.screenshot({ path: path.join(SHOTS, `5-new-job-${TAG}.png`), fullPage: true });
    await page.click('[data-act="wiz-create"]');
    await page.waitForSelector('.link-box code');
    const applyLink = await page.textContent('.link-box code');
    assert.ok(applyLink.includes('/apply?job=j_'), 'apply link: ' + applyLink);
    const privateLink = await page.locator('.link-box code').nth(1).textContent();
    await page.screenshot({ path: path.join(SHOTS, `6-share-${TAG}.png`), fullPage: true });

    /* ---- a candidate applies ---- */
    const candCtx = REMOTE ? await browser.newContext({ viewport: { width: 390, height: 844 } }) : rec;
    const cand = await candCtx.newPage();
    watch(cand);
    if (!REMOTE) await cand.setViewportSize({ width: 390, height: 844 });
    await cand.goto(applyLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' });
    await cand.waitForSelector('#a-title');
    assert.strictEqual(await cand.textContent('#a-title'), 'Backend Engineer');
    assert.ok((await overflow(cand)) <= 0, 'apply page has no sideways scroll on a phone');
    await cand.screenshot({ path: path.join(SHOTS, `7-apply-phone-${TAG}.png`), fullPage: true });
    await cand.click('#btn-paste');
    await cand.fill('#f-name', 'Ngozi Test');
    await cand.fill('#f-phone', '0803 123 4567');
    await cand.fill('#f-email', 'ngozi@example.com');
    await cand.fill('#f-cv', 'Ngozi Test\nBackend engineer with 5 years of experience building APIs in Python and Go on PostgreSQL. Shipped payment services used by real customers.');
    await cand.check('#f-consent');
    await cand.screenshot({ path: path.join(SHOTS, `8-apply-form-phone-${TAG}.png`), fullPage: true });
    await cand.click('#submit-btn');
    await cand.waitForSelector('#success-section:not([hidden])');
    const interviewUrl = await cand.getAttribute('#start-interview', 'href');
    assert.ok(interviewUrl.includes('token=c_'));

    /* ---- the AI chat ---- */
    await cand.goto(interviewUrl, { waitUntil: 'networkidle' });
    await cand.waitForSelector('#btn-begin');
    await cand.click('#btn-begin');
    for (let q = 0; q < 5; q++) {
      await cand.waitForFunction((n) => document.querySelectorAll('.msg.ai').length === n && !document.getElementById('btn-send').disabled, q + 1);
      if (q === 2) await cand.screenshot({ path: path.join(SHOTS, `9-chat-phone-${TAG}.png`) });
      if (q === 3) { await cand.click('#btn-skip'); continue; }
      await cand.fill('#answer', 'I built and ran the payments API in Python, handling about 40 requests a second on PostgreSQL, zebra-quartz.');
      await cand.click('#btn-send');
    }
    await cand.waitForSelector('#summary-box:not([hidden])', { timeout: 15000 });
    assert.ok((await overflow(cand)) <= 0, 'chat page has no sideways scroll');
    await cand.screenshot({ path: path.join(SHOTS, `10-summary-phone-${TAG}.png`), fullPage: true });

    /* ---- recruiter sees the applicant ---- */
    await page.goto(BASE + '/hire#/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.job-row');
    await page.locator('.job-row', { hasText: 'Backend Engineer' }).filter({ hasNotText: 'Founding' }).first().click();
    await page.waitForSelector('.cand-item');
    assert.ok((await page.textContent('.cand-list')).includes('Ngozi Test'), 'applicant reaches the recruiter');
    await page.click('[data-act="screen"]');
    await page.waitForFunction(() => document.querySelector('.cand-item .pc') && !document.querySelector('.cand-item .pc.none'));
    await page.locator('.cand-item', { hasText: 'Ngozi Test' }).click();
    await page.waitForSelector('.interview-box');
    const box = await page.textContent('.interview-box');
    assert.ok(box.includes('Confidence'), 'interview summary shown');
    assert.ok(!(await page.content()).includes('zebra-quartz'), 'raw answers are not shown to the recruiter');
    await page.click('[data-act="reveal"]');
    assert.ok((await page.textContent('.contact-info')).includes('+2348031234567'), 'consented phone is normalised and shown');

    /* ---- private link on another device (shared storage only) ---- */
    if (REMOTE) {
      const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const p2 = await other.newPage(); watch(p2);
      await p2.goto(privateLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' });
      await p2.waitForSelector('.cand-item');
      assert.ok((await p2.textContent('.cand-list')).includes('Ngozi Test'), 'private link opens the job elsewhere');
      const p3 = await (await browser.newContext()).newPage();
      await p3.goto(BASE + '/hire#/job/' + applyLink.match(/job=(j_[0-9a-f]+)/)[1], { waitUntil: 'networkidle' });
      await p3.waitForSelector('.empty-state');
      assert.ok((await p3.textContent('.empty-state')).includes('not linked'), 'no key, no applicants');
    }

    /* ---- the same recruiter views on a phone ---- */
    const ph = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    watch(ph);
    if (REMOTE) {
      await ph.goto(privateLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' });
      await ph.waitForSelector('.cand-item');
      assert.ok((await overflow(ph)) <= 0, 'recruiter job page has no sideways scroll on a phone');
      await ph.screenshot({ path: path.join(SHOTS, `11-recruiter-phone-${TAG}.png`), fullPage: true });
      await ph.locator('.cand-item').first().click();
      await ph.waitForSelector('.detail h2');
      assert.ok((await overflow(ph)) <= 0, 'applicant detail has no sideways scroll on a phone');
      await ph.screenshot({ path: path.join(SHOTS, `12-detail-phone-${TAG}.png`), fullPage: true });
    } else {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(BASE + '/hire#/job/' + applyLink.match(/job=(j_[0-9a-f]+)/)[1] + '/applicants');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.cand-item');
      assert.ok((await overflow(page)) <= 0, 'recruiter job page has no sideways scroll on a phone');
      await page.screenshot({ path: path.join(SHOTS, `11-recruiter-phone-${TAG}.png`), fullPage: true });
      await page.locator('.cand-item').first().click();
      await page.waitForSelector('.detail h2');
      assert.ok((await overflow(page)) <= 0, 'applicant detail has no sideways scroll on a phone');
      await page.screenshot({ path: path.join(SHOTS, `12-detail-phone-${TAG}.png`), fullPage: true });
    }

    assert.deepStrictEqual(errors, [], 'no uncaught page errors: ' + errors.join(' | '));
    console.log('All browser tests passed (' + TAG + ').');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
