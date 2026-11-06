# NerdTutors Evaluation & OCR Grading Engines Subsystem Documentation

**Document Path**: `docs/system/evaluation-ocr.md`  
**Subsystem Scope**: `ocr-scan.html`, `results.html`, `api/ocr-evaluate.js`, `api/cbse-rules.json`  
**Target Audience**: Software Engineers, Technical Architects, CBSE Academic Auditors, Security Reviewers  
**System Integrity Mode**: Production / Deterministic  

---

## 1. Architectural Overview & Workflow Lifecycle

### 1.1 Purpose & Domain Scope
The **Evaluation & OCR Grading Engines subsystem** is the automated assessment core of NerdTutors. It is engineered specifically for official Central Board of Secondary Education (CBSE) standards across Class 10th Social Science (CBSE Code 087) and Class 12th Commerce streams: Economics (CBSE Code 030), Business Studies (CBSE Code 054), and Accountancy (CBSE Code 055).

The subsystem ingests smartphone photographs or scanned PDFs of handwritten student examination answer sheets, identifies question identifiers out-of-order, transcribes and reasons over student handwriting, validates reasoning against official CBSE marking schemes, applies deterministic academic guardrails, stores results in Google Cloud Firestore, and generates publication-grade printable A4 split-panel report cards.

### 1.2 End-to-End Architectural Pipeline

```
                                [Student Smartphone / Tablet / Desktop]
                                                   │
                  ┌────────────────────────────────┴────────────────────────────────┐
                  ▼                                                                 ▼
         [📷 Open Camera]                                                  [📁 Choose Files]
     (#cameraInput, capture=environment)                               (#fileInput, multiple)
                  │                                                                 │
                  └───────────────────────────────┬─────────────────────────────────┘
                                                  ▼
                                      [handleFiles(files)]
                                                  │
                                                  ▼
                                [Smart Canvas Image Downscaling]
                            (Max 1024px, JPEG 0.75, Aspect Preserved)
                                                  │
                                                  ▼
                                 [LocalStorage Resume Image Cache]
                                 (ocr_scan_images, saveDraft)
                                                  │
                                                  ▼
                               [XHR Upload with Progress & Guard]
                           (postWithProgress, 4.0 MB Payload Guard)
                                                  │
                                                  ▼ POST /api/ocr-evaluate
 ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ SERVERLESS BACKEND (api/ocr-evaluate.js)                                                        │
 │                                                                                                 │
 │  1. Ingestion & Origin Check (CORS, unauthenticated direct access, rate limit audit)           │
 │  2. 6-Layer Instruction Assembly (Exam paper, rubrics, universal CBSE guardrails, subject)      │
 │  3. Google Cloud Vertex AI / AI Studio Gateway:                                                 │
 │                                                                                                 │
 │     ┌─────────────────────────────────────────────────────────────────────────────────────┐     │
 │     │ TIER 1: Primary Model (gemini-4-argon) Direct Single-Pass Vision                     │     │
 │     │ - temperature: 0.0, seed: 42, thinkingLevel: "low" / "medium"                       │     │
 │     │ - Latency: ~8-12 seconds | Token Savings: >65% (~8k-10k tokens vs 33k)              │     │
 │     └──────────────────────────────────────────┬──────────────────────────────────────────┘     │
 │                                                │ (Success?)                                     │
 │                                       ┌────────┴────────┐                                       │
 │                                       ▼ YES             ▼ NO (429, 503, 504, Quota)             │
 │                                       │     ┌─────────────────────────────────────────────┐     │
 │                                       │     │ TIER 2: Failover Backup (gemini-3.8-flash)   │     │
 │                                       │     │ - Single-Pass Vision (thinkingBudget: 512)  │     │
 │                                       │     └──────────────────────┬──────────────────────┘     │
 │                                       │                            │ (Success?)                 │
 │                                       │                   ┌────────┴────────┐                   │
 │                                       │                   ▼ YES             ▼ NO                │
 │                                       │                   │     ┌─────────────────────────┐     │
 │                                       │                   │     │ TIER 3: Dual-Pass OCR   │     │
 │                                       │                   │     │ (Transcribe -> Grade)   │     │
 │                                       │                   │     └───────────┬─────────────┘     │
 │                                       ▼                   ▼                 ▼                   │
 │     ┌─────────────────────────────────────────────────────────────────────────────────────┐     │
 │     │ 4. Deterministic Academic Safety Nets & Programmatic Overrides:                     │     │
 │     │    - Dynamic Binary MCQ Hard-Lock (0.5 / 1.0 all-or-nothing, wrong option = 0.0)    │     │
 │     │    - Defend vs Refute Stance Premise Error Ceiling (max 1.0 mark)                   │     │
 │     │    - Descriptive Section Weight Restoration (Q7-Q12 restored to 4.0)                │     │
 │     │    - Off-Topic Irrelevance Zero Mark Override                                       │     │
 │     │    - 15-Word Feedback Budget & Max 2 Improvements Cap                               │     │
 │     │    - Math Invariant Clamping [0, maxMarks] & Programmatic Total Sum Summation       │     │
 │     └─────────────────────────────────────────────────────────────────────────────────────┘     │
 │                                                │                                                │
 └────────────────────────────────────────────────┼────────────────────────────────────────────────┘
                                                  ▼ HTTP 200 JSON
                                       [Client Response Ingestion]
                                                  │
                         ┌────────────────────────┴────────────────────────┐
                         ▼                                                 ▼
             [Firestore Persistence]                         [Split-Panel Report Card]
          (addDoc in testResults coll)                   (Left: Score Card | Right: Badge Grid)
                         │                                                 │
                         ▼                                                 ▼
          [In-Place Re-Evaluation Flow]                     [Window Print & PDF Generation]
       (updateDoc on currentSavedResultId)                  (@page A4 narrow margin, exact color)
```

