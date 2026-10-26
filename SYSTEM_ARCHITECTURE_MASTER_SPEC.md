# NerdTutors: System Architecture & Operations Master Specification
**Document Version:** 1.0.0 (Production Master)  
**Author:** Antigravity AI Engineering Team (DeepMind / NerdTutors)  
**Target Audience:** Future AI Agents, Backend Developers, and DevOps Engineers  
**Classification:** Mission-Critical Architecture Reference  

---

> [!IMPORTANT]
> **READ THIS BEFORE MODIFYING ANY EVALUATION, BATCHING, OR CLOUD CODE:**  
> This specification documents the exact configuration, infrastructure permissions, cloud routing, API constraints, and database rules governing NerdTutors' AI paper evaluation and batch processing engine. Deviating from the rules in this document will result in production outages, broken Firebase permissions, invalid Google Cloud API errors, or massive unbilled retail compute expenses.

---

## 1. Executive Summary & Cost Architecture

NerdTutors operates a dual-tier paper evaluation system designed for Indian academic boards (CBSE Classes 10 & 12) across **Economics (030)**, **Business Studies (054)**, **Accountancy (055)**, and **Social Science (087)**.

```
+---------------------------------------------------------------------------------------------------+
|                                 NERDTUTORS EVALUATION PIPELINE                                    |
+---------------------------------------------------------------------------------------------------+
|  1. LIVE SINGLE-PASS EVALUATION (Single Student)       |  2. ASYNCHRONOUS BATCH EVALUATION (Class) |
|  - Endpoint: /api/ocr-evaluate.js                      |  - Endpoint: /api/batch-evaluate.js       |
|  - Channel: Vertex AI Real-time Streaming              |  - Channel: Vertex AI BatchPredictionJobs  |
|  - Latency: ~8–12 seconds                              |  - Latency: ~3–4 minutes per classroom    |
|  - Retail Cost: ~₹10.00 – ₹15.00 per paper             |  - Wholesale Cost: ~₹1.93 – ₹3.00 (50% off)|
+---------------------------------------------------------------------------------------------------+
```

### The 50% Asynchronous Batch Discount
* Google Cloud Vertex AI provides an official **50% discount** on both prompt and candidate tokens for asynchronous batch prediction jobs compared to standard online generation.
* Verified Production SKU Evidence (Google Cloud Billing, 25 Oct 2026):
  * `Gemini 4 Argon Global Text Output - Batch Predictions`: **₹0.98**
  * `Gemini 4 Argon Global Text Input - Batch Predictions`: **₹0.95**
  * **Total Realized Cost Per Student Paper**: **₹1.93** (approx. 2.3 cents USD).
  * In contrast, retail online generation runs cost **₹10.00 – ₹15.00+** when frontend retries occur on slow connections.

---

## 2. Infrastructure & Cloud Identity Registry

### 2.1 Google Cloud Platform (GCP)
* **GCP Project ID**: `nerd-tutors-001` (Numeric Project Number: `975383880672`)
* **Default Region**: `us-central1` (Host: `aiplatform.googleapis.com` or `us-central1-aiplatform.googleapis.com`)
* **Service Account Principal**: `vertex-express@nerd-tutors-001.iam.gserviceaccount.com`
* **Local Service Account Key File**: `vertex-key.json` (root directory, strictly gitignored)
* **Vercel Production Environment Variable**: `GCP_SERVICE_ACCOUNT_KEY` (contains full raw JSON of `vertex-key.json`)
* **Required IAM Roles on Service Account**:
  * `roles/aiplatform.user` (Vertex AI User - needed to dispatch BatchPredictionJobs)
  * `roles/storage.admin` or `roles/storage.objectAdmin` (GCS Object Admin - needed to read/write JSONL manifests)

### 2.2 Google Cloud Storage (GCS)
* **Dedicated Bucket Name**: `nerd-tutors-001-batch-evals`
* **Bucket Location**: `US` Multi-Region (Standard Storage Class)
* **Object Structure**:
  * `inputs/<sessionId>_<timestamp>.jsonl`: JSONL manifest containing batch input requests.
  * `outputs/<sessionId>_<timestamp>/`: Destination directory where Vertex AI writes completed `prediction-model-..._predictions.jsonl` output files.

