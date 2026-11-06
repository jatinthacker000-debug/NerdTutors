# NerdTutors Evaluation & OCR Grading Engine Architecture
**Target Documentation**: `docs/system/03-evaluation-ocr-engine.md`  
**Subsystem Scope**: `ocr-scan.html`, `results.html`, `api/ocr-evaluate.js`, `api/cbse-rules.json`

---

## 1. Executive Summary & Architectural Overview

The **NerdTutors Evaluation & OCR Grading Subsystem** is an autonomous, board-moderator-grade assessment pipeline tailored to official CBSE standards (Class 10th Social Science and Class 12th Commerce: Economics, Accountancy, and Business Studies).

The architecture features a decoupled, multi-tiered pipeline:
1. **Client Ingestion Layer (`ocr-scan.html` & `bundle-evaluator.js`)**: Mobile-optimized camera capture (circumventing mobile OS browser file bugs), smart canvas downscaling (1024px interactive, 768px single-tile batch), payload validation, and resume-safe local caching.
2. **AI Multimodal Evaluation Layer (`api/ocr-evaluate.js` & `api/batch-evaluate.js`)**: 
   - **Interactive Live Mode (`api/ocr-evaluate.js`)**: Google Gemini 4 Argon (`gemini-4-argon`) Direct Single-Pass multimodal reasoning as primary evaluator (8–12s latency, ~₹3.00/paper), with automatic failover to Gemini 3.8 Flash (`gemini-3.8-flash`) and dual-pass OCR transcription fallback.
   - **High-Volume Asynchronous Batch Mode (`api/batch-evaluate.js`)**: Google Cloud Vertex AI Batch Prediction API running `gemini-4-argon` at an official 50% discount with 768px single-tile alignment, marking scheme deduplication, and zero-feedback mandates (₹2.57/paper).
3. **Deterministic Academic Defense Layer (`api/cbse-rules.json` & Programmatic Overrides)**: Dynamic binary MCQ hard-locks (0.5 / 1.0), Defend vs. Refute stance capping, strict 15-word feedback budgets, anti-hallucination omitted question detectors, and immutable mathematical score clamping.
4. **Data Persistence & In-Place Re-Evaluation (`Firestore testResults`)**: Single-record in-place mutation avoiding duplicate test submissions.
5. **Report Card & Print Layout Engine (`ocr-scan.html`, `results.html`)**: Side-by-side split panel dashboard, 5-column question badge matrix, dynamic status legends, and narrow-margin A4 print stylesheets (`5mm 6mm`).

---

## 2. Student Paper Ingestion Subsystem (`ocr-scan.html`)

### 2.1 The Mobile Browser Multi-File Camera Bug & Resolution
* **The Vulnerability**: On mobile operating systems (Android Chrome, iOS Safari), applying the `multiple` attribute to an `<input type="file" accept="image/*" multiple>` element causes mobile OS file pickers to suppress or bypass the native device camera shortcut, forcing students to select existing photos from the gallery only. Conversely, applying `capture="environment"` disables multi-file selection.
* **Dual-Input Decoupled Architecture**:
  * In `ocr-scan.html`, two hidden file inputs are maintained:
    ```html
    <input type="file" id="fileInput" multiple accept="image/*,application/pdf" style="display: none;">
    <input type="file" id="cameraInput" accept="image/*" capture="environment" style="display: none;">
    ```
  * The dropzone UI provides two dedicated, clearly styled action triggers: `📷 Open Camera` (`#btnCamera`) and `📁 Choose Files` (`#btnGallery`).
  * Both inputs route their `change` events into a unified asynchronous handler: `handleFiles(e.target.files)`.
  * This allows students on smartphones to tap `📷 Open Camera`, snap page 1, return to the screen, tap `📷 Open Camera` again, snap page 2, and sequentially accumulate sheets into the upload queue (`uploadedFiles[]`) without losing previous photos.

