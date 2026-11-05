import fs from 'fs';
import path from 'path';
import { getVertexAccessToken, getVertexCredentialsInfo } from './vertex-auth.js';
import {
    handleCors,
    validateInvocation,
    verifyAuth,
    sendError
} from './_security.js';

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
    return `\n=== SUBJECT-SPECIFIC BOARD DIRECTIVES: ${subjectHeader} ===\n${JSON.stringify(selectedRules, null, 2)}\n`;
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

function getDeletedJobsFilePath() {
    const primaryPath = path.join(process.cwd(), 'api', 'deleted-batch-jobs.json');
    if (fs.existsSync(primaryPath)) return primaryPath;
    const rootPath = path.join(process.cwd(), 'deleted-batch-jobs.json');
    if (fs.existsSync(rootPath)) return rootPath;
    return path.join('/tmp', 'deleted-batch-jobs.json');
}

function loadDeletedJobIds() {
    const fPath = getDeletedJobsFilePath();
    try {
        if (fs.existsSync(fPath)) {
            const raw = fs.readFileSync(fPath, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) return data;
        }
    } catch (_) {}
    return [];
}

function saveDeletedJobIds(ids) {
    const primaryDir = path.join(process.cwd(), 'api');
    try {
        if (!fs.existsSync(primaryDir)) fs.mkdirSync(primaryDir, { recursive: true });
        fs.writeFileSync(path.join(primaryDir, 'deleted-batch-jobs.json'), JSON.stringify(ids, null, 2), 'utf8');
        return;
    } catch (_) {}
    try {
        fs.writeFileSync(path.join('/tmp', 'deleted-batch-jobs.json'), JSON.stringify(ids, null, 2), 'utf8');
    } catch (_) {}
}

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (validateInvocation(req, res)) return;

    if (req.method !== "POST" && req.method !== "GET") {
        return sendError(res, 405, "Method not allowed. Use GET or POST.");
    }

    // Mandatory Authentication Guard
    const authResult = await verifyAuth(req);
    if (!authResult.authenticated) {
        return sendError(res, 401, "Unauthorized: Authentication required to access batch evaluation service.");
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    if (req.method === "GET") {
        body = req.query;
    }

    const action = body.action || req.query?.action || "create";

    // Creating or deleting batch jobs requires administrator privileges
    if ((action === "create" || action === "delete") && !authResult.user?.isAdmin) {
        return sendError(res, 403, "Forbidden: Administrator privileges required to create or delete batch prediction jobs.");
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
        return sendError(res, 500, "Neither Gemini/Vertex API key nor GCP Service Account key is configured in server environment.");
    }

    const apiKey = rawKeys ? rawKeys.split(",")[0].trim() : "";


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
            let parsedErr = {};
            try { parsedErr = JSON.parse(errTxt); } catch (_) {}
            const msg = parsedErr?.error?.message || (errTxt.startsWith('<') ? "Google Cloud Storage returned an HTML error" : errTxt);
            throw new Error(`Google Cloud Storage upload failed (${res.status}): ${msg}`);
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

    async function readGcsManifest(shortId) {
        if (!shortId || !authToken) return null;
        const bucket = process.env.GCP_STORAGE_BUCKET || `${projectId}-batch-evals`;
        const manifestUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/manifests%2F${encodeURIComponent(shortId)}.json?alt=media`;
        try {
            const mRes = await fetch(manifestUrl, { headers: { "Authorization": `Bearer ${authToken}` } });
            if (mRes.ok) {
                const mText = await mRes.text();
                return JSON.parse(mText);
            }
        } catch (_) {}
        return null;
    }

    // ==========================================
    // ACTION: LIST (Fetch batch jobs from Vertex AI)
    // ==========================================
    if (action === "list") {
        try {
            const savedJobs = loadSavedBatchJobs();
            const deletedIds = loadDeletedJobIds();

            let googleBatches = [];
            try {
                const { url: listUrl, headers: listHeaders } = getEndpoint("list");
                const gRes = await fetch(listUrl, { headers: listHeaders });
                const rawText = await gRes.text();
                let gData = {};
                try { gData = JSON.parse(rawText); } catch (_) {}
                googleBatches = gData.batchPredictionJobs || gData.batches || [];
            } catch (_) {}

            // Exclude jobs that have been deleted by user
            googleBatches = googleBatches.filter(gb => {
                const shortId = gb.name.split('/').pop();
                return !deletedIds.includes(shortId) && !deletedIds.includes(gb.name);
            });

            const updatedJobs = savedJobs.filter(j => !deletedIds.includes(j.id) && !deletedIds.includes(j.batchId)).map(j => {
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

            for (const gb of googleBatches) {
                const shortId = gb.name.split('/').pop();
                let existing = updatedJobs.find(j => j.batchId === gb.name || j.id === shortId);
                let manifest = null;
                if (!existing || !existing.studentsMetadata || existing.studentsMetadata.length === 0) {
                    manifest = await readGcsManifest(shortId);
                }

                if (!existing) {
                    const disp = gb.displayName || '';
                    let inferredSubject = manifest?.subject || '';
                    if (!inferredSubject) {
                        const dLower = disp.toLowerCase();
                        if (dLower.includes('account')) inferredSubject = 'Accountancy';
                        else if (dLower.includes('eco')) inferredSubject = 'Economics';
                        else if (dLower.includes('business') || dLower.includes('bst')) inferredSubject = 'Business Studies';
                        else if (dLower.includes('social') || dLower.includes('sst')) inferredSubject = 'Social Science';
                    }

                    updatedJobs.push({
                        id: shortId,
                        batchId: gb.name,
                        sessionName: manifest?.sessionName || disp || 'Vertex AI Batch Job',
                        subject: inferredSubject,
                        class: manifest?.class || 'Class 12th',
                        studentCount: manifest?.studentCount || 1,
                        studentsMetadata: manifest?.studentsMetadata || [],
                        status: gb.state || 'JOB_STATE_PENDING',
                        createdAt: gb.createTime || new Date().toISOString()
                    });
                } else if (manifest && (!existing.studentsMetadata || existing.studentsMetadata.length === 0)) {
                    existing.studentsMetadata = manifest.studentsMetadata || [];
                    if (manifest.subject) existing.subject = manifest.subject;
                    if (manifest.sessionName) existing.sessionName = manifest.sessionName;
                    if (manifest.studentCount) existing.studentCount = manifest.studentCount;
                }
            }

            saveBatchJobsList(updatedJobs);
            return res.status(200).json({ success: true, jobs: updatedJobs });
        } catch (err) {
            console.error("Batch list error:", err);
            return res.status(500).json({ error: err.message });
        }
    }

    // ==========================================
    // ACTION: DELETE (Remove batch job from registry & cancel on Google)
    // ==========================================
    if (action === "delete") {
        const batchId = body.batchId || "";
        const cleanId = String(batchId).replace(/^.*\/batchPredictionJobs\//, '').replace(/^batches\//, '');

        // 1. Try to cancel/delete on Google Cloud Vertex AI
        try {
            const { url: deleteUrl, headers: deleteHeaders } = getEndpoint("status", "", cleanId);
            await fetch(deleteUrl, { method: "DELETE", headers: deleteHeaders });
        } catch (_) {}

        // 2. Remove from local list
        const saved = loadSavedBatchJobs();
        const filtered = saved.filter(j => j.batchId !== batchId && j.id !== batchId && j.id !== cleanId && !j.batchId?.endsWith(cleanId));
        saveBatchJobsList(filtered);

        // 3. Blacklist ID so 'action: list' never resurrects it
        const deletedIds = loadDeletedJobIds();
        if (cleanId && !deletedIds.includes(cleanId)) deletedIds.push(cleanId);
        if (batchId && !deletedIds.includes(batchId)) deletedIds.push(batchId);
        saveDeletedJobIds(deletedIds);

        return res.status(200).json({ success: true, message: "Batch job deleted from registry and Google Cloud." });
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
        const batchId = body.batchId || req.query?.batchId || "";
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

            const shortId = (batchId || '').split('/').pop();
            const allSaved = loadSavedBatchJobs();
            const targetJ = allSaved.find(j => j.batchId === batchId || j.id === batchId || `batches/${j.id}` === batchId);
            
            let studentsMetadata = body.studentsMetadata || [];
            if (!studentsMetadata || studentsMetadata.length === 0) {
                if (targetJ?.studentsMetadata?.length) {
                    studentsMetadata = targetJ.studentsMetadata;
                } else {
                    const gcsM = await readGcsManifest(shortId);
                    if (gcsM?.studentsMetadata?.length) {
                        studentsMetadata = gcsM.studentsMetadata;
                    }
                }
            }

            const parsedResults = [];

            for (let i = 0; i < responsesList.length; i++) {
                const item = responsesList[i];
                const meta = studentsMetadata[i] || { studentName: `Student ${i + 1}` };
                const usageMetadata = item.response?.usageMetadata || null;

                let rawText = "";
                if (item.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
                    rawText = item.response.candidates[0].content.parts[0].text;
                } else if (item.response?.text) {
                    rawText = item.response.text;
                }

                if (!rawText) {
                    parsedResults.push({
                        studentName: meta.studentName || `Student ${i + 1}`,
                        error: item.error?.message || "Empty response from Google model"
                    });
                    continue;
                }

                try {
                    let cleaned = rawText.trim();
                    if (cleaned.startsWith("```json")) cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
                    else if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```\s*/i, "").replace(/```\s*$/i, "");

                    const evalObj = JSON.parse(cleaned);

                    // Robust student name resolution: Model Output > Manifest Meta > Student N
                    let resolvedStudentName = evalObj.studentName || meta.studentName;
                    if (!resolvedStudentName || /^student\s*\d+$/i.test(resolvedStudentName)) {
                        if (evalObj.studentName && !/^student\s*\d+$/i.test(evalObj.studentName)) {
                            resolvedStudentName = evalObj.studentName;
                        } else if (meta.studentName && !/^student\s*\d+$/i.test(meta.studentName)) {
                            resolvedStudentName = meta.studentName;
                        }
                    }
                    if (!resolvedStudentName) resolvedStudentName = `Student ${i + 1}`;

                    // CBSE Safety Nets: Deterministic Binary MCQ Checks, Zero-Feedback Protocol, Stance Caps & Math Clamping
                    if (Array.isArray(evalObj.results)) {
                        let runningSum = 0;
                        const combinedSchemeText = (targetJ?.markingScheme || body.markingScheme || "").toLowerCase();

                        evalObj.results.forEach(resObj => {
                            const qNumStr = String(resObj.questionNumber || resObj.questionId || "").trim();
                            const qRawNumMatch = qNumStr.match(/(\d+)/);
                            const qRawNum = qRawNumMatch ? qRawNumMatch[1] : "";
                            const feedbackText = String(resObj.feedback || "").toLowerCase();

                            // 1. Dynamic MCQ Detection & Deterministic Option Evaluation
                            const isMCQ = Boolean(
                                resObj.studentOption || 
                                resObj.correctOption || 
                                ((Number(resObj.maxMarks) <= 1.0) && (/mcq|q[1-9]|section\s*a/i.test(qNumStr)))
                            );

                            if (isMCQ) {
                                let expectedMcqWeight = 1.0;
                                if (Number(resObj.maxMarks) === 0.5) {
                                    expectedMcqWeight = 0.5;
                                } else if (combinedSchemeText && qRawNum) {
                                    const explicitHalfMatch = combinedSchemeText.match(new RegExp(`(?:q\\.?|question\\s*)${qRawNum}[^\\n]*0\\.5\\s*(?:mark|m)?`, 'i'));
                                    if (explicitHalfMatch) expectedMcqWeight = 0.5;
                                }
                                resObj.maxMarks = expectedMcqWeight;

                                const studentOpt = resObj.studentOption ? String(resObj.studentOption).trim().toUpperCase() : null;
                                let correctOpt = resObj.correctOption ? String(resObj.correctOption).trim().toUpperCase() : null;

                                // Fallback extract correct option from marking scheme if not provided by model
                                if (!correctOpt && qRawNum && combinedSchemeText) {
                                    const schemeOptMatch = combinedSchemeText.match(new RegExp(`(?:q\\.?|question\\s*)${qRawNum}[^\\n\\[\\(]*[\\(\\[]([a-d])[\\)\\]]`, 'i'));
                                    if (schemeOptMatch) correctOpt = schemeOptMatch[1].toUpperCase();
                                }

                                const isExplicitlyWrong = feedbackText.includes("incorrect") || feedbackText.includes("wrong") || feedbackText.includes("0/1") || feedbackText.includes("0 mark");

                                if (correctOpt) {
                                    resObj.correctOption = correctOpt;
                                    if (studentOpt && studentOpt === correctOpt) {
                                        resObj.score = expectedMcqWeight;
                                        // Zero-Feedback Protocol: Full marks get zero feedback
                                        resObj.feedback = "";
                                        resObj.improvements = [];
                                    } else {
                                        resObj.score = 0;
                                        if (studentOpt) {
                                            resObj.feedback = `Option (${studentOpt}) selected; correct option is (${correctOpt}).`;
                                        } else if (feedbackText.includes("not attempted") || feedbackText.includes("unattempted")) {
                                            resObj.feedback = `The question was not attempted. Correct option is (${correctOpt}).`;
                                        } else {
                                            resObj.feedback = `Incorrect option chosen; correct option is (${correctOpt}).`;
                                        }
                                    }
                                } else {
                                    if (isExplicitlyWrong) {
                                        resObj.score = 0;
                                    } else if (Number(resObj.score) >= (expectedMcqWeight * 0.75)) {
                                        resObj.score = expectedMcqWeight;
                                        resObj.feedback = "";
                                        resObj.improvements = [];
                                    } else {
                                        resObj.score = 0;
                                    }
                                }
                            }

                            // 2. Unattempted Question Handling
                            const isUnattempted = feedbackText.includes("not attempted") || feedbackText.includes("unattempted") || feedbackText.includes("omitted");
                            if (isUnattempted && !isMCQ) {
                                resObj.score = 0;
                                resObj.feedback = "The question was not attempted.";
                                resObj.improvements = [];
                            }

                            // 3. Off-Topic Check (only for subjective questions <= 3 marks)
                            const isOffTopic = Number(resObj.maxMarks) <= 3 && !isMCQ && (
                                feedbackText.includes("off-topic") ||
                                feedbackText.includes("off topic") ||
                                feedbackText.includes("does not address") ||
                                feedbackText.includes("does not answer") ||
                                feedbackText.includes("unrelated") ||
                                feedbackText.includes("zero marks")
                            );
                            if (isOffTopic) {
                                resObj.score = 0;
                            }

                            // 4. Defend/Refute Stance Governance
                            const wrongStanceHeuristic = feedbackText.includes("defended instead of refut") ||
                                feedbackText.includes("refuted instead of defend") ||
                                feedbackText.includes("defended the statement instead of refuting") ||
                                feedbackText.includes("refuted the statement instead of defending") ||
                                feedbackText.includes("defend instead of refute") ||
                                feedbackText.includes("refute instead of defend") ||
                                feedbackText.includes("wrong stance") ||
                                feedbackText.includes("should have refuted") ||
                                feedbackText.includes("should have defended");

                            const isWrongStance = resObj.stanceCorrect === false || (resObj.stanceCorrect === null && wrongStanceHeuristic);
                            if (isWrongStance && Number(resObj.maxMarks) >= 3 && Number(resObj.score) > 1.0) {
                                resObj.score = 1.0;
                            }

                            // 5. Zero-Feedback Protocol for Full Marks
                            if (resObj.score >= resObj.maxMarks) {
                                resObj.feedback = "";
                                resObj.improvements = [];
                            }

                            // 6. Improvements array bounds
                            if (Array.isArray(resObj.improvements) && resObj.improvements.length > 2) {
                                resObj.improvements = resObj.improvements.slice(0, 2);
                            }

                            // 7. Programmatic Mathematical Clamping
                            const maxForQ = Number(resObj.maxMarks) || 1;
                            let s = Number(resObj.score);
                            if (!Number.isFinite(s) || s < 0) s = 0;
                            if (s > maxForQ) s = maxForQ;
                            resObj.score = Math.round(s * 10) / 10;
                            runningSum += resObj.score;
                        });
                        evalObj.totalScore = Math.round(runningSum * 10) / 10;
                    }

                    parsedResults.push({
                        studentName: resolvedStudentName,
                        result: evalObj,
                        usageMetadata: usageMetadata,
                        rawOutput: cleaned
                    });
                } catch (pErr) {
                    parsedResults.push({
                        studentName: meta.studentName || `Student ${i + 1}`,
                        error: "JSON parse failed: " + pErr.message,
                        usageMetadata: usageMetadata,
                        rawOutput: rawText
                    });
                }
            }

            // Mark job as SYNCED in server registry
            if (targetJ) {
                targetJ.status = 'SYNCED';
                targetJ.syncedCount = parsedResults.length;
                targetJ.syncedAt = new Date().toISOString();
                saveBatchJobsList(allSaved);
            }

            let totalPromptTokens = 0;
            let totalCandidatesTokens = 0;
            let totalCachedTokens = 0;
            let totalThinkingTokens = 0;

            parsedResults.forEach(p => {
                const u = p.usageMetadata || {};
                totalPromptTokens += Number(u.promptTokenCount) || 0;
                totalCandidatesTokens += Number(u.candidatesTokenCount) || 0;
                totalCachedTokens += Number(u.cachedContentTokenCount) || 0;
                totalThinkingTokens += Number(u.thoughtsTokenCount) || 0;
            });

            // Google Cloud Vertex AI List Pricing in INR (with 50% Batch Prediction Discount):
            // Text Input: ₹0.0001919775 / token
            // Text Output (includes thinking): ₹0.0009598875 / token
            // Cached Input: ₹0.000047994 / token
            const inputRate = 0.0001919775;
            const outputRate = 0.0009598875;
            const cachedRate = 0.000047994;

            const nonCachedPromptTokens = Math.max(0, totalPromptTokens - totalCachedTokens);
            const estCostInr = (nonCachedPromptTokens * inputRate) + (totalCachedTokens * cachedRate) + (totalCandidatesTokens * outputRate);

            console.log("📊 [VERTEX BATCH TOKEN & CACHE AUDIT]", {
                batchId: data.name,
                studentCount: parsedResults.length,
                totalPromptTokens,
                totalCandidatesTokens,
                totalThinkingTokens,
                totalCachedTokens,
                cacheStatus: totalCachedTokens > 0 ? "✅ CACHE HIT" : "ℹ️ STANDARD PREFIX",
                cacheRatio: totalPromptTokens > 0 ? `${((totalCachedTokens / totalPromptTokens) * 100).toFixed(1)}%` : "0%",
                estimatedBatchCostInr: `₹${estCostInr.toFixed(2)}`,
                costPerStudentInr: parsedResults.length > 0 ? `₹${(estCostInr / parsedResults.length).toFixed(2)}` : "₹0.00"
            });

            return res.status(200).json({
                success: true,
                batchId: data.name,
                parsedResults,
                usageSummary: {
                    totalPromptTokens,
                    totalCandidatesTokens,
                    totalThinkingTokens,
                    totalCachedTokens,
                    cacheHit: totalCachedTokens > 0,
                    estimatedCostInr: Math.round(estCostInr * 100) / 100,
                    costPerStudentInr: parsedResults.length > 0 ? Math.round((estCostInr / parsedResults.length) * 100) / 100 : 0
                }
            });
        } catch (err) {
            console.error("Batch sync error:", err);
            return res.status(500).json({ error: err.message });
        }
    }

    // ==========================================
    // ACTION: CREATE (Submit a new batch to Google)
    // ==========================================
    try {
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
        const isExplicitCache = Boolean(cachedContentId && (cachedContentId.startsWith('cachedContents/') || cachedContentId.includes('/cachedContents/')));

    const reasoningGuardrailPrompt = `
--- REASONING BUDGET GOVERNANCE & THINKING GUARDRAIL (CRITICAL) ---
- Formulate your evaluation directly against the marking scheme value points without discursive preamble.
- Do NOT rewrite or transcribe the student's entire answer inside your internal thinking trace.
- For MCQs: Simply identify the student's written option letter (A, B, C, D) and the key's option letter in a single step. Do NOT write paragraphs of theory or debate MCQs in thinking.
- For Subjective Questions: Check directly for the presence or absence of mandatory textbook value points. Deduct marks immediately for missing points without repetitive deliberation.
- Keep your internal thought trace crisp, concise, and decisive.
`;

    // Streamlined prompt: if an explicit cachedContent resource exists, reference it.
    // Otherwise, include full static prompt prefix to trigger Vertex AI automatic implicit caching!
    let promptBase = "";
    if (isExplicitCache) {
        promptBase = `Evaluate this student's handwritten answer sheet against the pre-loaded Exam Questions, Marking Scheme, Subject Directives, and Output Schema in your active cache (${cachedContentId}). Return STRICT JSON only.`;
    } else {
        const subjectDirectives = getSubjectDirectives(subject);
        promptBase = `You are evaluating student handwritten answer sheets against the official exam questions and marking scheme below.
${reasoningGuardrailPrompt}
CRITICAL BOARD CONSTRAINTS:
1. DETERMINISTIC MCQ EXTRACTION:
   - For Multiple Choice Questions, extract the student's written option letter ("A", "B", "C", "D") into "studentOption" and the marking scheme option letter into "correctOption".
   - If the option matches: award full maxMarks. If incorrect: award 0.
2. DEFEND / REFUTE QUESTIONS:
   - Record "stanceCorrect": true/false. If the student chose the incorrect stance, the score MUST be capped to a maximum of 1.0 mark.
3. TIERED FEEDBACK PROTOCOL (TOKEN-OPTIMIZED):
   - FULL MARKS (score === maxMarks, including correct MCQs): Set "feedback": "" (EMPTY STRING) and "improvements": []. Do NOT write praises, explanations, or quotes for answers that are already 100% correct.
   - PARTIALLY CORRECT (some marks lost): Provide 1 to 2 direct sentences explaining the exact gap or missed value point.
   - MAJOR MISTAKES / TOTALLY WRONG (≥75% marks lost or 0 marks): Provide 3 to 4 concise sentences explaining the error and the correct accounting/economic treatment. Keep it short and focused.
   - UNATTEMPTED QUESTIONS: Set "score": 0, "feedback": "The question was not attempted.", and "improvements": [].
   - PLAIN TEXT ONLY: No markdown formatting (**bold**, *italics*, # headers) inside JSON strings.
4. CANONICAL QUESTION NUMBERING & SUB-PARTS (CRITICAL):
   - Always use canonical numbering matching the official exam paper.
   - LEAF-LEVEL ONLY: If a question contains sub-parts (e.g. Q2 has (a) and (b)), evaluate ONLY at the leaf level ("Q2(a)", "Q2(b)"). NEVER output a composite parent entry like "Q2" when evaluating sub-parts!
   - 1-TIER SUB-PARTS: Always format with parentheses: "Q2(a)", "Q2(b)", "Q5(i)", "Q5(ii)". NEVER output unparenthesized strings like "Q2a" or "Q5i".
   - 2-TIER SUB-PARTS (SUBPART OF A SUBPART): If a sub-part has its own sub-parts, format every level with parentheses:
     * Letter + Roman: "Q17(a)(i)", "Q17(a)(ii)", "Q17(b)(i)", "Q17(b)(ii)"
     * Roman + Letter: "Q17(i)(a)", "Q17(i)(b)"
     * Letter + Number: "Q17(a)(1)", "Q17(a)(2)"
     * Never drop parentheses (e.g. NEVER write "Q17a(i)" or "Q17ai").
   - NEVER bundle multi-part questions into a single composite block.
5. ZERO LANGUAGE OR SPELLING PENALTY: In non-language subjects (Economics, Business Studies, Accountancy, Social Science), ZERO marks (0.0) shall be deducted for spelling errors or imperfect English phrasing as long as the core subject concept is conveyed.
6. VALUE POINTS OVER RIGID WORDING: The marking scheme provides suggested value points. If a student conveys the core concept using valid alternative subject expression, award full due credit.
${subjectDirectives}

--- EXAM QUESTIONS ---
${questions || ""}

--- OFFICIAL MARKING SCHEME ---
${markingScheme || ""}
${otherInstructions ? `\n--- TEACHER OVERRIDE INSTRUCTIONS ---\n${otherInstructions}\n` : ""}

Return STRICT JSON:
{
  "studentName": "<exact student name from prompt>",
  "results": [
    {
      "questionNumber": "Q1",
      "maxMarks": <number - immutable question weight>,
      "score": <number - awarded marks, 0 to maxMarks>,
      "studentOption": "<uppercase letter A/B/C/D if MCQ, else null>",
      "correctOption": "<uppercase letter A/B/C/D from marking scheme if MCQ, else null>",
      "stanceCorrect": "<boolean true/false if Defend/Refute question, else null>",
      "feedback": "<EMPTY STRING \"\" IF FULL MARKS; 1-2 sentences if partial; 3-4 sentences if major error; \"The question was not attempted.\" if skipped>",
      "improvements": ["<1-2 short actionable tips IF marks lost, else []>"]
    }
  ],
  "totalScore": <number - sum of scores>,
  "totalMaxMarks": ${maxMarks},
  "overallFeedback": "<concise 2-3 sentence executive performance summary>"
}`;
    }

    // Package each student into an inline GenerateContentRequest
    const inlinedRequests = students.map((st, idx) => {
        const studentName = st.studentName || `Student ${idx + 1}`;
        const candidateSuffix = `\n\n--- EVALUATION TARGET ---\nSTUDENT NAME / CANDIDATE IDENTIFIER: ${studentName}\n(MANDATORY: You MUST set the output JSON field "studentName" to "${studentName}")\nEvaluate the student's handwritten answer sheet pages below against the master criteria above.`;
        // Static promptBase MUST come FIRST at Token 0 to trigger Google Cloud Vertex AI implicit prefix KV-caching across all students!
        // Static promptBase is placed as an isolated first part at Token 0 to trigger Google Cloud Vertex AI implicit prefix KV-caching across all students!
        const parts = [{ text: promptBase }, { text: candidateSuffix }];

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
            seed: 42,
            mediaResolution: "MEDIA_RESOLUTION_MEDIUM"
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

        if (isExplicitCache) {
            reqItem.cachedContent = cachedContentId;
        }

        return reqItem;
    });

    const cleanExam = examName ? examName.replace(/[^a-zA-Z0-9_-]/g, "_") : "Exam";
    const cleanSubj = subject ? subject.replace(/[^a-zA-Z0-9_-]/g, "_") : "General";
    const displayName = `NerdTutors_${cleanSubj}_${cleanExam}_${Date.now()}`;
    const cleanModel = (model || "gemini-4-argon").replace(/^publishers\/google\/models\//, '').replace(/^models\//, '');
    const cleanSession = (sessionId || 'exam').replace(/[^a-zA-Z0-9_-]/g, '_');
    const gcsBucket = process.env.GCP_STORAGE_BUCKET || `${projectId}-batch-evals`;
    const inputFileName = `inputs/${cleanSession}_${Date.now()}.jsonl`;
    const jsonlData = inlinedRequests.map(req => JSON.stringify({ request: req })).join('\n') + '\n';

    console.log("📊 [BATCH INPUT PAYLOAD AUDIT]", {
        isExplicitCache,
        cachedContentId,
        questionsChars: (questions || "").length,
        questionsEstTokens: Math.round((questions || "").length / 4),
        markingSchemeChars: (markingScheme || "").length,
        markingSchemeEstTokens: Math.round((markingScheme || "").length / 4),
        totalPromptBaseChars: promptBase.length,
        totalPromptBaseEstTokens: Math.round(promptBase.length / 4),
        studentsCount: students.length,
        pagesPerStudent: students.map(s => s.pages?.length || 0)
    });

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
        const shortBatchId = (data.name || '').split('/').pop();

        const newJob = {
            id: shortBatchId,
            batchId: data.name,
            sessionId: sessionId || null,
            sessionName: examName || 'Exam Assessment',
            subject: subject || 'General',
            class: body.class || 'Class 12th',
            studentCount: students.length,
            studentsMetadata: students.map((s, idx) => ({ 
                studentName: s.studentName || `Student ${idx + 1}`, 
                pageCount: Array.isArray(s.pages) ? s.pages.length : 1 
            })),
            maxMarks: Number(maxMarks) || 40,
            markingScheme: markingScheme || "",
            status: data.state || "JOB_STATE_PENDING",
            gcsInputUri: gcsInputUri,
            gcsOutputDirectory: outputPrefix,
            createdAt: data.createTime || new Date().toISOString()
        };
        const allJobs = loadSavedBatchJobs();
        allJobs.unshift(newJob);
        saveBatchJobsList(allJobs);

        // Upload manifest to GCS for permanent multi-device sync
        try {
            await uploadToGcs(gcsBucket, `manifests/${shortBatchId}.json`, JSON.stringify(newJob, null, 2), "application/json");
            console.log(`✅ Uploaded batch job manifest to GCS: manifests/${shortBatchId}.json`);
        } catch (mErr) {
            console.warn("Notice: Manifest GCS upload:", mErr.message);
        }

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
