# Scout Screener

Rank candidates against a role and see the evidence from each CV. **The AI suggests; a human decides.**

Built as the "something built with AI" submission for a Talent Scout Intern application to **Sourcing Sprints** (finding talent for early-stage startups).

---

## Key Features

1. **Recruiter Screener (`/`):**
   - Extract requirements from job descriptions or add them manually (**Must have** vs **Nice to have**).
   - Candidate ranking match bar with one segment per requirement:
     - **Green (`#1e9e4a`):** Stated in the CV (backed by exact quotes).
     - **Amber Stripes:** Not stated, so verify before deciding.
     - **Red (`#c8372d`):** Contradicted (e.g. experience shortfall).
   - Potential score: *"Up to X% if verified"* prevents prematurely passing on candidates with brief CVs.
   - **Outreach & Contact Buttons:**
     - Contact details are hidden by default until the recruiter clicks **Show contact**.
     - If candidate gave explicit consent: One-click native links for **WhatsApp** (`https://wa.me/<digits>?text=...`), **Call** (`tel:+<E.164>`), and **Email** (`mailto:...`).
     - Customizable recruiter outreach message template supporting `{first name}`, `{recruiter name}`, `{company}`, and `{role}`.
     - If consent was withheld: Displays a discrete `🔒 Contact details withheld by candidate` notice.
   - **CSV Export:** Includes a privacy toggle (*"Include contact details in CSV"*, unticked by default).

2. **Candidate Application Portal (`/apply`):**
   - Upload CV as a **photo, screenshot, or PDF**.
   - **Client-Side Extraction:**
     - PDFs: Text layer parsed in the browser via `pdf.js`.
     - Images: On-device OCR using `Tesseract.js` (free, private, never leaves device).
     - Optional **Groq Vision fallback** (`/api/ocr`, using `qwen/qwen3.8-27b`) with explicit candidate consent.
   - **Pre-submission Review:** Full editable form for name, phone, email, location, links (LinkedIn, GitHub), and extracted CV text to correct OCR noise (e.g., 0 vs O, 1 vs l).
   - **Nigerian & International Phone Normalization:** Accepts `0803 123 4567`, `+234 803 123 4567`, `2348031234567`, and international formats, validating and normalizing to ITU-T E.164 (`+2348031234567`).
   - **Consent Checkbox (Unticked by default):** *"Recruiters I apply to can see my contact details."*

3. **AI Verification Interview (`/interview`):**
   - 5 short questions (~5 minutes) focusing strictly on unstated items and concrete technical claims.
   - Transparent AI disclosure upfront (explaining AI identity, purpose, audience, and candidate skip/stop rights).
   - Safety guardrails: Strictly forbids questions on age, marriage, religion, health, or personal demographics.
   - **Recruiter Verification Summary (<= 120 words):** Cites verbatim candidate quotes as evidence, flags confirmed vs open requirements, suggests 3 recruiter follow-up questions, and assigns confidence (*low, medium, high*). Never gives an automated hire/reject verdict.
   - Candidate can read their summary and click **Delete My Interview Data** at any time.

4. **Storage & Access (NDPA 2023 Compliant):**
   - Each candidate receives an unguessable 24+ character token URL (`c_<random_hex>`).
   - Firestore security rules restrict candidate access to matching token and enforce 30-day lifecycle deletion.
   - Offline / local fallback storage included for instant local demos without needing cloud configuration.

---

## 90-Second Demo Script (Screen Recording)

**[00:00 - 00:20] Candidate Application & Local OCR**
1. Open mobile browser / emulator at `/apply`.
2. Drop or select a candidate CV screenshot (e.g. Adaeze Okafor).
3. Point out that text extraction runs directly inside the browser using Tesseract.js / pdf.js without uploading raw files.
4. Show live Nigerian phone validation (`0803 123 4567` auto-normalizes to `+2348031234567`).
5. Tick the consent box ("Recruiters I apply to can see my contact details") and click **Submit Application**.

**[00:20 - 00:45] AI Verification Interview**
1. Click **Start Short AI Interview** to open `/interview`.
2. Highlight the clear transparency banner ("Notice: You are speaking with an AI...").
3. Answer Question 1 ("I designed the payments microservice in Python FastAPI handling 40k TPS on PostgreSQL").
4. Tap **Stop and Finish** to generate the verification summary.
5. Highlight the recruiter summary: 120-word limit, verbatim quotes as evidence, confirmed vs open requirements, and confidence badge.

**[00:45 - 01:30] Recruiter Screening & Instant Outreach**
1. Switch to recruiter view at `/`.
2. Click **Load a sample role and candidates** (or load live applicants).
3. Click **Screen candidates**.
4. Explain the segmented match bar: Green for stated evidence, amber stripes for verify (never reject), red for contradicted.
5. Expand Adaeze Okafor. Click **Show contact**.
6. Show the generated outreach links:
   - Tap **WhatsApp**: shows `https://wa.me/2348031234567?text=...` with personalized message template filled with `{first name}`, `{recruiter name}`, and `{company}`.
