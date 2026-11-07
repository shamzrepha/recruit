const { chromium } = require('playwright');
const { createServer } = require('./dev-server.js');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

(async () => {
  console.log('Starting local test server on port 3344...');
  const server = createServer().listen(3344);

  let browser;
  try {
    console.log('Launching Chrome browser for visual & flow testing...');
    browser = await chromium.launch({ channel: 'chrome', headless: true });

    /* =========================================================================
       FLOW 1: Mobile Screen Test (Phone Viewport: 390 x 844, iPhone 13)
       ========================================================================= */
    console.log('\n--- Running Flow 1: Candidate Flow on Mobile (390x844) ---');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const mobilePage = await mobileContext.newPage();
    mobilePage.on('dialog', async d => { await d.accept(); });

    // 1. Visit /apply
    await mobilePage.goto('http://localhost:3344/apply', { waitUntil: 'networkidle' });
    assert.strictEqual(await mobilePage.title(), 'Apply for Role - Scout Screener');

    // 2. Fill in Candidate Form
    await mobilePage.fill('#f-name', 'Adaeze Okafor');
    await mobilePage.fill('#f-phone', '0803 123 4567');
    await mobilePage.waitForTimeout(300);

    const feedbackText = await mobilePage.textContent('#phone-feedback');
    assert.ok(feedbackText.includes('+2348031234567'), 'Phone validation feedback is live and shows E.164');

    await mobilePage.fill('#f-email', 'adaeze@example.com');
    await mobilePage.fill('#f-location', 'Lagos, Nigeria');
    await mobilePage.fill('#f-linkedin', 'https://linkedin.com/in/adaeze-okafor');
    await mobilePage.fill('#f-cv', [
      'Adaeze Okafor',
      'Senior Backend Engineer, 5 years experience',
      'Built payment APIs in Python (FastAPI) and Go on PostgreSQL database.',
      'Shipped production APIs used by over 40 merchants with 2M daily requests.',
      'Infrastructure on AWS with Docker.'
    ].join('\n'));

    // Check consent for recruiters to see contact details
    await mobilePage.check('#f-consent');
    assert.strictEqual(await mobilePage.isChecked('#f-consent'), true);

    await mobilePage.screenshot({ path: path.join(SCREENSHOT_DIR, '1-mobile-apply-form.png'), fullPage: true });
    console.log('Saved screenshot: 1-mobile-apply-form.png');

    // 3. Submit application
    await mobilePage.click('#submit-btn');
    await mobilePage.waitForSelector('#success-section:not([hidden])', { timeout: 5000 });

    const appTokenUrl = await mobilePage.textContent('#cand-link');
    assert.ok(appTokenUrl.includes('/interview?token='), 'Generates unique candidate interview URL');
    console.log('Generated Candidate Token Link:', appTokenUrl);

    await mobilePage.screenshot({ path: path.join(SCREENSHOT_DIR, '2-mobile-apply-success.png') });
    console.log('Saved screenshot: 2-mobile-apply-success.png');

    // 4. Click Start Short AI Interview
    await mobilePage.click('#start-interview-btn');
    await mobilePage.waitForURL(/\/interview\?token=/, { timeout: 5000 });

    // 5. Verify Transparency Notice
    const noticeText = await mobilePage.textContent('.transparency-notice');
    assert.ok(noticeText.includes('Notice: You are speaking with an AI'), 'Clear AI disclosure present');
    assert.ok(noticeText.includes('Purpose'), 'Clear purpose explanation present');
    assert.ok(noticeText.includes('Only the human recruiter'), 'Audience clarity present');

    // 6. Wait for Question 1
    await mobilePage.waitForSelector('.chat-bubble.ai', { timeout: 8000 });
    await mobilePage.fill('#answer-input', 'I designed and deployed the core payment processing pipeline handling 40k transactions/sec using Python FastAPI and PostgreSQL.');
    await mobilePage.screenshot({ path: path.join(SCREENSHOT_DIR, '3-mobile-interview-chat.png') });
    console.log('Saved screenshot: 3-mobile-interview-chat.png');

    // Stop and finish interview to generate summary
    await mobilePage.evaluate(() => { window.confirm = () => true; });
    await mobilePage.click('#btn-stop');

    // 7. Verify Summary Generation
    await mobilePage.waitForSelector('#summary-section:not([hidden])', { timeout: 10000 });
    const summaryText = await mobilePage.textContent('#summary-body');
    assert.ok(summaryText.length > 20, 'Recruiter summary body generated');

    const confidenceBadge = await mobilePage.textContent('#confidence-badge');
    assert.ok(/Confidence:\s*(High|Medium|Low)/i.test(confidenceBadge), 'Confidence badge rendered');

    await mobilePage.screenshot({ path: path.join(SCREENSHOT_DIR, '4-mobile-interview-summary.png'), fullPage: true });
    console.log('Saved screenshot: 4-mobile-interview-summary.png');

    await mobileContext.close();


    /* =========================================================================
       FLOW 2: Desktop Screen Test (Laptop Viewport: 1280 x 800)
       ========================================================================= */
    console.log('\n--- Running Flow 2: Recruiter Flow on Laptop (1280x800) ---');
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const desktopPage = await desktopContext.newPage();
    desktopPage.on('dialog', async d => { await d.accept(); });

    // 1. Visit Recruiter Dashboard / Screener
    await desktopPage.goto('http://localhost:3344/', { waitUntil: 'networkidle' });

    // 2. Load Sample Role & Candidates
    await desktopPage.click('#sample');
    await desktopPage.waitForTimeout(300);

    const jdText = await desktopPage.inputValue('#jd');
    assert.ok(jdText.includes('Founding Backend Engineer'), 'Job description loaded');

    // Check recruiter settings
    await desktopPage.click('#recruiter-box summary');
    await desktopPage.waitForTimeout(200);
    const recName = await desktopPage.inputValue('#rec-name');
    assert.strictEqual(recName, 'Tolu Adebayo');

    await desktopPage.screenshot({ path: path.join(SCREENSHOT_DIR, '5-laptop-recruiter-setup.png'), fullPage: true });
    console.log('Saved screenshot: 5-laptop-recruiter-setup.png');

    // 3. Screen Candidates
    console.log('Clicking #run...');
    await desktopPage.click('#run');
    console.log('Waiting for #results...');
    await desktopPage.waitForSelector('#results:not([hidden])', { timeout: 10000 });
    console.log('#results is unhidden!');

    const tallyText = await desktopPage.textContent('#tally');
    console.log('Tally:', tallyText);
    assert.ok(tallyText.includes('shortlisted'), 'Results summary tally calculated');

    // 4. Open Adaeze Okafor details
    console.log('Opening details...');
    await desktopPage.evaluate(() => {
      const firstDetails = document.querySelector('details.person');
      if (firstDetails) firstDetails.open = true;
    });
    await desktopPage.waitForTimeout(300);

    // 5. Contact buttons test
    console.log('Waiting for toggle contact button...');
    const toggleContactBtn = await desktopPage.waitForSelector('button[data-act="toggle-contact"]', { state: 'visible' });
    console.log('Toggle contact button found!');
    assert.strictEqual(await toggleContactBtn.textContent(), 'Show contact', 'Contact is hidden by default');

    // Click Show Contact
    await toggleContactBtn.click();
    await desktopPage.waitForSelector('.contact-panel');

    const waLink = await desktopPage.getAttribute('.contact-btn.wa', 'href');
    assert.ok(waLink.startsWith('https://wa.me/2348031234567?text='), 'WhatsApp link correctly formatted with wa.me and no plus in number');
    assert.ok(waLink.includes(encodeURIComponent('Adaeze')), 'WhatsApp link includes candidate first name in template');
    assert.ok(waLink.includes(encodeURIComponent('Tolu Adebayo')), 'WhatsApp link includes recruiter name in template');

    const telLink = await desktopPage.getAttribute('.contact-btn.tel', 'href');
    assert.strictEqual(telLink, 'tel:+2348031234567', 'Tel link correctly formatted with E.164');

    const mailLink = await desktopPage.getAttribute('.contact-btn.mail', 'href');
    assert.ok(mailLink.startsWith('mailto:adaeze.okafor@example.com?'), 'Email link correctly formatted');

    // 6. Test candidate withholding consent (Chiamaka Eze)
    const personElements = await desktopPage.$$('details.person');
    let foundWithheld = false;
    for (const p of personElements) {
      const summaryText = await p.textContent();
      if (summaryText.includes('Chiamaka Eze')) {
        await p.evaluate(el => { el.open = true; });
        const withheld = await p.$('.contact-withheld');
        if (withheld) {
          const txt = await withheld.textContent();
          assert.ok(txt.includes('withheld by candidate'), 'Withheld notice shown when consent is false');
          foundWithheld = true;
        }
      }
    }
    assert.ok(foundWithheld, 'Verified non-consenting candidate has contact withheld');

    await desktopPage.screenshot({ path: path.join(SCREENSHOT_DIR, '6-laptop-recruiter-results.png'), fullPage: true });
    console.log('Saved screenshot: 6-laptop-recruiter-results.png');

    await desktopContext.close();

    console.log('\nAll browser visual and functional tests completed successfully!');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(err => {
  console.error('Browser Test Error:', err);
  process.exit(1);
});
