const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function generatePDF() {
  const htmlPath = path.resolve(__dirname, '../docs/interview-guide.html');
  const pdfPath = path.resolve(__dirname, '../docs/Scout_Screener_Architecture_and_Interview_Guide.pdf');

  console.log('Loading HTML source from:', htmlPath);

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();

  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  // Ensure fonts and styles are fully rendered
  await page.waitForTimeout(1000);

  console.log('Generating PDF to:', pdfPath);
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: false,
    preferCSSPageSize: true
  });

  await browser.close();

  const stats = fs.statSync(pdfPath);
  console.log(`\nPDF Generated Successfully!`);
  console.log(`Output: ${pdfPath}`);
  console.log(`Size: ${(stats.size / 1024).toFixed(1)} KB`);
}

generatePDF().catch(err => {
  console.error('PDF Generation Error:', err);
  process.exit(1);
});
