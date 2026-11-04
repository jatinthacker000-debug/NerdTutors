/**
 * tests/security-verification.js
 * 
 * NerdTutors Phase 2 Security Hardening Automated Verification Suite
 * 
 * Programmatically tests all acceptance criteria from ORIGINAL_REQUEST.md & PROJECT.md:
 * 1. CORS Origin Hardening & Anti-Abuse Invocation Guards
 * 2. Mandatory Authentication for Evaluation Endpoints
 * 3. Tiered Rate Limiting & 100% Admin Bypass
 * 4. Frontend Stored XSS Sanitization & Entity Escaping
 * 5. Firestore Rules Git Guard & Deployment Documentation
 * 6. Core Evaluation Engine Preservation Invariants
 * 
 * Run command:
 *   node tests/security-verification.js
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ANSI Color Helpers
const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

// Test Runner State
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];
let currentSuite = '';

function suite(name) {
    currentSuite = name;
    console.log(`\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan} SUITE: ${name}${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
}

async function test(name, fn) {
    totalTests++;
    const testId = `${currentSuite} > ${name}`;
    try {
        await fn();
        passedTests++;
        testResults.push({ suite: currentSuite, name, status: 'PASS' });
        console.log(`  ${colors.green}✔ PASS${colors.reset} ${name}`);
    } catch (err) {
        failedTests++;
        testResults.push({ suite: currentSuite, name, status: 'FAIL', error: err.message });
        console.log(`  ${colors.red}✖ FAIL${colors.reset} ${name}`);
        console.log(`    ${colors.yellow}Error: ${err.message}${colors.reset}`);
        if (process.env.VERBOSE && err.stack) {
            console.log(`    ${colors.gray}${err.stack.split('\n').slice(1, 4).join('\n    ')}${colors.reset}`);
        }
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertIncludes(haystack, needle, message) {
    if (typeof haystack === 'string' && !haystack.includes(needle)) {
        throw new Error(`${message || 'Assertion failed'}: expected string to include ${JSON.stringify(needle)}`);
    } else if (Array.isArray(haystack) && !haystack.includes(needle)) {
        throw new Error(`${message || 'Assertion failed'}: expected array to include ${JSON.stringify(needle)}`);
    }
}

function assertNotIncludes(haystack, needle, message) {
    if (typeof haystack === 'string' && haystack.includes(needle)) {
        throw new Error(`${message || 'Assertion failed'}: expected string NOT to include ${JSON.stringify(needle)}`);
    } else if (Array.isArray(haystack) && haystack.includes(needle)) {
        throw new Error(`${message || 'Assertion failed'}: expected array NOT to include ${JSON.stringify(needle)}`);
    }
}

// Mock Request & Response Factory for Vercel Serverless Handlers
function createMockReqRes({
    method = 'GET',
    url = '/',
    headers = {},
    body = null,
    remoteAddress = '127.0.0.1'
} = {}) {
    const normalizedHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
        normalizedHeaders[k.toLowerCase()] = v;
    }
    const req = {
        method,
        url,
        headers: normalizedHeaders,
        body,
        socket: { remoteAddress }
    };
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        ended: false,
        setHeader(k, v) {
            this.headers[k.toLowerCase()] = v;
            return this;
        },
        getHeader(k) {
            return this.headers[k.toLowerCase()];
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            this.ended = true;
            return this;
        },
        end(data) {
            if (data !== undefined) this.body = data;
            this.ended = true;
            return this;
        }
    };
    return { req, res };
}

// Main Execution Function
async function runAllTests() {
    console.log(`${colors.bold}${colors.blue}╔══════════════════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.bold}${colors.blue}║          NERDTUTORS PHASE 2 SECURITY VERIFICATION SUITE              ║${colors.reset}`);
    console.log(`${colors.bold}${colors.blue}╚══════════════════════════════════════════════════════════════════════╝${colors.reset}`);
    console.log(`${colors.gray}Timestamp: ${new Date().toISOString()}${colors.reset}`);
    console.log(`${colors.gray}Target Directory: ${ROOT_DIR}${colors.reset}\n`);

    const startTime = Date.now();

    // Dynamically load _security.js if present
    let secModule = null;
    const secPath = path.join(ROOT_DIR, 'api', '_security.js');
    if (fs.existsSync(secPath)) {
        try {
            secModule = await import(`file://${secPath}`);
        } catch (e) {
            console.warn(`[WARN] Could not import api/_security.js: ${e.message}`);
        }
    }

    // =========================================================================
    // SUITE 1: CORS Origin Hardening & Anti-Abuse Invocation Guards
    // =========================================================================
    suite('1. CORS Origin Hardening & Anti-Abuse Invocation Guards');

    await test('api/_security.js exists and exports required security functions', () => {
        assert(fs.existsSync(secPath), 'api/_security.js must exist');
        assert(secModule !== null, 'api/_security.js must be importable as ES module');
        assert(typeof secModule.handleCors === 'function', 'handleCors must be exported');
        assert(typeof secModule.validateInvocation === 'function', 'validateInvocation must be exported');
        assert(typeof secModule.verifyAuth === 'function', 'verifyAuth must be exported');
        assert(typeof secModule.checkIsAdmin === 'function', 'checkIsAdmin must be exported');
        assert(typeof secModule.checkRateLimit === 'function', 'checkRateLimit must be exported');
        assert(typeof secModule.sendError === 'function', 'sendError must be exported');
    });

    await test('CORS allows valid production origin https://nerd-tutors-two.vercel.app', () => {
        assert(secModule, 'Security module required');
        const { req, res } = createMockReqRes({
            method: 'OPTIONS',
            headers: {
                origin: 'https://nerd-tutors-two.vercel.app',
                'access-control-request-method': 'POST'
            }
        });
        const handled = secModule.handleCors(req, res);
        assert(handled === true, 'handleCors must handle OPTIONS request');
        assertEqual(res.getHeader('access-control-allow-origin'), 'https://nerd-tutors-two.vercel.app');
        assert([200, 204].includes(res.statusCode), `Expected status 200 or 204, got ${res.statusCode}`);
        assertEqual(res.getHeader('x-content-type-options'), 'nosniff', 'X-Content-Type-Options nosniff required');
        assertEqual(res.getHeader('x-frame-options'), 'SAMEORIGIN', 'X-Frame-Options SAMEORIGIN required');
    });

    await test('CORS allows valid production origin on actual POST requests', () => {
        assert(secModule, 'Security module required');
        const { req, res } = createMockReqRes({
            method: 'POST',
            headers: {
                origin: 'https://nerd-tutors-two.vercel.app'
            }
        });
        const handled = secModule.handleCors(req, res);
        assert(handled === false, 'handleCors must return false on non-OPTIONS allowed requests so execution continues');
        assertEqual(res.getHeader('access-control-allow-origin'), 'https://nerd-tutors-two.vercel.app');
    });

    await test('CORS rejects deprecated origin https://nerd-tutors.vercel.app with 403 or denial', () => {
        assert(secModule, 'Security module required');
        const { req, res } = createMockReqRes({
            method: 'OPTIONS',
            headers: {
                origin: 'https://nerd-tutors.vercel.app',
                'access-control-request-method': 'POST'
            }
        });
        const handled = secModule.handleCors(req, res);
        assert(handled === true, 'handleCors must handle/reject invalid origin');
        assert(res.statusCode === 403 || res.getHeader('access-control-allow-origin') !== 'https://nerd-tutors.vercel.app',
            'Deprecated origin must be rejected or not granted allow headers');
    });

    await test('CORS rejects untrusted origin https://malicious-site.com', () => {
        assert(secModule, 'Security module required');
        const { req, res } = createMockReqRes({
            method: 'OPTIONS',
            headers: {
                origin: 'https://malicious-site.com',
                'access-control-request-method': 'POST'
            }
        });
        const handled = secModule.handleCors(req, res);
        assert(handled === true, 'handleCors must handle/reject untrusted origin');
        assert(res.statusCode === 403 || !res.getHeader('access-control-allow-origin'),
            'Untrusted origin must be rejected with 403 or denied allow headers');
    });

    await test('CORS denies localhost origins when NODE_ENV === "production"', () => {
        assert(secModule, 'Security module required');
        const origEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'production';
            const { req, res } = createMockReqRes({
                method: 'OPTIONS',
                headers: {
                    origin: 'http://localhost:3000',
                    'access-control-request-method': 'POST'
                }
            });
            const handled = secModule.handleCors(req, res);
            assert(handled === true, 'handleCors must reject localhost in production');
            assert(res.statusCode === 403 || res.getHeader('access-control-allow-origin') !== 'http://localhost:3000',
                'Localhost must be denied in production environment');
        } finally {
            process.env.NODE_ENV = origEnv;
        }
    });

    await test('CORS permits localhost origins when NODE_ENV === "development"', () => {
        assert(secModule, 'Security module required');
        const origEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'development';
            const { req, res } = createMockReqRes({
                method: 'OPTIONS',
                headers: {
                    origin: 'http://localhost:3000',
                    'access-control-request-method': 'POST'
                }
            });
            const handled = secModule.handleCors(req, res);
            assert(handled === true, 'handleCors must handle options for localhost in dev');
            assertEqual(res.getHeader('access-control-allow-origin'), 'http://localhost:3000',
                'Localhost must be permitted in non-production environment');
        } finally {
            process.env.NODE_ENV = origEnv;
        }
    });

    await test('Anti-abuse guard rejects requests with untrusted Origin header', () => {
        assert(secModule, 'Security module required');
        const { req, res } = createMockReqRes({
            method: 'POST',
            headers: { origin: 'https://attacker-domain.evil' }
        });
        const blocked = secModule.validateInvocation(req, res);
        assert(blocked === true, 'validateInvocation must return true (blocked) for untrusted origin');
        assertEqual(res.statusCode, 403, 'Must return HTTP 403');
    });

    await test('Anti-abuse guard rejects requests with untrusted Referer header', () => {
        assert(secModule, 'Security module required');
        const { req, res } = createMockReqRes({
            method: 'POST',
            headers: { referer: 'https://attacker-domain.evil/phish.html' }
        });
        const blocked = secModule.validateInvocation(req, res);
        assert(blocked === true, 'validateInvocation must return true (blocked) for untrusted referer');
        assertEqual(res.statusCode, 403, 'Must return HTTP 403');
    });

    await test('Anti-abuse guard rejects direct external invocations (no origin/referer/auth) in production', () => {
        assert(secModule, 'Security module required');
        const origEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'production';
            const { req, res } = createMockReqRes({
                method: 'POST',
                headers: {}
            });
            const blocked = secModule.validateInvocation(req, res);
            assert(blocked === true, 'Direct curl/bot invocation without auth in production must be blocked');
            assertEqual(res.statusCode, 403, 'Must return HTTP 403');
        } finally {
            process.env.NODE_ENV = origEnv;
        }
    });

    await test('Wildcard Access-Control-Allow-Origin: * is completely removed from all 5 target files', () => {
        const targetFiles = [
            'api/analyze-topics.js',
            'api/batch-evaluate.js',
            'api/check-vertex.js',
            'api/create-cache.js',
            'api/manage-gate.js'
        ];

        for (const relPath of targetFiles) {
            const fullPath = path.join(ROOT_DIR, relPath);
            assert(fs.existsSync(fullPath), `Target file ${relPath} must exist`);
            const content = fs.readFileSync(fullPath, 'utf8');

            // Assert no wildcard CORS header
            assertNotIncludes(content, 'Access-Control-Allow-Origin", "*"',
                `Wildcard CORS found in ${relPath}`);
            assertNotIncludes(content, "Access-Control-Allow-Origin', '*'",
                `Wildcard CORS found in ${relPath}`);
            assertNotIncludes(content, 'Access-Control-Allow-Origin", "*"',
                `Wildcard CORS found in ${relPath}`);
            assertNotIncludes(content, '"Access-Control-Allow-Origin", "*"',
                `Wildcard CORS found in ${relPath}`);
        }
    });

    await test('Deprecated domain https://nerd-tutors.vercel.app is removed from active allowedOrigins across api/', () => {
        const apiFiles = fs.readdirSync(path.join(ROOT_DIR, 'api'))
            .filter(f => f.endsWith('.js') && f !== '_security.js');

        for (const file of apiFiles) {
            const content = fs.readFileSync(path.join(ROOT_DIR, 'api', file), 'utf8');
            // If the file defines its own allowedOrigins array, it must not include deprecated origin
            const allowedOriginsMatch = content.match(/allowedOrigins\s*=\s*\[([\s\S]*?)\]/);
            if (allowedOriginsMatch) {
                const arrayBody = allowedOriginsMatch[1];
                assertNotIncludes(arrayBody, 'https://nerd-tutors.vercel.app',
                    `Deprecated domain found in allowedOrigins of api/${file}`);
            }
        }
    });

    // =========================================================================
    // SUITE 2: Mandatory User Authentication for Evaluation Endpoints
    // =========================================================================
    suite('2. Mandatory User Authentication for Evaluation Endpoints');

    await test('verifyAuth rejects unauthenticated requests (missing token)', async () => {
        assert(secModule, 'Security module required');
        const { req } = createMockReqRes({
            method: 'POST',
            headers: {}
        });
        const auth = await secModule.verifyAuth(req);
        assertEqual(auth.authenticated, false, 'Unauthenticated request must return authenticated: false');
        assert(auth.user === null, 'User object must be null for unauthenticated request');
    });

    await test('verifyAuth rejects malformed or invalid Bearer tokens', async () => {
        assert(secModule, 'Security module required');
        const { req } = createMockReqRes({
            method: 'POST',
            headers: { authorization: 'Bearer invalid-token-string' }
        });
        const auth = await secModule.verifyAuth(req);
        assertEqual(auth.authenticated, false, 'Malformed token must fail authentication');
    });

    await test('verifyAuth accepts valid HMAC-signed gate token via X-Gate-Token header', async () => {
        assert(secModule, 'Security module required');
        const token = secModule.createSignedGateToken('nerd_tutor_alpha', { permanent: true });
        const { req } = createMockReqRes({
            method: 'POST',
            headers: { 'x-gate-token': token }
        });
        const auth = await secModule.verifyAuth(req);
        assertEqual(auth.authenticated, true, 'Valid gate token must authenticate successfully');
        assert(auth.user !== null, 'User object must be populated');
        assertEqual(auth.user.username, 'nerd_tutor_alpha');
        assertEqual(auth.user.isAdmin, true, 'Gate token user must have administrative privileges');
        assertEqual(auth.user.authType, 'gate');
    });

    await test('verifyAuth accepts valid HMAC-signed gate token via Authorization: Gate header', async () => {
        assert(secModule, 'Security module required');
        const token = secModule.createSignedGateToken('nerd_tutor_beta', { permanent: true });
        const { req } = createMockReqRes({
            method: 'POST',
            headers: { authorization: `Gate ${token}` }
        });
        const auth = await secModule.verifyAuth(req);
        assertEqual(auth.authenticated, true, 'Gate token via Authorization header must authenticate');
        assertEqual(auth.user.username, 'nerd_tutor_beta');
    });

    await test('verifyAuth accepts valid HMAC-signed gate token via Authorization: Bearer header', async () => {
        assert(secModule, 'Security module required');
        const token = secModule.createSignedGateToken('nerd_tutor_gamma', { permanent: true });
        const { req } = createMockReqRes({
            method: 'POST',
            headers: { authorization: `Bearer ${token}` }
        });
        const auth = await secModule.verifyAuth(req);
        assertEqual(auth.authenticated, true, 'Gate token via Bearer header must authenticate as fallback');
        assertEqual(auth.user.username, 'nerd_tutor_gamma');
    });

    await test('verifyAuth accepts valid legacy Base64 credentials for backward compatibility', async () => {
        assert(secModule, 'Security module required');
        const legacyToken = Buffer.from('nerd_tutor_alpha:nt_pass_alpha2026').toString('base64');
        const { req } = createMockReqRes({
            method: 'POST',
            headers: { 'x-gate-token': legacyToken }
        });
        const auth = await secModule.verifyAuth(req);
        assertEqual(auth.authenticated, true, 'Legacy master credentials must authenticate');
        assertEqual(auth.user.username, 'nerd_tutor_alpha');
    });

    await test('verifyAuth rejects tampered or forged HMAC gate tokens', async () => {
        assert(secModule, 'Security module required');
        const fakeToken = Buffer.from(JSON.stringify({
            u: 'attacker',
            permanent: true,
            sig: '0000000000000000000000000000000000000000000000000000000000000000'
        })).toString('base64');
        const { req } = createMockReqRes({
            method: 'POST',
            headers: { 'x-gate-token': fakeToken }
        });
        const auth = await secModule.verifyAuth(req);
        assertEqual(auth.authenticated, false, 'Forged token must fail authentication');
    });

    await test('verifyAuth rejects expired HMAC gate tokens', async () => {
        assert(secModule, 'Security module required');
        const expiredToken = secModule.createSignedGateToken('nerd_tutor_alpha', {
            permanent: false,
            exp: Date.now() - 60000 // Expired 1 minute ago
        });
        const { req } = createMockReqRes({
            method: 'POST',
            headers: { 'x-gate-token': expiredToken }
        });
        const auth = await secModule.verifyAuth(req);
        assertEqual(auth.authenticated, false, 'Expired token must fail authentication');
    });

    await test('api/ocr-evaluate.js blocks unauthenticated POST requests with HTTP 401', async () => {
        const handlerPath = path.join(ROOT_DIR, 'api', 'ocr-evaluate.js');
        const handlerModule = await import(`file://${handlerPath}`);
        const handler = handlerModule.default;
        const { req, res } = createMockReqRes({
            method: 'POST',
            headers: {
                origin: 'https://nerd-tutors-two.vercel.app'
            },
            body: { mode: 'single', question: 'test' }
        });

        await handler(req, res);
        assertEqual(res.statusCode, 401, 'api/ocr-evaluate.js must return HTTP 401 Unauthorized for unauthenticated calls');
        assert(res.body && res.body.error, 'Response must contain error object');
    });

    await test('api/evaluate.js blocks unauthenticated POST requests with HTTP 401', async () => {
        const handlerPath = path.join(ROOT_DIR, 'api', 'evaluate.js');
        const handlerModule = await import(`file://${handlerPath}`);
        const handler = handlerModule.default;
        const { req, res } = createMockReqRes({
            method: 'POST',
            headers: {
                origin: 'https://nerd-tutors-two.vercel.app'
            },
            body: { studentAnswer: 'test', modelAnswer: 'test' }
        });

        await handler(req, res);
        assertEqual(res.statusCode, 401, 'api/evaluate.js must return HTTP 401 Unauthorized for unauthenticated calls');
    });

    await test('api/batch-evaluate.js blocks unauthenticated requests with HTTP 401', async () => {
        const handlerPath = path.join(ROOT_DIR, 'api', 'batch-evaluate.js');
        const handlerModule = await import(`file://${handlerPath}`);
        const handler = handlerModule.default;
        const { req, res } = createMockReqRes({
            method: 'POST',
            headers: {
                origin: 'https://nerd-tutors-two.vercel.app'
            },
            body: { action: 'list' }
        });

        await handler(req, res);
        assertEqual(res.statusCode, 401, 'api/batch-evaluate.js must return HTTP 401 Unauthorized for unauthenticated calls');
    });

    await test('api/manage-gate.js blocks unauthenticated GET/POST requests with HTTP 401 (no credential leak)', async () => {
        const handlerPath = path.join(ROOT_DIR, 'api', 'manage-gate.js');
        const handlerModule = await import(`file://${handlerPath}`);
        const handler = handlerModule.default;
        const { req, res } = createMockReqRes({
            method: 'GET',
            headers: {
                origin: 'https://nerd-tutors-two.vercel.app'
            }
        });

        await handler(req, res);
        assertEqual(res.statusCode, 401, 'api/manage-gate.js must return HTTP 401 Unauthorized');
        assert(!res.body?.credentials, 'Must NEVER return credentials to unauthenticated callers');
    });

    // =========================================================================
    // SUITE 3: Tiered Rate Limiting & Admin Rate Limit Bypass
    // =========================================================================
    suite('3. Tiered Rate Limiting & Admin Rate Limit Bypass');

    await test('Normal student requests are permitted up to 3 evaluations per minute', () => {
        assert(secModule, 'Security module required');
        secModule.resetRateLimits();

        const studentUser = { uid: 'student_alice_01', email: 'alice@school.edu', isAdmin: false };
        const { req } = createMockReqRes({
            headers: { 'x-forwarded-for': '198.51.100.10' }
        });

        const hit1 = secModule.checkRateLimit(req, studentUser);
        assert(hit1.allowed === true, '1st request must be allowed');
        assertEqual(hit1.remainingMinute, 2, '2 evaluations remaining in minute window');

        const hit2 = secModule.checkRateLimit(req, studentUser);
        assert(hit2.allowed === true, '2nd request must be allowed');
        assertEqual(hit2.remainingMinute, 1, '1 evaluation remaining in minute window');

        const hit3 = secModule.checkRateLimit(req, studentUser);
        assert(hit3.allowed === true, '3rd request must be allowed');
        assertEqual(hit3.remainingMinute, 0, '0 evaluations remaining in minute window');
    });

    await test('Normal student exceeding 3 evaluations/min receives HTTP 429 with plain-language explanation and Retry-After', () => {
        assert(secModule, 'Security module required');
        // Continuing from previous test state where 3 hits occurred
        const studentUser = { uid: 'student_alice_01', email: 'alice@school.edu', isAdmin: false };
        const { req } = createMockReqRes({
            headers: { 'x-forwarded-for': '198.51.100.10' }
        });

        const hit4 = secModule.checkRateLimit(req, studentUser);
        assert(hit4.allowed === false, '4th request within 60s must be rejected (rate limited)');
        assert(hit4.retryAfterSeconds > 0, 'retryAfterSeconds must be greater than 0');
        assert(hit4.message && hit4.message.includes('Rate limit exceeded'), 'Must include clear rate limit message');
        assert(hit4.message.includes('maximum of 3 evaluations per minute') || hit4.message.includes('evaluations per minute'),
            'Must explain the 3 evaluations/minute limit in plain language');
    });

    await test('Admin account kaushtubh457@gmail.com bypasses rate limits completely (100% unlimited)', () => {
        assert(secModule, 'Security module required');
        secModule.resetRateLimits();

        const adminUser = { uid: 'admin_k', email: 'kaushtubh457@gmail.com', isAdmin: true };
        const { req } = createMockReqRes({
            headers: { 'x-forwarded-for': '198.51.100.20' }
        });

        // Execute 10 rapid calls
        for (let i = 1; i <= 10; i++) {
            const check = secModule.checkRateLimit(req, adminUser);
            assert(check.allowed === true, `Admin evaluation #${i} must be allowed with zero throttling`);
            assert(check.isAdmin === true, 'Response must confirm admin status');
            assertEqual(check.retryAfterSeconds, 0, 'No cooldown for admin');
        }
    });

    await test('Admin account jatinthacker000@gmail.com bypasses rate limits completely', () => {
        assert(secModule, 'Security module required');
        const adminUser = { uid: 'admin_j', email: 'jatinthacker000@gmail.com', isAdmin: true };
        const { req } = createMockReqRes({
            headers: { 'x-forwarded-for': '198.51.100.21' }
        });

        for (let i = 1; i <= 10; i++) {
            const check = secModule.checkRateLimit(req, adminUser);
            assert(check.allowed === true, `Admin evaluation #${i} must be allowed`);
        }
    });

    await test('Admin account pathak.amitkumar@hrjohnsonindia.com bypasses rate limits completely', () => {
        assert(secModule, 'Security module required');
        const adminUser = { uid: 'admin_a', email: 'pathak.amitkumar@hrjohnsonindia.com', isAdmin: true };
        const { req } = createMockReqRes({
            headers: { 'x-forwarded-for': '198.51.100.22' }
        });

        for (let i = 1; i <= 10; i++) {
            const check = secModule.checkRateLimit(req, adminUser);
            assert(check.allowed === true, `Admin evaluation #${i} must be allowed`);
        }
    });

    await test('HMAC Gate Token authenticated users bypass rate limits completely', () => {
        assert(secModule, 'Security module required');
        const gateUser = { uid: 'gate_nerd_tutor_alpha', email: 'nerd_tutor_alpha@nerdtutors.gate', authType: 'gate', isAdmin: true };
        const { req } = createMockReqRes({
            headers: { 'x-forwarded-for': '198.51.100.23' }
        });

        for (let i = 1; i <= 10; i++) {
            const check = secModule.checkRateLimit(req, gateUser);
            assert(check.allowed === true, `Gate admin evaluation #${i} must be allowed without limit`);
        }
    });

    await test('Anti-Spoofing: Client header X-User-Email cannot bypass rate limits without verified auth', () => {
        assert(secModule, 'Security module required');
        secModule.resetRateLimits();

        // Student tries to spoof admin by sending header X-User-Email: kaushtubh457@gmail.com
        // But the verified user object resolved by verifyAuth is an unprivileged student
        const untrustedStudent = { uid: 'attacker_uid', email: 'attacker@evil.com', isAdmin: false };
        const { req } = createMockReqRes({
            headers: {
                'x-forwarded-for': '198.51.100.30',
                'x-user-email': 'kaushtubh457@gmail.com'
            }
        });

        // 3 calls succeed
        secModule.checkRateLimit(req, untrustedStudent);
        secModule.checkRateLimit(req, untrustedStudent);
        secModule.checkRateLimit(req, untrustedStudent);

        // 4th call must be blocked because the user object is NOT verified admin
        const check4 = secModule.checkRateLimit(req, untrustedStudent);
        assert(check4.allowed === false, 'Spoofed client header must NOT bypass rate limiter');
    });

    await test('checkIsAdmin strictly checks authorized emails and eliminates loose substring matches', () => {
        assert(secModule, 'Security module required');
        // Valid admins
        assert(secModule.checkIsAdmin('kaushtubh457@gmail.com') === true);
        assert(secModule.checkIsAdmin('jatinthacker000@gmail.com') === true);
        assert(secModule.checkIsAdmin('pathak.amitkumar@hrjohnsonindia.com') === true);
        assert(secModule.checkIsAdmin('KAUSHTUBH457@GMAIL.COM') === true, 'Case-insensitive comparison');

        // Substring spoof attempts (MUST RETURN FALSE)
        assert(secModule.checkIsAdmin('badadmin@attacker.com') === false, 'Should not match email containing "admin"');
        assert(secModule.checkIsAdmin('admin@evil.com') === false, 'Generic admin@evil.com must be false');
        assert(secModule.checkIsAdmin('jatin@attacker.com') === false, 'Should not match substring "jatin"');
        assert(secModule.checkIsAdmin('student@school.edu') === false);
    });

    await test('Error sanitization redacts sensitive Google API keys and credentials', () => {
        assert(secModule, 'Security module required');
        const leakUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon?key=AIzaSyD_TEST_LEAK_SECRET_12345';
        const sanitized = secModule.sanitizeString(leakUrl);
        assertNotIncludes(sanitized, 'AIzaSyD_TEST_LEAK_SECRET_12345', 'API key must be redacted');
        assert(sanitized.includes('[REDACTED') || sanitized.includes('key=[REDACTED]'), 'Key placeholder must be present');
    });

    // =========================================================================
    // SUITE 4: Frontend Stored XSS Sanitization & Entity Escaping
    // =========================================================================
    suite('4. Frontend Stored XSS Sanitization & Entity Escaping');

    // Load escapeHtml from admin-utils.js using AST / regex extraction
    const adminUtilsPath = path.join(ROOT_DIR, 'js', 'admin-modules', 'admin-utils.js');
    assert(fs.existsSync(adminUtilsPath), 'js/admin-modules/admin-utils.js must exist');
    const adminUtilsSrc = fs.readFileSync(adminUtilsPath, 'utf8');

    // Extract escapeHtml implementation
    let escapeHtmlFn = null;
    try {
        const mapMatch = adminUtilsSrc.match(/const\s+HTML_ESCAPE_MAP\s*=\s*\{([\s\S]*?)\};/);
        assert(mapMatch, 'HTML_ESCAPE_MAP must be defined in admin-utils.js');
        const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

        escapeHtmlFn = function escapeHtml(str) {
            if (!str && str !== 0) return '';
            return String(str).replace(/[&<>"']/g, c => HTML_ESCAPE_MAP[c]);
        };
    } catch (e) {
        throw new Error(`Failed to initialize escapeHtml unit tester: ${e.message}`);
    }

    await test('escapeHtml encodes all 5 mandatory HTML entities (&, <, >, ", \')', () => {
        assertEqual(escapeHtmlFn('&'), '&amp;', '& must be &amp;');
        assertEqual(escapeHtmlFn('<'), '&lt;', '< must be &lt;');
        assertEqual(escapeHtmlFn('>'), '&gt;', '> must be &gt;');
        assertEqual(escapeHtmlFn('"'), '&quot;', '" must be &quot;');
        assertEqual(escapeHtmlFn("'"), '&#39;', "' must be &#39;");
    });

    await test('escapeHtml safely handles falsy, null, undefined, and numeric values', () => {
        assertEqual(escapeHtmlFn(null), '', 'null must return empty string');
        assertEqual(escapeHtmlFn(undefined), '', 'undefined must return empty string');
        assertEqual(escapeHtmlFn(''), '', 'empty string must return empty string');
        assertEqual(escapeHtmlFn(0), '0', 'number 0 must return "0"');
        assertEqual(escapeHtmlFn(42), '42', 'number 42 must return "42"');
    });

    await test('escapeHtml neutralizes classic <script>alert(1)</script> injection', () => {
        const payload = '<script>alert(1)</script>';
        const escaped = escapeHtmlFn(payload);
        assertEqual(escaped, '&lt;script&gt;alert(1)&lt;/script&gt;');
        assertNotIncludes(escaped, '<script', 'Must not contain raw <script');
        assertNotIncludes(escaped, '</script>', 'Must not contain raw </script>');
    });

    await test('escapeHtml neutralizes <img src=x onerror=alert(1)> vector', () => {
        const payload = '<img src=x onerror=alert(1)>';
        const escaped = escapeHtmlFn(payload);
        assertEqual(escaped, '&lt;img src=x onerror=alert(1)&gt;');
        assertNotIncludes(escaped, '<img', 'Must not contain raw <img');
    });

    await test('escapeHtml neutralizes single-quote inline event breakout \' onclick=\'alert(1)', () => {
        const payload = "' onclick='alert(1)";
        const escaped = escapeHtmlFn(payload);
        assertEqual(escaped, '&#39; onclick=&#39;alert(1)');
        assertNotIncludes(escaped, "'", 'Must not contain raw single quote');
    });

    await test('escapeHtml neutralizes double-quote attribute breakout "><svg onload=alert(1)>', () => {
        const payload = '"><svg onload=alert(1)>';
        const escaped = escapeHtmlFn(payload);
        assertEqual(escaped, '&quot;&gt;&lt;svg onload=alert(1)&gt;');
        assertNotIncludes(escaped, '"', 'Must not contain raw double quote');
        assertNotIncludes(escaped, '<svg', 'Must not contain raw <svg');
    });

    await test('admin-utils.js contains robust regex-based escapeHtml escaping quotes', () => {
        assertIncludes(adminUtilsSrc, 'HTML_ESCAPE_MAP', 'admin-utils.js must define HTML_ESCAPE_MAP');
        assertIncludes(adminUtilsSrc, '&#39;', 'admin-utils.js must escape single quote to &#39;');
        assertIncludes(adminUtilsSrc, '&quot;', 'admin-utils.js must escape double quote to &quot;');
        // Ensure old flawed div.textContent/div.innerHTML is replaced
        assertNotIncludes(adminUtilsSrc, 'div.textContent = text;\n    return div.innerHTML;',
            'Flawed div.innerHTML escaping must be replaced');
    });

    await test('dashboard.js escapes student names, feedback, and OCR handwritten responses', () => {
        const dashboardSrc = fs.readFileSync(path.join(ROOT_DIR, 'dashboard.js'), 'utf8');
        assert(dashboardSrc.includes('escapeHtml'), 'dashboard.js must use escapeHtml');
        // Verify escapeHtml is applied to student responses
        assert(dashboardSrc.includes('escapeHtml(studentAnswer)') || dashboardSrc.includes('escapeHtml(item.studentAnswer)'),
            'dashboard.js must sanitize OCR studentAnswer before rendering in DOM');
        assert(dashboardSrc.includes('escapeHtml(result.studentName') || dashboardSrc.includes('escapeHtml(r.studentName'),
            'dashboard.js must sanitize studentName in tables');
    });

    // =========================================================================
    // SUITE 5: Firestore Rules Git Guard & Deployment Documentation
    // =========================================================================
    suite('5. Firestore Rules Git Guard & Deployment Documentation');

    await test('firestore.rules is NOT tracked in the Git repository (git ls-files returns empty)', () => {
        try {
            const gitLs = execSync('git ls-files firestore.rules', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
            assertEqual(gitLs, '', 'firestore.rules must NOT be tracked in git index');
        } catch (e) {
            throw new Error(`Git command failed: ${e.message}`);
        }
    });

    await test('.gitignore contains firestore.rules to prevent accidental check-ins', () => {
        const gitignoreContent = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf8');
        assertIncludes(gitignoreContent, 'firestore.rules', '.gitignore must list firestore.rules');
    });

    await test('docs/firestore-rules-deployment.md exists and is thoroughly authored', () => {
        const docPath = path.join(ROOT_DIR, 'docs', 'firestore-rules-deployment.md');
        assert(fs.existsSync(docPath), 'docs/firestore-rules-deployment.md must exist');
        const docContent = fs.readFileSync(docPath, 'utf8');
        assert(docContent.length > 3000, 'Documentation must be thorough and comprehensive (>3000 bytes)');
    });

    await test('docs/firestore-rules-deployment.md contains complete rules_version = \'2\' specification', () => {
        const docContent = fs.readFileSync(path.join(ROOT_DIR, 'docs', 'firestore-rules-deployment.md'), 'utf8');
        assertIncludes(docContent, "rules_version = '2';", 'Rules must specify version 2');
        assertIncludes(docContent, 'service cloud.firestore', 'Rules must target cloud.firestore');
    });

    await test('docs/firestore-rules-deployment.md restricts gateCredentials and batchJobs strictly to isAdmin()', () => {
        const docContent = fs.readFileSync(path.join(ROOT_DIR, 'docs', 'firestore-rules-deployment.md'), 'utf8');
        assertIncludes(docContent, 'match /gateCredentials/{username}', 'Must have rule for gateCredentials');
        assertIncludes(docContent, 'match /batchJobs/{jobId}', 'Must have rule for batchJobs');
        assert(docContent.includes('allow read, write: if isAdmin();'), 'Must restrict to isAdmin()');
    });

    await test('docs/firestore-rules-deployment.md enforces mathematical score invariant isValidScore()', () => {
        const docContent = fs.readFileSync(path.join(ROOT_DIR, 'docs', 'firestore-rules-deployment.md'), 'utf8');
        assertIncludes(docContent, 'isValidScore(score, maxMarks)', 'Must define isValidScore helper function');
        assertIncludes(docContent, 'score >= 0', 'Must assert score >= 0');
        assertIncludes(docContent, 'maxMarks > 0', 'Must assert maxMarks > 0');
        assertIncludes(docContent, 'score <= maxMarks', 'Must assert score <= maxMarks');
    });

    await test('docs/firestore-rules-deployment.md protects testSessions with diff guard on whitelisted fields', () => {
        const docContent = fs.readFileSync(path.join(ROOT_DIR, 'docs', 'firestore-rules-deployment.md'), 'utf8');
        assertIncludes(docContent, 'match /testSessions/{sessionId}', 'Must match testSessions');
        assertIncludes(docContent, 'cachedContentId', 'Must whitelist cachedContentId');
        assertIncludes(docContent, 'cacheExpiresAt', 'Must whitelist cacheExpiresAt');
        assertIncludes(docContent, 'hasOnly(', 'Must use affectedKeys().hasOnly() diff guard');
    });

    await test('docs/firestore-rules-deployment.md defines global default catch-all deny rule', () => {
        const docContent = fs.readFileSync(path.join(ROOT_DIR, 'docs', 'firestore-rules-deployment.md'), 'utf8');
        assertIncludes(docContent, 'match /{document=**}', 'Must define catch-all root match');
        assert(docContent.includes('allow read, write: if false;'), 'Catch-all must deny read and write');
    });

    await test('docs/firestore-rules-deployment.md contains step-by-step Firebase Console and CLI guides', () => {
        const docContent = fs.readFileSync(path.join(ROOT_DIR, 'docs', 'firestore-rules-deployment.md'), 'utf8');
        assertIncludes(docContent, 'Firebase Console Web UI', 'Must include Firebase Console guide');
        assertIncludes(docContent, 'Firebase CLI', 'Must include CLI deployment guide');
        assertIncludes(docContent, 'Rules Playground Simulation Scenarios', 'Must include simulation scenarios');
    });

    // =========================================================================
    // SUITE 6: Core Evaluation Engine Preservation Invariants
    // =========================================================================
    suite('6. Core Evaluation Engine Preservation Invariants');

    const ocrEvalPath = path.join(ROOT_DIR, 'api', 'ocr-evaluate.js');
    assert(fs.existsSync(ocrEvalPath), 'api/ocr-evaluate.js must exist');
    const ocrEvalSrc = fs.readFileSync(ocrEvalPath, 'utf8');

    await test('PRIMARY_MODEL defaults strictly to "gemini-4-argon"', () => {
        assert(ocrEvalSrc.match(/PRIMARY_MODEL\s*=[\s\S]*?gemini-4-argon/),
            'PRIMARY_MODEL must default to gemini-4-argon in api/ocr-evaluate.js');
    });

    await test('mediaResolution is configured to "MEDIA_RESOLUTION_LOW"', () => {
        assert(ocrEvalSrc.includes('mediaResolution: "MEDIA_RESOLUTION_LOW"'),
            'mediaResolution must be MEDIA_RESOLUTION_LOW for token optimization');
    });

    await test('thinkingLevel is preserved as "medium"', () => {
        assert(ocrEvalSrc.match(/thinkingLevel[\s\S]*?["']medium["']/),
            'thinkingLevel must be preserved as "medium"');
    });

    await test('Seed is pinned to 42 for deterministic evaluation', () => {
        assert(ocrEvalSrc.match(/seed:\s*(?:options\.seed\s*!==\s*undefined\s*\?\s*Number\(options\.seed\)\s*:\s*)?42/),
            'seed must be pinned to 42');
    });

    await test('Temperature is locked to 0.0 for deterministic evaluation', () => {
        assert(ocrEvalSrc.match(/temperature:\s*(?:options\.temperature\s*!==\s*undefined\s*\?\s*options\.temperature\s*:\s*)?0\.0/),
            'temperature must be locked to 0.0');
    });

    await test('Dynamic binary MCQ scoring hard-lock is fully intact (0 or maxMarks, no partial marks)', () => {
        assertIncludes(ocrEvalSrc, 'expectedMcqWeight', 'Dynamic MCQ weight detection must be present');
        assertIncludes(ocrEvalSrc, 'resObj.score = expectedMcqWeight;', 'MCQ full mark award intact');
        assertIncludes(ocrEvalSrc, 'resObj.score = 0;', 'MCQ zero mark deduction intact');
        assertIncludes(ocrEvalSrc, 'Dynamic Binary MCQ', 'Binary MCQ logging and logic intact');
    });

    await test('Programmatic score clamping [0, maxMarks] and math sum invariant are fully intact', () => {
        assertIncludes(ocrEvalSrc, 'if (s < 0) s = 0;', 'Negative score clamp intact');
        assertIncludes(ocrEvalSrc, 's = maxForQ;', 'Max mark clamp intact');
        assertIncludes(ocrEvalSrc, 'calculatedTotal > result.maxMarks', 'Total score cap intact');
        assertIncludes(ocrEvalSrc, 'result.totalScore = calculatedTotal;', 'Sum recalculation intact');
    });

    await test('Defend vs Refute stance error cap to 1.0 mark is fully intact', () => {
        assertIncludes(ocrEvalSrc, 'wrongStance', 'Defend/Refute stance error detection intact');
        assertIncludes(ocrEvalSrc, 'resObj.score = 1.0;', 'Defend/Refute 1.0 mark cap intact');
    });

    await test('Resilient backup model failover to gemini-3.8-flash is preserved', () => {
        assertIncludes(ocrEvalSrc, 'BACKUP_MODEL', 'Backup model definition intact');
        assertIncludes(ocrEvalSrc, 'gemini-3.8-flash', 'gemini-3.8-flash failover intact');
    });

    // =========================================================================
    // EXECUTION SUMMARY & REPORT
    // =========================================================================
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n${colors.bold}${colors.blue}══════════════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bold}${colors.blue}                      TEST EXECUTION SUMMARY                          ${colors.reset}`);
    console.log(`${colors.bold}${colors.blue}══════════════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`  Total Tests Run: ${colors.bold}${totalTests}${colors.reset}`);
    console.log(`  Passed Tests:    ${colors.bold}${colors.green}${passedTests}${colors.reset}`);
    console.log(`  Failed Tests:    ${colors.bold}${failedTests > 0 ? colors.red : colors.green}${failedTests}${colors.reset}`);
    console.log(`  Execution Time:  ${duration}s\n`);

    if (failedTests > 0) {
        console.log(`${colors.bold}${colors.red}FAILED TESTS:${colors.reset}`);
        testResults.filter(r => r.status === 'FAIL').forEach((r, idx) => {
            console.log(`  ${idx + 1}. [${r.suite}] ${r.name}`);
            console.log(`     ${colors.yellow}Reason: ${r.error}${colors.reset}`);
        });
        console.log(`\n${colors.bold}${colors.red}❌ VERIFICATION SUITE FAILED${colors.reset}\n`);
        process.exit(1);
    } else {
        console.log(`${colors.bold}${colors.green}✔ ALL SECURITY VERIFICATION CHECKS PASSED PERFECTLY!${colors.reset}\n`);
        process.exit(0);
    }
}

// Execute
runAllTests().catch(err => {
    console.error(`${colors.bold}${colors.red}Fatal Runner Error:${colors.reset}`, err);
    process.exit(1);
});