---

## 2. Upload Handlers & Mobile Camera Workaround

### 2.1 The Mobile Browser Multi-File Camera Bug & Resolution
* **The Root Bug**: Mobile operating systems (Android Chrome and iOS WebKit/Safari) exhibit an established browser interaction bug: when an HTML `<input type="file">` tag includes the `multiple` attribute (`multiple accept="image/*"`), mobile OS file pickers suppress or bypass the native device camera capture interface, forcing students to select existing photos from the gallery. Conversely, attaching `capture="environment"` opens the camera directly but forcibly disables multi-file selection.
* **The Dual-Input Solution**:
  In `ocr-scan.html` (lines 464–465), two separate hidden file inputs are maintained:
  ```html
  <input type="file" id="fileInput" multiple accept="image/*,application/pdf" style="display: none;">
  <input type="file" id="cameraInput" accept="image/*" capture="environment" style="display: none;">
  ```
* **Decoupled User Action Triggers**:
  The dropzone interface presents two dedicated action buttons:
  - `📷 Open Camera` (`#btnCamera`): Programmatically triggers `cameraInput.click()`.
  - `📁 Choose Files` (`#btnGallery`): Programmatically triggers `fileInput.click()`.
* **Unified Event Ingestion (`handleFiles`)**:
  Both inputs route their `change` events into a unified asynchronous handler:
  ```javascript
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  cameraInput.addEventListener('change', (e) => handleFiles(e.target.files));
  ```
  This architecture allows a student on a smartphone to tap `📷 Open Camera`, snap Page 1, return to the scanner, tap `📷 Open Camera` again, snap Page 2, and sequentially accumulate sheets in `uploadedFiles[]` without overriding or deleting previously photographed pages.

### 2.2 Client-Side Smart Canvas Compression (`fileToBase64`)
Modern smartphone cameras capture 12MP to 48MP photographs (3MB to 15MB per JPEG). Transmitting raw multi-page photographs causes severe HTTP payload bloat, exceeds serverless request body limits, and causes high latency on 4G/3G mobile connections.

`ocr-scan.html` implements client-side smart canvas compression (lines 1163–1224):
1. **PDF Passthrough**: If `file.type === 'application/pdf'`, the file is read directly as base64 via `FileReader.readAsDataURL()`.
2. **Dynamic Canvas Downscaling**: For images, an offscreen HTML5 `<canvas>` element resizes the image so that the maximum dimension (width or height) is clamped to **1024px** while strictly preserving the aspect ratio:
   ```javascript
   const MAX_DIM = 1024;
   let width = img.width;
   let height = img.height;

   if (width > MAX_DIM || height > MAX_DIM) {
       if (width > height) {
           height = Math.round((height * MAX_DIM) / width);
           width = MAX_DIM;
       } else {
           width = Math.round((width * MAX_DIM) / height);
           height = MAX_DIM;
       }
   }
   ```
3. **High-Quality Context Export**:
   - `ctx.imageSmoothingEnabled = true;`
   - `ctx.imageSmoothingQuality = 'high';`
   - `canvas.toDataURL('image/jpeg', 0.75)`
4. **Economic & Visual Impact**:
   - Cuts base64 payload size by **>80%** (reducing a 6MB raw photo to ~250KB–400KB).
   - Cuts multimodal vision tile tokens by **~70%**.
   - Preserves high contrast and razor-sharp clarity for handwritten ink strokes, mathematical subscripts, accounting ledger columns, and economics diagrams.

### 2.3 Payload Sizing & Weak-Connection Resilience
* **Hard Image Cap**: Hard-limited to `MAX_IMAGES = 10` sheets per submission to prevent memory overload.
* **Payload Size Guard (`currentPayloadMB`)**: Tracks cumulative base64 payload bytes against `MAX_TOTAL_MB = 4.0 MB`. If exceeded, a non-blocking UI alert warns students that large uploads may experience latency on cellular connections before approaching Vercel's ~4.5MB serverless body limit.
* **Progressive XHR Uplink (`postWithProgress`)**: Employs native `XMLHttpRequest` with `xhr.upload.onprogress` (lines 1312–1350) to render a live progress bar (0%–100%) during the client upload phase.
* **Low-Connection Retries (`submitWithRetry`)**:
  - `MAX_RETRIES = 0` (configured in production to prevent duplicate automated charges on connection timeouts).
  - `UPLOAD_TIMEOUT_MS = 180000` (3-minute execution ceiling per attempt).
  - Exponential backoff algorithm is preserved for transient network drops (`status 0`, timeout, `5xx`), while never retrying client-side `4xx` errors.

### 2.4 User Work Preservation Rule (Zero Data Loss)
Network disruptions or API errors must **NEVER** wipe a student's uploaded sheets or entered data.
* **Persistent Local Storage Caching**:
  - `saveDraft()`: Persists student name, batch, class, subject, exam year, and test session ID to `localStorage`.
  - `saveImagesDraft()`: Serializes `uploadedFiles[]` into `localStorage.getItem('ocr_scan_images')`.
  - `loadImagesDraft()`: Automatically restores previously uploaded sheets if a student refreshes or the browser crashes.