### 2.2 Client-Side Smart Canvas Compression
* **Token Optimization & Latency Control**: Raw smartphone cameras capture 12MP–48MP images (3MB–15MB each), which inflate base64 payloads and burn unnecessary vision tile tokens.
* **Algorithm (`fileToBase64`)**:
  * If the file is a PDF (`application/pdf`), it is converted directly to base64 via `FileReader.readAsDataURL()`.
  * For images, an offscreen HTML5 `<canvas>` element dynamically resizes the image so that the maximum dimension (width or height) is clamped to **1024px** while strictly preserving aspect ratio:
    ```javascript
    const MAX_DIM = 1024;
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
  * The canvas is exported as `image/jpeg` with quality `0.75` (`canvas.toDataURL('image/jpeg', 0.75)`).
  * **Impact**: Reduces payload weight by >80% and vision tile token consumption by ~70% while keeping student handwriting, accounting ledger lines, and economics curves crisp and legible.

> [!NOTE]
> **Dual Resolution Strategy**:
> - **Interactive Grader (`ocr-scan.html`)**: Employs `MAX_DIM = 1024px` with `MEDIA_RESOLUTION_LOW` for fast interactive single-paper evaluations.
> - **Bulk Batch Evaluator (`bundle-evaluator.js`)**: Employs `MAX_DIM = 768px` (`quality = 0.80`) with `MEDIA_RESOLUTION_MEDIUM`. 768px matches Google Vertex AI's native vision tile grid (768×768), locking consumption to **exactly 258 tokens per page** and eliminating multi-tile fragmentation.

### 2.3 Payload Sizing & Weak-Connection Resilience
* **Queue Limits**: Hard cap of `MAX_IMAGES = 10` sheets per submission.
* **Payload Size Guard**: `currentPayloadMB()` monitors cumulative base64 payload size against `MAX_TOTAL_MB = 4.0 MB`, issuing pre-flight warnings before hitting Vercel's ~4.5 MB serverless body execution threshold.
* **Progressive XHR & Exponential Retry**:
  * `postWithProgress()` leverages `XMLHttpRequest` with `xhr.upload.onprogress` to display a real-time progress bar (0%–100%) during the slow cellular uplink phase.
  * `submitWithRetry()` wraps uploads with exponential backoff for transient network drops (status 0, timeout, 5xx), while never retrying client-side 4xx rejections.
* **Storage Persistence (Resume Draft)**:
  * Selected image payloads are cached in `localStorage` under `ocr_scan_images`. If a student accidentally refreshes or encounters a network disconnect, images are automatically restored upon reload via `loadImagesDraft()`.

---

## 3. AI Evaluation Pipeline (`api/ocr-evaluate.js`)

```
   [Student Answer Sheet Images (Base64)]
                   │
                   ▼
