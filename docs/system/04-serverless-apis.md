# Serverless Backend APIs & Background Systems Architecture
**Document Reference:** `docs/system/04-serverless-apis.md`  
**System Scope:** NerdTutors Serverless Functions (`/api/*`) on Vercel & Google Cloud Vertex AI

---

## 1. Architectural Overview & Shared Infrastructure

NerdTutors utilizes a serverless architecture hosted on Vercel with Google Cloud Vertex AI and Google AI Studio backends. The serverless layer orchestrates document ingestion, context caching, AI topic analysis, asynchronous batch grading, and gate authentication.

```
                           ┌──────────────────────────────────────────────┐
                           │          Client Frontend & Dashboard         │
                           └──────────────────────┬───────────────────────┘
                                                  │
                 ┌────────────────────────────────┼──────────────────────────────┐
                 ▼                                ▼                              ▼
        ┌──────────────────┐            ┌──────────────────┐           ┌──────────────────┐
        │ /api/extract-pdf │            │/api/create-cache │           │/api/batch-evaluate
        └────────┬─────────┘            └────────┬─────────┘           └────────┬─────────┘
                 │                               │                              │
                 │                               ▼                              ▼
                 │                      ┌──────────────────┐           ┌──────────────────┐
                 │                      │Vertex AI Context │           │ Google Cloud     │
                 │                      │Caching (75% off) │           │ Storage (GCS)    │
                 │                      └──────────────────┘           └────────┬─────────┘
                 │                                                              │
                 ▼                                                              ▼
        ┌──────────────────┐                                           ┌──────────────────┐
        │ Gemini 4 Argon   │                                           │Vertex AI Batch   │
        │ Vision Ingestion │                                           │Prediction Jobs   │
        └──────────────────┘                                           └──────────────────┘
```

### Shared Authentication Backbone (`api/vertex-auth.js`)
All Vertex AI endpoints (`analyze-topics.js`, `batch-evaluate.js`, `create-cache.js`) route service account authentication through `api/vertex-auth.js`:
- **`getVertexAccessToken()`**:
  - Automatically loads Google Cloud Service Account credentials from `vertex-key.json` or `process.env.GCP_SERVICE_ACCOUNT_KEY`.
  - Supports raw JSON, shell-quoted strings, or Base64-encoded credential payloads.
  - Sanitizes RSA private key newline escapes (`\n` replacement) to eliminate OpenSSL `ERR_OSSL_PEM_NO_START_LINE` runtime crashes.
  - Signs an RS256 JWT claim with scopes `https://www.googleapis.com/auth/cloud-platform` and `https://www.googleapis.com/auth/generative-language`.
  - Performs an OAuth2 token exchange against `https://oauth2.googleapis.com/token`.
  - Caches access tokens in memory (`cachedToken`, `tokenExpiresAt`) and auto-reuses them if valid for >5 minutes (300s).
- **`getVertexCredentialsInfo()`**: Returns structured diagnostic metadata (`configured`, `source`, `clientEmail`, `projectId`, `hasPrivateKey`) without leaking private keys.

---

## 2. API Endpoint Specifications

### 2.1 `/api/analyze-topics.js`
*Automated NCERT Curriculum Topic Classification & Cognitive Skill Profiling*