* **Error Resilience Guarantee**:
  If evaluation fails or times out, the `try/catch` block explicitly retains `uploadedFiles[]` in memory. The user can press `🚀 Submit for Evaluation` again immediately without having to re-photograph their sheets.

---

## 3. Direct Single-Pass Vision Architecture

### 3.1 Primary Model (`gemini-4-argon`)
NerdTutors utilizes Google's frontier reasoning multimodal model, **`gemini-4-argon`**, as its primary evaluation engine.
* **Direct Single-Pass Vision Paradigm**:
  Unlike legacy dual-pass architectures that execute an initial transcription pass followed by a second grading pass, Direct Single-Pass Vision passes the downscaled student answer sheet images directly into `gemini-4-argon` alongside the questions and CBSE marking scheme in a single round-trip.
* **Qualitative Cognitive Thinking Configuration**:
  Gemini 4 Argon strictly rejects numeric token budgets (`thinkingBudget`) with HTTP 400 `INVALID_ARGUMENT`. To prevent API crashes, `buildGenerationConfigForModel()` in `api/ocr-evaluate.js` (lines 312–333) programmatically adapts the configuration based on model identity:
  ```javascript
  if (isArgon) {
      config.thinkingConfig = {
          thinkingLevel: options.thinkingLevel || thinkingLevel || "medium"
      };
  } else {
      config.thinkingConfig = {
          thinkingBudget: options.thinkingBudget !== undefined ? Number(options.thinkingBudget) : 512
      };
  }
  ```
  `ocr-scan.html` requests `thinkingLevel: "medium"`, balancing deep multi-step deduction across student handwriting against execution speed.
* **Vision Resolution Setting**:
  Configured with `mediaResolution: "MEDIA_RESOLUTION_LOW"` in `api/ocr-evaluate.js` (line 658), matching the 1024px downscaling profile to ensure rapid vision tokenization while avoiding visual hallucinations.

### 3.2 Prompt Engineering & The 6-Layer Instruction Architecture
To prevent cognitive overload, prompt bloat, and conflicting instructions, the AI prompt is assembled via a 6-layer decoupled hierarchy:

| Layer | Component | Source & Storage Location | Function & Directives |
|---|---|---|---|
| **Layer 1** | Exam Paper & Key | Session Firestore (`questions`, `markingScheme`) | Official questions, question weights, model solutions, and marking rubrics. |
| **Layer 2** | Teacher Overrides | Session Firestore (`otherInstructions`) | Sanitized (max 500 chars, stripped of backticks/symbols) master directives from teachers. |
| **Layer 3** | Universal CBSE Guardrails | `getUniversalGuardrails()` | Clauses 1–18: Value points over rigid wording; 0 language deductions; case study citation legitimacy; binary MCQs. |
| **Layer 4** | Subject Directives | `api/cbse-rules.json` via `getSubjectDirectives(subject)` | Filtered specifically by exam subject (`ECONOMICS_030`, `ACCOUNTANCY_055`, `BUSINESS_STUDIES_054`, `SOCIAL_SCIENCE_087`). |
| **Layer 5** | Cognitive Thinking Guardrails | `reasoningGuardrailPrompt` | Anti-discursive thinking: No preamble, no verbatim essay re-transcription in thoughts, 1-step binary MCQ verification, <1,500 thinking tokens. |
| **Layer 6** | Mandatory Output Schema | Structured JSON Contract | Enforced with `responseMimeType: "application/json"`. Returns `totalScore`, `maxMarks`, `overallFeedback`, `improvements`, and `results[]`. |

* **Context Cache Anti-Duplication Rule**:
  When a Google Cloud Context Cache is active (`cachedContentId`), `textPrompt` switches to `leanSessionPrompt` (~80 tokens):
  > *"You are an expert CBSE exam moderator evaluating this student's handwritten answer sheet. The Exam Questions, Marking Scheme, Subject Directives, Teacher Directives, Reasoning Guardrails, and Output Schema are already pre-loaded in your active cache..."*
  This prevents repeating thousands of static tokens on every student submission, securing Google's official **75% token caching discount**.

### 3.3 Token & Latency Economics
Direct Single-Pass Vision delivers dramatic performance and economic improvements over dual-pass architectures:

| Evaluation Architecture | Latency | Total Token Footprint | Cost per Student Paper | Primary Operational Use Case |
|---|---|---|---|---|
| **Legacy Dual-Pass Pipeline** | 90 – 120 seconds | ~33,000 tokens | ₹11.03 ($0.128) | Archived legacy |
| **Gemini 4 Argon Single-Pass (Interactive)** | 8 – 14 seconds | ~8,000 – 10,000 tokens | ~₹3.00 ($0.035) | Student self-scan (`ocr-scan.html`) |
| **Vertex AI Batch Prediction (Unoptimized)** | 2 – 10 minutes | ~19,900 tokens | ₹7.40 ($0.086) | Pre-optimization baseline |
| **Vertex AI Batch Prediction (Optimized M284)** | **2 – 10 minutes** | **~10,400 tokens** | **₹2.57 ($0.030)** | **Classroom bundles (`admin.html`)** |


### 3.4 Optional Forced Dual-Pass Mode
If an examiner requires explicit literal transcription of student handwriting prior to evaluation, setting `body.forceDualPass === true` triggers the dual-pass pathway:
1. `transcribeWithGemini()` (lines 856–899): Executes pure forensic OCR (`temperature: 0.0, seed: 42`, thinking disabled, `MEDIA_RESOLUTION_LOW`) transcribing handwriting word-for-word into Markdown without correcting errors or grading.
2. `gradeWithGemini()` (lines 901–927): Wraps the extracted handwriting into `<student_transcription>` tags and feeds it into the grading engine.