> [!CAUTION]
> **UNRELATED GCP MARKETING BANNERS:**  
> Google Cloud Console frequently displays promotional banners for **"Storage Batch Operations API"**. This is an unrelated GCP object migration tool for transferring petabytes of storage. It is **NOT** needed and must **NEVER** be activated or integrated into NerdTutors.

---

## 3. The 4 Fatal Traps Every New Agent Must Avoid

### Trap 1: NEVER Switch from Vertex AI to Gemini Developer API
* **Rule**: NerdTutors runs on enterprise **Google Cloud Vertex AI** (`aiplatform.googleapis.com`), authenticated via OAuth2 Service Account bearer tokens (`vertex-key.json`).
* **Why**: Google's public Developer API (`generativelanguage.googleapis.com`) lacks the enterprise GCS pipeline, does not support the GCP credit billing account (`₹28,000+` free tier credits), and does not offer the same multi-student JSONL GCS batch scheduler.
* **Instruction**: Never import `@google/generative-ai` or redirect API endpoints to `generativelanguage.googleapis.com`.

---

### Trap 2: Explicit vs. Implicit Caching (The Code 3 Fatal Error)
* **The Error**: Passing an invalid `cachedContent` parameter causes Vertex AI to crash the batch with:
  ```json
  {"code": 3, "message": "Invalid CachedContent name: vertex-implicit-ttR25WQt1fwY8qrcvGqF"}
  ```
* **The Mechanism**:
  1. Vertex AI batch prediction requires `cachedContent` to be a fully qualified resource URI:
     `projects/{project}/locations/{location}/cachedContents/{cacheId}` or `cachedContents/{cacheId}`.
  2. If the user created a session without explicit cloud context caching, the session holds a local or implicit tag (e.g., `vertex-implicit-...`).
* **The Invariant**:
  ```javascript
  const isExplicitCache = Boolean(
      cachedContentId && 
      (cachedContentId.startsWith('cachedContents/') || cachedContentId.includes('/cachedContents/'))
  );

  // ONLY attach cachedContent if it is a validated explicit Google resource
  if (isExplicitCache) {
      reqItem.cachedContent = cachedContentId;
  }
  ```
* **Fallback Behavior**: When `isExplicitCache` is false, embed the full exam questions, marking scheme, teacher instructions, and CBSE directives directly into `promptBase`. Vertex AI automatically activates **implicit prefix caching** under the hood without throwing errors!

---

### Trap 3: The Client Firebase Rules Constraint (NEVER Create New Collections)
* **The Situation**: The Firebase project belongs to the **CLIENT**, not the development team. The developer has **NO access** to update the Firestore Security Rules in the Firebase Console.
* **Client's Locked Firestore Rules Allow ONLY**:
  * `testResults` (Full read/write for authenticated users)
  * `testSessions` (Read for users, write for admin)
  * `questions` (Read for users, write for admin)
  * `questionBatches` (Read for users, write for admin)
  * `gateCredentials` (Admin authentication)
* **The Failure Mode**: Creating or querying any new collection from the client browser (such as `batchJobs`, `evalQueue`, `auditLogs`) triggers an immediate unhandled fatal error:
  ```text
  FirebaseError: Missing or insufficient permissions.
  ```
* **The Architectural Rule**:
  1. **Batch Metadata Storage**: Store all batch job metadata (`batchId ➔ { sessionId, sessionName, class, subject, maxMarks, targetGroup, studentsMetadata }`) in browser **`localStorage`** (`nt_batch_job_<id>`).
  2. **Evaluation Results Storage**: Write student report cards **EXCLUSIVELY to `testResults`** via `addDoc(collection(db, 'testResults'), payload)`.
  3. Never call `collection(db, 'batchJobs')` from client JavaScript.

---

### Trap 4: The Session ID Orphan Bug (Data Visibility Invariant)
* **The Bug**: If a batch evaluation record is saved to `testResults` with `sessionId: null` or an empty string, the student report card **disappears completely** from the school dashboard!
* **Why**: The admin results viewer (`admin.html` / `session-manager.js`) and Question Matrix (`dashboard.html` / `matrix-manager.js`) filter results using:
  ```javascript
  if (data.sessionId === selectedSessionId) { ... }
  ```
