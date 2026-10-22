/**
 * /api/create-cache.js
 * 
 * Creates a server-side Gemini Context Cache (cachedContents) for a Test Session.
 * Once created, evaluations for this test session can reference `cachedContentId`,
 * allowing Gemini 4 Argon to reuse the cached question paper, marking scheme,
 * and CBSE rubrics across hundreds of student evaluations with up to 75% cost savings!
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getVertexAccessToken } from './vertex-auth.js';

// Force load .env.local if present locally to bypass Vercel CLI sync overrides
try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.substring(1, value.length - 1);
                }
                process.env[key] = value;
            }
        });
    }
} catch (e) {
    console.warn("Env force load error:", e.message);
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-gate-token");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    // Gate security check disabled (direct access enabled)
    const clientToken = req.headers['x-gate-token'] || "";

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = {}; }
    }

    const {
        sessionId,
        examName,
        subject,
        questions,
        markingScheme,
        maxMarks = 40,
        otherInstructions = "",
        ttlHours = 72
    } = body || {};

    if (!questions || !markingScheme) {
        return res.status(400).json({ error: "questions and markingScheme are required to build context cache." });
    }

    const rawKeys = process.env.VERTEX_API_KEY || process.env.GEMINI_API_KEY || process.env.GEMINI_API || process.env.GEMINI_KEY;
    if (!rawKeys) {
        return res.status(500).json({ error: "Gemini API key is not configured in environment variables." });
    }

    const apiKeys = rawKeys.split(",").map(k => k.trim()).filter(Boolean);
    const primaryKey = apiKeys[0];
    const model = body?.model || process.env.GEMINI_MODEL || "gemini-4-argon";

    // Load CBSE Master Rules Matrix to embed into the persistent cache
    let rulesText = "";
    try {
        const rulesPath = path.join(process.cwd(), 'api', 'cbse-rules.json');
        if (fs.existsSync(rulesPath)) {
            rulesText = fs.readFileSync(rulesPath, 'utf8');
        }
    } catch (_) {}

    // Build the master cached context text containing 100% of static instructions
    const bundledContent = `=== OFFICIAL CBSE EXAM CONTEXT & ZERO-ERROR MARKING SCHEME ===
Exam Name: ${examName || 'Standard Assessment'}
Subject: ${subject || 'General'}
Session ID: ${sessionId || 'unspecified'}
Total Maximum Marks: ${maxMarks || 40}

--- QUESTIONS & EXAM PAPER ---
${questions}

--- OFFICIAL MARKING SCHEME & MODEL ANSWERS ---
${markingScheme}

${otherInstructions ? `--- TEACHER OVERRIDE INSTRUCTIONS ---\n${otherInstructions}\n` : ""}

--- CBSE ZERO-ERROR AUTONOMOUS GRADER MASTER SPECIFICATION & COGNITIVE GUARDRAILS ---
${rulesText}

--- REASONING BUDGET GOVERNANCE & THINKING GUARDRAIL (CRITICAL) ---
- Perform direct, focused rubric verification without discursive speculation.
- Do NOT rewrite or transcribe the student's entire answer inside your internal thinking trace.
- For MCQs: Compare the written option letter (A, B, C, D) directly against the key in a single step. Zero paragraphs of theory in thoughts.
- For Subjective Questions: Check directly for the presence or absence of mandatory textbook value points and numerical steps. Deduct marks immediately for missing points without repetitive deliberation.
- Keep your internal thought trace crisp, concise, and decisive.

--- OFFICIAL CBSE EVALUATION STANDARDS & INSTRUCTIONS ---
1. STRICT BINARY MCQ: Compare option letters directly. 1 mark if correct; 0 if wrong. Never award 0.5.
2. DEFEND / REFUTE: Choosing incorrect stance caps question score to maximum 1.0 mark.
3. CONCISE FEEDBACK: Feedback per question MUST be strictly 15 words or fewer. Improvements max 2 items (max 15 words each).
4. MATHEMATICAL SUM INVARIANT: Total of question maxMarks must equal ${maxMarks || 40}.
5. UNATTEMPTED QUESTIONS: If question is missing from answer sheet, award score = 0 and feedback: "The question was not attempted."

--- MANDATORY OUTPUT JSON SCHEMA ---
Return STRICT JSON in the following format:
{
  "totalScore": <number>,
  "maxMarks": ${maxMarks || 40},
  "overallFeedback": "<comprehensive 2-sentence performance summary>",
  "improvements": ["1-2 high-impact bullet points"],
  "results": [
    {
      "questionNumber": "Q1",
      "questionText": "",
      "maxMarks": <number - immutable question weight>,
      "studentAnswerText": "<brief quote if marks lost, else ''>",
      "feedback": "<concise feedback under 15 words>",
      "score": <number - awarded marks>,
      "improvements": ["<tip under 15 words if marks lost, else []>"],
      "incorrectPhrases": [
        {
          "wrongText": "<key mistaken phrase/calculation>",
          "explanation": "<brief explanation of error>"
        }
      ]
    }
  ]
}
===================================================`;

    const isVertex = primaryKey.startsWith("AQ.") || Boolean(process.env.VERTEX_API_KEY);
    const ttlSeconds = Math.max(3600, Math.min(ttlHours * 3600, 259200)); // 1 hour to 3 days
    const expireTime = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const cleanSession = (sessionId || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);

    let endpoint = "";
    let payload = {};
    const headers = { "Content-Type": "application/json" };

    if (isVertex) {
        const projectId = process.env.GCP_PROJECT_ID || "975383880672";
        const location = process.env.GCP_LOCATION || "us-central1";

        let authToken = null;
        try {
            authToken = await getVertexAccessToken();
        } catch (e) {
            console.warn("Could not obtain Service Account OAuth2 token:", e.message);
        }

        if (authToken) {
            headers["Authorization"] = `Bearer ${authToken}`;
            endpoint = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/cachedContents`;
        } else {
            endpoint = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/cachedContents?key=${primaryKey}`;
        }

        payload = {
            model: `projects/${projectId}/locations/${location}/publishers/google/models/${model}`,
            displayName: `cache_${cleanSession}`,
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
    } else {
        // Google AI Studio
        endpoint = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${primaryKey}`;
        payload = {
            model: `models/${model}`,
            displayName: `cache_${cleanSession}`,
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
    }

    try {
        console.log(`📡 [Real Cache Creation Attempt] Calling: ${endpoint.replace(/key=[^&\s]+/gi, 'key=REDACTED')}`);
        const response = await fetch(endpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload)
        });

        const rawText = await response.text();
        let data = {};
        try { data = JSON.parse(rawText); } catch (_) {}

        if (response.ok && data && data.name) {
            console.log(`✅ [Real Cache Created] Active Cache ID: ${data.name}`);
            return res.status(200).json({
                success: true,
                cachedContentId: data.name,
                mode: isVertex ? "explicit-vertex" : "explicit-studio",
                model: model,
                expireTime: data.expireTime || expireTime,
                message: `⚡ Context cache successfully created on ${model} (75% discount active).`
            });
        }

        // If Google rejects the API key for caching (401/403/400)
        console.warn(`⚠️ Google Cache API responded with status ${response.status}:`, rawText);
        return res.status(200).json({
            success: false,
            cachedContentId: null,
            mode: "unsupported",
            status: response.status,
            error: `Cache creation not supported with current credentials (${response.status})`,
            details: data?.error?.message || rawText,
            message: `⚠️ Explicit cache creation requires service account credentials on Vertex AI. Using streamlined prompt with 0 bloat (Plan C).`
        });

    } catch (err) {
        console.warn("⚠️ Context Cache network error:", err.message);
        return res.status(200).json({
            success: false,
            cachedContentId: null,
            mode: "error",
            error: err.message,
            message: `⚠️ Network error creating cache. Evaluator will use streamlined prompt.`
        });
    }
}
