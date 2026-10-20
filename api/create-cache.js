/**
 * /api/create-cache.js
 * 
 * Creates a server-side Gemini Context Cache (cachedContents) for a Test Session.
 * Once created, evaluations for this test session can reference `cachedContentId`,
 * allowing Gemini 3.8 Flash to reuse the cached question paper, marking scheme,
 * and CBSE rubrics across hundreds of student evaluations with up to 75% cost savings!
 */

const crypto = require('crypto');

module.exports = async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-gate-token");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    // Gate security check
    const clientToken = req.headers['x-gate-token'];
    const GATE_SECRET = process.env.GATE_SECRET || 'nt_gate_hmac_secret_2026_super_secure';

    const defaultGateCreds = [
        { username: 'nerd_tutor_alpha', password: 'nt_pass_alpha2026' },
        { username: 'nerd_tutor_beta', password: 'nt_pass_beta2026' },
        { username: 'nerd_tutor_gamma', password: 'nt_pass_gamma2026' },
        { username: 'nerd_tutor_delta', password: 'nt_pass_delta2026' },
        { username: 'nerd_tutor_epsilon', password: 'nt_pass_epsilon2026' }
    ];

    let gateCreds = defaultGateCreds;
    if (process.env.GATE_CREDENTIALS) {
        try {
            gateCreds = process.env.GATE_CREDENTIALS.split(',').map(pair => {
                const parts = pair.split(':');
                return {
                    username: parts[0]?.trim(),
                    password: parts[1]?.trim()
                };
            }).filter(c => c.username && c.password);
        } catch (e) {
            console.error("Failed to parse GATE_CREDENTIALS env var, using defaults:", e);
        }
    }

    function isValidGateAuth(token) {
        if (!token) return false;
        try {
            const raw = Buffer.from(token, 'base64').toString('utf8');
            const data = JSON.parse(raw);
            if (data && data.u && data.exp && data.sig) {
                if (Date.now() > Number(data.exp)) return false;
                const expectedSig = crypto.createHmac('sha256', GATE_SECRET).update(`${data.u}:${data.exp}`).digest('hex');
                if (data.sig.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(data.sig), Buffer.from(expectedSig))) {
                    return true;
                }
            }
        } catch (_) {}

        return gateCreds.some(c => {
            const expectedToken = Buffer.from(`${c.username}:${c.password}`).toString('base64');
            return expectedToken === token;
        });
    }

    if (!isValidGateAuth(clientToken)) {
        return res.status(401).json({ error: "Unauthorized access: Invalid or missing Gate token." });
    }

    const {
        sessionId,
        examName,
        subject,
        questions,
        markingScheme,
        ttlHours = 72
    } = req.body || {};

    if (!questions || !markingScheme) {
        return res.status(400).json({ error: "questions and markingScheme are required to build context cache." });
    }

    const rawKeys = process.env.VERTEX_API_KEY || process.env.GEMINI_API_KEY || process.env.GEMINI_API || process.env.GEMINI_KEY;
    if (!rawKeys) {
        return res.status(500).json({ error: "Gemini API key is not configured in environment variables." });
    }

    const apiKeys = rawKeys.split(",").map(k => k.trim()).filter(Boolean);
    const primaryKey = apiKeys[0];
    const model = req.body?.model || process.env.GEMINI_MODEL || "gemini-4-argon";

    // Load CBSE Master Rules Matrix to embed into the persistent cache
    let rulesText = "";
    try {
        const rulesPath = require('path').join(process.cwd(), 'api', 'cbse-rules.json');
        if (require('fs').existsSync(rulesPath)) {
            rulesText = require('fs').readFileSync(rulesPath, 'utf8');
        }
    } catch (_) {}

    // Build the master cached context text
    const bundledContent = `=== OFFICIAL CBSE EXAM CONTEXT & ZERO-ERROR MARKING SCHEME ===
Exam Name: ${examName || 'Standard Assessment'}
Subject: ${subject || 'General'}
Session ID: ${sessionId || 'unspecified'}

--- QUESTIONS & EXAM PAPER ---
${questions}

--- OFFICIAL MARKING SCHEME & MODEL ANSWERS ---
${markingScheme}

--- CBSE ZERO-ERROR AUTONOMOUS GRADER MASTER SPECIFICATION & COGNITIVE GUARDRAILS ---
${rulesText}
===================================================`;

    try {
        const isVertex = primaryKey.startsWith("AQ.") || Boolean(process.env.VERTEX_API_KEY);
        const projectId = process.env.GCP_PROJECT_ID || "975383880672";
        const location = process.env.GCP_LOCATION || "us-central1";

        let endpoint = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${primaryKey}`;
        let headers = { "Content-Type": "application/json" };

        if (isVertex) {
            endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/cachedContents?key=${primaryKey}`;
            // If primaryKey is an OAuth Bearer token rather than an API key
            if (!primaryKey.startsWith("AQ.") && primaryKey.length > 80) {
                headers["Authorization"] = `Bearer ${primaryKey}`;
                endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/cachedContents`;
            }
        }

        const ttlSeconds = Math.max(3600, Math.min(ttlHours * 3600, 259200)); // 1 hour to 3 days
        const modelResource = isVertex
            ? `projects/${projectId}/locations/${location}/publishers/google/models/${model}`
            : `models/${model}`;

        const payload = {
            model: modelResource,
            displayName: `cache_${(sessionId || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`,
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: bundledContent }
                    ]
                }
            ],
            ttl: `${ttlSeconds}s`
        };

        const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
        });

        const rawText = await response.text();
        let data = {};
        try { data = JSON.parse(rawText); } catch (_) {}

        if (!response.ok) {
            console.error("❌ Context Cache API rejected:", response.status, rawText);
            return res.status(response.status).json({
                error: "Google API rejected context cache creation",
                status: response.status,
                details: data?.error?.message || rawText
            });
        }

        return res.status(200).json({
            success: true,
            cachedContentId: data.name,
            model: model,
            expireTime: data.expireTime,
            message: `Context cache successfully created on ${model}.`
        });

    } catch (err) {
        console.error("❌ Context Cache Creation Error:", err.message);
        return res.status(500).json({
            error: "Failed to create context cache",
            details: err.message
        });
    }
};
