# NerdTutors Rate Limiting & Abuse Prevention Policies

## 1. Overview & Purpose

The NerdTutors evaluation engine utilizes frontier multimodal AI models—including Google Cloud Vertex AI's **Gemini 4 Argon** and **Gemini 3.8 Flash**—to perform deep-reasoning, CBSE-aligned optical grading of handwritten student answer sheets. 

Because advanced multimodal AI inference entails substantial computational overhead and third-party API costs, tiered rate limiting is enforced across all evaluation endpoints:
- `api/ocr-evaluate.js` (Primary single-pass vision handwriting evaluator)
- `api/evaluate.js` (Secondary / legacy text evaluator)
- `api/batch-evaluate.js` (Bulk asynchronous evaluation and batch job management)

The rate limiting engine safeguards system stability, ensures equitable resource allocation among students, prevents runaway API bills, and defends against automated scraping or denial-of-service (DoS) attempts while granting teachers and administrators completely unhindered evaluation throughput.

---

## 2. Policy Summary by User Role

| Role / Identity | Per-Minute Burst Limit | Daily Quota | Cooldown / Throttling | Verification Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **Normal Student** | **3 evaluations** / rolling 60s | **25 evaluations** / calendar day | Automatic HTTP 429 with `Retry-After` | Firebase Auth ID Token (`isAdmin: false`) |
| **Verified Administrator** | **Unlimited** (∞) | **Unlimited** (∞) | None (0s cooldown) | Cryptographically verified Admin Email or HMAC-SHA256 Gate Token |
| **Unauthenticated Caller** | **0** (Immediate rejection) | **0** | Blocked with HTTP 401 Unauthorized | N/A |

---

## 3. Student Rate Limiting Policy

Normal authenticated students are bound by a two-tiered quota:

### A. Sliding-Window Burst Protection (Minute Limit)
- **Maximum Rate**: **3 evaluations per rolling 60 seconds**.
- **Sliding Window Calculation**: Every submission timestamp is recorded. When a new submission arrives, all timestamps older than 60,000 milliseconds are purged. If 3 or more evaluations occurred in the preceding 60 seconds, the request is temporarily blocked.
- **Cooldown Window**: The student must wait until the oldest evaluation within the 60-second window expires (typically between 1 and 60 seconds).

### B. Daily Fair-Use Quota (Day Limit)
- **Maximum Daily Limit**: **25 evaluations per calendar day**.
- **Day Boundary Reset**: The daily counter resets automatically at 00:00:00 UTC (midnight).
- **Quota Exceeded Action**: Once 25 evaluations have been consumed in a single day, the student cannot initiate new evaluations until the next calendar day begins. The response directs the student to consult their educator or administrator if an extension is warranted.

---

## 4. Administrator Exemption Policy

Verified administrators enjoy **100% unlimited evaluations and batch predictions** without rate limits, cooldowns, or throttling.

### A. Eligible Administrator Identities
An evaluation request is automatically recognized as administrative and granted immediate rate-limit bypass if it satisfies either of the following criteria:

1. **Verified Admin Email Address**:
   - `kaushtubh457@gmail.com`
   - `jatinthacker000@gmail.com`
   - `pathak.amitkumar@hrjohnsonindia.com`
   - Any email listed in the server environment variable `ADMIN_EMAILS` (comma-separated).
2. **Cryptographically Signed HMAC Gate Token**:
   - Requests presenting a valid HMAC-SHA256 token signed with the server's `GATE_SECRET` (issued to authorized moderators via `api/verify-gate.js`).

### B. Anti-Spoofing & Privilege Escalation Defense
- **Zero Trust in Unverified Client Headers**: The backend **never** trusts client-provided headers like `X-User-Email` or `X-Admin: true` for privilege determination.
- **Cryptographic Validation**:
  - Firebase Auth ID tokens are cryptographically verified using Google's official public X.509 RS256 certificates.
  - Gate tokens are validated using HMAC-SHA256 signature verification with timing-safe comparison (`crypto.timingSafeEqual`) to prevent timing attacks.
  - Substring matching vulnerabilities are strictly eliminated: email addresses like `badadmin@attacker.com` or `jatin@malicious.org` are rejected as unprivileged students.

---

## 5. Response Format & RFC 6585 Compliance

When a rate limit is exceeded, the server returns an **HTTP 429 Too Many Requests** response adhering to RFC 6585 standards.

### A. HTTP Headers
- `Status`: `429 Too Many Requests`
- `Retry-After`: `<integer_seconds>` (Specifies the exact number of seconds the client must wait before retrying)
- `Content-Type`: `application/json`

### B. Minute Limit Exceeded Response (Payload Example)
```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 38

{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Students are permitted a maximum of 3 evaluations per minute. Please wait 38 seconds before submitting again.",
  "retryAfterSeconds": 38
}
```

### C. Daily Quota Exceeded Response (Payload Example)
```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 18420

{
  "error": "Too Many Requests",
  "message": "Daily evaluation quota exceeded (maximum 25 evaluations per day for students). Please try again tomorrow or contact an administrator.",
  "retryAfterSeconds": 18420
}
```

---

## 6. Architecture & Security Rationale

### A. Dual-Key Tracking (`IP` + `UID`)
The rate limiting engine tracks usage concurrently across two independent dimensions:
1. **Network IP Key (`ip:<client_ip>`)**: Extracted from `x-forwarded-for`, `x-real-ip`, or the direct socket address. Prevents malicious actors from creating multiple disposable student accounts to flood the evaluation queue from a single machine.
2. **User Identity Key (`uid:<user_uid>`)**: Extracted from the cryptographically verified authentication token. Prevents a student from bypassing rate limits by switching IP addresses, cycling through cellular / Wi-Fi networks, or utilizing VPN proxies.

Both keys must pass inspection. If either the IP or the authenticated User ID has exceeded the threshold, the request is rejected.

### B. In-Memory Sliding Window vs. Fixed Bucket
- Fixed-window rate limiting suffers from "boundary burst" vulnerabilities (e.g., submitting 3 requests at 00:59 and 3 more at 01:01, totaling 6 requests in 2 seconds).
- The NerdTutors sliding window maintains exact millisecond timestamps, ensuring that no student can ever exceed 3 evaluations in **any** rolling 60,000ms span.

### C. Serverless Execution & State Persistence
- In Vercel serverless environments, in-memory rate limiting operates within warm function instances, providing sub-millisecond local burst defense with zero database lookup latency.
- State is automatically memory-managed: stale timestamps are trimmed during every evaluation, and client records whose activity is older than 24 hours are periodically swept to maintain low memory footprints.

---

## 7. Frontend User Experience Integration

The frontend client (`ocr-scan.html` and `dashboard.js`) is designed to handle HTTP 429 responses gracefully:
1. **Clear Toast Feedback**: When HTTP 429 is received, a non-blocking glassmorphism toast appears with the human-friendly message returned by the API.
2. **Visual Cooldown Timer**: The submit button displays a countdown timer derived directly from the `Retry-After` header (e.g., `"Please wait 38s"`), re-enabling itself automatically when the window elapses.
3. **Data Preservation**: In accordance with system preservation guidelines, the client **never** discards uploaded images, answers, or form fields upon encountering a 429 response. The student's workspace remains completely intact.
