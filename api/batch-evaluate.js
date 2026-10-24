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

function getBatchJobsFilePath() {
    const primaryPath = path.join(process.cwd(), 'api', 'batch-jobs.json');
    if (fs.existsSync(primaryPath)) return primaryPath;
    const rootPath = path.join(process.cwd(), 'batch-jobs.json');
    if (fs.existsSync(rootPath)) return rootPath;
    return path.join('/tmp', 'batch-jobs.json');
}

function loadSavedBatchJobs() {
    const fPath = getBatchJobsFilePath();
    try {
        if (fs.existsSync(fPath)) {
            const raw = fs.readFileSync(fPath, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) return data;
        }
    } catch (_) {}
    return [];
}

function saveBatchJobsList(jobs) {
    const primaryDir = path.join(process.cwd(), 'api');
    try {
        if (!fs.existsSync(primaryDir)) fs.mkdirSync(primaryDir, { recursive: true });
        fs.writeFileSync(path.join(primaryDir, 'batch-jobs.json'), JSON.stringify(jobs, null, 2), 'utf8');
        return;
    } catch (_) {}
    try {
        fs.writeFileSync(path.join('/tmp', 'batch-jobs.json'), JSON.stringify(jobs, null, 2), 'utf8');
    } catch (_) {}
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

    let authToken = null;
    let authError = null;
    const credsInfo = getVertexCredentialsInfo();

    try {
        authToken = await getVertexAccessToken();
    } catch (e) {
        authError = e.message;
    }

    const rawKeys = process.env.GEMINI_API_KEY || process.env.VERTEX_API_KEY || process.env.GEMINI_KEY || process.env.GOOGLE_API_KEY || "";
    if (!rawKeys && !authToken) {
        return res.status(500).json({
            error: "Neither Gemini/Vertex API key nor GCP Service Account key is configured in server environment.",
            authAudit: {
                serviceAccountFetched: false,
                error: credsInfo.error || authError || "Missing API Key or GCP_SERVICE_ACCOUNT_KEY"
            }
        });
    }

    const apiKey = rawKeys ? rawKeys.split(",")[0].trim() : "";
    const action = body.action || "create";

    const projectId = credsInfo.projectId || process.env.GCP_PROJECT_ID || "nerd-tutors-001";
    const location = process.env.GCP_LOCATION || "global";
    const host = location === "global" 
        ? "aiplatform.googleapis.com" 
        : (location === "us" ? "aiplatform.us.rep.googleapis.com" : (location === "eu" ? "aiplatform.eu.rep.googleapis.com" : `${location}-aiplatform.googleapis.com`));

    const authAudit = {
        serviceAccountFetched: Boolean(credsInfo.configured),
        serviceAccountEmail: credsInfo.clientEmail,
        projectId: projectId,
        location: location,
        tokenActive: Boolean(authToken),
        hasApiKey: Boolean(apiKey),
        cloudProvider: `Google Cloud Vertex AI (${location} - ${host})`,
        authError: authError
    };

    function getEndpoint(actionName, targetModel = "", batchId = "") {
        const cleanModel = (targetModel || "gemini-4-argon").replace(/^publishers\/google\/models\//, '').replace(/^models\//, '');
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${authToken}`
        };
        let url = "";

        const basePath = `https://${host}/v1/projects/${projectId}/locations/${location}/batchPredictionJobs`;

        if (actionName === "create" || actionName === "list") {
            url = basePath;
        } else if (actionName === "status" || actionName === "sync" || actionName === "cancel") {
            const cleanBatch = String(batchId).replace(/^.*\/batchPredictionJobs\//, '').replace(/^batches\//, '');
            url = `${basePath}/${cleanBatch}`;
        }
        return { url, headers };
    }

    async function uploadToGcs(bucketName, objectPath, contentString, contentType = 'application/jsonl') {
        const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
        let res = await fetch(uploadUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": contentType
            },
            body: contentString
        });

        if (res.status === 404) {
            console.log(`🪣 Bucket '${bucketName}' not found. Creating bucket in project '${projectId}'...`);
            const createBucketRes = await fetch(`https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(projectId)}`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${authToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name: bucketName,
                    location: "US",
                    storageClass: "STANDARD"
                })
            });

            if (!createBucketRes.ok && createBucketRes.status !== 409) {
                const errTxt = await createBucketRes.text();
                console.warn(`Bucket creation notice: ${errTxt}`);
            }

            res = await fetch(uploadUrl, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${authToken}`,
                    "Content-Type": contentType
                },
                body: contentString
            });
        }

        if (!res.ok) {
            const errTxt = await res.text();
            throw new Error(`Google Cloud Storage upload failed (${res.status}): ${errTxt}`);
        }

        return `gs://${bucketName}/${objectPath}`;
    }

    async function readGcsPredictions(gcsOutputDirectory) {
        if (!gcsOutputDirectory || !gcsOutputDirectory.startsWith('gs://')) return [];
        const withoutGs = gcsOutputDirectory.replace('gs://', '');
        const firstSlash = withoutGs.indexOf('/');
        const bucket = firstSlash !== -1 ? withoutGs.substring(0, firstSlash) : withoutGs;
        const prefix = firstSlash !== -1 ? withoutGs.substring(firstSlash + 1) : '';

        const listUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?prefix=${encodeURIComponent(prefix)}`;
        const listRes = await fetch(listUrl, {
            headers: { "Authorization": `Bearer ${authToken}` }
        });
        if (!listRes.ok) {
            const errTxt = await listRes.text();
            console.error("GCS list output error:", errTxt);
            return [];
        }
        const listData = await listRes.json();
        const items = listData.items || [];
        const jsonlFiles = items.filter(it => it.name.endsWith('.jsonl'));

        const allResponses = [];
        for (const fileObj of jsonlFiles) {
            const fileUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(fileObj.name)}?alt=media`;
            const fileRes = await fetch(fileUrl, {
                headers: { "Authorization": `Bearer ${authToken}` }
            });
            if (fileRes.ok) {
                const textContent = await fileRes.text();
                const lines = textContent.split('\n').map(l => l.trim()).filter(Boolean);
                for (const line of lines) {
                    try {
                        const parsedLine = JSON.parse(line);
                        allResponses.push(parsedLine);
                    } catch (_) {}
                }
            }
        }
        return allResponses;
    }

    // ==========================================
    // ACTION: LIST (Fetch batch jobs from Vertex AI)
    // ==========================================
    if (action === "list") {
        try {
            const savedJobs = loadSavedBatchJobs();
            let googleBatches = [];
            try {
                const { url: listUrl, headers: listHeaders } = getEndpoint("list");
                const gRes = await fetch(listUrl, { headers: listHeaders });
                const rawText = await gRes.text();
                let gData = {};
                try { gData = JSON.parse(rawText); } catch (_) {}
                googleBatches = gData.batchPredictionJobs || gData.batches || [];
            } catch (_) {}

            const updatedJobs = savedJobs.map(j => {
                const live = googleBatches.find(gb => gb.name === j.batchId || gb.name?.endsWith(j.batchId));
                if (live) {
                    return {
                        ...j,
                        status: live.state || j.status,
                        updateTime: live.updateTime || j.updateTime
                    };
                }
                return j;
            });

            googleBatches.forEach(gb => {
                const shortId = gb.name.split('/').pop();
                const exists = updatedJobs.some(j => j.batchId === gb.name || j.id === shortId);
                if (!exists) {
                    updatedJobs.push({
                        id: shortId,
                        batchId: gb.name,
                        sessionName: gb.displayName || 'Vertex AI Batch Job',
                        studentCount: 1,
                        status: gb.state || 'JOB_STATE_PENDING',
                        createdAt: gb.createTime || new Date().toISOString()
                    });
                }
            });

            saveBatchJobsList(updatedJobs);
            return res.status(200).json({ success: true, jobs: updatedJobs });
        } catch (err) {
            console.error("Batch list error:", err);
            return res.status(500).json({ error: err.message });
        }
    }

    // ==========================================
    // ACTION: DELETE (Remove batch job from registry)
    // ==========================================
    if (action === "delete") {
        const batchId = body.batchId || "";
        const saved = loadSavedBatchJobs();
        const filtered = saved.filter(j => j.batchId !== batchId && j.id !== batchId && j.batchId !== `batches/${batchId}`);
        saveBatchJobsList(filtered);
        return res.status(200).json({ success: true, message: "Batch job deleted from registry." });
    }

    // ==========================================
    // ACTION: STATUS (Poll existing batch job)
    // ==========================================
    if (action === "status") {
        const batchId = body.batchId || "";
        if (!batchId) {
            return res.status(400).json({ error: "batchId is required for status check." });
        }

        try {
            const { url: statusUrl, headers: statusHeaders } = getEndpoint("status", "", batchId);
            const gRes = await fetch(statusUrl, { headers: statusHeaders });
            const rawText = await gRes.text();
            let data = {};
            try { data = JSON.parse(rawText); } catch (_) {}

            if (!gRes.ok) {
                return res.status(gRes.status).json({
                    error: data.error?.message || (rawText.startsWith('<') ? "Google Cloud returned an HTML error page." : rawText) || "Failed to fetch batch status from Google Cloud.",
                    authAudit
                });
            }

            return res.status(200).json({
                batchId: data.name,
                displayName: data.displayName || "",
                state: data.state || "JOB_STATE_PENDING",
                done: data.done || (data.state === 'JOB_STATE_SUCCEEDED' || data.state === 'JOB_STATE_FAILED' || data.state === 'JOB_STATE_CANCELLED'),
                createTime: data.createTime || null,
                updateTime: data.updateTime || null,
                error: data.error || null,
                outputInfo: data.outputInfo || null,
                hasResponses: Boolean(data.outputInfo?.gcsOutputDirectory || data.dest?.inlinedResponses || data.response?.responses)
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
        const batchId = body.batchId || "";
        if (!batchId) {
            return res.status(400).json({ error: "batchId is required to sync results." });
        }

        try {
            const { url: syncUrl, headers: syncHeaders } = getEndpoint("sync", "", batchId);
            const gRes = await fetch(syncUrl, { headers: syncHeaders });
            const rawText = await gRes.text();
            let data = {};
            try { data = JSON.parse(rawText); } catch (_) {}

            if (!gRes.ok) {
                return res.status(gRes.status).json({
                    error: data.error?.message || (rawText.startsWith('<') ? "Google Cloud returned an HTML error page." : rawText) || "Failed to sync batch.",
                    authAudit
                });
            }

            if (data.state !== 'JOB_STATE_SUCCEEDED') {
                return res.status(400).json({
                    error: `Batch job is not completed yet. Current state: ${data.state}`,
                    state: data.state
                });
            }

            let responsesList = [];
            const gcsOutputDir = data.outputInfo?.gcsOutputDirectory || body.gcsOutputDirectory;
            if (gcsOutputDir) {
                console.log(`📥 Reading batch prediction output from GCS: ${gcsOutputDir}...`);
                responsesList = await readGcsPredictions(gcsOutputDir);
            }
            if (responsesList.length === 0) {
                responsesList = data.dest?.inlinedResponses || data.response?.responses || [];
            }

            if (!responsesList || responsesList.length === 0) {
                return res.status(400).json({ error: "No response objects found in Google Batch result or GCS output directory." });
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

            // Mark job as SYNCED in server registry
            const allSaved = loadSavedBatchJobs();
            const targetJ = allSaved.find(j => j.batchId === batchId || j.id === batchId || `batches/${j.id}` === batchId);
            if (targetJ) {
                targetJ.status = 'SYNCED';
                targetJ.syncedCount = parsedResults.length;
                targetJ.syncedAt = new Date().toISOString();
                saveBatchJobsList(allSaved);
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

    const reasoningGuardrailPrompt = `
--- REASONING BUDGET GOVERNANCE & THINKING GUARDRAIL (CRITICAL) ---
- Formulate your evaluation directly against the marking scheme value points without discursive preamble.
- Do NOT rewrite or transcribe the student's entire answer inside your internal thinking trace.
- For MCQs: Compare the written option letter (A, B, C, D) directly against the key in a single reasoning step. Zero paragraphs of theory in thoughts.
- For Subjective Questions: Check directly for the presence or absence of mandatory textbook value points. Deduct marks immediately for missing points without repetitive deliberation.
- Keep your internal thought trace crisp, concise, and decisive.
`;

    // Streamlined prompt: if cachedContentId is attached, Google already holds the entire
    // question paper, marking scheme, and rubrics in memory!
    let promptBase = "";
    if (cachedContentId) {
        promptBase = `Evaluate this student's handwritten answer sheet against the pre-loaded Exam Questions, Marking Scheme, Subject Directives, and Output Schema in your active cache (${cachedContentId}). Return STRICT JSON only.`;
    } else {
        const subjectDirectives = getSubjectDirectives(subject);
        promptBase = `You are evaluating student handwritten answer sheets against the official exam questions and marking scheme below.
${reasoningGuardrailPrompt}
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
    { "questionNumber": "Q1", "score": <number>, "maxMarks": <number>, "feedback": "<max 15 words>", "improvements": ["<max 15 words>"] }
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
    const cleanModel = (model || "gemini-4-argon").replace(/^publishers\/google\/models\//, '').replace(/^models\//, '');
    const cleanSession = (sessionId || 'exam').replace(/[^a-zA-Z0-9_-]/g, '_');
    const gcsBucket = process.env.GCP_STORAGE_BUCKET || `${projectId}-batch-evals`;
    const inputFileName = `inputs/${cleanSession}_${Date.now()}.jsonl`;
    const jsonlData = inlinedRequests.map(req => JSON.stringify({ request: req })).join('\n') + '\n';

    console.log(`📤 Uploading batch input (${inlinedRequests.length} students) to Google Cloud Storage (gs://${gcsBucket}/${inputFileName})...`);
    let gcsInputUri = body.gcsInputUri || "";
    if (!gcsInputUri) {
        gcsInputUri = await uploadToGcs(gcsBucket, inputFileName, jsonlData);
        console.log(`✅ Uploaded input file to ${gcsInputUri}`);
    }

    const outputPrefix = body.gcsOutputUri || `gs://${gcsBucket}/outputs/${cleanSession}_${Date.now()}/`;

    // Official Google Cloud Vertex AI projects.locations.batchPredictionJobs resource schema
    const vertexBatchPayload = {
        displayName: displayName.substring(0, 128),
        model: `publishers/google/models/${cleanModel}`,
        inputConfig: {
            instancesFormat: "jsonl",
            gcsSource: {
                uris: [gcsInputUri]
            }
        },
        outputConfig: {
            predictionsFormat: "jsonl",
            gcsDestination: {
                outputUriPrefix: outputPrefix
            }
        }
    };

    try {
        const { url: createUrl, headers: createHeaders } = getEndpoint("create", cleanModel);
        createHeaders["Content-Type"] = "application/json";
        console.log(`🚀 Dispatching Vertex AI Batch Prediction Job to ${createUrl} (Model: publishers/google/models/${cleanModel})...`);

        const gRes = await fetch(createUrl, {
            method: "POST",
            headers: createHeaders,
            body: JSON.stringify(vertexBatchPayload)
        });

        const rawText = await gRes.text();
        let data = {};
        try { data = JSON.parse(rawText); } catch (_) {}

        if (!gRes.ok || !data.name) {
            console.error("Vertex AI Batch creation error:", rawText);
            const cleanErr = data?.error?.message || (rawText.startsWith('<') ? "Vertex AI returned an HTML error page." : rawText) || "Failed to create Vertex AI Batch Job.";
            return res.status(gRes.status || 500).json({
                error: cleanErr,
                details: data?.error?.details || null,
                authAudit
            });
        }

        console.log("🎉 Google Batch Job Created Successfully:", data.name);

        const newJob = {
            id: data.name.replace('batches/', ''),
            batchId: data.name,
            sessionId: sessionId || null,
            sessionName: examName || 'Exam Assessment',
            subject: subject || 'General',
            studentCount: students.length,
            studentsMetadata: students.map(s => ({ studentName: s.studentName, pageCount: Array.isArray(s.pages) ? s.pages.length : 1 })),
            maxMarks: Number(maxMarks) || 40,
            status: data.state || "JOB_STATE_PENDING",
            gcsInputUri: gcsInputUri,
            gcsOutputDirectory: outputPrefix,
            createdAt: data.createTime || new Date().toISOString()
        };
        const allJobs = loadSavedBatchJobs();
        allJobs.unshift(newJob);
        saveBatchJobsList(allJobs);

        return res.status(200).json({
            success: true,
            batchId: data.name,
            displayName: data.displayName || displayName,
            state: data.state || "JOB_STATE_PENDING",
            studentCount: students.length,
            createTime: data.createTime || new Date().toISOString(),
            authAudit
        });

    } catch (err) {
        console.error("Batch endpoint fatal error:", err);
        return res.status(500).json({ error: err.message, authAudit });
    }
}