- **Purpose**: Parses exam questions and marking schemes into structured NCERT chapters, topics, subtopics, question types, and Bloom's Taxonomy cognitive domains.
- **HTTP Method**: `POST` (`OPTIONS` supported for CORS).
- **CORS Headers**:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: POST, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, Authorization`
- **Environment Variables**:
  - `GCP_SERVICE_ACCOUNT_KEY` / `vertex-key.json` (Vertex AI OAuth2)
  - `GCP_PROJECT_ID` (default: `"nerd-tutors-001"`)
  - `GCP_LOCATION` (default: `"global"`; host dynamically maps to `aiplatform.googleapis.com` or regional endpoints)
  - `VERTEX_API_KEY` / `GEMINI_API_KEY` / `GEMINI_API` / `GEMINI_KEY` (Fallback AI Studio Key)

#### Request Payload Schema
```json
{
  "sessionId": "exam_session_101",
  "questions": "Q1. What is the reserve ratio?\nQ2(a). Explain CRR...\nQ10. Calculate GDP...",
  "markingScheme": "Q1. (B) Central bank mandated reserve...\nQ2(a). Cash Reserve Ratio...",
  "subject": "Economics",
  "classLevel": "Class 12th"
}
```
*Validation*: Requires at least `questions` or `markingScheme`. Returns `400 Bad Request` if both are empty.

#### Models & Cognitive Level Configuration
- **Primary Model**: `gemini-3.8-flash`
  - Selected for high-throughput reasoning and near-instant parsing latency (<2 seconds).
  - Configured with `temperature: 0.0`, `seed: 42`, and `responseMimeType: "application/json"`.
- **Failover Model**: `gemini-4-argon`
  - Automatically triggers if `gemini-3.8-flash` returns an error status on Vertex AI (`!response.ok && isVertex`).
- **Curriculum & Cognitive Classification System**:
  - **Completeness Guardrail**: Explicit instruction forbids omission of Question 10 or leaf questions.
  - **Leaf-Level Canonical Keys**: Disallows grouping sub-parts into composite parent keys (e.g. requires `"Q2(a)"` and `"Q2(b)"`, never just `"Q2"`).
  - **NCERT Chapter Mapping**: Enforces canonical NCERT textbook chapter names (e.g., *"Government Budget and the Economy"*, *"Accounting for Partnership"*).
  - **Question Type**: Categorized into `"MCQ" | "Numerical" | "Case Study" | "Theory" | "Assertion-Reason"`.
  - **Cognitive Skills (Bloom's Taxonomy / CBSE Matrix)**: Categorized into `"Remembering" | "Understanding" | "Applying" | "Analysing" | "Evaluating"`.

#### Post-Processing Normalization
Normalizes `topicMap` keys using regular expressions (`/^(?:question|q)?\s*\.?\s*(\d+)(\s*\(?[a-z0-9ivxlcdm]+\)?.*)?$/i`), automatically generating lookup aliases:
- `"Q1"`, `"1"`, `"Question 1"` all point to identical topic metadata.
- Leaf subpart `"Q2(a)"` aliases to `"2(a)"`, while preserving parent `"Q2"` fallback.

#### Response Structure
```json
{
  "success": true,
  "sessionId": "exam_session_101",
  "analysis": {
    "subject": "Economics",
    "classLevel": "Class 12th",
    "totalQuestions": 34,
    "chaptersCovered": [
      "Money and Banking",
      "Government Budget and the Economy"
    ],
    "topicMap": {
      "Q1": {
        "chapter": "Money and Banking",
        "topic": "Functions of Central Bank",
        "subtopic": "Lender of Last Resort",
        "type": "MCQ",
        "cognitiveSkill": "Understanding"
      },
      "1": { ... }
    },
    "curriculumSummary": "Covers Unit 2 (Money & Banking) and Unit 4 (Government Budget) with focus on numerical multiplier and balance of payments."
  }
}
```

---

### 2.2 `/api/batch-evaluate.js`
*Google Cloud Vertex AI Asynchronous Batch Prediction Engine (50% Cost Discount)*

- **Purpose**: Manages lifecycle of bulk exam evaluation jobs asynchronously, processing 10 to 100+ student answer sheets with an official 50% discount on Google Gemini tokens.
- **HTTP Methods**: `POST`, `GET`, `OPTIONS`
- **CORS Headers**:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: POST, GET, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, Authorization`
- **Environment Variables**:
  - `GCP_SERVICE_ACCOUNT_KEY` / `vertex-key.json`
  - `GCP_PROJECT_ID` (default: `"nerd-tutors-001"`)
  - `GCP_LOCATION` (default: `"global"`)
  - `GCP_STORAGE_BUCKET` (default: `${projectId}-batch-evals`)
  - `GEMINI_MODEL` (default: `"gemini-4-argon"`)

#### Lifecycle Actions Supported (`body.action` or `query.action`)
1. `create`: Ingests student pages, uploads JSONL to GCS, and submits a `batchPredictionJob`.
2. `list`: Queries Vertex AI API and merges live states with local/GCS manifests.
3. `status`: Polls status, timestamps, and error details of an individual job.
4. `sync`: Downloads prediction outputs from GCS, executes CBSE programmatic safety nets, and returns parsed evaluations.
5. `delete`: Issues deletion to Vertex AI, unregisters from local cache, and records in deleted blacklists.

