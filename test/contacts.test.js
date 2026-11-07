const assert = require('assert');
const E = require('../engine.js');

console.log('Running contacts and phone normalisation tests...');

// 1. Phone Normalisation - Nigerian cases
const ngCases = [
  { in: '0803 123 4567', expected: '+2348031234567', desc: 'Nigerian local spaced' },
  { in: '08031234567', expected: '+2348031234567', desc: 'Nigerian local compact' },
  { in: '+234 803 123 4567', expected: '+2348031234567', desc: 'Nigerian +234 with spaces' },
  { in: '+234-803-123-4567', expected: '+2348031234567', desc: 'Nigerian +234 with hyphens' },
  { in: '2348031234567', expected: '+2348031234567', desc: 'Nigerian 234 prefix without plus' },
  { in: '+23408031234567', expected: '+2348031234567', desc: 'Nigerian +234 with redundant leading 0' },
  { in: '0703 555 0192', expected: '+2347035550192', desc: 'Nigerian 070 prefix' },
  { in: '0909 888 7766', expected: '+2349098887766', desc: 'Nigerian 090 prefix' },
  { in: '0912 345 6789', expected: '+2349123456789', desc: 'Nigerian 091 prefix' },
  { in: '8031234567', expected: '+2348031234567', desc: 'Nigerian 10 digits without leading 0' },
  { in: '(0802) 345 6789', expected: '+2348023456789', desc: 'Nigerian with parentheses' }
];

ngCases.forEach(c => {
  const res = E.normalizePhone(c.in);
  assert.strictEqual(res.valid, true, `${c.desc} should be valid`);
  assert.strictEqual(res.e164, c.expected, `${c.desc} normalized to ${c.expected}`);
});

// 2. Phone Normalisation - International cases
const intlCases = [
  { in: '+1 415 555 2671', expected: '+14155552671', desc: 'US phone number' },
  { in: '+44 7911 123456', expected: '+447911123456', desc: 'UK mobile number' },
  { in: '+233 24 123 4567', expected: '+233241234567', desc: 'Ghana mobile number' },
  { in: '+254 712 345678', expected: '+254712345678', desc: 'Kenya mobile number' },
  { in: '00447911123456', expected: '+447911123456', desc: 'International double-zero prefix' }
];

intlCases.forEach(c => {
  const res = E.normalizePhone(c.in);
  assert.strictEqual(res.valid, true, `${c.desc} should be valid`);
  assert.strictEqual(res.e164, c.expected, `${c.desc} normalized to ${c.expected}`);
});

// 3. Bad inputs
const badCases = [
  '',
  '   ',
  null,
  undefined,
  'call me maybe',
  '0803 12', // too short
  '0123 456 7890', // invalid Nigerian prefix (012)
  '0803-abc-4567', // letters
  '+12', // international too short
  '+1234567890123456789' // international too long (>15 digits)
];

badCases.forEach(bad => {
  const res = E.normalizePhone(bad);
  assert.strictEqual(res.valid, false, `Bad input "${bad}" should be rejected`);
  assert.ok(res.error, `Bad input "${bad}" must have a clear error message`);
});

// 4. WhatsApp link builder
const waLink = E.buildWhatsAppLink('+234 803 123 4567', 'Hi {first name}! How is it going at {company}? & see + chat 🚀', {
  firstName: 'Adaeze',
  company: 'Flutterwave'
});
assert.ok(waLink.startsWith('https://wa.me/2348031234567?text='), 'WhatsApp link has wa.me and digits without plus');
assert.ok(!waLink.includes('+234'), 'wa.me must not have + in phone number');
assert.ok(waLink.includes(encodeURIComponent('Hi Adaeze! How is it going at Flutterwave? & see + chat 🚀')), 'WhatsApp link properly URL-encodes spaces, &, +, and emoji');

// 5. Tel link builder
const telLink = E.buildTelLink('0803 123 4567');
assert.strictEqual(telLink, 'tel:+2348031234567', 'Tel link formats as tel:+<E.164>');
assert.strictEqual(E.buildTelLink('invalid-number'), '', 'Tel link returns empty for invalid input');

// 6. Mailto link builder
const mailtoLink = E.buildMailtoLink('candidate@example.com', 'Interview for {role} & next steps', 'Hi Adaeze,\n\nReady for a chat? + details 🚀');
assert.ok(mailtoLink.startsWith('mailto:candidate@example.com?'), 'Mailto link begins with email');
assert.ok(mailtoLink.includes('subject=' + encodeURIComponent('Interview for {role} & next steps')), 'Subject is URL encoded with &');
assert.ok(mailtoLink.includes('body=' + encodeURIComponent('Hi Adaeze,\n\nReady for a chat? + details 🚀')), 'Body is URL encoded with newlines and emoji');
assert.strictEqual(E.buildMailtoLink('not-an-email'), '', 'Mailto returns empty for invalid email');

// 7. Noisy OCR text extraction
const noisyOcr = `
  CURRICULUM VITAE
  Chiamaka Eze
  Senior Software Engineer
  Lagos, Nigeria
  Email: chiamaka.eze [at] example.com
  Telephone: (+234) 803 987 6543
  LinkedIn: linkedin.com/in/chiamaka-eze
  GitHub: github.com/chiamaka-codes
  Portfolio: https://chiamaka.dev
  
  SUMMARY
  Over 5 years building scalable backend services.
`;

const contacts = E.extractContacts(noisyOcr);
assert.strictEqual(contacts.name, 'Chiamaka Eze', 'Extracts candidate name');
assert.strictEqual(contacts.email, 'chiamaka.eze@example.com', 'Extracts and fixes noisy OCR email');
assert.strictEqual(contacts.phone, '+2348039876543', 'Extracts and normalises phone number from OCR text');
assert.strictEqual(contacts.location, 'Lagos', 'Extracts location');
assert.strictEqual(contacts.links.linkedin, 'https://linkedin.com/in/chiamaka-eze', 'Extracts LinkedIn profile URL');
assert.strictEqual(contacts.links.github, 'https://github.com/chiamaka-codes', 'Extracts GitHub profile URL');
assert.strictEqual(contacts.links.portfolio, 'https://chiamaka.dev', 'Extracts portfolio URL');

console.log('All contacts and phone normalisation tests passed successfully!');
