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
       PAGE 1: LANDING PAGE (Desktop 1280 x 800)
       ========================================================================= */
    console.log('\n--- Testing Page 1: Landing Page (The Two Gateways) ---');
    const landingContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const landingPage = await landingContext.newPage();
    landingPage.on('dialog', async d => { await d.accept(); });

    await landingPage.goto('http://localhost:3344/', { waitUntil: 'networkidle' });
    assert.strictEqual(await landingPage.title(), 'Scout Screener - AI-Powered Talent Sourcing for Early-Stage Startups');

    const heroTitle = await landingPage.textContent('.hero-title');
    assert.ok(heroTitle.includes('The AI suggests'), 'Landing page displays hero title');

    // Verify the two gateway doors
    const hireCardText = await landingPage.textContent('.gateway-card.hire-card');
    assert.ok(hireCardText.includes('I am looking to hire'), 'Has Recruiter gateway card');

    const applyCardText = await landingPage.textContent('.gateway-card.apply-card');
    assert.ok(applyCardText.includes('I am looking to be employed'), 'Has Candidate gateway card');

    await landingPage.screenshot({ path: path.join(SCREENSHOT_DIR, '0-landing-page.png'), fullPage: true });
    console.log('Saved screenshot: 0-landing-page.png');
    await landingContext.close();


    /* =========================================================================
       PAGE 2: RECRUITER & FOUNDER PORTAL (/hire)
       ========================================================================= */
    console.log('\n--- Testing Page 2: Recruiter Portal with AI Intake Chatbot (/hire) ---');
    const recruiterContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const recruiterPage = await recruiterContext.newPage();
    recruiterPage.on('dialog', async d => { await d.accept(); });

    await recruiterPage.goto('http://localhost:3344/hire', { waitUntil: 'networkidle' });
    assert.ok((await recruiterPage.title()).includes('I am Looking to Hire'), 'Page title is correct');

    // Tab 1: AI Role Intake Chatbot
    await recruiterPage.waitForSelector('#recruiter-chat-messages .chat-bubble.ai');
    const firstAiMsg = await recruiterPage.textContent('#recruiter-chat-messages .chat-bubble.ai');
    assert.ok(firstAiMsg.includes('AI Sourcing Partner'), 'AI assistant opens the recruiter interview');

    // Load example brief
    await recruiterPage.click('#btn-quick-sample-chat');
    await recruiterPage.waitForTimeout(300);

    await recruiterPage.screenshot({ path: path.join(SCREENSHOT_DIR, '5-recruiter-intake-chat.png'), fullPage: true });
    console.log('Saved screenshot: 5-recruiter-intake-chat.png');

    // Click "Generate Role & Screening Requirements"
    await recruiterPage.click('#btn-generate-role');
    await recruiterPage.waitForTimeout(600);

    // Verify Tab 2 (Screening & Candidates) is automatically activated
    assert.strictEqual(await recruiterPage.getAttribute('#section-screen', 'hidden'), null, 'Screening tab is active');
    const reqList = await recruiterPage.$$('.reqs li');
    assert.ok(reqList.length >= 3, 'Role requirements successfully extracted from intake chat');

    // Load sample candidates to screen
    await recruiterPage.click('#sample');
    await recruiterPage.waitForTimeout(300);

    // Run AI Screen
    await recruiterPage.click('#run');
    await recruiterPage.waitForSelector('#results:not([hidden])', { timeout: 10000 });

    // Open first candidate details and check contact links
    await recruiterPage.evaluate(() => {
      const first = document.querySelector('details.person');
      if (first) first.open = true;
    });
    await recruiterPage.waitForTimeout(300);

    const toggleContactBtn = await recruiterPage.waitForSelector('button[data-act="toggle-contact"]', { state: 'visible' });
    await toggleContactBtn.click();
    await recruiterPage.waitForSelector('.contact-panel');

    const waLink = await recruiterPage.getAttribute('.contact-btn.wa', 'href');
    assert.ok(waLink.includes('wa.me/2348031234567'), 'WhatsApp link pre-filled with candidate number');

    await recruiterPage.screenshot({ path: path.join(SCREENSHOT_DIR, '6-laptop-recruiter-results.png'), fullPage: true });
    console.log('Saved screenshot: 6-laptop-recruiter-results.png');
    await recruiterContext.close();


    /* =========================================================================
       PAGE 3: CANDIDATE PORTAL & INTERVIEW (/apply)
       ========================================================================= */
    console.log('\n--- Testing Page 3: Candidate Portal on Mobile (390x844) ---');
    const candidateContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const candidatePage = await candidateContext.newPage();
    candidatePage.on('dialog', async d => { await d.accept(); });

    await candidatePage.goto('http://localhost:3344/apply', { waitUntil: 'networkidle' });

    // Fill application form
    await candidatePage.fill('#f-name', 'Adaeze Okafor');
    await candidatePage.fill('#f-phone', '0803 123 4567');
    await candidatePage.fill('#f-email', 'adaeze@example.com');
    await candidatePage.fill('#f-location', 'Lagos, Nigeria');
    await candidatePage.fill('#f-cv', [
      'Adaeze Okafor',
      'Senior Backend Engineer, 5 years experience',
      'Built payment APIs in Python and Go on PostgreSQL database.',
      'Shipped production APIs used by over 40 merchants with 2M daily requests.'
    ].join('\n'));

    await candidatePage.check('#f-consent');
    await candidatePage.screenshot({ path: path.join(SCREENSHOT_DIR, '1-mobile-apply-form.png'), fullPage: true });
    console.log('Saved screenshot: 1-mobile-apply-form.png');

    await candidatePage.click('#submit-btn');
    await candidatePage.waitForSelector('#success-section:not([hidden])');

    // Start AI interview
    await candidatePage.click('#start-interview-btn');
    await candidatePage.waitForURL(/\/interview\?token=/);

    await candidatePage.waitForSelector('.chat-bubble.ai');
    await candidatePage.fill('#answer-input', 'I designed and deployed the core payment processing pipeline handling 40k transactions/sec using Python FastAPI and PostgreSQL.');

    await candidatePage.click('#btn-stop');
    await candidatePage.waitForSelector('#summary-section:not([hidden])', { timeout: 10000 });

    await candidatePage.screenshot({ path: path.join(SCREENSHOT_DIR, '4-mobile-interview-summary.png'), fullPage: true });
    console.log('Saved screenshot: 4-mobile-interview-summary.png');
    await candidateContext.close();

    console.log('\nAll 3 main pages tested and verified successfully!');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(err => {
  console.error('Browser Test Error:', err);
  process.exit(1);
});
