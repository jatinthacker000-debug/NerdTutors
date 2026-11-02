/**
 * tests/security-verification-m1.js
 * 
 * Comprehensive automated security verification suite for Milestone M1:
 * - CORS origin hardening & allowed origins enforcement
 * - Direct invocation & anti-abuse validation
 * - HMAC Gate token generation & cryptographic verification
 * - Strict Admin Role Resolution (no loose substring matching)
 * - Error sanitization & secret masking
 * - Dual-key sliding window rate limiting & admin zero-limit bypass
 * - Protected endpoint authentication guards (manage-gate, check-vertex, analyze-topics, batch-evaluate, create-cache, extract-pdf, verify-gate)
 */

import {
    handleCors,
    validateInvocation,
    verifyAuth,
    checkIsAdmin,
    sendError,
    sanitizeString,
    checkRateLimit,
    resetRateLimits,
    createSignedGateToken,
    verifyGateToken,
    getAllowedOrigins,
    PRODUCTION_ORIGIN,
    DEPRECATED_ORIGIN,
    DEFAULT_CREDENTIALS
} from '../api/_security.js';

import verifyGateHandler from '../api/verify-gate.js';
import manageGateHandler from '../api/manage-gate.js';
import checkVertexHandler from '../api/check-vertex.js';
import analyzeTopicsHandler from '../api/analyze-topics.js';
import batchEvaluateHandler from '../api/batch-evaluate.js';
import createCacheHandler from '../api/create-cache.js';
import extractPdfHandler from '../api/extract-pdf.js';

// Test mock helper
function createMockReqRes({ method = 'GET', origin = null, referer = null, headers = {}, body = null, query = {} } = {}) {
    const reqHeaders = { ...headers };
    if (origin) reqHeaders['origin'] = origin;
    if (referer) reqHeaders['referer'] = referer;

    const req = {
        method,
        headers: reqHeaders,
        body,
        query,
        socket: { remoteAddress: '127.0.0.1' }
    };

    let statusCode = 200;
    const responseHeaders = {};
    let responseBody = null;
    let ended = false;

    const res = {
        setHeader(k, v) {
            responseHeaders[k.toLowerCase()] = v;
        },
        getHeader(k) {
            return responseHeaders[k.toLowerCase()];
        },
        status(code) {
            statusCode = code;
            return res;
        },
        json(data) {
            responseBody = data;
            ended = true;
            return res;
        },
        end() {
            ended = true;
            return res;
        },
        _getStatusCode: () => statusCode,
        _getHeaders: () => responseHeaders,
        _getBody: () => responseBody,
        _isEnded: () => ended
    };

    return { req, res };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        failed++;
    }
}

