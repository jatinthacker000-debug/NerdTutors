import fs from 'fs';
import path from 'path';

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
    console.warn("Env force load error in batch-evaluate:", e.message);
}

// Load CBSE Master Rules Matrix
let cbseRules = null;
try {
    const rulesPath = path.join(process.cwd(), 'api', 'cbse-rules.json');
    if (fs.existsSync(rulesPath)) {
        cbseRules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    }
} catch (e) {
    console.warn("Could not load cbse-rules.json:", e.message);
}

function getSubjectDirectives(subject) {
    const sub = (subject || "").toLowerCase();
    if (!cbseRules || !cbseRules.STAGE_2_DETERMINISTIC_EVALUATOR || !cbseRules.STAGE_2_DETERMINISTIC_EVALUATOR.SUBJECT_SPECIFIC_DIRECTIVES) {
        return "";
    }
    const directives = cbseRules.STAGE_2_DETERMINISTIC_EVALUATOR.SUBJECT_SPECIFIC_DIRECTIVES;
    let selectedRules = null;
    let subjectHeader = "";

    if (sub.includes("account") || sub.includes("accounting")) {
        selectedRules = directives.ACCOUNTANCY_055;
        subjectHeader = "ACCOUNTANCY (CBSE CODE 055)";
    } else if (sub.includes("business")) {
        selectedRules = directives.BUSINESS_STUDIES_054;
        subjectHeader = "BUSINESS STUDIES (CBSE CODE 054)";
    } else if (sub.includes("economics")) {
        selectedRules = directives.ECONOMICS_030;
        subjectHeader = "ECONOMICS (CBSE CODE 030)";
    } else if (sub.includes("social") || sub.includes("history") || sub.includes("geography") || sub.includes("civics")) {
        selectedRules = directives.SOCIAL_SCIENCE_087;
        subjectHeader = "SOCIAL SCIENCE (CBSE CODE 087)";
    }
    if (!selectedRules) return "";
    return `\n=== SUBJECT-SPECIFIC BOARD DIRECTIVES: ${subjectHeader} ===\n${JSON.stringify(selectedRules)}\n`;
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST" && req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed." });
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    if (req.method === "GET") {
        body = req.query;
    }

    const rawKeys = process.env.GEMINI_API_KEY || process.env.VERTEX_API_KEY || process.env.GEMINI_KEY || "";
    if (!rawKeys) {
        return res.status(500).json({ error: "Gemini API key is not configured in server environment." });
    }
    const apiKey = rawKeys.split(",")[0].trim();
    const action = body.action || "create";

    // ==========================================
    // ACTION: STATUS (Poll existing batch job)
    // ==========================================
    if (action === "status") {
        let batchId = body.batchId || "";
        if (!batchId) {
            return res.status(400).json({ error: "batchId is required for status check." });
        }
        if (!batchId.startsWith("batches/")) {
            batchId = "batches/" + batchId;
        }

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/${batchId}?key=${apiKey}`;
            const gRes = await fetch(url);
            const data = await gRes.json();

            if (!gRes.ok) {
                return res.status(gRes.status).json({
                    error: data.error?.message || "Failed to fetch batch status from Google Cloud."
                });
            }

            return res.status(200).json({
                batchId: data.name,
                displayName: data.displayName || "",
                state: data.state || "JOB_STATE_PENDING",
                done: data.done || (data.state === 'JOB_STATE_SUCCEEDED' || data.state === 'JOB_STATE_FAILED'),
                createTime: data.createTime || null,
                updateTime: data.updateTime || null,
                error: data.error || null,
                hasResponses: Boolean(data.dest?.inlinedResponses || data.response?.responses)
            });
        } catch (err) {
            console.error("Batch status error:", err);
            return res.status(500).json({ error: err.message });
        }
    }

    // ==========================================
    // ACTION: SYNC (Retrieve & parse responses)
    // ==========================================
    if (action === "sync") {
        let batchId = body.batchId || "";
        if (!batchId) {
            return res.status(400).json({ error: "batchId is required to sync results." });
        }
        if (!batchId.startsWith("batches/")) {
            batchId = "batches/" + batchId;
        }

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/${batchId}?key=${apiKey}`;
            const gRes = await fetch(url);
            const data = await gRes.json();

            if (!gRes.ok) {
                return res.status(gRes.status).json({ error: data.error?.message || "Failed to sync batch." });
            }

            if (data.state !== 'JOB_STATE_SUCCEEDED') {
                return res.status(400).json({
                    error: `Batch job is not completed yet. Current state: ${data.state}`,
                    state: data.state
                });
            }

            const inlinedResponses = data.dest?.inlinedResponses || data.response?.responses || [];
            if (!inlinedResponses || inlinedResponses.length === 0) {
                return res.status(400).json({ error: "No response objects found in Google Batch result." });
            }

            const studentsMetadata = body.studentsMetadata || [];
            const parsedResults = [];

            for (let i = 0; i < inlinedResponses.length; i++) {
                const item = inlinedResponses[i];
                const meta = studentsMetadata[i] || { studentName: `Student ${i + 1}` };

                let rawText = "";
                if (item.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
                    rawText = item.response.candidates[0].content.parts[0].text;
                } else if (item.response?.text) {
                    rawText = item.response.text;
                }

                if (!rawText) {
                    parsedResults.push({
                        studentName: meta.studentName,
                        error: item.error?.message || "Empty response from Google model"
                    });
                    continue;
                }

                try {
                    let cleaned = rawText.trim();
                    if (cleaned.startsWith("```json")) cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
                    else if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```\s*/i, "").replace(/```\s*$/i, "");

                    const evalObj = JSON.parse(cleaned);

                    // CBSE Safety Nets: Programmatic Mathematical Clamping & Binary MCQ Checks
                    if (Array.isArray(evalObj.results)) {
                        let runningSum = 0;
                        evalObj.results.forEach(resObj => {
                            const isMCQ = (Number(resObj.maxMarks) <= 1.0) && (/mcq|q[1-9]|section\s*a/i.test(resObj.questionId || ""));
                            if (isMCQ) {
                                resObj.maxMarks = 1.0;
                                const fb = (resObj.feedback || "").toLowerCase();
                                const isWrong = fb.includes("incorrect") || fb.includes("wrong") || fb.includes("0/1");
                                if (isWrong) resObj.score = 0;
                                else if (Number(resObj.score) >= 0.5) resObj.score = 1.0;
                                else resObj.score = 0;
                            }
                            // Clamping
                            resObj.score = Math.min(Math.max(0, Number(resObj.score) || 0), Number(resObj.maxMarks) || 1);
                            runningSum += resObj.score;
                        });
                        evalObj.totalScore = Math.round(runningSum * 10) / 10;
                    }

                    parsedResults.push({
                        studentName: meta.studentName,
                        result: evalObj,
                        rawOutput: cleaned
                    });
                } catch (pErr) {
                    parsedResults.push({
                        studentName: meta.studentName,
                        error: "JSON parse failed: " + pErr.message,
                        rawOutput: rawText
                    });
                }
            }

            return res.status(200).json({
                success: true,
                batchId: data.name,
                parsedResults
            });
        } catch (err) {
            console.error("Batch sync error:", err);
            return res.status(500).json({ error: err.message });
        }
    }

    // ==========================================
    // ACTION: CREATE (Submit a new batch to Google)
    // ==========================================
    const {
        sessionId,
        examName,
        subject,
        questions,
        markingScheme,
        maxMarks = 40,
        otherInstructions = "",
        students = [],
        cachedContentId = null,
        model = process.env.GEMINI_MODEL || "gemini-4-argon"
    } = body;

    if (!students || students.length === 0) {
        return res.status(400).json({ error: "At least one student with answer sheet pages is required to create a batch." });
    }

    const isArgon = model.includes("argon") || model.includes("gemini-4");

    // Streamlined prompt: if cachedContentId is attached, Google already holds the entire
    // question paper, marking scheme, and rubrics in memory!
    let promptBase = "";
    if (cachedContentId) {
        promptBase = `Evaluate this student's answer sheet against the pre-cached exam questions and official marking scheme.
CRITICAL CONSTRAINTS:
1. STRICT BINARY MCQ: 1 mark if correct option letter matches; 0 if wrong. Never award 0.5.
2. DEFEND / REFUTE: Choosing incorrect stance caps question score to maximum 1.0 mark.
3. CONCISE FEEDBACK: Feedback per question MUST be strictly 15 words or fewer. Improvements max 2 items (max 15 words each).
${otherInstructions ? `Teacher override: ${otherInstructions}\n` : ""}
Return STRICT JSON:
{
  "results": [
    { "questionId": "Q1", "score": <number>, "maxMarks": <number>, "feedback": "<max 15 words>", "improvements": ["<max 15 words>"] }
  ],
  "totalScore": <number>,
  "totalMaxMarks": ${maxMarks},
  "overallFeedback": "<comprehensive 2-3 sentence performance summary>"
}`;
    } else {
        const subjectDirectives = getSubjectDirectives(subject);
        promptBase = `You are evaluating student handwritten answer sheets against the official exam questions and marking scheme below.
CRITICAL CONSTRAINTS:
1. STRICT BINARY MCQ: 1 mark if correct option letter matches; 0 if wrong. Never award 0.5.
2. DEFEND / REFUTE: Choosing incorrect stance caps question score to maximum 1.0 mark.
3. CONCISE FEEDBACK: Feedback per question MUST be strictly 15 words or fewer. Improvements max 2 items (max 15 words each).
${subjectDirectives}

--- EXAM QUESTIONS ---
${questions || ""}

--- OFFICIAL MARKING SCHEME ---
${markingScheme || ""}
${otherInstructions ? `\n--- TEACHER OVERRIDE INSTRUCTIONS ---\n${otherInstructions}\n` : ""}

Return STRICT JSON:
{
  "results": [
    { "questionId": "Q1", "score": <number>, "maxMarks": <number>, "feedback": "<max 15 words>", "improvements": ["<max 15 words>"] }
  ],
  "totalScore": <number>,
  "totalMaxMarks": ${maxMarks},
  "overallFeedback": "<comprehensive 2-3 sentence performance summary>"
}`;
    }

    // Package each student into an inline GenerateContentRequest
    const inlinedRequests = students.map((st, idx) => {
        const studentPrompt = `STUDENT NAME: ${st.studentName || `Student ${idx + 1}`}\n\n${promptBase}`;
        const parts = [{ text: studentPrompt }];

        if (Array.isArray(st.pages)) {
            st.pages.forEach(p => {
                parts.push({
                    inlineData: {
                        mimeType: p.mimeType || "image/jpeg",
                        data: p.base64
                    }
                });
            });
        }

        const genConfig = {
            responseMimeType: "application/json",
            temperature: 0.0,
            seed: 42
        };

        if (isArgon) {
            genConfig.thinkingConfig = { thinkingLevel: "medium" };
        } else {
            genConfig.thinkingConfig = { thinkingBudget: 512 };
        }

        const reqItem = {
            contents: [
                {
                    role: "user",
                    parts: parts
                }
            ],
            generationConfig: genConfig
        };

        if (cachedContentId) {
            reqItem.cachedContent = cachedContentId;
        }

        return reqItem;
    });

    const displayName = `NerdTutors_${examName ? examName.replace(/[^a-zA-Z0-9_-]/g, "_") : "Exam"}_${Date.now()}`;
    const targetModel = model.includes("/") ? model : `models/${model}`;

    const batchPayload = {
        batch: {
            displayName: displayName.substring(0, 60),
            inputConfig: {
                requests: {
                    requests: inlinedRequests.map(reqObj => ({ request: reqObj }))
                }
            }
        }
    };

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/${targetModel}:batchGenerateContent?key=${apiKey}`;
        console.log(`🚀 Sending batch creation request to Google (${students.length} students)...`);

        const gRes = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batchPayload)
        });

        const data = await gRes.json();

        if (!gRes.ok) {
            console.error("Google Batch creation error:", data);
            return res.status(gRes.status).json({
                error: data.error?.message || "Failed to create Google Batch Job.",
                details: data.error?.details || null
            });
        }

        console.log("🎉 Google Batch Job Created Successfully:", data.name);

        return res.status(200).json({
            success: true,
            batchId: data.name,
            displayName: data.displayName || displayName,
            state: data.state || "JOB_STATE_PENDING",
            studentCount: students.length,
            createTime: data.createTime || new Date().toISOString()
        });

    } catch (err) {
        console.error("Batch endpoint fatal error:", err);
        return res.status(500).json({ error: err.message });
    }
}