---

## 4. Deterministic Evaluation & Configuration

### 4.1 Hard-Locked Seed Pinning
In high-stakes academic grading, non-deterministic variance (where evaluating the same student paper twice yields different marks) is unacceptable.

NerdTutors enforces absolute deterministic reproducibility in `api/ocr-evaluate.js`:
* `temperature: 0.0`: Completely eliminates stochastic exploration in token sampling.
* `seed: 42`: Hard-pinned generation seed across all API calls (`generationConfig: { temperature: 0.0, seed: 42 }`).
* Result: Identical answer sheets evaluated against identical marking schemes produce identical scores and feedback across runs.

---

## 5. CBSE 2.0 Deterministic Rules & Programmatic Overrides

### 5.1 Deterministic Knowledge Base (`api/cbse-rules.json`)
`api/cbse-rules.json` contains a comprehensive formalization of CBSE marking standards divided into two distinct architectural stages:
* **Stage 1 (Vision OCR Preprocessor Rules `OCR-01` to `OCR-08`)**:
  - `OCR-01 (ZERO_AUTOCORRECT_AND_LEXICAL_LOCK)`: Forbids autocorrecting misspelled technical terms (e.g., transcribing *"Espirit De Crops"* literally).
  - `OCR-02 (ILLEGIBLE_TOKEN_FLAGGING)`: Emits literal `[ILLEGIBLE_TOKEN]` when visual confidence is <0.85 rather than guessing contextually.
  - `OCR-03 (STRIKETHROUGH_AND_SCRATCHOUT_EXCLUSION)`: Drops scratched-out or slashed text into `discarded_strikethrough_log[]` so marks are neither awarded nor deducted.
  - `OCR-04 (LITERAL_ARITHMETIC_PRESERVATION)`: Transcribes mathematical errors literally without calculating corrections.
  - `OCR-05 (DIAGRAM_BOUNDING_BOX_ISOLATION)`: Extracts origin labels (`O`), curve slopes, directional arrows, and equilibrium points (`E`) strictly inside diagram bounding boxes.
  - `OCR-06 (ACCOUNTANCY_GRID_AND_HEADER_FIDELITY)`: Verifies presence of Dr., Cr., L.F., currency symbols (`₹`), and parenthetical journal narrations (`(Being...)`).
* **Stage 2 (CBSE General Marking Guidelines Clauses 1–18)**:
  - `Clause 04`: Suggested value points over rigid wording; students may use their own expression.
  - `Clause 07`: Mandatory sub-part isolation; multi-part questions cannot be scored as single composite blocks.
  - `Clause 09`: Extra question retention; retain the alternative deserving higher marks.
  - `Clause 10`: No cumulative penalties; an error is penalized only once, not repeatedly across cascading steps.
  - `Clause 15`: Zero marks deducted for spelling, grammatical slips, or imperfect English in non-language commerce/social science papers.

### 5.2 Subject-Specific Evaluation Matrices
`api/cbse-rules.json` defines rigid rulesets injected dynamically via `getSubjectDirectives(subject)`:

#### A. Accountancy (CBSE Code 055)
- **Format Penalties (`ACC_01`)**: 25% deduction for missing tabular journal format; 0.5M deduction for missing L.F./currency headers; 0.5M deduction for missing Dr./Cr. labels; 0.5M deduction for missing journal entry narration.
- **Working Note Dependency Lock (`ACC_02`)**: Complex derived figures (Capital Reserve, Hidden Goodwill, Gaining Ratios) missing working notes are capped at **maximum 25%** of allocated marks even if the final numerical figure matches the answer key.
- **Arithmetic & AS-3 Balance Verification (`ACC_03`)**: Independent vertical sum check; flags forced balance fraud; enforces negative cash outflows in brackets `( )`; strict classification of Operating, Investing, and Financing activities.

#### B. Business Studies (CBSE Code 054)
- **Three-Tier Case Study Protocol (`BST_01`)**:
  1. *Tier 1*: Exact NCERT concept identification.
  2. *Tier 2*: Verbatim line citation from the case passage.
  3. *Tier 3*: Concept explanation and justification.
  *Cascading Dependency*: If Tier 1 is wrong or missing, Tier 2 and Tier 3 receive **0.0 marks immediately**.
- **NCERT Lexical Synonym Lock (`BST_02`)**: Zero marks awarded if informal synonyms are used instead of canonical NCERT headings:
  - *"Teamwork"* / *"Group harmony"* $\rightarrow$ REJECTED for **Espirit De Corps**.
  - *"Hierarchy line"* / *"Reporting ladder"* $\rightarrow$ REJECTED for **Scalar Chain**.
  - *"Direct talk"* / *"Shortcut bridge"* $\rightarrow$ REJECTED for **Gang Plank**.
  - *"Company comes first"* $\rightarrow$ REJECTED for **Subordination of Individual Interest to General Interest**.
  - *"Mindset change"* $\rightarrow$ REJECTED for **Mental Revolution**.
  - *"Dummy machine training"* $\rightarrow$ REJECTED for **Vestibule Training**.
- **Comparative Distinction Enforcement (`BST_03`)**: 50% deduction for non-tabular paragraph comparisons; 0.5M deduction per row for missing "Basis of Distinction" column; asymmetric row comparison scores 0.0.

