import fs from 'fs';
import path from 'path';
import { getVertexAccessToken, getVertexCredentialsInfo } from './vertex-auth.js';

// Force load .env.local if present locally
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
    console.warn("Env force load notice in analyze-topics:", e.message);
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = {}; }
    }

    const {
        sessionId = "",
        questions = "",
        markingScheme = "",
        subject = "General",
        classLevel = "Class 12th"
    } = body;

    if (!questions && !markingScheme) {
        return res.status(400).json({ error: "questions or markingScheme text is required for topic analysis." });
    }

    // Auth & Endpoint setup
    let authToken = null;
    const credsInfo = getVertexCredentialsInfo();
    try {
        authToken = await getVertexAccessToken();
    } catch (_) {}

    const rawKeys = process.env.VERTEX_API_KEY || process.env.GEMINI_API_KEY || process.env.GEMINI_API || process.env.GEMINI_KEY || "";
    const apiKey = rawKeys ? rawKeys.split(",")[0].trim() : "";

    if (!authToken && !apiKey) {
        return res.status(500).json({ error: "Missing Google Cloud Vertex AI or Gemini credentials." });
    }

    const projectId = credsInfo.projectId || process.env.GCP_PROJECT_ID || "nerd-tutors-001";
    const location = process.env.GCP_LOCATION || "global";
    const host = location === "global" 
        ? "aiplatform.googleapis.com" 
        : (location === "us" ? "aiplatform.us.rep.googleapis.com" : `${location}-aiplatform.googleapis.com`);

    const promptText = `You are a master CBSE Curriculum Coordinator and Exam Analyst.
Analyze the following CBSE exam question paper and marking scheme for Subject: ${subject} (${classLevel}).

--- EXAM QUESTIONS ---
${questions}

--- OFFICIAL MARKING SCHEME ---
${markingScheme}

YOUR TASK:
For EVERY individual question and leaf-level sub-part (e.g. Q1, Q2(a), Q2(b), Q5(i), Q5(ii), Q17(a)(i)...):
1. Use CANONICAL LEAF-LEVEL NUMBERING matching the paper (e.g. "Q1", "Q2(a)", "Q2(b)"). Never output composite parent questions like "Q2" if sub-parts (a) and (b) exist!
2. Map to official CBSE / NCERT Curriculum:
   - "chapter": The exact NCERT textbook chapter name (e.g. "Admission of a Partner", "Financial Management", "National Income", "Sectors of the Indian Economy").
   - "topic": The core CBSE topic or mechanism tested (e.g. "Revaluation of Assets & Liabilities", "Capital Structure Decision", "Expenditure Method of GDP").
   - "subtopic": Specific nuance or concept tested (e.g. "Unrecorded Asset adjustment", "Trading on Equity", "Net Factor Income from Abroad").
   - "type": "MCQ" | "Numerical" | "Case Study" | "Theory" | "Assertion-Reason"
   - "cognitiveSkill": "Remembering" | "Understanding" | "Applying" | "Analysing" | "Evaluating"

Return STRICT JSON ONLY in this format:
{
  "subject": "${subject}",
  "classLevel": "${classLevel}",
  "totalQuestions": <number>,
  "chaptersCovered": ["<chapter 1>", "<chapter 2>"],
  "topicMap": {
    "Q1": {
      "chapter": "<Chapter Name>",
      "topic": "<Core Topic>",
      "subtopic": "<Specific Concept>",
      "type": "MCQ",
      "cognitiveSkill": "Understanding"
    }
  },
  "curriculumSummary": "<Concise 2-sentence summary of the syllabus scope tested in this paper>"
}`;

    const isVertex = Boolean(authToken);
    let targetUrl = "";
    const headers = { "Content-Type": "application/json" };

    if (isVertex) {
        headers["Authorization"] = `Bearer ${authToken}`;
        targetUrl = `https://${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/gemini-4-argon:generateContent`;
    } else {
        targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    }

    const payload = {
        contents: [
            {
                role: "user",
                parts: [{ text: promptText }]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
            seed: 42
        }
    };

    try {
        let response = await fetch(targetUrl, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload)
        });

        // Failover to gemini-3.8-flash if primary encounters error
        if (!response.ok && isVertex) {
            console.warn(`Argon topic analysis status ${response.status}. Failing over to gemini-3.8-flash...`);
            const fallbackUrl = `https://${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/gemini-3.8-flash:generateContent`;
            response = await fetch(fallbackUrl, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(payload)
            });
        }

        if (!response.ok) {
            const errTxt = await response.text();
            return res.status(response.status).json({ error: `Model call failed: ${errTxt}` });
        }

        const data = await response.json();
        const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        
        let parsed = {};
        try {
            parsed = JSON.parse(rawContent.trim().replace(/^```json/i, '').replace(/```$/i, '').trim());
        } catch (e) {
            return res.status(500).json({ error: "Failed to parse topic analysis model JSON.", rawContent });
        }

        return res.status(200).json({
            success: true,
            sessionId,
            analysis: parsed
        });
    } catch (err) {
        console.error("Topic analysis handler error:", err);
        return res.status(500).json({ error: err.message });
    }
}