#### Action 1: Create Batch Job (`action: "create"`)
- **Request Payload**:
  ```json
  {
    "action": "create",
    "sessionId": "eco_test_01",
    "examName": "Class 12 Economics Pre-Board",
    "subject": "Economics",
    "questions": "Full question paper text...",
    "markingScheme": "Official marking scheme...",
    "maxMarks": 80,
    "otherInstructions": "Strict marking on diagrams",
    "cachedContentId": "projects/.../locations/us-central1/cachedContents/123456",
    "students": [
      {
        "studentName": "Aarav Sharma",
        "pages": [
          { "mimeType": "image/jpeg", "base64": "/9j/4AAQSkZJRg..." }
        ]
      }
    ]
  }
  ```
- **Storage & Cloud Execution**:
  1. Compiles an array of `GenerateContentRequest` objects (one per student) with `responseMimeType: "application/json"`, `temperature: 0.0`, `seed: 42`, and `thinkingConfig: { thinkingLevel: "medium" }`.
  2. Formats requests as JSONL lines (`{"request": {...}}\n`).
  3. Uploads input to `gs://${gcsBucket}/inputs/${cleanSession}_${Date.now()}.jsonl` (with automatic bucket creation if non-existent).
  4. Dispatches request to `https://${host}/v1/projects/${projectId}/locations/${location}/batchPredictionJobs`.
  5. Uploads a persistent job manifest to `gs://${gcsBucket}/manifests/${shortBatchId}.json` for cross-device synchronization.
  6. Returns HTTP 200 with job ID, creation timestamp, and `authAudit`.

#### Action 2: Status Polling (`action: "status"`)
- **Request Payload**: `{ "action": "status", "batchId": "projects/.../batchPredictionJobs/34827491823" }`
- **Response**:
  ```json
  {
    "batchId": "projects/nerd-tutors-001/locations/global/batchPredictionJobs/34827491823",
    "displayName": "NerdTutors_Economics_PreBoard_1730000000",
    "state": "JOB_STATE_RUNNING",
    "done": false,
    "createTime": "2026-10-31T08:00:00Z",
    "updateTime": "2026-10-31T08:04:12Z",
    "hasResponses": false
  }
  ```

#### Action 3: Results Synchronization & Safety Nets (`action: "sync"`)
- Checks that `state === "JOB_STATE_SUCCEEDED"`.
- Reads GCS prediction files from `outputInfo.gcsOutputDirectory` (reading and parsing all `.jsonl` chunks via Google Cloud Storage JSON API with Service Account Bearer token).
- Resolves student identities: Priority order is **Model Output `studentName` > Manifest Metadata > Student Index**.
- **CBSE Programmatic Safety Nets & Rule Enforcement**:
  - **Binary MCQ Gate**: Detects 1-mark MCQs (`maxMarks <= 1.0` and `mcq|q[1-9]|section a`). If feedback contains negative tokens (`"incorrect"`, `"wrong"`, `"0/1"`), forces `score = 0`. Correct answers forced to `score = 1.0`. Fractional/partial scores are eliminated.
  - **Score Clamping**: Programmatically clamps every score to `[0, maxMarks]`.
  - **Sum Invariant**: Sums all question scores using floating-point rounding (`Math.round(runningSum * 10) / 10`) to guarantee `totalScore` matches question totals.
- Marks registry entry as `SYNCED`.
- Returns HTTP 200 with `parsedResults`.

#### Action 4: Registry Listing & Deletion (`list`, `delete`)
- `list`: Combines local `api/batch-jobs.json` with live Vertex AI `batchPredictionJobs`, resolving missing metadata via GCS manifests and filtering out IDs present in `api/deleted-batch-jobs.json`.
- `delete`: Sends HTTP `DELETE` to Vertex AI, removes job from local file registry, and appends ID to deleted blacklists so it cannot reappear on future list refreshes.

---

### 2.3 `/api/create-cache.js`
*Google Cloud Vertex AI Context Caching API (75% Token Discount)*

