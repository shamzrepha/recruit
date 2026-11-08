# Scout Screener

Rank candidates against a role and see the evidence from each CV. The AI suggests. A human decides.

## The three pages

- **`/` Landing**: two doors, "I'm looking to hire" and "I'm looking for work".
- **`/hire` Employers**: dashboard, jobs, post-a-job (a short chat where Scout asks about the company and the role, then writes the job post and requirements), a kanban pipeline per job (drag to move stages), a candidate drawer with the full profile, evidence, AI chat summary and contact buttons, and **Ask Scout**, an assistant. Type "show me the top 30 candidates" (or "top 10 in Lagos who know sales", "above 70%", "shortlist the top 5") and it lists ranked cards; click one to read the whole CV.
- **`/jobs` Job seekers**: upload a CV once (PDF, photo or pasted text). Scout builds a profile (contact details, schools, jobs, skills, roadmap), scores every open role, shows where you would rank (estimated top X%), and lets you apply to the roles you pick. There is also a browse tab with every open role. `/apply?job=...` is the direct link a recruiter can share.

After applying, candidates can do a 3-question chat, written like a recruiter would ask, from their CV. Recruiters see a summary, never the raw answers.

Rankings are estimates. The "top X%" uses the anonymous scores of people who applied so far and shows only when at least 3 have applied.

## Accounts and short links

- **Short apply links**: every job gets a code, so the link to share is `https://your-site/a/K7X3QP`. Older jobs get a code the first time the recruiter opens them.
- **Optional accounts** (`/account`, needs shared storage): job seekers keep their profile and saved CV, see each application's status (Received, Under review, Shortlisted, Not selected) and can withdraw; employers get their jobs on every device. Passwords are salted PBKDF2 hashes, 8 wrong attempts lock sign-in for 15 minutes, sessions last 30 days. Applying without an account still works.
- **Screening**: new applicants are screened by AI automatically when a recruiter opens the job (keyword matching if there is no `GROQ_API_KEY`).

## Storage: read this before demoing

- **Without setup**: data is saved in the browser (localStorage). Applicant and recruiter must use the same browser. Fine for a recorded demo.
- **With Upstash Redis** (free): applications from any device reach the recruiter. In Vercel, add the Upstash Redis integration (it sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`), or set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, then redeploy. The Share tab shows which mode is active.

## Environment variables

| Name | Purpose |
|---|---|
| `GROQ_API_KEY` | Turns on AI screening, interview, role chat and vision OCR. Without it the app says so and falls back to a basic CV reader and keyword matching, which is rougher. |
| `GROQ_MODEL`, `GROQ_VISION_MODEL` | Optional model overrides. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` (or `KV_REST_API_URL` / `_TOKEN`) | Shared storage. |

## Privacy and access

- No accounts. Each job has a private key; only its hash is stored. Recruiter data is returned only with that key.
- Contact details are removed unless the candidate consented. The AI chat transcript is never sent to recruiters.
- Candidate records expire after 30 days; jobs after 90. Candidates can delete their application at any time.
- The AI never makes a hire or reject decision.

## Develop

```
npm test                                                    # engine, core, contacts, API
npm install && npx playwright install chrome
npm run test:browser                                        # browser-storage mode
SCOUT_STORE=memory-persistent npm run test:browser          # shared-storage mode
```

Pages are static HTML/CSS/JS plus Vercel functions in `api/`. `_src/` holds page sources; run `python3 _src/build.py` after editing them (or edit the built `.html` directly). `core.js` holds every rule and runs on both server and browser.

Not covered by tests: live Groq calls, vision OCR, PDF text extraction, and Upstash itself.


## Google sign-in, password reset and emails

All optional. The site works without them; each one switches on when its settings exist in Vercel > Settings > Environment Variables.

| What | Settings | Notes |
| --- | --- | --- |
| Sign in with Google | `GOOGLE_CLIENT_ID` | Google Cloud Console > APIs & Services > Credentials > Create OAuth client ID > Web application. Under "Authorized JavaScript origins" add your site address (for example `https://your-site.vercel.app`). Paste the Client ID. |
| Emails (reset link, "shortlisted", "new applicant") | `BREVO_API_KEY` + `MAIL_FROM`, or `RESEND_API_KEY` + `MAIL_FROM` | Brevo lets you send from one verified address (a Gmail works) and is free for 300 a day. Resend only emails other people after you verify a domain. |
| Links inside emails | `SITE_URL` | Your public address, no trailing slash. |

Without email settings the "Forgot your password?" link is hidden. Without a Google Client ID the Google button is hidden. After changing settings, redeploy.

Accounts also need the Upstash Redis storage connected (see above). Privacy and Terms pages are `/privacy` and `/terms`; add a contact email there if you want people to reach you.
