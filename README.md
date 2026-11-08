# Scout Screener

Rank candidates against a role and see the evidence from each CV. The AI suggests. A human decides.

## The three pages

- **`/` Landing**: two doors, "I'm looking to hire" and "I'm looking for work".
- **`/hire` Employers**: dashboard, jobs, post-a-job (a short chat where Scout asks about the company and the role, then writes the job post and requirements), a kanban pipeline per job (drag to move stages), a candidate drawer with the full profile, evidence, AI chat summary and contact buttons, and **Ask Scout**, an assistant. Type "show me the top 30 candidates" (or "top 10 in Lagos who know sales", "above 70%", "shortlist the top 5") and it lists ranked cards; click one to read the whole CV.
- **`/jobs` Job seekers**: upload a CV once (PDF, photo or pasted text). Scout builds a profile (contact details, schools, jobs, skills, roadmap), scores every open role, shows where you would rank (estimated top X%), and lets you apply to the roles you pick. There is also a browse tab with every open role. `/apply?job=...` is the direct link a recruiter can share.

After applying, candidates can do a 3-question chat, written like a recruiter would ask, from their CV. Recruiters see a summary, never the raw answers.

Rankings are estimates. The "top X%" uses the anonymous scores of people who applied so far and shows only when at least 3 have applied.

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