#### C. Economics (CBSE Code 030)
- **Diagram Geometric Validation (`ECO_01`)**:
  - Aggregate Supply ($AS = Y$) must start from Origin ($O$) at a $45^\circ$ positive upward slope.
  - Keynesian Consumption Curve ($C$) must start from a positive Y-intercept (Autonomous Consumption $\bar{C} > 0$).
  - Keynesian Saving Curve ($S$) must start from a negative Y-intercept ($-\bar{C} < 0$).
  - Missing axis titles penalize 50%; missing curve labels lock score to 0.0; missing shift arrows on shift questions deduct 0.5M.
- **4-Stage Multi-Step Numerical Pipeline (`ECO_02`)**:
  1. Stage 1: Explicit formula statement (20% weight).
  2. Stage 2: Exact numerical substitution (35% weight).
  3. Stage 3: Intermediate aggregate conversion (30% weight).
  4. Stage 4: Final value with currency symbol (₹) and scale unit (Crores) (15% weight).
- **Indian Economic Development (IED) Chronology Lock (`ECO_03`)**: Falsified chronology dates invalidate the proposition:
  - First IPR (1948), Planning Commission (1950), First Five-Year Plan (1951–1956), Second IPR (1956), Great Leap Forward China (1958), Great Proletarian Cultural Revolution (1966–1976), Plan Holiday (1966–1969), China Economic Reforms (1978), Pakistan Reforms (1988), New Economic Policy LPG India (1991), NITI Aayog (2015).

#### D. Social Science (CBSE Code 087)
- **Historical Entity Tuple Lock (`SST_01`)**: Requires quadruple verification: `[Leader, Event/Treaty, Location, Year]`. Contradicting NCERT history invalidates the point.
- **Geographical Parameters (`SST_02`)**: Rejects vague terms (*"very hot"*, *"good rain"*). Enforces exact crop thresholds:
  - *Rice*: $>25^\circ\text{C}$, $>100\text{ cm}$ rainfall.
  - *Wheat*: $10^\circ\text{C}–15^\circ\text{C}$ (sowing), $21^\circ\text{C}–26^\circ\text{C}$ (ripening), $50–75\text{ cm}$ rainfall.
  - *Cotton*: High temperature, 210 frost-free days, light rainfall ($60–85\text{ cm}$).
- **Civics Constitutional Lexical Mandate (`SST_03`)**: Zero tolerance for inversions (Horizontal vs. Vertical power sharing; Coming Together vs. Holding Together federations). 5 mandatory 1992 decentralization constitutional propositions.
- **Wall of Text Penalty (`SST_04`)**: Unnumbered continuous paragraphs on 5-mark analytical questions receive a mandatory 0.5 mark deduction.

### 5.3 Programmatic Post-Processing Overrides
To compensate for cognitive limits and occasional leniency in LLMs, `api/ocr-evaluate.js` applies deterministic JavaScript-level overrides (lines 982–1157):

```javascript
// 1. Dynamic Binary MCQ Hard-Lock
if (isMCQ) {
    resObj.maxMarks = expectedMcqWeight; // Dynamically set to 0.5 or 1.0
    if (isExplicitlyWrong) {
        resObj.score = 0;
    } else if (isCorrectOption) {
        resObj.score = expectedMcqWeight;
    } else if (Number(resObj.score) >= (expectedMcqWeight * 0.75)) {
        resObj.score = expectedMcqWeight;
    } else {
        resObj.score = 0;
    }
}

// 2. Descriptive Section Weight Safeguard (Fixes AI MCQ Inflation / descriptive compression)
if (qIdx >= 7 && qIdx <= 12 && Number(resObj.maxMarks) < 3) {
    if (combinedSchemeText.includes("4 marks") || combinedSchemeText.includes("[4]")) {
        resObj.maxMarks = 4.0;
    }
}

// 3. Off-Topic Zero Mark Penalty
if (isOffTopic) {
    resObj.score = 0;
}

// 4. Defend/Refute Stance Governance
if (wrongStance && Number(resObj.maxMarks) >= 3 && Number(resObj.score) > 1.0) {
    resObj.score = 1.0;
}

// 5. Feedback Token Budget Caps
if (Array.isArray(resObj.improvements) && resObj.improvements.length > 2) {
    resObj.improvements = resObj.improvements.slice(0, 2);
}

// 6. Mathematical Invariant Clamping & Programmatic Summation
const maxForQ = Number(resObj.maxMarks);
let s = Number(resObj.score);
if (!Number.isFinite(s) || s < 0) s = 0;
if (s > maxForQ) s = maxForQ;
resObj.score = s;

let calculatedTotal = result.results.reduce((sum, r) => sum + (Number(r.score) || 0), 0);
if (calculatedTotal > result.maxMarks) calculatedTotal = result.maxMarks;
result.totalScore = calculatedTotal;
```

* **Dynamic Binary MCQ Gate**:
  - Dynamically inspects question text and marking scheme headers for half-mark indicators (`0.5`, `½`, or `"half mark"`).
  - Locks MCQ `maxMarks` to `0.5` or `1.0`. MCQs can **never** be awarded 2, 3, or 4 marks.
  - Scores strictly all-or-nothing: full credit if correct; exactly `0.0` if incorrect or if feedback contains negative keywords (`"incorrect option"`, `"wrong choice"`, `"0/1"`).
  - Prohibits fractional partial credit (e.g., no 0.25 on 0.5M, no 0.5 on 1.0M).
* **Defend vs. Refute Stance Premise Error Ceiling**:
  Taking the wrong stance in CBSE Economics/BST is a fatal premise error. Programmatically capped to a **maximum of 1.0 mark** (out of 3 or 4) even if the background explanation is detailed.