* **The Invariant**: Every batch-evaluated paper inserted into `testResults` MUST have a non-null `sessionId`. In `bundle-evaluator.js`, use the triple-tier fallback:
  1. Primary: `batchJobData.sessionId` (from `localStorage` or initial submission)
  2. Secondary: `selectedBundleSession.id` (from currently active session dropdown)
  3. Tertiary: Fallback match from `bundleSessionsList` using `#bundleSessionSelect` or `#resultSessionSelect`.

---

## 4. End-to-End Evaluation Lifecycle

```
[Teacher in admin.html]
       │
       ▼ (1) Uploads student answer sheets (1024px @ 0.75 JPEG)
[bundle-evaluator.js]
       │
       ▼ (2) Dispatches POST /api/batch-evaluate (action: "create")
[/api/batch-evaluate.js]
       │
       ├─► (3) Formats inlined GenerateContentRequest JSONL
       ├─► (4) Uploads JSONL to gs://nerd-tutors-001-batch-evals/inputs/
       └─► (5) Dispatches POST to Vertex AI BatchPredictionJobs endpoint
                  │
                  ▼ (Asynchronous Execution in Google Cloud ~3–4 mins)
           [Google Cloud Vertex AI Scheduler]
                  │
                  ▼ Writes output to gs://nerd-tutors-001-batch-evals/outputs/
[/api/batch-evaluate.js]
       ▲
       │ (6) Polled via GET /api/batch-evaluate?action=status
[bundle-evaluator.js]
       │
       ▼ (7) On JOB_STATE_SUCCEEDED, calls POST /api/batch-evaluate (action: "sync")
[/api/batch-evaluate.js]
       │
       ├─► (8) Reads output JSONL from GCS Media API
       ├─► (9) Parses raw model JSON response
       └─► (10) Applies CBSE Safety Nets (Math Clamping, Binary MCQ, Defend/Refute)
                  │
                  ▼ Returns clean parsedResults[]
[bundle-evaluator.js]
       │
       ▼ (11) Writes each student to Firestore 'testResults' with active sessionId
[Firestore DB (testResults)]
       │
       ▼ (12) Triggers change event on #resultSessionSelect
[admin.html Results Table & dashboard.html Question Matrix Auto-Populate!]
```

---

## 5. Model Architecture & Fallback Hierarchy

### 5.1 Primary Frontier Model: `gemini-4-argon`
* **Google Cloud Model Path**: `publishers/google/models/gemini-4-argon`
* **Architecture**: Direct Single-Pass Multimodal Deep-Reasoning.
* **Reasoning Budget**: `thinkingConfig: { thinkingLevel: "medium" }`.
* **Deterministic Hyperparameters**: `temperature: 0.0`, `seed: 42`.
* **Vision Resolution**: Reads handwritten scripts directly at native resolution without text transcription preprocessing.

### 5.2 Resilient Backup Model: `gemini-3.8-flash`
* **Google Cloud Model Path**: `publishers/google/models/gemini-3.8-flash`
* **Activation**: Automatically triggered on 429 (Rate Limit), 503 (Server Unavailable), or 504 (Gateway Timeout) on `gemini-4-argon`.
* **Reasoning Budget**: `thinkingConfig: { thinkingBudget: 512 }`.
* **Deterministic Hyperparameters**: `temperature: 0.0`, `seed: 42`.

---

## 6. The 6-Layer Context & Instruction Hierarchy

All instructions to Gemini must flow through the strict 6-layer hierarchy to prevent prompt bloat and token duplication:

1. **Layer 1: Exam Session Paper & Key**: Questions, official CBSE marking scheme, and maximum marks.
2. **Layer 2: Teacher Override Directives (`otherInstructions`)**: Specific session instructions from the classroom teacher.
3. **Layer 3: Universal CBSE Board Guardrails**:
   * Strict binary MCQs (1 or 0, never fractional 0.5).
   * Defend / Refute stance enforcement (wrong stance caps question to max 1.0 mark).
   * 15-word feedback budget per question.
   * Recommendations capped at 2 items (max 15 words each).
   * Value points prioritized over rigid verbatim language.
