# Nerd Tutors Workspace Specifications

## 1. Evaluation & OCR Grading Standards (`api/ocr-evaluate.js`)
* **Strict Evaluation Standard:** The evaluation prompt MUST prioritize strict, objective moderator rules (strict MCQ option matches, zero marks for off-topic content, terminology/spelling check penalties, brevity caps, etc.). Do not relax these into proportional/moderate rubrics.
* **Safety Nets:** Clamping of individual scores to `[0, maxMarks]` and programmatic sum recalculation is enforced at the end of the API handler to ensure mathematical correctness.
* **Rephrased Model Answers:** The API schema expects a student-friendly, simplified 2-3 sentence `modelAnswer` based on the marking scheme.

## 2. Dashboard & Report Card Layout
* **Side-by-Side Split Panel:** The default report card preview and printed PDF layout (used in `results.html`, `ocr-scan.html`, `settings.html`, and `admin.js`) displays a split screen:
  * **Left Side:** Final Score block, grade/performance metrics, badge counts (Correct, Partial, Incorrect).
  * **Right Side:** Question-by-Question performance badges grid (Checks, Exclamations, Crosses) and dynamic legend.
* **Print Styling:**
  * `@page { margin: 0; }` must be used inside printing style blocks to hide the default browser headers (date/time) and footers (`about:blank`, page counts).
  * Page borders/margins must instead be styled inside the `body` tag using `padding: 10mm 15mm !important;`.
  * Ensure color backgrounds print by applying `-webkit-print-color-adjust: exact !important;` and `print-color-adjust: exact !important;`.
  * The evaluation date goes in the top metadata table (date-only via `.toLocaleDateString()`), and the detailed evaluation time (via `.toLocaleTimeString()`) is placed at the bottom of the left Final Score card to preserve clean formatting.

## 3. Data Export & Filtering Console (`dashboard.html` / `dashboard.js`)
* Use a clean, advanced filter box on the student dashboard that filters by Class (10th vs 12th) and dynamically updates available sessions.
* Export outputs as a single unified CSV containing structured test session details rather than multiple fragmented cards.

## 4. Comprehensive System Memory (Implementation Log)

This section contains the exact implementations, structures, and business logic created to prevent any context loss across sessions.

### A. Secondary Authentication Gate
* **Purpose**: Restrict access to the OCR scanner, preventing unauthorized API usage by students or non-moderators.
* **Component Map**:
  1. [api/verify-gate.js](file:///d:/Trinno/NerdTutors/api/verify-gate.js): Serverless POST endpoint. Checks credentials. Returns a Base64 token `Buffer.from(username + ":" + password).toString('base64')`. It checks against the `GATE_CREDENTIALS` environment variable (value format: `user1:pass1,user2:pass2`). If missing, it defaults to:
     - `nerd_tutor_alpha` / `nt_pass_alpha2026`
     - `nerd_tutor_beta` / `nt_pass_beta2026`
     - `nerd_tutor_gamma` / `nt_pass_gamma2026`
     - `nerd_tutor_delta` / `nt_pass_delta2026`
     - `nerd_tutor_epsilon` / `nt_pass_epsilon2026`
  2. [gate-guard.js](file:///d:/Trinno/NerdTutors/gate-guard.js): Lightweight frontend script injected at the very top of `<head>` in all HTML files. Immediately checks `localStorage.getItem('gate_authenticated')`. If missing, blocks page load and redirects the window to `login-gate.html` (preserving query params for return redirection).
  3. [login-gate.html](file:///d:/Trinno/NerdTutors/login-gate.html): Secure glassmorphism portal. Handles form submission, displays toasts on failure, and stores authentication states in `localStorage` upon success before redirecting.
  4. [api/ocr-evaluate.js](file:///d:/Trinno/NerdTutors/api/ocr-evaluate.js): Enforces authentication. Reads `x-gate-token` from headers. Compares it against the valid Base64 credential sets. Returns `401 Unauthorized` on mismatch.

### B. In-Place Firestore Re-Evaluation
* **Purpose**: Allow moderators to re-submit a student's answer sheet to correct grading anomalies or modify rules without generating duplicate test result entries.
* **Component Map**:
  - [ocr-scan.html](file:///d:/Trinno/NerdTutors/ocr-scan.html):
    - Stores the initial submission's Firestore document ID in `currentSavedResultId` and the input payload string in `lastPayloadString`.
    - Displays a `🔄 Re-evaluate` button in the print actions panel after grading finishes.
    - Click event triggers `api/ocr-evaluate` with the cached payload, then updates the existing Firestore document in-place using `updateDoc()` and re-renders the updated report card without duplication.

### C. Programmatic Grading Override System
* **Purpose**: Compensate for cognitive limits in smaller Vision-OCR models by programmatically enforcing strict academic board standards.
* **Logic Location**: Inside the results parsing loop in [api/ocr-evaluate.js](file:///d:/Trinno/NerdTutors/api/ocr-evaluate.js#L520-L560).
* **Rule Overrides**:
  1. **Strict MCQ check**: Checks if `maxMarks === 1` AND question identifiers contain `"mcq"` or represent `Q1` to `Q8`. If the feedback text contains negative words (e.g. `"incorrect"`, `"wrong"`, `"should be"`, `"instead of"`, `"0/1"`), it forces `resObj.score = 0`. This keeps composite sections (like `Section A` worth 8 marks) safe from block-wide wipeouts.
  2. **Off-Topic check**: Checks if `maxMarks <= 3` (individual subjective questions) AND feedback contains `"off-topic"`, `"unrelated"`, or `"does not address"`. If matched, forces `resObj.score = 0` (strict zero marks).
  3. **Math Clamping**: Programmatically forces `resObj.score` into `[0, maxMarks]` and recalculates `totalScore` as the mathematical sum of all questions.

### D. Mobile Camera Upload Integration
* **Purpose**: Resolve the mobile OS browser bug where the `multiple` attribute disables the native camera capture menu.
* **Component Map**:
  - [ocr-scan.html](file:///d:/Trinno/NerdTutors/ocr-scan.html):
    - HTML has two inputs: `#fileInput` (multiple, accept="image/*") and `#cameraInput` (accept="image/*", capture="environment").
    - UI dropzone contains two buttons: `📷 Open Camera` and `📁 Choose Files`.
    - Event handlers map both inputs to the unified `handleFiles` function, allowing students to capture images page-by-page sequentially using the camera, accumulating them in the upload queue.

---

## 5. Dual-Pass Grading Architecture (Pure Gemini 3.8 Flash)
* **Strategy**:
  * **Pass 1 (High-Resolution Visual Transcription)**: Call `gemini-3.8-flash` with `mediaResolution: "MEDIA_RESOLUTION_HIGH"` to transcribe handwritten student sheets into Markdown.
  * **Pass 2 (Deterministic Evaluator)**: Call `gemini-3.8-flash` with a 1,024-token thinking budget to evaluate transcribed student answers against official questions, model answers, and the CBSE 2.0 deterministic rules matrix ([api/cbse-rules.json](file:///d:/Trinno/NerdTutors/api/cbse-rules.json)).
  * **Fallback**: Single-pass direct vision evaluation if dual-pass fails.
* **Core File**: [api/ocr-evaluate.js](file:///d:/Trinno/NerdTutors/api/ocr-evaluate.js).