- **Purpose**: Pre-loads static exam questions, official CBSE marking schemes, teacher override directives, and evaluation rubrics into Google's active memory for up to 72 hours.
- **HTTP Method**: `POST` (`OPTIONS` supported for CORS).
- **CORS Headers**:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: POST, GET, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, Authorization, x-gate-token`
- **Environment Variables**:
  - `GCP_PROJECT_ID` (default: `"975383880672"`)
  - `GCP_LOCATION` (default: `"us-central1"`)
  - `VERTEX_API_KEY` / `GEMINI_API_KEY`
  - `GEMINI_MODEL` (default: `"gemini-4-argon"`)

#### Request Payload Schema
```json
{
  "sessionId": "session_eco_term1",
  "examName": "Class 12 Economics Term 1",
  "subject": "Economics",
  "questions": "Complete question paper string...",
  "markingScheme": "Complete marking scheme string...",
  "maxMarks": 40,
  "otherInstructions": "Award step marks for calculation",
  "ttlHours": 72,
  "model": "gemini-4-argon"
}
```

#### Cache Construction & Architecture
- Compiles the full static context into `bundledContent`:
  - Exam metadata and max marks.
  - Question text and official marking scheme.
  - Teacher override instructions (`otherInstructions`).
  - CBSE Stage 2 Subject Directives extracted from `api/cbse-rules.json`.
  - Thinking guardrail & reasoning budget governance (anti-transcription, 1-step MCQ comparison).
  - CBSE Universal Guardrails: Strict binary MCQs, Defend/Refute 1.0 cap, 15-word feedback budget, unattempted question detection, leaf-level parentheses rules (`Q2(a)`, `Q17(a)(i)`).
  - Mandatory Output JSON Schema.
- Sets TTL: `ttlSeconds = Math.max(3600, Math.min(ttlHours * 3600, 259200))` (clamped between 1 hour and 3 days).

#### Multi-Tiered Fallback Architecture
1. **Explicit Vertex AI Cache (`explicit-vertex`)**:
   - Posts to `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/cachedContents` using OAuth2 Bearer token.
   - Successful return yields resource name: `projects/.../locations/.../cachedContents/1234567890`.
2. **Explicit AI Studio Cache (`explicit-studio`)**:
   - Posts to `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`.
3. **Implicit KV-Caching (`implicit-cache`)**:
   - If `gemini-4-argon` is used and Google responds with 400 or `"does not support explicit context caching"`, the endpoint auto-activates implicit KV-caching mode (`cachedContentId: "implicit-argon-cache"`). Gemini 4 Argon automatically caches the prompt prefix on Google infrastructure with the identical 75% cost discount.
4. **Unsupported/Graceful Degradation (`unsupported`)**:
   - If credentials or quota reject cache creation, returns HTTP 200 with `success: false` and `mode: "unsupported"` instead of crashing. Frontend seamlessly falls back to streamlined prompt mode without interrupting student grading.

#### Response Structure
```json
{
  "success": true,
  "cachedContentId": "projects/975383880672/locations/us-central1/cachedContents/8392174921",
  "mode": "explicit-vertex",
  "model": "gemini-4-argon",
  "expireTime": "2026-11-04T13:00:00.000Z",
  "message": "⚡ Context cache successfully created on gemini-4-argon (75% discount active)."
}
```

---

### 2.4 `/api/extract-pdf.js`
*Multimodal Vision PDF Ingestion & Academic Document Parser*

- **Purpose**: Converts complex scanned or digital PDF question papers and marking schemes into standardized, clean markdown text.
- **HTTP Methods**: `POST`, `GET`, `OPTIONS`
- **CORS Whitelist**:
  - `https://nerd-tutors.vercel.app`
  - `https://nerd-tutors-two.vercel.app`
  - `http://localhost:3000`, `http://localhost:5000`
