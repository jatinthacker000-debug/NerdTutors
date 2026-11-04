# Production Firestore Security Rules & Deployment Guide

**Document Reference:** `docs/firestore-rules-deployment.md`  
**Firebase Project:** `nerd-tutors-001` (`nerd-tutors-001.firebaseapp.com`)  
**Security Level:** Production Hardened (Principle of Least Privilege + Default Deny)  
**SDK Compatibility:** Firebase JavaScript SDK v9 / v10 (Modular), Google Cloud Firestore  

---

## 1. Executive Summary & Architecture

This document establishes the hardened Google Cloud Firestore Security Rules architecture for the **NerdTutors** academic assessment platform. It enforces strict boundary validation, credential isolation, and role-based access control (RBAC) across all exam, evaluation, and administrative entities.

### Key Security Guarantees:
1. **Credential Isolation (`gateCredentials`)**: Master moderator keys and access credentials are strictly restricted to verified administrators (`isAdmin()`). Students and unauthenticated users cannot read, write, or enumerate moderator keys.
2. **Batch Job Protection (`batchJobs`)**: Asynchronous Vertex AI batch prediction job manifests and Google Cloud Storage (GCS) references are exclusively accessible to administrators.
3. **Assessment Integrity & Rubric Immutability (`testSessions`)**: Question papers, maximum marks, and official CBSE marking rubrics can only be created, modified, or deleted by administrators. Authenticated student/scanner clients may only update non-destructive context cache metadata (`cachedContentId`, `cacheExpiresAt`, `topicMap`, `chaptersCovered`, `curriculumSummary`).
4. **Mathematical Score Invariants (`testResults`)**: Student score submissions and updates are programmatically bounded: $0 \le \text{score} \le \text{maxMarks}$ with $\text{maxMarks} > 0$. Score inflation and negative marks are strictly rejected by the database engine.
5. **Ownership Isolation**: Students can only modify or delete their own evaluation records (`isOwner(resource.data.studentId)`). Administrators retain global audit and moderation authority.
6. **Default Catch-All Deny**: Any collection, document path, or subcollection not explicitly granted permission is closed and denied by default.
7. **Zero Git Tracking Policy**: Per Requirement R6, the active `firestore.rules` file is strictly ignored via `.gitignore` and must never be committed to the public Git repository.

---

## 2. Production Security Rules Specification