┌────────────────────────────────────────────────────────┐
│  Tier 1 Primary Evaluator: Gemini 4 Argon             │
│  - Architecture: Direct Single-Pass Multimodal Vision  │
│  - Config: temperature: 0.0, seed: 42                  │
│  - Thinking: thinkingLevel: "medium" / "low"          │
│  - Latency: ~8-14s | Token Cost: ~₹3.00 (vs ₹11+ Dual) │
└───────────────────────┬────────────────────────────────┘
                        │
             [Success?] ├───► (Yes) ──► Post-Processing Safety Nets
                        │
                   (No: 429/503/Quota)
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│  Tier 2 Failover Backup: Gemini 3.8 Flash              │
│  - Architecture: Direct Single-Pass Vision Failover    │
│  - Config: temperature: 0.0, seed: 42                  │
│  - Thinking: thinkingBudget: 512                       │
│  - Tracks: backupModelActivated = true                 │
└───────────────────────┬────────────────────────────────┘
                        │
             [Success?] ├───► (Yes) ──► Post-Processing Safety Nets
                        │
                   (No: OCR Unreadable)
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│  Tier 3 Fallback: Dual-Pass Vision + Grading           │
│  - Pass 1: Literal OCR Transcription (Gemini Vision)   │
│  - Pass 2: Structured Evaluation on Extracted Text     │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│  Post-Processing Academic Safety Nets & Overrides     │
│  - Binary MCQ hard-lock (0.5 or 1.0 strictly)         │
│  - Defend/Refute stance penalty cap (max 1.0 mark)     │
│  - Math clamp [0, maxMarks] & programmatic sum         │
│  - Off-topic rejection & 15-word feedback budget       │
└────────────────────────────────────────────────────────┘
```

### 3.1 Tier 1: Frontier Primary Evaluator (`gemini-4-argon`)
* **Direct Single-Pass Multimodal Vision**:
  * Instead of paying the latency and token overhead of a dual-pass OCR-then-grade pipeline, Gemini 4 Argon accepts the student images directly alongside the exam questions and CBSE marking scheme in a single API round-trip.
  * **Latency**: 8–14 seconds (down from 90–120 seconds in dual-pass).
  * **Cost**: Drops from ₹11.03 to ~₹3.00 per submission (~65% token savings).
* **Deterministic Configuration**:
  * `temperature: 0.0`
  * `seed: 42` (hard-pinned seed guarantees identical mark allocations across repeated runs of identical papers).
  * `mediaResolution: "MEDIA_RESOLUTION_LOW"`
  * `responseMimeType: "application/json"`
* **Qualitative Reasoning Mapping**:
  * Gemini 4 Argon **strictly rejects** numeric `thinkingBudget` with HTTP 400 `INVALID_ARGUMENT`.
  * `buildGenerationConfigForModel()` programmatically maps Argon to qualitative thinking:
    ```javascript
    config.thinkingConfig = {
        thinkingLevel: options.thinkingLevel || thinkingLevel || "medium"
    };
    ```

### 3.2 Tier 2: Resilient Failover Backup (`gemini-3.8-flash`)
* **Trigger Conditions**: HTTP 429 (rate limit), 503 (service overloaded), 504 (gateway timeout), or quota depletion across API keys.
* **Dynamic Config Adaptation**:
  * Gemini 3.8 Flash requires numeric token budgets for thinking rather than qualitative strings.
  * The pipeline sanitizes `generationConfig`, stripping `thinkingLevel` and supplying `thinkingConfig: { thinkingBudget: 512 }`.
* **Telemetry & Observability**:
  * Sets `result.modelUsed = 'gemini-3.8-flash (Backup Failover Single-Pass)'`.
  * Sets `result.backupModelActivated = true`.
  * Logs root-cause failure in `result.failoverReason`.

### 3.3 Tier 3: Dual-Pass Transcription Fallback
* **Manual or Automatic Trigger**:
  * Invoked explicitly if `body.forceDualPass === true` or automatically if single-pass fails across both models.
* **Pass 1 (`transcribeWithGemini`)**:
  * Runs as pure forensic OCR (`temperature: 0.0, seed: 42`, no thinking config).
  * Transcribes literal handwriting word-for-word into Markdown without evaluating, autocorrecting, or completing sentences.
* **Pass 2 (`gradeWithGemini`)**:
  * Feeds `<student_transcription>` into the high-reasoning evaluator model against the questions and rubric.

---

## 4. Academic Research Defenses & Deterministic Safety Nets

Based on benchmarks from *"Reliable AI Marking of Handwritten Exam Sheets: Failures and Fixes"*, NerdTutors enforces rigorous programmatic guardrails over LLM outputs in `api/ocr-evaluate.js`:

| Academic Vulnerability | Production Mechanism | Implementation File & Line |
|---|---|---|
| **MCQ Lenient Partial Marks & Point Inflation** | Dynamic Binary MCQ Hard-Lock (`0.0` or `maxMarks`) | `api/ocr-evaluate.js:983-1053` |
| **Defend vs Refute Stance Premise Error** | Premise Error Ceiling (Capped to max `1.0` mark) | `api/ocr-evaluate.js:1091-1105` |
| **Invented Mark Weights & Sum Mismatches** | Programmatic Clamping `[0, maxMarks]` & Sum Summation | `api/ocr-evaluate.js:1112-1157` |
| **Descriptive Question Weight Hallucination** | Section Weight Restoration (Q7–Q12 restored to 4.0) | `api/ocr-evaluate.js:1055-1073` |
| **Discursive Rambling & Prompt Bloat** | 15-Word Feedback Budget & Max 2 Improvements Cap | `api/ocr-evaluate.js:469-476, 1107-1110` |
| **Student Prompt Injection in Handwriting** | Untrusted Data Fencing & Instruction Sandboxing | `api/ocr-evaluate.js:399-401` |
| **Blank / Skipped Question Hallucinations** | Explicit Presence Check & Zero Award | `api/ocr-evaluate.js:448-452` |
| **Duplicate Result Entries on Regrading** | In-Place Firestore Document Mutation (`updateDoc`) | `ocr-scan.html:1910-1954` |

### 4.1 Dynamic Binary MCQ Hard-Lock
* **Dynamic Weight Detection**:
  * Inspects exam text and marking scheme headers for half-mark indicators (`0.5`, `½`, or `half mark`).
  * Dynamically locks `resObj.maxMarks` to `0.5` or `1.0`. MCQs can **never** be awarded 2, 3, or 4 marks.
* **Strict All-or-Nothing Scoring**:
  * Compares student option letter directly with marking scheme.
  * If correct: `resObj.score = expectedMcqWeight` (full marks: 0.5 or 1.0).
  * If wrong (or feedback contains negative phrases like `"incorrect option"`, `"wrong option"`, `"0/1"`): `resObj.score = 0.0`.
  * **Zero partial credit**: Marks like `0.25` on 0.5M questions or `0.5` on 1.0M questions are strictly prohibited.

### 4.2 Defend vs. Refute Stance Governance
* In CBSE Board Economics and Business Studies examinations, questions requiring a student to "Defend or Refute" a proposition hinge on selecting the correct initial stance.
* Taking the wrong stance (e.g., defending that British colonial rule modernized Indian agriculture) is a fatal premise failure.
* **Governance**:
  * In the prompt: Explicitly warned that wrong stance caps total question marks at maximum 1.0.
  * In programmatic post-processing: If `feedbackText` matches stance error keywords (`"defended instead of refut"`, `"refuted instead of defend"`, `"wrong stance"`) and `maxMarks >= 3`, any score above 1.0 is programmatically clamped:
    ```javascript
    if (wrongStance && Number(resObj.maxMarks) >= 3 && Number(resObj.score) > 1.0) {
        resObj.score = 1.0;
    }
    ```

### 4.3 Feedback Budget & Zero-Feedback Protocol
* **Interactive Mode (`api/ocr-evaluate.js`)**:
  * **Full Marks (score === maxMarks)**: Feedback is ultra-lean (3–5 words: e.g., `"Correct option selected"`).
  * `studentAnswerText: ""`, `improvements: []`, `incorrectPhrases: []`.
* **Batch Mode (`api/batch-evaluate.js`) - The Zero-Feedback Mandate**:
  * **Full Marks (score === maxMarks)**: Feedback MUST be strictly empty string (`""`) and improvements MUST be empty array (`[]`).
  * Enforced via prompt directive and deterministic JavaScript wipe (`if (score >= maxMarks) { feedback = ""; improvements = []; }`).
  * Saves 500–1,200 expensive candidate output tokens per paper.
* **Partial or Zero Marks (score < maxMarks)**:
  * Feedback is strictly limited to 1 punchy sentence under 15 words.
  * `improvements`: Programmatically capped to a maximum of 2 actionable tips via `resObj.improvements.slice(0, 2)`.
  * Plain-text mandate: Markdown syntax tokens (`**bold**`, `*italics*`, `### headers`) are stripped to preserve clean JSON parsing.

