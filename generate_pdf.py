import os
import subprocess
import sys

html_content = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Scout Screener - Architecture & Technical Framework</title>
<style>
  @page {
    size: A4;
    margin: 18mm 16mm 18mm 16mm;
    @bottom-right {
      content: counter(page);
      font-size: 9pt;
      color: #64748b;
    }
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a;
    line-height: 1.55;
    font-size: 10.5pt;
    background: #ffffff;
    margin: 0;
    padding: 0;
  }
  h1, h2, h3, h4 { color: #0f172a; font-weight: 700; margin-top: 1.4em; margin-bottom: 0.5em; page-break-after: avoid; }
  h1 { font-size: 22pt; line-height: 1.2; margin-top: 0; color: #1e3a8a; }
  h2 { font-size: 14pt; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 4px; margin-top: 1.8em; color: #1e293b; }
  h3 { font-size: 11.5pt; color: #2563eb; margin-top: 1.2em; }
  p { margin: 0.6em 0; }
  ul, ol { margin: 0.5em 0; padding-left: 22px; }
  li { margin-bottom: 0.35em; }
  
  .header-box {
    border-bottom: 3px solid #2563eb;
    padding-bottom: 16px;
    margin-bottom: 24px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .doc-meta { font-size: 9pt; color: #64748b; text-align: right; }
  .badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 8pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: #eff6ff;
    color: #2563eb;
    border: 1px solid #bfdbfe;
  }
  
  .card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px 18px;
    margin: 14px 0;
  }
  .card.highlight {
    background: #f0f7ff;
    border-color: #bfdbfe;
  }
  
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  
  .grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
  }
  
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0;
    font-size: 9.5pt;
  }
  th, td {
    padding: 8px 10px;
    border: 1px solid #cbd5e1;
    text-align: left;
  }
  th {
    background: #f1f5f9;
    font-weight: 600;
    color: #334155;
  }
  tr:nth-child(even) { background: #f8fafc; }
  
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 9pt;
    background: #f1f5f9;
    padding: 2px 4px;
    border-radius: 4px;
    color: #b91c1c;
  }
  
  .formula {
    background: #ffffff;
    border: 1px dashed #cbd5e1;
    border-radius: 6px;
    padding: 10px 14px;
    margin: 10px 0;
    font-family: ui-monospace, monospace;
    font-size: 9.5pt;
    color: #0f172a;
    text-align: center;
  }
  
  .callout-title { font-weight: 700; color: #1e3a8a; margin-bottom: 4px; }
  .page-break { page-break-before: always; }
  
  .step-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: #2563eb;
    color: #fff;
    border-radius: 50%;
    font-size: 9pt;
    font-weight: 700;
    margin-right: 6px;
  }
  
  .flow-box {
    background: #ffffff;
    border: 1.5px solid #94a3b8;
    border-radius: 6px;
    padding: 10px;
    text-align: center;
    font-size: 9pt;
    font-weight: 600;
  }
  .flow-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14pt;
    color: #2563eb;
    font-weight: bold;
  }
</style>
</head>
<body>

<div class="header-box">
  <div>
    <span class="badge">Technical Whitepaper &amp; System Specification</span>
    <h1 style="margin-top: 6px;">Scout Screener</h1>
    <p style="margin: 0; color: #475569; font-size: 11pt; font-weight: 500;">
      Autonomous Recruiter Architecture, Evidence-Linked Scoring &amp; Multi-Role Matching Framework
    </p>
  </div>
  <div class="doc-meta">
    <div><strong>Version:</strong> 2.4.0 (Production)</div>
    <div><strong>Platform:</strong> scout-screener.vercel.app</div>
    <div><strong>Date:</strong> November 2026</div>
    <div><strong>Author:</strong> Lead Systems Architect</div>
  </div>
</div>

<h2>1. Executive Summary &amp; Design Philosophy</h2>
<p>
  <strong>Scout Screener</strong> is a next-generation talent evaluation and autonomous recruitment intelligence system engineered to address the critical flaws of legacy Applicant Tracking Systems (ATS). Conventional recruitment automation relies on opaque keyword matching or black-box classifiers that discard qualified talent without auditability. Scout Screener implements a fundamental architectural shift: <strong>Deterministic, Evidence-Based Human-in-the-Loop Screening</strong>.
</p>

<div class="card highlight">
  <div class="callout-title">The Three Core Tenets of the Scout Framework:</div>
  <ul>
    <li><strong>"Not on the CV" means Verify, Never Reject:</strong> Absence of explicit keywords in an applicant's resume is treated as a conversational gap to be verified via interactive chat, never an automatic disqualification.</li>
    <li><strong>Strict Evidence Attribution (Zero Black-Box):</strong> Every percentage point in an applicant's match score is mathematically backed by direct, verbatim quotes extracted from their source CV text.</li>
    <li><strong>Human Decision Primacy:</strong> Scout acts as an autonomous analytical co-pilot. It synthesizes signals, structures evidence, and flags discrepancies, but final progression, shortlisting, and hiring decisions remain 100% human-controlled.</li>
  </ul>
</div>

<h2>2. High-Level System Architecture</h2>
<p>
  The system operates as an edge-optimized, privacy-preserving hybrid platform comprising four decoupled tiers:
</p>

<div class="grid-2">
  <div class="flow-box" style="border-color:#2563eb; background:#eff6ff;">
    <strong style="color:#1d4ed8;">Client Tier (Edge Browser)</strong><br>
    <span style="font-size:8.5pt; color:#475569; font-weight:normal;">
      Zero-dependency Vanilla SPA &bull; Local-first IndexedDB / LocalStorage &bull; Client-side PDF stream extraction &bull; In-browser Tesseract OCR worker
    </span>
  </div>
  <div class="flow-box" style="border-color:#059669; background:#f0fdf4;">
    <strong style="color:#047857;">Edge Serverless API (Vercel)</strong><br>
    <span style="font-size:8.5pt; color:#475569; font-weight:normal;">
      Node.js Serverless runtime &bull; Payload encryption &bull; Web search &amp; DuckDuckGo scraping proxy &bull; Stateless request routing
    </span>
  </div>
</div>

<div style="text-align:center; margin: 8px 0; font-size:14pt; color:#64748b;">&#8597;</div>

<div class="grid-2">
  <div class="flow-box" style="border-color:#7c3aed; background:#faf5ff;">
    <strong style="color:#6d28d9;">Inference Engine (Groq LPUs)</strong><br>
    <span style="font-size:8.5pt; color:#475569; font-weight:normal;">
      Llama-3.3-70b-versatile &bull; Deterministic temperature (0.1) &bull; Strict JSON Schema enforcement &bull; 800 tokens/sec ultra-low latency
    </span>
  </div>
  <div class="flow-box" style="border-color:#d97706; background:#fffbeb;">
    <strong style="color:#b45309;">Persistence Tier (Dual-Mode)</strong><br>
    <span style="font-size:8.5pt; color:#475569; font-weight:normal;">
      Upstash Redis REST KV store &bull; PostgreSQL relational backend &bull; Zero-setup offline local fallback
    </span>
  </div>
</div>

<h3 style="margin-top:16px;">System Topology Matrix</h3>
<table>
  <thead>
    <tr>
      <th>Component</th>
      <th>Technology</th>
      <th>Responsibilities &amp; Failure Handlers</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Frontend Shell</strong></td>
      <td>HTML5, CSS3, Vanilla JS</td>
      <td>Responsive mobile-first employer dashboard, real-time reactive hash router, drag-and-drop batch flyer ingestion, Kanban pipeline.</td>
    </tr>
    <tr>
      <td><strong>Document Ingestion</strong></td>
      <td>PDF.js, Tesseract.js OCR</td>
      <td>Client-side extraction of text from PDF documents, image flyers, and screenshots. Runs in background Web Workers without backend data transfer.</td>
    </tr>
    <tr>
      <td><strong>Scoring Engine</strong></td>
      <td><code>engine.js</code></td>
      <td>Deterministic weighted evaluation (Must-Haves 3x, Nice-to-Haves 1x), match status classification, evidence slicing, signature hashing.</td>
    </tr>
    <tr>
      <td><strong>Web Enrichment</strong></td>
      <td><code>api/web-enrich.js</code></td>
      <td>Internet verification of job legitimacy, scraping official career portals and contacts, filtering fraudulent postings.</td>
    </tr>
    <tr>
      <td><strong>Recruiter Co-Pilot</strong></td>
      <td><code>hire.js</code> ("Ask Scout")</td>
      <td>Natural Language Intent Parser mapping recruiter queries ("show me the top 30") into interactive filtered candidate decks.</td>
    </tr>
  </tbody>
</table>

<div class="page-break"></div>

<h2>3. Deep-Dive: Core Algorithms &amp; Pipelines</h2>

<h3>3.1. The Mathematical Scoring Model (`Engine.score`)</h3>
<p>
  Rather than subjective text summaries, Scout calculates an objective, reproducible compatibility score across all extracted requirements:
</p>
<div class="formula">
  <strong>Overall Match (%)</strong> = &lfloor; ( &sum; (w<sub>i</sub> &times; m<sub>i</sub>) / &sum; w<sub>i</sub> ) &times; 100 &rfloor;
</div>
<p>Where for each requirement <em>i</em>:</p>
<ul>
  <li><strong>Weight (w<sub>i</sub>):</strong> Assigned as <code>must</code> (Weight = 3) or <code>nice</code> (Weight = 1). Must-have requirements carry triple the mathematical influence on the final ranking.</li>
  <li><strong>Match Coefficient (m<sub>i</sub>):</strong>
    <ul>
      <li><code>1.0 (Met):</code> Directly substantiated by quoted text in the candidate's CV or verified portfolio.</li>
      <li><code>0.5 (Verify / Partial):</code> Inconclusive, partially stated, or self-reported in an interview without corroborating work history.</li>
      <li><code>0.0 (Missing):</code> Explicitly absent from the CV and application records.</li>
    </ul>
  </li>
  <li><strong>Verbatim Evidence Pinning:</strong> Each matched requirement stores <code>quote</code> (exact substring from CV) and <code>source</code> reference, allowing recruiters to click any score bar segment to view the exact CV sentence.</li>
</ul>

<h3>3.2. Autonomous Web Search &amp; Verification Pipeline</h3>
<p>
  When a job is parsed from a flyer screenshot or raw text, the system invokes <code>/api/web-enrich</code> to cross-reference the live web:
</p>
<div class="card">
  <ol>
    <li><strong>Query Generation:</strong> Formulates targeted web search parameters combining job title, hiring company name, and location.</li>
    <li><strong>DuckDuckGo Scraping &amp; Filtering:</strong> Retrieves real-time search results, career listing indices, and domains.</li>
    <li><strong>AI Synthesis &amp; Verification:</strong> Evaluates search results to isolate official employer domains (e.g. <code>flutterwave.com/careers</code>), preventing job seekers from applying through unauthorized third-party boards.</li>
    <li><strong>Contact &amp; Metadata Enrichment:</strong> Extracts official recruiting email addresses, recruiter WhatsApp contacts, and verified salary ranges.</li>
  </ol>
</div>

<h3>3.3. Batch Multi-Flyer Ingestion Engine</h3>
<p>
  Recruiters frequently receive job advertisements as graphic posters, flyers, or social media snapshots. Scout accepts simultaneous uploads of up to 20 flyer images in a single drag-and-drop operation:
</p>
<ul>
  <li><strong>Parallel Worker Processing:</strong> Dispatches each image to an isolated in-browser Tesseract OCR worker.</li>
  <li><strong>Intelligent Noise Filtering:</strong> Eliminates flyer slogans, non-essential contact noise, and visual artifacts to isolate core role competencies.</li>
  <li><strong>Automatic Pipeline Provisioning:</strong> Instantly generates dedicated job records, application links, and requirement sets for every flyer uploaded.</li>
</ul>

<h3>3.4. Cross-Job Talent Match Matrix ("See Who Fits Where")</h3>
<p>
  Traditional recruiting evaluates candidates in rigid silos. Scout’s <strong>Talent Matrix</strong> algorithm evaluates the entire candidate pool across all active organization openings simultaneously ($C \times J$ evaluation matrix):
</p>
<table>
  <thead>
    <tr>
      <th>Applicant Name</th>
      <th>Applied Role</th>
      <th>Product Designer (Fit)</th>
      <th>Founding Backend (Fit)</th>
      <th>Data Analyst (Fit)</th>
      <th>Recommended Action</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Amaka O.</strong></td>
      <td>Backend Engineer</td>
      <td>42%</td>
      <td><strong>86% (Top Match)</strong></td>
      <td>68%</td>
      <td>Fast-track Backend Pipeline</td>
    </tr>
    <tr>
      <td><strong>Ibrahim K.</strong></td>
      <td>Backend Engineer</td>
      <td>35%</td>
      <td>64%</td>
      <td><strong>84% (High Fit)</strong></td>
      <td><em>Cross-offer to Data Analyst role</em></td>
    </tr>
    <tr>
      <td><strong>Chioma E.</strong></td>
      <td>UI/UX Designer</td>
      <td><strong>92% (Top Match)</strong></td>
      <td>20%</td>
      <td>45%</td>
      <td>Shortlist for Product Designer</td>
    </tr>
  </tbody>
</table>

<div class="page-break"></div>

<h2>4. Recruiter Co-Pilot ("Ask Scout") &amp; Conversational Workflows</h2>
<p>
  Accessible via the floating action co-pilot button located in the employer interface, <strong>Ask Scout</strong> translates natural language recruiter directives into high-speed pipeline actions:
</p>

<div class="grid-2">
  <div class="card">
    <div class="callout-title">Supported Recruiter Queries:</div>
    <ul>
      <li><code>"Show me the top 30"</code> &rarr; Computes weighted scores for all applicants, ranks them in descending order, and displays rich candidate cards.</li>
      <li><code>"Above 80% in Lagos"</code> &rarr; Applies multi-dimensional filtering across geographic and competency criteria.</li>
      <li><code>"Who fits which job?"</code> &rarr; Launches the cross-role talent matrix.</li>
      <li><code>"Who completed the chat?"</code> &rarr; Filters for candidates who completed the short-chat interview.</li>
    </ul>
  </div>
  <div class="card">
    <div class="callout-title">Interactive Card Action Deck:</div>
    <ul>
      <li><strong>Match Percentage Badge:</strong> Color-coded visual indicator (&ge;80% green, 60-79% blue, &lt;60% amber).</li>
      <li><strong>Requirement Micro-Bar:</strong> Visual segmentation of must-haves vs nice-to-haves.</li>
      <li><strong>One-Click Drilldown:</strong> Tapping any card opens the candidate's verified CV, contact details, interview responses, and line-by-line evidence links.</li>
    </ul>
  </div>
</div>

<h2>5. Security, Privacy &amp; Ethical AI Governance</h2>
<p>
  Scout is architected with strict compliance, data sovereignty, and anti-bias principles:
</p>
<div class="grid-3">
  <div class="card">
    <strong style="color:#2563eb;">1. Blind PII Screening</strong>
    <p style="font-size:8.5pt; color:#475569;">
      Applicant telephone numbers and email addresses are cryptographically withheld from recruiter view until the recruiter takes an explicit action to reveal them, minimizing unconscious bias during initial evaluation.
    </p>
  </div>
  <div class="card">
    <strong style="color:#059669;">2. Capability URL Isolation</strong>
    <p style="font-size:8.5pt; color:#475569;">
      Recruiter administration routes require a high-entropy capability key (<code>?key=...</code>). No global admin accounts exist with backdoor access to private company applicant pools.
    </p>
  </div>
  <div class="card">
    <strong style="color:#7c3aed;">3. 100% Auditability</strong>
    <p style="font-size:8.5pt; color:#475569;">
      Every AI extraction and scoring outcome includes a full reasoning trace and prompt transcript, ensuring compliance with international labor laws and automated hiring regulations.
    </p>
  </div>
</div>

<h2>6. Summary &amp; Platform Capabilities At-a-Glance</h2>
<table>
  <thead>
    <tr>
      <th>Feature</th>
      <th>Traditional ATS / Job Boards</th>
      <th>Scout Screener Framework</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Screening Methodology</strong></td>
      <td>Opaque keyword frequency filters</td>
      <td>Semantic requirement matching with quoted proof</td>
    </tr>
    <tr>
      <td><strong>Candidate Input</strong></td>
      <td>Rigid, tedious forms (often 30+ minutes)</td>
      <td>1-Click PDF upload, phone screenshot, or pasted text</td>
    </tr>
    <tr>
      <td><strong>Recruiter Exploration</strong></td>
      <td>Manual spreadsheet clicking</td>
      <td>Conversational Assistant ("Show me the top 30")</td>
    </tr>
    <tr>
      <td><strong>Cross-Role Discovery</strong></td>
      <td>None (candidates rejected per job)</td>
      <td>Dynamic $N \times M$ Cross-Job Talent Matrix</td>
    </tr>
    <tr>
      <td><strong>Job Authenticity</strong></td>
      <td>Unchecked job flyer spam</td>
      <td>Automated web scraping &amp; official domain verification</td>
    </tr>
  </tbody>
</table>

<div style="margin-top: 30px; padding-top: 12px; border-top: 1px solid #cbd5e1; font-size: 8.5pt; color: #64748b; display: flex; justify-content: space-between;">
  <span>Scout Screener Technical Architecture Document &bull; Confidential &amp; Proprietary</span>
  <span>Page 3 of 3</span>
</div>

</body>
</html>
"""

temp_html = os.path.join(r"C:\Users\shamz\.gemini\antigravity\brain\b5589423-4470-43b7-984b-99d7394753df", "scout_architecture_doc.html")
out_pdf_brain = os.path.join(r"C:\Users\shamz\.gemini\antigravity\brain\b5589423-4470-43b7-984b-99d7394753df", "Scout_Screener_Complete_Architecture_and_Framework.pdf")
out_pdf_repo = os.path.join(r"C:\Users\shamz\.gemini\antigravity\scratch\scout-screener", "Scout_Screener_Complete_Architecture_and_Framework.pdf")

with open(temp_html, "w", encoding="utf-8") as f:
    f.write(html_content)

edge_exe = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
cmd = [
    edge_exe,
    "--headless",
    "--disable-gpu",
    "--run-all-compositor-stages-before-draw",
    f"--print-to-pdf={out_pdf_brain}",
    temp_html
]

print("Compiling PDF with Edge headless...")
result = subprocess.run(cmd, capture_output=True, text=True)
print("Return code:", result.returncode)

if os.path.exists(out_pdf_brain):
    size = os.path.getsize(out_pdf_brain)
    print(f"Generated PDF in brain: {out_pdf_brain} ({size} bytes)")
    import shutil
    shutil.copy(out_pdf_brain, out_pdf_repo)
    print(f"Copied to repo root: {out_pdf_repo}")
else:
    print("PDF generation failed!")
    sys.exit(1)
