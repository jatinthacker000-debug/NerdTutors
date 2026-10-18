/**
 * /api/create-cache.js
 * 
 * Creates a server-side Gemini Context Cache (cachedContents) for a Test Session.
 * Once created, evaluations for this test session can reference `cachedContentId`,
 * allowing Gemini 3.8 Flash to reuse the cached question paper, marking scheme,
 * and CBSE rubrics across hundreds of student evaluations with up to 75% cost savings!
 */

const axios = require('axios');

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
    const validTokens = [
        "bmVyZF90dXRvcl9hbHBoYTpudF9wYXNzX2FscGhhMjAyNg==",
        "bmVyZF90dXRvcl9iZXRhOm50X3Bhc3NfYmV0YTIwMjY=",
        "bmVyZF90dXRvcl9nYW1tYTpudF9wYXNzX2dhbW1hMjAyNg==",
        "bmVyZF90dXRvcl9kZWx0YTpudF9wYXNzX2RlbHRhMjAyNg==",
        "bmVyZF90dXRvcl9lcHNpbG9uOm50X3Bhc3NfZXBzaWxvbjIwMjY="
    ];

    if (!clientToken || !validTokens.includes(clientToken)) {
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
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

    // Build the master cached context text
    const bundledContent = `=== OFFICIAL CBSE EXAM CONTEXT & MARKING SCHEME ===
Exam Name: ${examName || 'Standard Assessment'}
Subject: ${subject || 'General'}
Session ID: ${sessionId || 'unspecified'}

--- QUESTIONS & EXAM PAPER ---
${questions}

--- OFFICIAL MARKING SCHEME & MODEL ANSWERS ---
${markingScheme}

--- CBSE STRICT MODERATOR EVALUATION PROTOCOL ---
1. STRICT OBJECTIVE MARKING: Award zero marks for off-topic, unrelated, or hallucinated answers.
2. STEP MARKING: Award partial marks only when specific keywords or formula steps match the official marking scheme.
3. TERMINOLOGY: Deduct marks if mandatory technical terminology is absent or incorrect.
4. MODEL ANSWERS: Provide student-friendly, simplified 2-3 sentence explanations for every evaluated question.
===================================================`;

    try {
        const isVertex = primaryKey.startsWith("AQ.") || Boolean(process.env.VERTEX_API_KEY);
        const projectId = process.env.GCP_PROJECT_ID || "975383880672";
        const location = process.env.GCP_LOCATION || "us-central1";

        let endpoint = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${primaryKey}`;
        let headers = { "Content-Type": "application/json" };

        if (isVertex) {
            endpoint = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/cachedContents`;
            headers["Authorization"] = `Bearer ${primaryKey}`;
        }

        const ttlSeconds = Math.max(3600, Math.min(ttlHours * 3600, 259200)); // 1 hour to 3 days

        const payload = {
            model: `models/${model}`,
            displayName: `cache_${sessionId || Date.now()}`,
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

        const response = await axios.post(endpoint, payload, { headers });
        const data = response.data;

        return res.status(200).json({
            success: true,
            cachedContentId: data.name,
            model: model,
            expireTime: data.expireTime,
            message: "Context cache successfully created on Gemini 3.8 Flash."
        });

    } catch (err) {
        console.error("❌ Context Cache Creation Error:", err?.response?.data || err.message);
        return res.status(err?.response?.status || 500).json({
            error: "Failed to create context cache",
            details: err?.response?.data || err.message
        });
    }
};