### 4.4 Deterministic Mathematical Clamping & Invariant Sum Recalculation
* **Per-Question Clamping**:
  ```javascript
  const maxForQ = Number(resObj.maxMarks);
  let s = Number(resObj.score);
  if (!Number.isFinite(s) || s < 0) s = 0;
  if (s > maxForQ) s = maxForQ;
  resObj.score = s;
  ```
* **Sum Invariant**:
  * The system never trusts the LLM's returned `totalScore`.
  * Total earned score is recalculated programmatically:
    ```javascript
    let calculatedTotal = result.results.reduce((sum, r) => sum + (Number(r.score) || 0), 0);
    if (calculatedTotal > result.maxMarks) calculatedTotal = result.maxMarks;
    result.totalScore = calculatedTotal;
    ```

### 4.5 In-Place Firestore Re-Evaluation
* **Problem**: Teachers or moderators frequently re-evaluate papers after updating session directives or adjusting question weights. Creating a new document each time pollutes the student dashboard with duplicate result cards.
* **Mechanism (`ocr-scan.html`)**:
  * On initial submission, the Firestore ID is saved in `currentSavedResultId = docRef.id`, and the JSON request body is stored in `lastPayloadString`.
  * When `🔄 Re-evaluate` (`#btnReevaluate`) is clicked, `submitWithRetry(lastPayloadString)` is executed, and Firestore is updated using `updateDoc(doc(db, 'testResults', currentSavedResultId), ...)`:
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
  * The report card re-renders instantly without spawning duplicate records.

---

## 5. UI Architecture & Report Card Engine (`ocr-scan.html`, `results.html`)

### 5.1 Side-by-Side Split Panel Layout
Both `ocr-scan.html` (instant scanner preview) and `results.html` (student portal) use a unified split dashboard:

```
┌────────────────────────────────────────┬────────────────────────────────────────────────────────┐
│  LEFT PANEL: Score & Metrics (1fr)     │  RIGHT PANEL: Performance Grid (1.5fr)                 │
├────────────────────────────────────────┼────────────────────────────────────────────────────────┤
│  🏆 FINAL SCORE                        │  📋 QUESTION PERFORMANCE                               │
│        28 / 40                         │  ┌───────┬───────┬───────┬───────┬───────┐            │
│                                        │  │  Q1   │  Q2   │  Q3   │  Q4   │  Q5   │            │
│  Grade:         A                      │  │   ✓   │   ✓   │   !   │   ✗   │   ✓   │            │
│  Performance:   Very Good              │  │  1/1  │  1/1  │ 1.5/3 │  0/1  │  4/4  │            │
│  Max Marks:     40                     │  └───────┴───────┴───────┴───────┴───────┘            │
│  Marks Lost:    12                     │  ... (5-column responsive item grid)                   │
│                                        │                                                        │
│  ┌──────────┬──────────┬───────────┐   │  Legend:                                               │
│  │    22    │    3     │     5     │   │  ✓ Correct (Full)  ! Partial  ✗ Incorrect (Zero)       │
│  │ Correct  │ Partial  │ Incorrect │   │                                                        │
│  └──────────┴──────────┴───────────┘   │  💡 Note: Detailed mistakes shown below for lost marks │
│  Time Evaluated: 06:45:12 PM           │                                                        │
└────────────────────────────────────────┴────────────────────────────────────────────────────────┘
```