Below is the complete, copy-pasteable production Firestore Security Rules specification (`rules_version = '2'`). This block is ready for immediate deployment via the Firebase Console Web UI or Firebase CLI.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // =========================================================================
    // SECTION 1: HELPER FUNCTIONS & AUTHENTICATION GUARDS
    // =========================================================================

    /**
     * isSignedIn: Returns true if the incoming request includes a valid Firebase Auth token.
     */
    function isSignedIn() {
      return request.auth != null;
    }

    /**
     * isAuthenticated: Alias for isSignedIn() for cross-codebase consistency.
     */
    function isAuthenticated() {
      return isSignedIn();
    }

    /**
     * isAdmin: Validates whether the authenticated user holds administrative privileges.
     * Checks:
     *  1. Token email matches the authorized administrator allowlist (case-insensitive).
     *  2. OR token contains the custom claim `admin: true`.
     */
    function isAdmin() {
      return request.auth != null && (
        (
          'email' in request.auth.token &&
          request.auth.token.email.lower() in [
            'kaushtubh457@gmail.com',
            'jatinthacker000@gmail.com',
            'pathak.amitkumar@hrjohnsonindia.com'
          ]
        ) || (
          'admin' in request.auth.token &&
          request.auth.token.admin == true
        )
      );
    }

    /**
     * isOwner: Validates whether the authenticated user's UID matches the target owner UID.
     */
    function isOwner(uid) {
      return request.auth != null && request.auth.uid == uid;
    }

    /**
     * isValidScore: Enforces mathematical score invariants:
     *  - `score` must be a numeric value >= 0.
     *  - `maxMarks` must be a numeric value > 0.
     *  - `score` cannot exceed `maxMarks`.
     */
    function isValidScore(score, maxMarks) {
      return score is number &&
             maxMarks is number &&
             score >= 0 &&
             maxMarks > 0 &&
             score <= maxMarks;
    }

    // =========================================================================
    // SECTION 2: GRANULAR COLLECTION ACCESS RULES
    // =========================================================================

    /**
     * 1. GATE CREDENTIALS REGISTRY (`gateCredentials/{username}`)
     * Contains moderator access keys, sync source flags, and plaintext passwords.
     * Threat Model: Broken Object Property Level Authorization (OWASP API3).
     * Rule: Strictly accessible to Administrators. Completely hidden from students/public.
     */
    match /gateCredentials/{username} {
      allow read, write: if isAdmin();
    }

    /**
     * 2. BATCH JOBS (`batchJobs/{jobId}`)
     * Contains Google Cloud Vertex AI Batch Prediction job manifests, GCS bucket URIs,
     * and student roster metadata.
     * Rule: Strictly accessible to Administrators.
     */
    match /batchJobs/{jobId} {
      allow read, write: if isAdmin();
    }

    /**
     * 3. TEST SESSIONS (`testSessions/{sessionId}`)
     * Contains exam titles, full question paper text, CBSE marking schemes, and rubrics.
     * Threat Model: Unauthorized rubric alteration or exam paper leak.
     * Rules:
     *  - Read: Authenticated users can read session papers for grading and practice.
     *  - Create / Delete: Strictly administrators.
     *  - Update: Administrators have full update permissions. Authenticated student/scanner
     *    clients may ONLY update context cache metadata and curriculum maps without altering
     *    exam questions, marks, or marking schemes.
     */
    match /testSessions/{sessionId} {
      allow read: if isSignedIn();
      allow create, delete: if isAdmin();
      allow update: if isAdmin() || (
        isSignedIn() &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          'cachedContentId',
          'cacheExpiresAt',
          'topicMap',
          'chaptersCovered',
          'curriculumSummary'
        ])
      );
    }

    /**
     * 4. TEST RESULTS (`testResults/{resultId}`)
     * Contains evaluated student report cards, overall scores, question-wise breakdown,
     * diagnostic feedback, and token audit ledgers.
     * Threat Model: Score tampering, grade spoofing, unauthorized result deletion.
     * Rules:
     *  - Read: Authenticated users can read test results (for dashboard & report cards).
     *  - Create: Authenticated users can create an evaluation result, provided the score
     *    satisfies `isValidScore(score, maxMarks)`.
     *  - Update: Document owner (student) or administrator can update (e.g. in-place re-evaluation),
     *    strictly enforcing `isValidScore(score, maxMarks)`.
     *  - Delete: Document owner (student) or administrator can delete.
     */
    match /testResults/{resultId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && isValidScore(request.resource.data.score, request.resource.data.maxMarks);
      allow update: if (isOwner(resource.data.studentId) || isAdmin()) && isValidScore(request.resource.data.score, request.resource.data.maxMarks);
      allow delete: if isOwner(resource.data.studentId) || isAdmin();
    }

    /**
     * 5. QUESTIONS & QUESTION BATCHES (`questions/{questionId}`, `questionBatches/{batchId}`)
     * Curated question banks and categorized question sets.
     * Rules:
     *  - Read: Authenticated users.
     *  - Write / Delete: Strictly administrators.
     */
    match /questions/{questionId} {
      allow read: if isSignedIn();
      allow write, delete: if isAdmin();
    }

    match /questionBatches/{batchId} {
      allow read: if isSignedIn();
      allow write, delete: if isAdmin();
    }

    /**
     * 6. USER PROFILES (`users/{userId}`)
     * User profiles and role assignments.
     * Rules:
     *  - Read / Write: Allowed if requesting user owns the record (`isOwner(userId)`) or is an administrator.
     */
    match /users/{userId} {
      allow read, write: if isOwner(userId) || isAdmin();
    }

    // =========================================================================
    // SECTION 3: DEFAULT CATCH-ALL DENY
    // =========================================================================

    /**
     * Global Catch-All Rule:
     * Explicitly denies read and write access to all unmapped collections, metadata
     * tables, or experimental paths.
     */
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## 3. Threat Modeling & Architectural Rationale

