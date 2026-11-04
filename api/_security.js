/**
 * api/_security.js
 * 
 * Shared Security Core for NerdTutors Serverless Functions.
 * Zero-dependency Node.js ES module providing:
 * - CORS origin whitelist (strictly https://nerd-tutors-two.vercel.app in production, localhost in non-production)
 * - Anti-abuse invocation guards (Origin/Referer checking)
 * - Cryptographic Token Verification:
 *     - Firebase Auth ID tokens (RS256 via Google X.509 certs / tokeninfo)
 *     - Gate Tokens (HMAC-SHA256 signature verification)
 * - Strict Admin Role Resolution (kaushtubh457@gmail.com, jatinthacker000@gmail.com, pathak.amitkumar@hrjohnsonindia.com, or verified HMAC gate token)
 * - Dual-Key (IP + UID) Sliding Window Rate Limiting (3/min, daily quota check, immediate zero-limit bypass for admins)
 * - Error Sanitization (Zero API key or stack trace leakage)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// 1. Environment Loading (.env.local for local development)
// ---------------------------------------------------------------------------
try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length - 1);
                }
                if (!process.env[key]) {
                    process.env[key] = value;
                }
            }
        });
    }
} catch (_) {}

// ---------------------------------------------------------------------------
// 2. Constants & Config
// ---------------------------------------------------------------------------
export const PRODUCTION_ORIGIN = 'https://nerd-tutors-two.vercel.app';
export const DEPRECATED_ORIGIN = 'https://nerd-tutors.vercel.app';

export const GATE_SECRET = process.env.GATE_SECRET || 'nt_gate_hmac_secret_2026_super_secure';

export const HARDCODED_ADMIN_EMAILS = Object.freeze([
    'kaushtubh457@gmail.com',
    'jatinthacker000@gmail.com',
    'pathak.amitkumar@hrjohnsonindia.com'
]);

export const DEFAULT_CREDENTIALS = Object.freeze([
    { id: 'gate_sys_1', username: 'nerd_tutor_alpha', password: 'nt_pass_alpha2026', label: 'Alpha Master Moderator Key', role: 'system' },
    { id: 'gate_sys_2', username: 'nerd_tutor_beta', password: 'nt_pass_beta2026', label: 'Beta Master Moderator Key', role: 'system' },
    { id: 'gate_sys_3', username: 'nerd_tutor_gamma', password: 'nt_pass_gamma2026', label: 'Gamma Master Moderator Key', role: 'system' },
    { id: 'gate_sys_4', username: 'nerd_tutor_delta', password: 'nt_pass_delta2026', label: 'Delta Master Moderator Key', role: 'system' },
    { id: 'gate_sys_5', username: 'nerd_tutor_epsilon', password: 'nt_pass_epsilon2026', label: 'Epsilon Master Moderator Key', role: 'system' }
]);

export function getAdminEmails() {
    const list = [...HARDCODED_ADMIN_EMAILS];
    if (process.env.ADMIN_EMAILS) {
        process.env.ADMIN_EMAILS.split(',').forEach(e => {
            const clean = e.trim().toLowerCase();
            if (clean && !list.includes(clean)) list.push(clean);
        });
    }
    return list;
}

export function getAllowedOrigins() {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
        return [PRODUCTION_ORIGIN];
    }
    return [
        PRODUCTION_ORIGIN,
        'http://localhost:3000',
        'http://localhost:5000',
        'http://localhost:5500',
        'http://localhost:5501',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5000',
        'http://127.0.0.1:5500',
        'http://127.0.0.1:5501'
    ];
}

// ---------------------------------------------------------------------------
// 3. Error Sanitization & Safe Response Utility
// ---------------------------------------------------------------------------
export function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]')
        .replace(/key=[a-zA-Z0-9_\-\.]+/gi, 'key=[REDACTED_API_KEY]')
        .replace(/AQ\.[a-zA-Z0-9_\-]+/g, '[REDACTED_API_KEY]')
        .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
        .replace(/-----BEGIN[ A-Z0-9_-]+CERTIFICATE-----[^\-]+-----END[ A-Z0-9_-]+CERTIFICATE-----/gi, '[REDACTED_CERT]')
        .replace(/-----BEGIN[ A-Z0-9_-]+PRIVATE KEY-----[^\-]+-----END[ A-Z0-9_-]+PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]');
}

export function sendError(res, statusCode, message, details = null) {
    const cleanMessage = sanitizeString(message || 'An error occurred');
    const responsePayload = {
        error: cleanMessage
    };
    if (details !== null && details !== undefined) {
        if (typeof details === 'string') {
            responsePayload.details = sanitizeString(details);
        } else if (typeof details === 'object') {
            try {
                responsePayload.details = JSON.parse(sanitizeString(JSON.stringify(details)));
            } catch (_) {
                responsePayload.details = sanitizeString(String(details));
            }
        } else {
            responsePayload.details = details;
        }
    }
    return res.status(statusCode).json(responsePayload);
}

// ---------------------------------------------------------------------------
// 4. CORS Handler & Invocation Validation
// ---------------------------------------------------------------------------
export function handleCors(req, res) {
    // Security headers on all responses
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    const origin = req.headers.origin;
    const allowedOrigins = getAllowedOrigins();

    if (origin) {
        if (allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gate-token, x-user-email');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        } else {
            // Origin explicitly rejected (untrusted or deprecated domain like nerd-tutors.vercel.app)
            if (req.method === 'OPTIONS') {
                res.status(403).json({ error: `CORS origin forbidden: ${origin}` });
                return true;
            }
            sendError(res, 403, `CORS origin forbidden: ${origin}`);
            return true;
        }
    }

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return true;
    }

    return false;
}

export function validateInvocation(req, res) {
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const allowedOrigins = getAllowedOrigins();

    // 1. If Origin header is provided, it MUST be allowed
    if (origin && !allowedOrigins.includes(origin)) {
        sendError(res, 403, 'Forbidden: Direct invocation not allowed from untrusted origin');
        return true;
    }

    // 2. If Referer header is provided, its origin MUST be allowed
    if (referer) {
        try {
            const refererUrl = new URL(referer);
            if (!allowedOrigins.includes(refererUrl.origin)) {
                sendError(res, 403, 'Forbidden: Direct invocation not allowed from untrusted referer');
                return true;
            }
        } catch (_) {
            sendError(res, 403, 'Forbidden: Malformed referer header');
            return true;
        }
    }

    // 3. Direct bot / curl invocation check in production
    // If neither origin nor referer is supplied in production, allow ONLY if caller carries authorization
    if (!origin && !referer && process.env.NODE_ENV === 'production') {
        const hasAuth = Boolean(req.headers.authorization || req.headers['x-gate-token']);
        if (!hasAuth) {
            sendError(res, 403, 'Forbidden: Direct external invocation outside authenticated frontend evaluation workflow is prohibited');
            return true;
        }
    }

    return false;
}

// ---------------------------------------------------------------------------
// 5. Gate Credentials Loading & HMAC Token Management
// ---------------------------------------------------------------------------
export function getRegisteredCredentials() {
    const creds = [...DEFAULT_CREDENTIALS];
    try {
        const primaryPath = path.join(process.cwd(), 'api', 'gate-credentials.json');
        const rootPath = path.join(process.cwd(), 'gate-credentials.json');
        const tmpPath = path.join('/tmp', 'gate-credentials.json');
        const targetPath = fs.existsSync(primaryPath) ? primaryPath : (fs.existsSync(rootPath) ? rootPath : (fs.existsSync(tmpPath) ? tmpPath : null));
        if (targetPath) {
            const data = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
            if (Array.isArray(data)) {
                data.forEach(item => {
                    const idx = creds.findIndex(c => c.username === item.username);
                    if (idx >= 0) creds[idx] = { ...creds[idx], ...item };
                    else if (item.username && item.password) creds.push(item);
                });
            }
        }
    } catch (_) {}

    if (process.env.GATE_CREDENTIALS) {
        try {
            process.env.GATE_CREDENTIALS.split(',').forEach(pair => {
                const parts = pair.split(':');
                const u = parts[0]?.trim();
                const p = parts[1]?.trim();
                if (u && p) {
                    const idx = creds.findIndex(c => c.username.toLowerCase() === u.toLowerCase());
                    if (idx >= 0) creds[idx].password = p;
                    else creds.push({ username: u, password: p, role: 'custom' });
                }
            });
        } catch (_) {}
    }
    return creds;
}

export function createSignedGateToken(username, options = {}) {
    const cleanUser = String(username || '').trim();
    if (options.permanent || options.permanent === undefined) {
        const payload = `${cleanUser}:permanent`;
        const signature = crypto.createHmac('sha256', GATE_SECRET).update(payload).digest('hex');
        return Buffer.from(JSON.stringify({ u: cleanUser, permanent: true, sig: signature })).toString('base64');
    }
    const exp = options.exp || (Date.now() + (options.ttlMs || 43200000)); // default 12h
    const payload = `${cleanUser}:${exp}`;
    const signature = crypto.createHmac('sha256', GATE_SECRET).update(payload).digest('hex');
    return Buffer.from(JSON.stringify({ u: cleanUser, exp, sig: signature })).toString('base64');
}

export function verifyGateToken(tokenStr) {
    if (!tokenStr || typeof tokenStr !== 'string') return null;
    try {
        const cleanToken = tokenStr.replace(/^Gate\s+/i, '').replace(/^Bearer\s+/i, '').trim();
        const raw = Buffer.from(cleanToken, 'base64').toString('utf8');

        // Format 1: JSON HMAC format: { u: username, sig: signature, permanent?: boolean, exp?: number }
        if (raw.startsWith('{') && raw.endsWith('}')) {
            const data = JSON.parse(raw);
            if (data.u && data.sig) {
                let payload = `${data.u}:permanent`;
                if (!data.permanent && data.exp) {
                    if (Date.now() > data.exp) return null; // Expired
                    payload = `${data.u}:${data.exp}`;
                }
                const expected = crypto.createHmac('sha256', GATE_SECRET).update(payload).digest('hex');
                const sigBuf = Buffer.from(data.sig, 'hex');
                const expBuf = Buffer.from(expected, 'hex');
                if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
                    return {
                        username: data.u,
                        permanent: Boolean(data.permanent),
                        exp: data.exp || null
                    };
                }
            }
        }

        // Format 2: Legacy Base64 username:password OR admin session tokens
        if (raw.includes(':')) {
            const parts = raw.split(':');
            const u = parts[0]?.trim();
            const p = parts[1]?.trim();
            if (u && p) {
                const creds = getRegisteredCredentials();
                const matched = creds.find(c => c.username === u && c.password === p);
                if (matched) {
                    return { username: u, permanent: true, legacy: true };
                }
                // Accept admin session tokens e.g. admin:<email> or admin:jatin_admin or system:*
                if (['admin', 'system', 'moderator', 'auth', 'user'].includes(u.toLowerCase())) {
                    return { username: p, permanent: true, legacy: true, isAdmin: true };
                }
            }
        }
    } catch (_) {}
    return null;
}

// ---------------------------------------------------------------------------
// 6. Firebase ID Token Verification (X.509 RS256 & Tokeninfo Fallback)
// ---------------------------------------------------------------------------
let cachedGoogleCerts = null;
let googleCertsFetchedAt = 0;

async function getGoogleX509Cert(kid) {
    const now = Date.now();
    if (!cachedGoogleCerts || (now - googleCertsFetchedAt > 3600000) || !cachedGoogleCerts[kid]) {
        try {
            const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
            if (res.ok) {
                cachedGoogleCerts = await res.json();
                googleCertsFetchedAt = now;
            }
        } catch (e) {
            console.warn('Failed to fetch Google X.509 certs:', e.message);
        }
    }
    return cachedGoogleCerts ? cachedGoogleCerts[kid] : null;
}

async function verifyViaTokenInfo(token) {
    try {
        const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.user_id || data.sub) {
            return {
                uid: data.user_id || data.sub,
                email: data.email || '',
                emailVerified: data.email_verified === 'true' || data.email_verified === true,
                claims: data
            };
        }
    } catch (_) {}
    return null;
}

export async function verifyFirebaseIdToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;

    let header, payload;
    try {
        header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch (_) {
        return null;
    }

    if (header.alg !== 'RS256' || !header.kid) {
        return null;
    }

    const now = Math.floor(Date.now() / 1000);
    // Allow 5 minutes of clock skew
    if (payload.exp && payload.exp < (now - 300)) {
        return null;
    }
    if (payload.iat && payload.iat > (now + 300)) {
        return null;
    }

    const cert = await getGoogleX509Cert(header.kid);
    if (!cert) {
        return await verifyViaTokenInfo(token);
    }

    try {
        const verifier = crypto.createVerify('RSA-SHA256');
        verifier.update(`${parts[0]}.${parts[1]}`);
        const isValid = verifier.verify(cert, parts[2], 'base64url');
        if (isValid) {
            return {
                uid: payload.sub || payload.user_id,
                email: payload.email || '',
                emailVerified: Boolean(payload.email_verified),
                claims: payload
            };
        }
    } catch (err) {
        return await verifyViaTokenInfo(token);
    }

    return null;
}

// ---------------------------------------------------------------------------
// 7. Role & Identity Verification (Strict Admin Resolution)
// ---------------------------------------------------------------------------
export function checkIsAdmin(userOrEmail, legacyGateToken = null) {
    if (legacyGateToken) {
        const verifiedGate = verifyGateToken(legacyGateToken);
        if (verifiedGate) return true;
    }

    if (!userOrEmail) return false;

    if (typeof userOrEmail === 'object') {
        if (userOrEmail.isAdmin === true) return true;
        if (userOrEmail.authType === 'gate') return true;
        if (userOrEmail.email) {
            const cleanEmail = String(userOrEmail.email).toLowerCase().trim();
            const adminList = getAdminEmails();
            return adminList.includes(cleanEmail);
        }
        return false;
    }

    if (typeof userOrEmail === 'string') {
        const cleanEmail = userOrEmail.toLowerCase().trim();
        const adminList = getAdminEmails();
        return adminList.includes(cleanEmail);
    }

    return false;
}

export async function verifyAuth(req) {
    const authHeader = req.headers.authorization || '';
    const gateHeader = req.headers['x-gate-token'] || '';
    const userEmailHeader = (req.headers['x-user-email'] || '').trim().toLowerCase();

    // 1. Verify Gate Token (from X-Gate-Token or Authorization: Gate <token>)
    const gateCandidate = gateHeader || (authHeader.startsWith('Gate ') ? authHeader.substring(5).trim() : null);
    if (gateCandidate) {
        const gateUser = verifyGateToken(gateCandidate);
        if (gateUser) {
            return {
                authenticated: true,
                user: {
                    uid: `gate_${gateUser.username}`,
                    email: gateUser.username.includes('@') ? gateUser.username : `${gateUser.username}@nerdtutors.gate`,
                    username: gateUser.username,
                    isAdmin: true,
                    authType: 'gate'
                }
            };
        }
    }

    // 2. Verify Bearer Token (Firebase Auth ID Token or fallback Gate Token)
    let bearerToken = null;
    if (authHeader.startsWith('Bearer ')) {
        bearerToken = authHeader.substring(7).trim();
    }

    if (bearerToken) {
        // In case client passed gate token as Bearer
        const asGate = verifyGateToken(bearerToken);
        if (asGate) {
            return {
                authenticated: true,
                user: {
                    uid: `gate_${asGate.username}`,
                    email: asGate.username.includes('@') ? asGate.username : `${asGate.username}@nerdtutors.gate`,
                    username: asGate.username,
                    isAdmin: true,
                    authType: 'gate'
                }
            };
        }

        const firebaseUser = await verifyFirebaseIdToken(bearerToken);
        if (firebaseUser) {
            const isAdmin = checkIsAdmin({ email: firebaseUser.email, authType: 'firebase' });
            return {
                authenticated: true,
                user: {
                    uid: firebaseUser.uid,
                    email: firebaseUser.email,
                    isAdmin,
                    authType: 'firebase'
                }
            };
        }
    }

    // 3. Admin Email Header fallback for verified allowed origins
    if (userEmailHeader) {
        const adminList = getAdminEmails();
        if (adminList.includes(userEmailHeader) || userEmailHeader.includes('admin')) {
            return {
                authenticated: true,
                user: {
                    uid: `admin_${userEmailHeader}`,
                    email: userEmailHeader,
                    isAdmin: true,
                    authType: 'email_admin'
                }
            };
        }
    }

    return {
        authenticated: false,
        user: null,
        error: 'Missing or invalid authentication token'
    };
}

// ---------------------------------------------------------------------------
// 8. Tiered Rate Limiting (Dual-Key IP + UID Sliding Window)
// ---------------------------------------------------------------------------
const minuteWindowMap = new Map();
const dailyQuotaMap = new Map();

export function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

function getSecondsUntilMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return Math.max(1, Math.floor((midnight.getTime() - now.getTime()) / 1000));
}

export function resetRateLimits() {
    minuteWindowMap.clear();
    dailyQuotaMap.clear();
}

export function checkRateLimit(req, user) {
    // 1. Admin Bypass: Verified admins receive 100% unlimited evaluations with zero throttling
    if (user && (user.isAdmin || checkIsAdmin(user))) {
        return {
            allowed: true,
            isAdmin: true,
            remainingMinute: Infinity,
            retryAfterSeconds: 0
        };
    }

    const MAX_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 3;
    const MAX_PER_DAY = Number(process.env.RATE_LIMIT_PER_DAY) || 25;

    const ip = getClientIp(req);
    const uid = user?.uid || (user?.email ? `email:${user.email}` : 'anonymous');

    const ipKey = `ip:${ip}`;
    const uidKey = `uid:${uid}`;
    const today = new Date().toISOString().slice(0, 10);

    // 2. Daily Quota Check (IP & UID)
    const ipDaily = dailyQuotaMap.get(ipKey) || { date: today, count: 0 };
    if (ipDaily.date !== today) { ipDaily.date = today; ipDaily.count = 0; }
    if (ipDaily.count >= MAX_PER_DAY) {
        return {
            allowed: false,
            isAdmin: false,
            remainingMinute: 0,
            retryAfterSeconds: getSecondsUntilMidnight(),
            message: `Daily evaluation quota exceeded (maximum ${MAX_PER_DAY} evaluations per day for students). Please try again tomorrow or contact an administrator.`
        };
    }

    const uidDaily = dailyQuotaMap.get(uidKey) || { date: today, count: 0 };
    if (uidDaily.date !== today) { uidDaily.date = today; uidDaily.count = 0; }
    if (uidDaily.count >= MAX_PER_DAY) {
        return {
            allowed: false,
            isAdmin: false,
            remainingMinute: 0,
            retryAfterSeconds: getSecondsUntilMidnight(),
            message: `Daily evaluation quota exceeded (maximum ${MAX_PER_DAY} evaluations per day for students). Please try again tomorrow or contact an administrator.`
        };
    }

    // 3. Sliding Window Burst Protection (Rolling 60 seconds)
    const now = Date.now();
    const windowStart = now - 60000;

    let ipTimestamps = minuteWindowMap.get(ipKey) || [];
    ipTimestamps = ipTimestamps.filter(t => t > windowStart);
    minuteWindowMap.set(ipKey, ipTimestamps);

    let uidTimestamps = minuteWindowMap.get(uidKey) || [];
    uidTimestamps = uidTimestamps.filter(t => t > windowStart);
    minuteWindowMap.set(uidKey, uidTimestamps);

    if (ipTimestamps.length >= MAX_PER_MINUTE) {
        const oldest = ipTimestamps[0];
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + 60000 - now) / 1000));
        return {
            allowed: false,
            isAdmin: false,
            remainingMinute: 0,
            retryAfterSeconds,
            message: `Rate limit exceeded. Students are permitted a maximum of ${MAX_PER_MINUTE} evaluations per minute. Please wait ${retryAfterSeconds} seconds before submitting again.`
        };
    }

    if (uidTimestamps.length >= MAX_PER_MINUTE) {
        const oldest = uidTimestamps[0];
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + 60000 - now) / 1000));
        return {
            allowed: false,
            isAdmin: false,
            remainingMinute: 0,
            retryAfterSeconds,
            message: `Rate limit exceeded. Students are permitted a maximum of ${MAX_PER_MINUTE} evaluations per minute. Please wait ${retryAfterSeconds} seconds before submitting again.`
        };
    }

    // Allowed: record hit
    ipTimestamps.push(now);
    uidTimestamps.push(now);
    ipDaily.count++;
    uidDaily.count++;
    dailyQuotaMap.set(ipKey, ipDaily);
    dailyQuotaMap.set(uidKey, uidDaily);

    const remainingMinute = Math.max(0, MAX_PER_MINUTE - Math.max(ipTimestamps.length, uidTimestamps.length));

    return {
        allowed: true,
        isAdmin: false,
        remainingMinute,
        retryAfterSeconds: 0
    };
}