4. **Layer 4: Targeted Subject Directives (`api/cbse-rules.json`)**: Dynamically filtered by subject (`BUSINESS_STUDIES_054`, `ECONOMICS_030`, `ACCOUNTANCY_055`, `SOCIAL_SCIENCE_087`).
5. **Layer 5: Cognitive Thinking Guardrails**: Anti-discursive reasoning rules preventing verbatim answer rewriting in thoughts.
6. **Layer 6: Mandatory Output JSON Schema**: Enforced with `responseMimeType: "application/json"`.

---

## 7. Deterministic Safety Nets (Programmatic Code Overrides)

Small vision models occasionally exhibit leniency or mathematical errors. NerdTutors compensates by programmatically overriding raw model outputs in both `api/ocr-evaluate.js` and `api/batch-evaluate.js`:

```javascript
// 1. Strict Binary MCQ Gate
const isMCQ = (Number(resObj.maxMarks) <= 1.0) && (/mcq|q[1-9]|section\s*a/i.test(resObj.questionId || ""));
if (isMCQ) {
    resObj.maxMarks = 1.0;
    const fb = (resObj.feedback || "").toLowerCase();
    const isWrong = fb.includes("incorrect") || fb.includes("wrong") || fb.includes("0/1") || fb.includes("instead of");
    if (isWrong) resObj.score = 0;
    else if (Number(resObj.score) >= 0.5) resObj.score = 1.0;
    else resObj.score = 0;
}

// 2. Strict Subjective Off-Topic Zeroing
const isOffTopic = (resObj.feedback || "").toLowerCase().includes("off-topic") || 
                   (resObj.feedback || "").toLowerCase().includes("not attempted") ||
                   (resObj.feedback || "").toLowerCase().includes("irrelevant");
if (isOffTopic && Number(resObj.maxMarks) <= 3) {
    resObj.score = 0;
}

// 3. Mathematical Clamping & Invariant Sum Recalculation
resObj.score = Math.min(Math.max(0, Number(resObj.score) || 0), Number(resObj.maxMarks) || 1);
runningSum += resObj.score;
evalObj.totalScore = Math.round(runningSum * 10) / 10;
```

---

## 8. Client Performance & Image Optimization Standard

To protect user bandwidth, prevent HTTP 503 timeouts on slow internet, and avoid token inflation:

* **Image Compression Engine** (`ocr-scan.html` & `bundle-evaluator.js`):
  * `MAX_DIM = 1024` (preserves handwriting strokes while slashing base64 payload size by ~80%).
  * `quality = 0.75` (standard JPEG canvas export).
  * Typical page footprint: **~50 KB – 75 KB** (down from 3 MB – 8 MB raw phone camera files).
* **Zero Automatic Retries (`MAX_RETRIES = 0`)**:
  * On slow mobile networks, automatic retries re-submitted the entire paid payload 2–3 times, burning tokens.
  * Invariant: `MAX_RETRIES` must remain `0`. Any retry must be explicitly initiated by the user.

---

## 9. Quick Verification Checklist for New Agents

Before closing any PR or making code modifications:

- [ ] Does the code call Google Cloud Vertex AI (`aiplatform.googleapis.com`) using `vertex-key.json`?
- [ ] Is `reqItem.cachedContent` guarded so it is ONLY passed if it starts with `cachedContents/`?
- [ ] Are all batch job metadata writes stored in `localStorage` and **NOT** in a new Firestore collection?
- [ ] Does every document inserted into `testResults` contain a valid, non-null `sessionId`?
- [ ] Is `MAX_RETRIES` set to `0` in frontend evaluation callers?
- [ ] Does `bundle-evaluator.js` log step-by-step diagnostic groups to `console.group`?
- [ ] Is `thinkingConfig: { thinkingLevel: "medium" }` preserved on `gemini-4-argon`?

---
*End of Master Architecture Specification. Maintained by NerdTutors Engineering.*