- **Environment Variables**:
  - `GEMINI_API_KEY`, `VERTEX_API_KEY`, `GEMINI_API`, `GEMINI_KEY`
  - `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, `GEMINI_API_KEY_4` (Failover key pool)
  - `DEFAULT_GEMINI_MODEL` / `GEMINI_MODEL` (default: `"gemini-4-argon"`)
  - `THINKING_BUDGET` (default: `512`)

#### Request Payload Schema
```json
{
  "pdfBase64": "JVBERi0xLjQKJcfsj6q2... (or data:application/pdf;base64,...)",
  "extractType": "questions",
  "examName": "CBSE Board Examination 2026",
  "examSet": "Set 2",
  "subject": "Business Studies"
}
```
*Self-Test Diagnostic Mode*: Submitting `{"action": "self-test"}` returns instant health verification `{ status: "online", geminiConfigured: true }`.

#### Extraction Modes & Vision Prompt Engineering
- **Question Paper Mode (`extractType: 'questions'`)**:
  - Resolves multi-column paper layouts: instructs model to traverse column hierarchies vertically without blending parallel column questions.
  - Extracts question numbers, question text, mark weights (`[1 Mark]`, `[3 Marks]`), and options (`(A)`, `(B)`, `(C)`, `(D)`) on individual lines.
  - Formats tables into clean Markdown grid structures.
- **Marking Scheme Mode (`extractType: 'markingScheme'`)**:
  - Formats headers as `Q1. [Correct Option Letter & Text]`.
  - Captures point-wise model answers and mark distributions (`1 Mark Definition + 2 Marks Diagram...`).
  - Preserves hierarchical numbering for case studies (`Q34.1`, `Q34.2`).

#### Model Configuration & Programmatic Quality Assessment
- **Model**: `gemini-4-argon` with `mediaResolution: "MEDIA_RESOLUTION_HIGH"`, `temperature: 0.1`, and `thinkingConfig: { thinkingLevel: "medium" }`.
- **Key Rotation**: Loops through available keys with a 65-second `AbortController` timeout per attempt.
- **Quality Analysis Heuristics**:
  - Detects question count using regex: `/(?:^|\n)\s*(?:Q\.?\s*(\d+)|\b(\d+)\.)/gim`.
  - Detects sections: `Section [A-E]`.
  - Assigns Quality Rating:
    - `High`: >= 5 detected questions and >= 150 characters.
    - `Medium`: 1–4 detected questions.
    - `Low`: 0 questions or < 150 characters.

#### Response Structure
```json
{
  "success": true,
  "extractedText": "### SECTION A\n\nQ1. Management is considered as...\n(A) Art\n(B) Science\n(C) Both Art and Science [1 Mark]...",
  "questionCount": 34,
  "detectedSections": ["Section A", "Section B", "Section C", "Section D"],
  "characterCount": 14200,
  "quality": "High",
  "modelUsed": "gemini-4-argon",
  "extractType": "questions",
  "examSet": "Set 2"
}
```

---

### 2.5 `/api/manage-gate.js`
*Gate Password Management & Registry Persistence*

- **Purpose**: Provides administrative CRUD operations for moderator access keys.
- **HTTP Methods**: `GET`, `POST`, `OPTIONS`
- **Security Headers**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
- **Storage Strategy**:
  - Reads and writes to `api/gate-credentials.json` with fallback to `gate-credentials.json` or `/tmp/gate-credentials.json`.
  - Seeds 5 built-in Master Moderator keys (`nerd_tutor_alpha` through `epsilon`).

#### Actions Supported
1. **`GET`**: Lists all registered credentials (id, username, password, label, role, createdAt).
2. **`POST` with `action: "add"` / `"create"`**:
   - Validates username (min 3 chars, alphanumeric/hyphens/dots) and password (min 4 chars).
   - Generates ID: `gate_custom_${Date.now()}_${rand}`.
   - Rejects case-insensitive duplicates.
   - Returns HTTP 201 with created credential and updated list.
3. **`POST` with `action: "update"` / `"edit"`**:
   - Matches by username or ID; updates password/label and sets `updatedAt`.
4. **`POST` with `action: "delete"` / `"remove"`**:
   - Deletes credential matching ID or username.
5. **`POST` with `action: "sync"`**:
   - Merges external arrays (e.g., Firestore credentials) into the local registry.

---

### 2.6 `/api/verify-gate.js`
*HMAC-SHA256 Token Verification & Gate Security Gatekeeper*

- **Purpose**: Authenticates moderator credentials and generates cryptographically signed tokens.
- **HTTP Methods**: `POST`, `OPTIONS`
- **Environment Variables**:
  - `GATE_SECRET` (default: `'nt_gate_hmac_secret_2026_super_secure'`)
  - `GATE_CREDENTIALS` (optional override format: `user1:pass1,user2:pass2`)
- **Credential Aggregation**:
  - Merges default credentials (`alpha` through `epsilon`), dynamic file credentials from `gate-credentials.json`, and environment variable overrides.
- **Cryptographic Token Issuance**:
  - Generates an HMAC-SHA256 signature using `crypto.createHmac('sha256', GATE_SECRET)` with payload `${username}:permanent`.
  - Serializes token as Base64 JSON:
    ```json
    {
      "u": "nerd_tutor_alpha",
      "permanent": true,
      "sig": "9f83ab...64_hex_chars"
    }
    ```
  - Configured with permanent validity (`permanent: true`) to guarantee moderators and students are never interrupted by mid-session session expiries.
- **Responses**:
  - `200 OK`: `{"success": true, "token": "<base64_token>"}`
  - `401 Unauthorized`: `{"error": "Invalid username or password"}`
  - `400 Bad Request`: `{"error": "Username and password are required"}`

---

## 3. Cross-Cutting Security, Error Handling & Redaction Mechanisms

| Security Dimension | Implementation Mechanism | Governing Files |
|---|---|---|
| **API Key Redaction** | Deep regex sanitization strips `key=[^&\s]+`, Google AI Studio keys (`AIza...`), and Vertex AI tokens (`AQ....`) from all log outputs and client error messages. | `api/extract-pdf.js`, `api/create-cache.js`, `api/batch-evaluate.js` |
| **Service Account Isolation** | RSA private keys and service account emails remain isolated on the server. `authAudit` objects expose operational booleans (`serviceAccountFetched: true`) without leaking credentials. | `api/vertex-auth.js`, `api/batch-evaluate.js` |
| **Origin Whitelisting & Web Hardening** | Restricts CORS origins to approved production and development domains (`nerd-tutors.vercel.app`, `localhost:3000`). Injects `X-Content-Type-Options: nosniff` and `X-Frame-Options: SAMEORIGIN`. | `api/extract-pdf.js`, `api/manage-gate.js`, `api/verify-gate.js` |
| **Unrestricted Gate Directive** | Gate redirects and token blocks are permanently neutralized in user-facing APIs (`create-cache.js`, `extract-pdf.js`, `ocr-evaluate.js`) ensuring zero disruption or student lockouts. | `api/create-cache.js`, `api/extract-pdf.js`, `gate-guard.js` |
| **Deterministic Seed Pinning** | Enforces `temperature: 0.0` and `seed: 42` across generative calls to prevent variance between evaluations of identical papers. | `api/analyze-topics.js`, `api/batch-evaluate.js`, `api/ocr-evaluate.js` |
| **Programmatic Result Overrides** | AI output is not trusted blindly: score clamping `[0, maxMarks]`, strict binary MCQ gating (negative feedback = 0 marks), and floating-point sum recalculations run in JavaScript code. | `api/batch-evaluate.js`, `api/ocr-evaluate.js` |
| **Multi-Key Failover Pooling** | Loops through primary and secondary API key lists (`GEMINI_API_KEY_2`, `_3`, `_4`) with 65s abort controllers, automatically recovering from rate limits or transient Google Cloud outages. | `api/extract-pdf.js` |

---

## 4. Environment Variables Reference

| Variable | Description | Used In |
|---|---|---|
| `GCP_SERVICE_ACCOUNT_KEY` | Raw, Base64, or JSON-stringified GCP service account key containing `client_email` and `private_key`. | `api/vertex-auth.js`, `batch-evaluate.js`, `analyze-topics.js` |
| `GCP_PROJECT_ID` | Google Cloud project identifier (e.g. `nerd-tutors-001` or `975383880672`). | `api/vertex-auth.js`, `batch-evaluate.js`, `create-cache.js` |
| `GCP_LOCATION` | Vertex AI regional location (`global`, `us`, `us-central1`, `eu`). | `api/batch-evaluate.js`, `analyze-topics.js`, `create-cache.js` |
| `GCP_STORAGE_BUCKET` | Google Cloud Storage bucket for batch input/output files and manifests. | `api/batch-evaluate.js` |
| `GEMINI_API_KEY` / `VERTEX_API_KEY` | Primary API Key for Google AI Studio or Vertex AI endpoints. | All API endpoints |
| `GEMINI_API_KEY_2`..`4` | Secondary failover API keys for pooling during peak traffic. | `api/extract-pdf.js` |
| `DEFAULT_GEMINI_MODEL` / `GEMINI_MODEL` | Default model specification (defaults to `gemini-4-argon`). | `api/extract-pdf.js`, `batch-evaluate.js`, `create-cache.js` |
| `GATE_SECRET` | Secret key used for signing permanent HMAC-SHA256 gate tokens. | `api/verify-gate.js`, `api/extract-pdf.js`, `api/manage-gate.js` |
| `GATE_CREDENTIALS` | Comma-separated list of moderator credentials (`user:pass,user2:pass2`). | `api/verify-gate.js`, `api/extract-pdf.js` |