* **Off-Topic Zero Mark Penalty**:
  For individual subjective questions ($\le 3$ marks), if feedback indicates the student wrote off-topic content (`"does not address"`, `"unrelated"`, `"off-topic"`), score is forced to `0`.
* **Descriptive Question Weight Safeguard**:
  Prevents models from compressing Section B/C descriptive questions (e.g., dropping Q7–Q12 to 1.5 marks) to reconcile sum discrepancies. Regex detectors restore descriptive questions to their full 4.0 (or 3.0) mark section weight.
* **15-Word Feedback Budget & Zero-Feedback Protocol**:
  - **Interactive Mode**: Full-mark answers have ultra-concise feedback (3–5 words, e.g., *"Correct option selected"*); `improvements: []`. Flawed answers capped strictly to 1 punchy sentence under 15 words.
  - **Batch Prediction Mode (Zero-Feedback Mandate)**: Answers scoring full marks (`score >= maxMarks`) have `feedback: ""` and `improvements: []`. Zero affirmation or commentary is written, saving 500–1,200 expensive candidate tokens per paper.
  - Improvements: Programmatically capped to at most 2 actionable bullet points (`slice(0, 2)`).
* **Deterministic Mathematical Clamping**:
  Per-question scores are strictly clamped to $[0, \text{maxMarks}]$. The total score is recalculated as the programmatic sum of question scores, clamped to $[0, \text{totalMaxMarks}]$. The system never trusts the LLM's arithmetic.

---

## 6. In-Place Firestore Re-Evaluation Flow

### 6.1 Moderator Workflow & Duplicate Prevention
Teachers and moderators frequently re-evaluate answer sheets after refining session instructions, adjusting marking rubrics, or auditing grading. Spawning a new Firestore document on each evaluation pollutes the student dashboard with duplicate records and corrupts longitudinal analytics.

### 6.2 Component Map & State Lifecycle
In `ocr-scan.html`:
1. **Initial Submission**:
   - `addDoc(collection(db, 'testResults'), { ... })` creates the result document.
   - Saves document ID in `currentSavedResultId = docRef.id`.
   - Caches request payload in `lastPayloadString = payloadString`.
   - Updates the browser URL query state via `window.history.replaceState({ resultId: docRef.id }, '', newUrl)` so page reloads immediately load the report card.
2. **Re-Evaluation Action**:
   - The print action panel displays the orange `🔄 Re-evaluate` button (`#btnReevaluate`).
   - Click listener executes `submitWithRetry(lastPayloadString)`.
   - Mutates the existing record in-place via Firestore's `updateDoc()`:
     ```javascript
     await updateDoc(doc(db, 'testResults', currentSavedResultId), {
         score: clampedScore,
         maxMarks: lockedMax,
         overallFeedback: report.overallFeedback,
         improvements: report.improvements,
         breakdown: report.results || [],
         modelUsed: report.modelUsed || 'gemini-4-argon',
         tokenUsage: report.tokenUsage || null,
         updatedAt: serverTimestamp()
     });
     ```
   - Re-renders the updated report card instantly without creating duplicate records.

---

## 7. Resilient Failover Backup Architecture

### 7.1 Two-Tier Failover Cascade
To maintain high availability during cloud rate limit spikes or regional outages, `api/ocr-evaluate.js` implements a resilient multi-tier failover cascade:

```
[Incoming Evaluation Request]
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│ Tier 1: Gemini 4 Argon Direct Single-Pass Vision            │
│ Primary Flagship Model (thinkingLevel: "medium")            │
└─────────────────────────────┬───────────────────────────────┘
                              │
                    [Pass / Fail Error?]
                              │
                     ┌────────┴────────┐
                     ▼                 ▼
                 (Success)     (429 / 503 / 504 / Quota)
                     │                 │
                     │                 ▼
                     │ ┌─────────────────────────────────────────────────────────────┐
                     │ │ Tier 2: Gemini 3.8 Flash Direct Single-Pass Vision Failover │
                     │ │ Sanitized Config (thinkingBudget: 512)                      │
                     │ └──────────────────────────────┬──────────────────────────────┘
                     │                                │
                     │                      [Pass / Fail Error?]
                     │                                │
                     │                       ┌────────┴────────┐
                     │                       ▼                 ▼
                     │                   (Success)     (Unreadable / Vision Fail)
                     │                       │                 │
                     │                       │                 ▼
                     │                       │ ┌─────────────────────────────────────────────┐
                     │                       │ │ Tier 3: Gemini 3.8 Flash Dual-Pass Fallback │
                     │                       │ │ Pass 1: Transcribe -> Pass 2: Grade         │
                     │                       │ └──────────────┬──────────────────────────────┘
                     │                       │                │
                     ▼                       ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Post-Processing Programmatic Academic Overrides & Invariant Clamping                        │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Dynamic Configuration Adaptation
* `gemini-4-argon`: Configured with qualitative `thinkingConfig: { thinkingLevel: "medium" }`. Numeric `thinkingBudget` is stripped.
* `gemini-3.8-flash`: Automatically sanitizes `generationConfig`, stripping `thinkingLevel` and supplying `thinkingConfig: { thinkingBudget: 512 }`.

### 7.3 Telemetry & Observability Fields
When failover occurs, `api/ocr-evaluate.js` records diagnostic telemetry:
* `result.modelUsed`: Tracks the exact model and pathway (e.g., `'gemini-3.8-flash (Backup Failover Single-Pass)'` or `'gemini-3.8-flash (Backup Dual-Pass Fallback)'`).
* `result.backupModelActivated`: Boolean flag set to `true` on failover.
* `result.failoverReason`: Captures the root-cause upstream error message (e.g., `primaryErr.message`).
* `result.tokenUsage`: Full cost audit breakdown in both USD and INR based on GCP list price rates.

---

## 8. Unrestricted Access / Gate Token Removal

### 8.1 Removal of Secondary Authentication Gate
In prior iterations, NerdTutors protected the scanner via a secondary gate authentication system (`gate-guard.js`, `login-gate.html`, and `GATE_CREDENTIALS`), returning a Base64 authorization token.

Per project directives, **all gate restrictions have been completely disabled**:
* **API Handler (`api/ocr-evaluate.js`)**:
  Lines 196–198:
  ```javascript
  // ===== Gate Security Check Disabled (Direct Access) =====
  const gateToken = req.headers['x-gate-token'] || "";
  ```
  The endpoint processes requests directly without validating passwords or rejecting unauthenticated tokens.
* **Frontend Guards**:
  - `gate-guard.js` operates as a permanent no-op.
  - `login-gate.html` immediately auto-redirects incoming traffic to `ocr-scan.html`.
  - No student or teacher is redirected to a gate login screen.

---

## 9. Report Card & Print Layout

### 9.1 Side-by-Side Split Panel Dashboard
Both `ocr-scan.html` (instant scanner preview) and `results.html` (`window.printReportCard`) render a unified, modern split dashboard:

```
┌──────────────────────────────────────────────┬────────────────────────────────────────────────────────────┐
│  LEFT SCORE PANEL (flex: 1, min-width: 280px)│  RIGHT PERFORMANCE PANEL (flex: 1.5, min-width: 320px)     │
├──────────────────────────────────────────────┼────────────────────────────────────────────────────────────┤
│  🏆 FINAL SCORE                              │  📋 QUESTION PERFORMANCE                                   │
│                                              │                                                            │
│                  28 / 40                     │  ┌───────┬───────┬───────┬───────┬───────┐                │
│                                              │  │  Q1   │  Q2   │  Q3   │  Q4   │  Q5   │                │
│  Grade:             A                        │  │   ✓   │   ✓   │   !   │   ✗   │   ✓   │                │
│  Performance:       Very Good                │  │  1/1  │  1/1  │ 1.5/3 │  0/1  │  4/4  │                │
│  Maximum Marks:     40                       │  └───────┴───────┴───────┴───────┴───────┘                │
│  Marks Lost:        12                       │  ... (5-column responsive question badge grid)             │
│                                              │                                                            │
│  ┌────────────┬────────────┬─────────────┐   │  Legend:                                                   │
│  │     22     │     3      │      5      │   │  ✓ Correct (Full)  ! Partial (Partial)  ✗ Incorrect (Zero)  │
│  │  Correct   │  Partial   │  Incorrect  │   │                                                            │
│  └────────────┴────────────┴─────────────┘   │  💡 Note: This sheet lists only questions where marks were │
│                                              │          lost. Review mistakes & model answers below.      │
│  Time Evaluated: 06:45:12 PM                 │                                                            │
└──────────────────────────────────────────────┴────────────────────────────────────────────────────────────┘
```

1. **Left Score Card (`.score-card-left`)**:
   - Giant final score typography (`3.5rem font-weight: 900 color: #c53030`).
   - Performance metrics table: Grade (`A+` to `F`), Performance verdict, Total Marks, Marks Lost.
   - Three summary badge boxes: Correct (green `#f0fdf4`), Partial (amber `#fffaf0`), Incorrect (red `#fff5f5`).
   - Date placed in top metadata grid; precise evaluation time placed at the bottom of the score card.
2. **Right Performance Grid (`.perf-card-right`)**:
   - 5-column CSS grid (`grid-template-columns: repeat(5, 1fr)`).
   - Question pill displays: Question number (`Q1`, `Q17(a)`), status icon (`✓`, `!`, `✗`), and score fraction (`earned / max`).
   - Performance status legend and informative guidance callout.

### 9.2 Question-by-Question Mistakes & Model Answers
* **Defensive Filtering**: The detailed correction section renders **ONLY questions where marks were lost** (`score < maxMarks`), eliminating clutter on successful questions.
* **Mistake Breakdown Elements**:
  - **Question Statement**: Cleanly rendered.
  - **Student Handwriting Quote**: Displayed in a dashed callout under *"What you wrote"*.
  - **Identified Mistake Phrases (`incorrectPhrases`)**: Exact flawed phrases rendered with strikethrough styling (`text-decoration: line-through`) alongside moderator explanations.
  - **Moderator Feedback**: Rendered in prominent warning styling.
  - **Model Answer**: Sanitized via `cleanModelAnswer()`, stripping markdown artifacts, delimiters, and trailing hashtags, and rendered in a prominent green card (`#f0fdf4`).
  - **Actionable Corrective Steps (`improvements`)**: Max 2 bullet points guiding how to achieve full marks.

### 9.3 Print & PDF CSS Standards
To ensure pixel-perfect printing and prevent ugly page breaks:
* **Narrow Page Margins**:
  ```css
  @page {
      size: A4 portrait;
      margin: 5mm 6mm; /* In ocr-scan.html and results.html print popup */
  }
  ```
  *(Note: Standard narrow print borders of `8mm 10mm` are also supported).*
* **Exact Background Color Preservation**:
  ```css
  *, *:before, *:after {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
  }
  ```