1. **Left Panel (Score Summary)**:
   * Giant typography for final score (`3.5rem font-weight: 900`).
   * Breakdown metrics: Grade (`A+` to `F`), Performance verdict, Total Marks, Marks Lost.
   * Three summary badge boxes: Correct (green `#f0fdf4`), Partial (amber `#fffaf0`), Incorrect (red `#fff5f5`).
   * Evaluation timestamp placed at the bottom.
2. **Right Panel (Item-Level Grid)**:
   * 5-column CSS grid (`grid-template-columns: repeat(5, 1fr)`).
   * Question pill displays: Question identifier (`Q1`, `Q17(a)`), Status icon (`✓`, `!`, `✗`), and score fraction (`earned / max`).
   * Color-coded background and borders matching question performance status.
   * Horizontal legend and informative correction note.

### 5.2 Question-by-Question Mistakes & Model Answers
* **Defensive Filtering**: The detailed question breakdown renders **ONLY questions where marks were lost** (`score < maxMarks`), preventing cognitive clutter.
* For each flawed question:
  * **Question Statement**: Cleanly rendered.
  * **Student Answer Transcription**: Tagged under *"What you wrote"* in dashed callout box.
  * **Identified Errors (`incorrectPhrases`)**: Exact mistaken words or calculations rendered with strikethrough styling (`text-decoration: line-through`) alongside specific moderator explanations.
  * **Moderator Mistake & Feedback**: Red feedback pill.
  * **Official Model Answer**: Extracted from marking scheme and sanitized via `cleanModelAnswer()` in a prominent green card (`#f0fdf4`).
  * **Actionable Next Steps (`improvements`)**: Max 2 bullet points guiding how to achieve full marks.

### 5.3 Print & PDF Styling Standards
To ensure professional printing and zero page-overflow issues:
* **Narrow Page Margins**:
  ```css
  @page {
      size: A4 portrait;
      margin: 5mm 6mm;
  }
  ```
* **Color Preservation**:
  ```css
  *, *:before, *:after {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
  }
  ```
* **Clean Page-Break Governance**:
  ```css
  .report-block, .score-card-left, .perf-card-right, .header, .meta-grid {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
  }
  .section-title {
      break-after: avoid !important;
      page-break-after: avoid !important;
  }
  ```
* In `@media print`, interactive buttons, navigation headers, and file upload containers are hidden (`display: none !important;`), while `#reportCardContainer` occupies 100% width with double margins stripped.

---

## 6. Integration Checklist & File Map

* `ocr-scan.html`:
  * Upload UI, decoupled camera/gallery inputs (`#fileInput`, `#cameraInput`).
  * Canvas downscaling (1024px, 0.75 quality JPEG).
  * XHR upload progress (`postWithProgress`) and resume caching.
  * In-place Firestore re-evaluation (`#btnReevaluate`).
  * Split-panel report card DOM rendering (`renderReportCard`).
* `results.html`:
  * Student test archive, score filtering, and stats cards.
  * Modal report card preview with popup print window (`window.printReportCard`).
  * Dedicated print stylesheet (`margin: 5mm 6mm`).
* `api/ocr-evaluate.js`:
  * Primary Gemini 4 Argon single-pass vision handler.
  * Failover to Gemini 3.8 Flash and backup dual-pass transcription.
  * Model-specific `generationConfig` mapping (Argon qualitative `thinkingLevel` vs. Flash numeric `thinkingBudget`).
  * Binary MCQ hard-lock, Defend/Refute stance caps, and math clamping.
* `api/cbse-rules.json`:
  * Stage 1 literal OCR transcription guidelines.
  * Stage 2 CBSE general marking guidelines (Clauses 1–18).
  * Subject-specific deterministic matrices (`ACCOUNTANCY_055`, `BUSINESS_STUDIES_054`, `ECONOMICS_030`, `SOCIAL_SCIENCE_087`).

This architectural specification is complete, verified against the codebase, and formatted for `docs/system/03-evaluation-ocr-engine.md`.