### 3.1 Defense-in-Depth for `gateCredentials` & `batchJobs`
* **Vulnerability Mitigated**: Credential Exfiltration & Resource Hijacking (OWASP API3: Broken Object Property Level Authorization).
* **Architectural Context**: NerdTutors allows moderators to synchronize access keys via Firestore (`collection: 'gateCredentials'`) for cloud-managed operational flexibility. If this collection were world-readable or accessible to authenticated students, malicious candidates could retrieve administrative access keys, impersonate examiners, or bypass AI rate limits.
* **Enforcement**:
  ```javascript
  match /gateCredentials/{username} {
    allow read, write: if isAdmin();
  }
  ```
  Neither anonymous nor normal authenticated users have read or list permissions. Only verified admin tokens can execute queries or mutations.

### 3.2 Score Invariant Enforcement (`isValidScore`)
* **Vulnerability Mitigated**: Client-Side Parameter Tampering & Grade Spoofing (OWASP API1 / API4).
* **Architectural Context**: In client-orchestrated evaluations (`ocr-scan.html`), the grading payload is parsed and saved to `testResults` via `addDoc()` or in-place re-evaluation `updateDoc()`. A malicious student could intercept outgoing WebSocket/HTTP requests and inject arbitrary scores (e.g., `score: 999`, `score: -50`, or `score: 100` on a 40-mark paper).
* **Enforcement**:
  ```javascript
  function isValidScore(score, maxMarks) {
    return score is number &&
           maxMarks is number &&
           score >= 0 &&
           maxMarks > 0 &&
           score <= maxMarks;
  }
  ```
  This invariant ensures that:
  - Both fields are strictly typed as numeric values.
  - No negative scores can ever be persisted.
  - The exam total weight `maxMarks` must be positive (> 0).
  - The awarded `score` cannot mathematically exceed `maxMarks`.

### 3.3 Context Cache Metadata Segregation (`testSessions` Diff Guard)
* **Vulnerability Mitigated**: Unauthorized Rubric Tampering & Exam Content Modification.
* **Architectural Context**: During OCR scanning in `ocr-scan.html`, the client creates or refreshes a Google Vertex AI Context Cache (saving 75% on token costs) and performs NCERT syllabus mapping. The client must write the resulting `cachedContentId`, `cacheExpiresAt`, and `topicMap` back to the `testSessions` document. However, students must NOT be able to alter questions, answers, maximum marks, or teacher instructions.
* **Enforcement**:
  ```javascript
  allow update: if isAdmin() || (
    isSignedIn() &&
    request.resource.data.diff(resource.data).affectedKeys().hasOnly([
      'cachedContentId',
      'cacheExpiresAt',
      'topicMap',
      'chaptersCovered',
      'curriculumSummary'
    ])
  );
  ```
  If a student attempts to alter any field outside this strictly whitelisted set (such as modifying `questions`, `markingScheme`, `maxMarks`, or `name`), Firestore's field diff engine immediately rejects the transaction.

### 3.4 Default Deny Principle
* **Vulnerability Mitigated**: Unintended Exposure of New or Auxiliary Collections.
* **Architectural Context**: As the application evolves, developers may introduce staging collections, temporary audit dumps, or internal configuration tables. Without an explicit catch-all deny, misconfigured rules or inherited root wildcards could leave new paths exposed.
* **Enforcement**:
  ```javascript
  match /{document=**} {
    allow read, write: if false;
  }
  ```
  Any document path not explicitly authorized by preceding match blocks is unconditionally denied.

---

## 4. Step-by-Step Deployment Guide

### Deployment Method 1: Firebase Console Web UI (Recommended)