async function runTests() {
    console.log('\n=== RUNNING MILESTONE M1 SECURITY VERIFICATION SUITE ===\n');

    // -------------------------------------------------------------
    // Test Group 1: CORS Origin Hardening
    // -------------------------------------------------------------
    console.log('--- Test Group 1: CORS Origin Hardening ---');

    // 1.1 Allowed production origin
    {
        const { req, res } = createMockReqRes({
            method: 'POST',
            origin: PRODUCTION_ORIGIN
        });
        const handled = handleCors(req, res);
        assert(handled === false, 'handleCors allows execution to continue for valid production origin');
        assert(res.getHeader('access-control-allow-origin') === PRODUCTION_ORIGIN, 'CORS header matches production origin');
        assert(res.getHeader('x-content-type-options') === 'nosniff', 'nosniff header is set');
    }

    // 1.2 Deprecated production origin must be rejected with 403
    {
        const { req, res } = createMockReqRes({
            method: 'POST',
            origin: DEPRECATED_ORIGIN
        });
        const handled = handleCors(req, res);
        assert(handled === true, 'handleCors halts execution for deprecated domain');
        assert(res._getStatusCode() === 403, 'Deprecated domain receives 403 Forbidden');
        assert(!res.getHeader('access-control-allow-origin'), 'Access-Control-Allow-Origin is NOT set for deprecated domain');
    }

    // 1.3 Untrusted foreign origin rejected with 403
    {
        const { req, res } = createMockReqRes({
            method: 'POST',
            origin: 'https://evil-attacker.com'
        });
        const handled = handleCors(req, res);
        assert(handled === true, 'handleCors halts execution for untrusted origin');
        assert(res._getStatusCode() === 403, 'Untrusted origin receives 403 Forbidden');
    }

    // 1.4 Preflight OPTIONS returns 204
    {
        const { req, res } = createMockReqRes({
            method: 'OPTIONS',
            origin: PRODUCTION_ORIGIN
        });
        const handled = handleCors(req, res);
        assert(handled === true, 'handleCors responds to OPTIONS preflight');
        assert(res._getStatusCode() === 204, 'OPTIONS returns 204 No Content');
        assert(res.getHeader('access-control-allow-origin') === PRODUCTION_ORIGIN, 'OPTIONS returns CORS header');
    }

    // 1.5 Localhost origins in production mode must be rejected
    {
        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const { req, res } = createMockReqRes({
            method: 'POST',
            origin: 'http://localhost:3000'
        });
        const handled = handleCors(req, res);
        assert(handled === true, 'Localhost is rejected in production mode');
        assert(res._getStatusCode() === 403, 'Localhost receives 403 in production mode');
        process.env.NODE_ENV = prevEnv;
    }

    // -------------------------------------------------------------
    // Test Group 2: Invocation Validation & Anti-Abuse
    // -------------------------------------------------------------
    console.log('\n--- Test Group 2: Invocation Validation & Anti-Abuse ---');

    // 2.1 Untrusted referer rejected
    {
        const { req, res } = createMockReqRes({
            referer: 'https://evil-attacker.com/attack.html'
        });
        const rejected = validateInvocation(req, res);
        assert(rejected === true, 'Untrusted referer is blocked');
        assert(res._getStatusCode() === 403, 'Untrusted referer receives 403');
    }

    // 2.2 Valid referer allowed
    {
        const { req, res } = createMockReqRes({
            referer: `${PRODUCTION_ORIGIN}/ocr-scan.html`
        });
        const rejected = validateInvocation(req, res);
        assert(rejected === false, 'Valid referer is allowed');
    }

    // 2.3 Direct curl in production without auth is rejected
    {
        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const { req, res } = createMockReqRes({
            headers: {} // No origin, no referer, no auth
        });
        const rejected = validateInvocation(req, res);
        assert(rejected === true, 'Direct invocation without origin/referer/auth is blocked in production');
        assert(res._getStatusCode() === 403, 'Direct invocation receives 403');
        process.env.NODE_ENV = prevEnv;
    }

    // -------------------------------------------------------------
    // Test Group 3: Strict Admin Role Resolution
    // -------------------------------------------------------------
    console.log('\n--- Test Group 3: Strict Admin Role Resolution ---');

    // 3.1 Authorized admins
    assert(checkIsAdmin('kaushtubh457@gmail.com') === true, 'kaushtubh457@gmail.com is recognized as admin');
    assert(checkIsAdmin('jatinthacker000@gmail.com') === true, 'jatinthacker000@gmail.com is recognized as admin');
    assert(checkIsAdmin('pathak.amitkumar@hrjohnsonindia.com') === true, 'pathak.amitkumar@hrjohnsonindia.com is recognized as admin');
    assert(checkIsAdmin({ email: 'kaushtubh457@gmail.com' }) === true, 'Admin object email is recognized');

    // 3.2 Unauthorized emails - Substring bypass prevention
    assert(checkIsAdmin('badadmin@attacker.com') === false, 'badadmin@attacker.com is REJECTED (substring attack blocked)');
    assert(checkIsAdmin('admin@malicious.org') === false, 'admin@malicious.org is REJECTED');
    assert(checkIsAdmin('myadminaccount@gmail.com') === false, 'myadminaccount@gmail.com is REJECTED');
    assert(checkIsAdmin('student@nerdtutors.com') === false, 'student@nerdtutors.com is REJECTED');

    // 3.3 Gate token admin verification
    const validGateToken = createSignedGateToken('nerd_tutor_alpha');
    assert(checkIsAdmin(null, validGateToken) === true, 'Valid signed gate token grants admin');
    assert(checkIsAdmin(null, 'tampered_gate_token_123') === false, 'Tampered gate token is REJECTED');

    // -------------------------------------------------------------
    // Test Group 4: Error Sanitization & Secret Masking
    // -------------------------------------------------------------
    console.log('\n--- Test Group 4: Error Sanitization & Secret Masking ---');

    {
        const sensitive = 'Model failed at https://generativelanguage.googleapis.com/v1beta?key=AIzaSyD7J_N9AH7v9sOWsoA4D0ihVMNvjsLKneA with Bearer eyJhbGciOiJSUzI1NiJ9';
        const cleaned = sanitizeString(sensitive);
        assert(!cleaned.includes('AIzaSyD7J_N9AH7v9sOWsoA4D0ihVMNvjsLKneA'), 'Google API key is redacted');
        assert(cleaned.includes('[REDACTED_API_KEY]'), 'Replacement token [REDACTED_API_KEY] is inserted');
        assert(!cleaned.includes('eyJhbGciOiJSUzI1NiJ9'), 'Bearer token is redacted');
    }

    {
        const { req, res } = createMockReqRes();
        sendError(res, 500, 'Vertex error with key=AQ.ABC123secretKey', { rawUrl: 'https://api.com?key=AIzaSySecret' });
        const body = res._getBody();
        assert(res._getStatusCode() === 500, 'sendError sets status code');
        assert(!body.error.includes('AQ.ABC123secretKey'), 'Vertex key redacted in error message');
        assert(!body.details.rawUrl.includes('AIzaSySecret'), 'API key redacted in details object');
    }

    // -------------------------------------------------------------
    // Test Group 5: Tiered Rate Limiting & Admin Bypass
    // -------------------------------------------------------------
    console.log('\n--- Test Group 5: Tiered Rate Limiting & Admin Bypass ---');

    resetRateLimits();

    // 5.1 Admin bypass: unlimited evaluations
    {
        const adminUser = { uid: 'admin_1', email: 'kaushtubh457@gmail.com', isAdmin: true };
        const { req } = createMockReqRes({ headers: { 'x-forwarded-for': '203.0.113.1' } });
        let adminAllowedAll = true;
        for (let i = 0; i < 10; i++) {
            const rl = checkRateLimit(req, adminUser);
            if (!rl.allowed || !rl.isAdmin) adminAllowedAll = false;
        }
        assert(adminAllowedAll === true, 'Admin executes 10 rapid evaluations with zero rate limiting (100% bypass)');
    }

    // 5.2 Student rate limiting: 3/min limit
    {
        const studentUser = { uid: 'student_99', email: 'student99@test.com', isAdmin: false };
        const { req } = createMockReqRes({ headers: { 'x-forwarded-for': '198.51.100.25' } });

        const r1 = checkRateLimit(req, studentUser);
        const r2 = checkRateLimit(req, studentUser);
        const r3 = checkRateLimit(req, studentUser);
        const r4 = checkRateLimit(req, studentUser);

        assert(r1.allowed === true, 'Student eval 1 is allowed');
        assert(r2.allowed === true, 'Student eval 2 is allowed');
        assert(r3.allowed === true, 'Student eval 3 is allowed');
        assert(r4.allowed === false, 'Student eval 4 is REJECTED with 429 rate limit exceeded');
        assert(r4.retryAfterSeconds > 0, 'Student receives positive retryAfterSeconds cooldown');
        assert(r4.message.includes('Students are permitted a maximum of 3 evaluations per minute'), 'Student receives plain-language message');
    }

    // -------------------------------------------------------------
    // Test Group 6: API Endpoint Authentication Guards
    // -------------------------------------------------------------
    console.log('\n--- Test Group 6: API Endpoint Authentication Guards ---');

    // 6.1 api/manage-gate.js
    // Unauthenticated GET must return 401
    {
        const { req, res } = createMockReqRes({ method: 'GET' });
        await manageGateHandler(req, res);
        assert(res._getStatusCode() === 401, 'api/manage-gate.js GET unauthenticated returns 401');
    }

    // Unauthenticated POST must return 401
    {
        const { req, res } = createMockReqRes({ method: 'POST', body: { action: 'add' } });
        await manageGateHandler(req, res);
        assert(res._getStatusCode() === 401, 'api/manage-gate.js POST unauthenticated returns 401');
    }

    // Authenticated Admin GET returns credentials WITHOUT passwords
    {
        const adminGateToken = createSignedGateToken('nerd_tutor_alpha');
        const { req, res } = createMockReqRes({
            method: 'GET',
            headers: { 'x-gate-token': adminGateToken }
        });
        await manageGateHandler(req, res);
        assert(res._getStatusCode() === 200, 'api/manage-gate.js authenticated admin GET returns 200');
        const data = res._getBody();
        assert(Array.isArray(data.credentials), 'Returns credentials array');
        const hasCleartextPassword = data.credentials.some(c => Boolean(c.password));
        assert(hasCleartextPassword === false, 'api/manage-gate.js GET strictly OMITS cleartext passwords');
    }

    // 6.2 api/check-vertex.js
    // Unauthenticated GET must return 401
    {
        const { req, res } = createMockReqRes({ method: 'GET' });
        await checkVertexHandler(req, res);
        assert(res._getStatusCode() === 401, 'api/check-vertex.js unauthenticated returns 401');
    }

    // Authenticated admin GET is allowed
    {
        const adminGateToken = createSignedGateToken('nerd_tutor_alpha');
        const { req, res } = createMockReqRes({
            method: 'GET',
            headers: { 'x-gate-token': adminGateToken }
        });
        await checkVertexHandler(req, res);
        assert(res._getStatusCode() === 200, 'api/check-vertex.js authenticated admin returns 200');
    }

    // 6.3 api/analyze-topics.js
    // Unauthenticated POST must return 401
    {
        const { req, res } = createMockReqRes({
            method: 'POST',
            body: { questions: 'Q1. Test question' }
        });
        await analyzeTopicsHandler(req, res);
        assert(res._getStatusCode() === 401, 'api/analyze-topics.js unauthenticated returns 401');
    }

    // 6.4 api/batch-evaluate.js
    // Unauthenticated request must return 401
    {
        const { req, res } = createMockReqRes({
            method: 'POST',
            body: { action: 'create', students: [{ studentName: 'Test' }] }
        });
        await batchEvaluateHandler(req, res);
        assert(res._getStatusCode() === 401, 'api/batch-evaluate.js unauthenticated returns 401');
    }

    // 6.5 api/create-cache.js
    // Unauthenticated POST must return 401
    {
        const { req, res } = createMockReqRes({
            method: 'POST',
            body: { questions: 'Q1', markingScheme: 'M1' }
        });
        await createCacheHandler(req, res);
        assert(res._getStatusCode() === 401, 'api/create-cache.js unauthenticated returns 401');
    }

    // 6.6 api/extract-pdf.js
    // Self-test diagnostic mode is allowed
    {
        const { req, res } = createMockReqRes({
            method: 'POST',
            body: { action: 'self-test' }
        });
        await extractPdfHandler(req, res);
        assert(res._getStatusCode() === 200, 'api/extract-pdf.js self-test mode returns 200');
    }

    // Unauthenticated extraction must return 401
    {
        const { req, res } = createMockReqRes({
            method: 'POST',
            body: { pdfBase64: 'JVBERi0xLjQK...' }
        });
        await extractPdfHandler(req, res);
        assert(res._getStatusCode() === 401, 'api/extract-pdf.js unauthenticated extraction returns 401');
    }

    // 6.7 api/verify-gate.js
    // Invalid credentials return 401
    {
        const { req, res } = createMockReqRes({
            method: 'POST',
            body: { username: 'invalid_user', password: 'wrong_password' }
        });
        await verifyGateHandler(req, res);
        assert(res._getStatusCode() === 401, 'api/verify-gate.js invalid login returns 401');
    }

    // Valid credentials return 200 and signed HMAC token
    {
        const { req, res } = createMockReqRes({
            method: 'POST',
            body: { username: 'nerd_tutor_alpha', password: 'nt_pass_alpha2026' }
        });
        await verifyGateHandler(req, res);
        assert(res._getStatusCode() === 200, 'api/verify-gate.js valid login returns 200');
        const token = res._getBody()?.token;
        assert(Boolean(token), 'api/verify-gate.js returns signed token');
        const verified = verifyGateToken(token);
        assert(verified?.username === 'nerd_tutor_alpha', 'Issued token verifies successfully via HMAC');
    }

    // -------------------------------------------------------------
    // Results Summary
    // -------------------------------------------------------------
    console.log('\n======================================================');
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
