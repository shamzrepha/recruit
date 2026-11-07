# Scout Screener

Rank candidates against a role and see the evidence from each CV. The AI suggests; a human decides.

Built for a Talent Scout Intern application to Sourcing Sprints (the video asks for something built with AI).

## What it does

1. Paste a job description and pull out the requirements, or add them by hand. Mark each one **Must have** or **Nice to have**.
2. Paste the CVs.
3. Press **Screen candidates**. For every candidate you get:
   - A match percentage, drawn as a bar with one segment per requirement.
   - A status for each requirement: **Stated** (with a quote from the CV), **Not stated** (verify it), or **Contradicted**.
   - "Up to X% if verified": the score if every "not stated" turned out to be true. A candidate can look weak only because the CV is short.
   - Questions to ask to check what the CV doesn't say.
   - Your decision: Shortlist, Ask first, or Pass. The tool never decides for you.
4. "Where the pool is thin" shows which requirements few candidates state, so you know what to search harder for.
5. Download the results as CSV.

## Two modes

| Mode | When | How it works |
| --- | --- | --- |
| AI screening | `GROQ_API_KEY` is set | Each CV is read by a Groq-hosted model on the server. Every quote it gives is checked against the CV text; a quote that isn't really there is downgraded to "not stated". |
| Keyword mode (demo) | No key | Matches words and synonyms in the CV. Can say "stated" or "not stated", and "contradicted" only for a clear years shortfall. |

The page shows which mode is on. If an AI call fails, it falls back to keyword mode and says so.

## Deploy (GitHub + Vercel)

1. Create a new GitHub repo and push this folder.
2. In Vercel: **Add New > Project**, import the repo. No build settings are needed (it's a static page plus one function).
3. In **Settings > Environment Variables**, add `GROQ_API_KEY` (a free key from console.groq.com). Redeploy.
4. Open the site. The badge at the top should say "AI screening is on".

Without step 3 the site still works in keyword mode.

## Run and test locally

```
npm test          # engine and API tests, no network needed
npx vercel dev    # runs the page and the /api/screen function
```

## Privacy and fairness

- Nothing is stored. CVs live in the page and are gone when it closes.
- In AI mode, CV text is sent to Groq's API to produce results.
- The AI is told to judge only against the listed requirements and to ignore name, gender, age, nationality, religion and similar details. It is a first filter. A person should read the CV before anyone is rejected.
- CV text is treated as untrusted: the model is told not to follow instructions inside a CV.

## Files

- `index.html`, `style.css`, `app.js`: the page.
- `engine.js`: requirement parsing, keyword matching, scoring.
- `samples.js`: a sample role and four made-up candidates.
- `api/screen.js`: the Vercel function that calls Groq.
- `test/`: tests for the engine and the function.
- `MASTER_PROMPT.md`: a prompt to give an AI coding assistant to extend this app (CV photo upload with OCR, WhatsApp/call/email buttons, AI interview summary).