* **Page-Break Governance**:
  ```css
  .report-block, .score-card-left, .perf-card-right, .header, .meta-grid, .question-mistake-card {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
  }
  .section-title {
      break-after: avoid !important;
      page-break-after: avoid !important;
  }
  ```
* **Body Reset in `@media print`**:
  `body { margin: 0 !important; padding: 0 !important; }` allows `@page` margins to govern print borders cleanly without double-margin padding. Interactive buttons, upload forms, and navigational headers are styled with `display: none !important;`.

---

## 10. Security-Sensitive Surfaces & Phase 2 Findings

Inspection of the Evaluation & OCR subsystem reveals several critical architectural and security surfaces that must be addressed during Phase 2 overhaul:

### Finding 1: Unauthenticated Public Evaluation Endpoint (High Severity)
* **File & Line**: `api/ocr-evaluate.js:196-198`
* **Vulnerability Description**: The secondary gate check is disabled. The endpoint does not verify Firebase Authentication JWT tokens or session cookies. Any external actor can POST base64 image payloads to `/api/ocr-evaluate`, executing expensive Google Vertex AI / Gemini 4 Argon multimodal reasoning calls and incurring significant API charges.
* **Phase 2 Remediation**: Enforce Firebase Admin SDK token verification (`req.headers.authorization.split('Bearer ')[1]`) on all POST calls to `/api/ocr-evaluate`.

### Finding 2: Client-Spoofable Admin Bypass (Medium Severity)
* **File & Line**: `api/ocr-evaluate.js:47-60, 206-213`
* **Vulnerability Description**: Admin privileges (unlimited rate limits) are granted if `email.includes('admin')`, `gateToken.includes('admin')`, or if `req.headers['x-user-email']` matches an admin list. Because HTTP headers are controlled entirely by the client, any user can bypass rate limits by sending a spoofed header: `X-User-Email: admin@nerdtutors.com`.
* **Phase 2 Remediation**: Verify admin status exclusively through cryptographically verified Firebase Custom Claims (`decodedToken.admin === true`).

### Finding 3: In-Memory Serverless Rate Limiting Flaws (Medium Severity)
* **File & Line**: `api/ocr-evaluate.js:125-174`
* **Vulnerability Description**: Rate limiting is stored in an in-memory `Map` (`ocrRateLimitMap`). In serverless environments (Vercel), each cold start, edge instance, or concurrent container maintains an isolated memory space. Distributed clients or burst requests hitting different serverless containers bypass rate limiting entirely.
* **Phase 2 Remediation**: Replace in-memory rate limiting with a centralized distributed Redis store (e.g., Upstash Redis) using sliding-window rate limiting.

### Finding 4: Unvalidated Serverless Payload Ingestion (Medium Severity)
* **File & Line**: `api/ocr-evaluate.js:200-204, 256-296`
* **Vulnerability Description**: The backend relies on client-side constraints (`MAX_TOTAL_MB = 4.0`) to limit payload size. An external script can POST a 20MB payload directly to `/api/ocr-evaluate`, causing high memory consumption, CPU thrashing during base64 decoding, or Vercel function timeouts.
* **Phase 2 Remediation**: Implement strict request body byte-length validation and JSON schema validation (e.g., via Zod) before decoding base64 images.

### Finding 5: Client-Side Firestore Document Mutation (Medium Severity)
* **File & Line**: `ocr-scan.html:1469-1488, 1933-1942`
* **Vulnerability Description**: `testResults` documents are written and updated directly from frontend client JavaScript using the public Firebase SDK (`addDoc`, `updateDoc`). If Firestore Security Rules are overly permissive, any authenticated or unauthenticated client can tamper with test scores, modify grades, or delete student records.
* **Phase 2 Remediation**: Shift all `testResults` persistence and re-evaluation database mutations to authenticated backend serverless endpoints, locking Firestore collections with strict `allow write: if false` client rules.

---

## 11. Component & Configuration Reference Index

| File / Component | Purpose | Key Exports & DOM Selectors |
|---|---|---|
| `ocr-scan.html` | Client ingestion, camera workaround, downscaling, re-evaluation UI, split report card | `#fileInput`, `#cameraInput`, `#btnCamera`, `#btnGallery`, `#dropzone`, `#btnSubmitGrading`, `#reportCardContainer`, `#btnReevaluate`, `handleFiles()`, `fileToBase64()`, `postWithProgress()`, `submitWithRetry()`, `renderReportCard()` |
| `results.html` | Student test archive, score cards, standalone popup print window | `#printReportCardBtn`, `window.printReportCard()`, `@page A4` print stylesheet |
| `api/ocr-evaluate.js` | Multimodal AI evaluation, model failover, CBSE programmatic overrides | Primary: `gemini-4-argon`, Backup: `gemini-3.8-flash`, `buildGenerationConfigForModel()`, `evaluateSinglePass()`, `transcribeWithGemini()`, `gradeWithGemini()`, `getSubjectDirectives()`, `checkOcrRateLimit()` |
| `api/cbse-rules.json` | Formal CBSE 2.0.0-PROD deterministic knowledge base | `STAGE_1_VISION_OCR_PREPROCESSOR` (`OCR-01` to `OCR-08`), `STAGE_2_DETERMINISTIC_EVALUATOR` (Clauses 1–18, `ACCOUNTANCY_055`, `BUSINESS_STUDIES_054`, `ECONOMICS_030`, `SOCIAL_SCIENCE_087`) |

---
*End of Documentation — NerdTutors Evaluation & OCR Grading Engines Subsystem (`docs/system/evaluation-ocr.md`)*