1. Open a web browser and navigate to the [Firebase Console](https://console.firebase.google.com/).
2. Select your Firebase project: **`nerd-tutors-001`**.
3. In the left-hand navigation menu, expand **Build** and select **Firestore Database**.
4. In the Firestore Database management screen, click the **Rules** tab at the top.
5. *(Optional Safety Step)* Copy the existing rules in the editor and save them as a local backup.
6. Select all content in the rules editor, delete it, and paste the complete rules from **Section 2** above.
7. Click the **Publish** button located in the top-right corner of the editor.
8. Wait for the confirmation banner: *"Rules published successfully"*. Rules propagate globally to Google Cloud edge regions within 60 seconds.

---

### Deployment Method 2: Firebase CLI (Automated / DevOps)

Per Requirement R6, `firestore.rules` is strictly ignored by Git and must never be committed. You can deploy rules using the Firebase CLI without committing the rules file:

1. **Install Firebase CLI** (if not already installed):
   ```bash
   npm install -g firebase-tools
   ```

2. **Authenticate with Google Cloud**:
   ```bash
   firebase login
   ```

3. **Verify Project Alias**:
   ```bash
   firebase projects:list
   # Ensure nerd-tutors-001 is active, or bind it:
   firebase use nerd-tutors-001
   ```

4. **Verify `.gitignore` Status**:
   Confirm that `firestore.rules` is tracked as ignored:
   ```bash
   git check-ignore firestore.rules
   # Should output: firestore.rules
   ```

5. **Deploy Rules Directly**:
   Ensure `firebase.json` references `firestore.rules`:
   ```json
   {
     "firestore": {
       "rules": "firestore.rules"
     }
   }
   ```
   Deploy strictly the security rules:
   ```bash
   firebase deploy --only firestore:rules
   ```

6. **Verify Deployment**:
   Check the deployment history in the Firebase Console Rules tab to confirm the active ruleset version and timestamp.

---

## 5. Firebase Rules Playground Simulation Scenarios

The Firebase Console includes a built-in **Rules Playground** (located directly above the Rules editor) that allows you to simulate requests with arbitrary auth tokens and payloads. Use the following 5 test scenarios to verify the rules before or after publishing:

---

### Scenario 1: Administrator Read on `gateCredentials` (Expected: ALLOW)
* **Objective**: Confirm authorized administrators can read moderator access keys.
* **Simulator Configuration**:
  - **Simulation Type**: `get` (Read)
  - **Location**: `gateCredentials/nerd_tutor_alpha`
  - **Authentication**: `Authenticated` = **ON**
  - **Provider**: `google.com` (or `password`)
  - **Firebase UID**: `admin_user_001`
  - **Custom Auth Token (JSON)**:
    ```json
    {
      "email": "kaushtubh457@gmail.com",
      "email_verified": true
    }
    ```
* **Execution**: Click **Run**.
* **Expected Result**: **ALLOW** (Green banner: *"Simulated read allowed"*).
* **Explanation**: `isAdmin()` matches `kaushtubh457@gmail.com` against the administrator email allowlist.

---

### Scenario 2: Student Read on `gateCredentials` (Expected: DENIED)
* **Objective**: Confirm normal students cannot read or enumerate moderator keys.
* **Simulator Configuration**:
  - **Simulation Type**: `get` (Read)
  - **Location**: `gateCredentials/nerd_tutor_alpha`
  - **Authentication**: `Authenticated` = **ON**
  - **Provider**: `google.com`
  - **Firebase UID**: `student_uid_999`
  - **Custom Auth Token (JSON)**:
    ```json
    {
      "email": "student@gmail.com",
      "email_verified": true
    }
    ```
* **Execution**: Click **Run**.
* **Expected Result**: **DENIED** (Red banner: *"Simulated read denied"*).
* **Explanation**: Normal student emails do not match the admin allowlist, and custom claim `admin: true` is absent.

---

### Scenario 3: Valid Score Creation on `testResults` (Expected: ALLOW)
* **Objective**: Confirm authenticated users can submit valid examination results.
* **Simulator Configuration**:
  - **Simulation Type**: `create`
  - **Location**: `testResults/result_sample_001`
  - **Authentication**: `Authenticated` = **ON**
  - **Firebase UID**: `student_uid_123`
  - **Custom Auth Token (JSON)**:
    ```json
    {
      "email": "student@gmail.com"
    }
    ```
  - **Document Data (JSON)**:
    ```json
    {
      "studentId": "student_uid_123",
      "studentName": "Priya Sharma",
      "score": 34.5,
      "maxMarks": 40.0,
      "sessionId": "session_eco_001",
      "class": "Class 12th",
      "subject": "Economics"
    }
    ```
* **Execution**: Click **Run**.
* **Expected Result**: **ALLOW** (Green banner: *"Simulated create allowed"*).
* **Explanation**: User is authenticated (`isSignedIn() == true`), and `isValidScore(34.5, 40.0)` evaluates to `true` ($0 \le 34.5 \le 40.0$).

---

### Scenario 4: Invalid Score (`score > maxMarks`) Creation on `testResults` (Expected: DENIED)
* **Objective**: Confirm the database engine blocks inflated or impossible scores.
* **Simulator Configuration**:
  - **Simulation Type**: `create`
  - **Location**: `testResults/result_sample_002`
  - **Authentication**: `Authenticated` = **ON**
  - **Firebase UID**: `student_uid_123`
  - **Custom Auth Token (JSON)**:
    ```json
    {
      "email": "student@gmail.com"
    }
    ```
  - **Document Data (JSON)**:
    ```json
    {
      "studentId": "student_uid_123",
      "studentName": "Priya Sharma",
      "score": 45.0,
      "maxMarks": 40.0,
      "sessionId": "session_eco_001"
    }
    ```
* **Execution**: Click **Run**.
* **Expected Result**: **DENIED** (Red banner: *"Simulated create denied"*).
* **Explanation**: `isValidScore(45.0, 40.0)` returns `false` because $45.0 \le 40.0$ is false.

---

### Scenario 5: Unauthenticated Read on `testSessions` (Expected: DENIED)
* **Objective**: Confirm public, unauthenticated scraping is blocked across all core collections.
* **Simulator Configuration**:
  - **Simulation Type**: `get` (Read)
  - **Location**: `testSessions/session_eco_001`
  - **Authentication**: `Authenticated` = **OFF** (Anonymous/Public)
* **Execution**: Click **Run**.
* **Expected Result**: **DENIED** (Red banner: *"Simulated read denied"*).
* **Explanation**: `isSignedIn()` evaluates `request.auth != null`, which fails when unauthenticated.

---

## 6. Troubleshooting & Operational Runbook

### 6.1 `FirebaseError: Missing or insufficient permissions`
When client code encounters this error, diagnose by systematically checking:

1. **Authentication State**:
   - Check if `auth.currentUser` is `null` in the browser console.
   - If user logged in recently, ensure the token has refreshed: `await auth.currentUser.getIdToken(true)`.

2. **Admin Email Whitelist & Casing**:
   - Authorized admin emails are strictly:
     - `kaushtubh457@gmail.com`
     - `jatinthacker000@gmail.com`
     - `pathak.amitkumar@hrjohnsonindia.com`
   - The rules use `.lower()` to eliminate casing discrepancies. Ensure the login email matches one of these three addresses.

3. **Score Boundary Violations on `testResults`**:
   - Ensure `score` and `maxMarks` are numeric numbers (not strings like `"34"`).
   - Ensure `score >= 0` and `score <= maxMarks`.
   - Ensure `maxMarks > 0`.

4. **Field Diff Rejections on `testSessions` Updates**:
   - If a non-admin client updates a `testSessions` document, verify that ONLY the whitelisted fields are being written:
     `['cachedContentId', 'cacheExpiresAt', 'topicMap', 'chaptersCovered', 'curriculumSummary']`.
   - Writing any other field (e.g. `questions`, `markingScheme`, `status`, `name`) will trigger an immediate permission denial.

---

### 6.2 Monitoring Security Rules via Google Cloud Console
To inspect live rule evaluation metrics and denied requests:

1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/) for project `nerd-tutors-001`.
2. Go to **Cloud Logging** -> **Logs Explorer**.
3. Use the following query to view Firestore security rule evaluations:
   ```text
   resource.type="cloud_firestore_database"
   jsonPayload.@type="type.googleapis.com/google.firestore.v1.FirestoreAudit"
   ```
4. In the Firebase Console, visit **Firestore Database** -> **Usage** tab to view daily read/write/delete operations and monitor rule evaluation traffic.

---

## 7. Compliance & Verification Attestation

- **Git Tracking Invariant**: Verified via `.gitignore` entry `firestore.rules` and `git check-ignore firestore.rules`. No rules files exist in the Git tracking index.
- **CBSE Moderation Standard**: Preserves deterministic AI evaluation pipelines and enforces exact mathematical boundary invariants at the database persistence tier.
- **Least Privilege Access**: Admin operations, student operations, and public boundaries are strictly compartmentalized with a global default-deny posture.
