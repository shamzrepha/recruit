# Scout Screener

Rank candidates against a role and see the evidence from each CV. The AI suggests. A human decides.

## How it works

1. **Recruiter** opens `/hire`, creates a job (chat with the AI, or paste a description) and edits the requirements.
2. The job gets an **apply link** for candidates and a **private recruiter link** for you (Share tab).
3. **Candidates** open the apply link, upload a CV (PDF, photo or screenshot, read on their own device), check the details and submit. Contact details are stored only if they tick the consent box. They can then do an optional 5-question AI chat.
4. **Recruiter** sees applicants ranked best first, with evidence per requirement (Stated / Not stated, verify / CV says otherwise), questions to ask, the AI chat summary (never the raw answers), and WhatsApp / Call / Email buttons for consenting candidates.

## Storage: read this before demoing

- **Without setup**: data is saved in the browser (localStorage). Applicant and recruiter must use the same browser. Fine for a recorded demo.
- **With Upstash Redis** (free): applications from any device reach the recruiter. In Vercel, add the Upstash Redis integration (it sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`), or set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, then redeploy. The Share tab shows which mode is active.

## Environment variables

| Name | Purpose |
|---|---|
| `GROQ_API_KEY` | Turns on AI screening, interview, role chat and vision OCR. Without it the app uses keyword matching and canned questions. |
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