7. Expand Chiamaka Eze to demonstrate privacy: `🔒 Contact details withheld by candidate` because consent was false.
8. Toggle **Include contact details in CSV** and click **Download as CSV**.
9. Wrap up: *"The AI suggests, a human decides."*

---

## Environment Variables

Configure in `.env.local` for local development or in **Vercel > Project > Settings > Environment Variables**:

| Variable | Required | Default | Description |
|---|---|---|---|
| `GROQ_API_KEY` | Optional (falls back to keyword mode) | None | Free API key from [console.groq.com](https://console.groq.com) |
| `GROQ_MODEL` | Optional | `llama-3.3-70b-versatile` | Groq text & JSON model ID |
| `GROQ_VISION_MODEL` | Optional | `qwen/qwen3.8-27b` | Groq multimodal vision model ID for OCR fallback |
| `FIREBASE_PROJECT_ID` | Optional | None | Firestore cloud storage project ID |
| `FIREBASE_CLIENT_EMAIL` | Optional | None | Firestore service account email |
| `FIREBASE_PRIVATE_KEY` | Optional | None | Firestore private key |

*Note: If no Groq or Firebase keys are supplied, the app automatically runs in local demo mode with deterministic keyword screening, local browser OCR, and local candidate storage.*

---

## Nigeria Data Protection Act 2023 (NDPA) Compliance

The application is architected to adhere strictly to NDPA 2023 principles:
1. **Explicit Consent:** Contact sharing and AI interview participation are optional, separated, and unticked by default.
2. **Purpose Limitation:** Candidate data is collected solely for role screening and candidate-recruiter outreach.
3. **Data Minimization:** Raw CV images are processed client-side and never stored permanently unless requested. Non-consenting candidates have phone/email stripped from recruiter endpoints.
4. **Storage Limitation & Right to Erasure:** Application records are bounded by a 30-day retention TTL policy. Every candidate has a one-click **Delete My Application Data** button that permanently erases their record.

---

## Testing & Verification

Run the automated test suites:

```bash
# 1. Unit & API Tests (Engine, Phone normalisation, Contacts, Mocked Groq, Prompt injection)
npm test

# 2. End-to-End Visual & Functional Browser Tests (Playwright with Chrome)
npm run test:browser
```

### Test Coverage Highlights
- **Phone Normalisation (`test/contacts.test.js`):** 11 Nigerian formats (`0803...`, `+234...`, `234...`, `070...`, `090...`, `091...`), international numbers (US, UK, Ghana, Kenya, `00` prefix), and illegal/bad inputs.
- **Link Builders:** Encoding of spaces (`%20`), `&`, `+`, newlines, and emojis in WhatsApp (`wa.me`), `tel:`, and `mailto:` URLs.
- **OCR Text Extraction:** Resilient parsing of emails, phone numbers, and profile links from noisy OCR transcriptions.
- **API Security (`test/api.test.js`):** Schema validation, quote verification and automatic downgrade of fabricated quotes, prompt injection resistance inside untrusted CV tags (`<cv>`), 429 rate limit retry, and NDPA contact redaction.
- **Browser Tests (`test/browser.test.js`):** Mobile flow (390x844) and desktop recruiter flow (1280x800) with visual screenshots saved in `test/screenshots/`.

### What Could Not Be Tested Live
- **Live Groq API Calls with a Production Key:** Tested against a mocked OpenAI-compatible Groq server response and deterministic local fallbacks. When deploying, verify your live `GROQ_API_KEY` on Vercel.
- **Live Production Firebase Instance:** Tested using the local persistence adapter and verified Firestore security rules schema (`firestore.rules`). When enabling Firestore, add your project credentials in Vercel.

---

## Deploy to GitHub and Vercel

1. Push your changes to GitHub:
   ```bash
   git add .
   git commit -m "Complete Scout Screener with Phases 1-5"
   git push origin main
   ```
2. In Vercel:
   - Click **Add New > Project** and select your GitHub repository.
   - Leave framework preset as **Other** (static page + serverless functions in `api/`).
   - In **Settings > Environment Variables**, add:
     - `GROQ_API_KEY = your_groq_api_key`
     - `GROQ_MODEL = llama-3.3-70b-versatile` (optional)
     - `GROQ_VISION_MODEL = qwen/qwen3.8-27b` (optional)
   - Click **Deploy**.
3. Open the production URL:
   - Badge at the top shows: **AI screening is on**.
   - Navigate to `/apply` for the Candidate Application Portal.
