// ============================================
// BUNDLE EVALUATOR MODULE
// Allows teachers to queue multiple student papers,
// schedule bulk evaluations, or manually trigger
// batch grading using Gemini Context Caching (75% savings).
// ============================================

import { db } from '../../firebase-config.js';
import {
    collection,
    getDocs,
    doc,
    getDoc,
    updateDoc,
    addDoc,
    serverTimestamp,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { showToast, escapeHtml } from './admin-utils.js';

let bundleSessionsList = [];
let selectedBundleSession = null;
let queuedBundlePapers = []; // Array of { id, studentName, files: [{ data, mimeType, name }], status, result }
let isEvaluatingBundle = false;
let bundleScheduleTimer = null;
let scheduledTimeStr = null;

export function setupBundleEvaluator() {
    const sessionSelect = document.getElementById('bundleSessionSelect');
    const fileInput = document.getElementById('bundleFileInput');
    const uploadArea = document.getElementById('bundleDropZone');
    const btnEvaluateNow = document.getElementById('btnEvaluateBundleNow');
    const btnClearBundle = document.getElementById('btnClearBundle');
    const scheduleToggle = document.getElementById('bundleScheduleToggle');
    const scheduleTimeInput = document.getElementById('bundleScheduleTime');
    const btnSetSchedule = document.getElementById('btnSetBundleSchedule');
    const btnCancelSchedule = document.getElementById('btnCancelBundleSchedule');

    // 1. Load Sessions into Dropdown
    loadBundleSessions();

    sessionSelect?.addEventListener('change', (e) => {
        const sessionId = e.target.value;
        selectedBundleSession = bundleSessionsList.find(s => s.id === sessionId) || null;
        renderSessionCacheStatus();
    });

    // 2. Drag & Drop and File Input
    uploadArea?.addEventListener('click', () => fileInput?.click());
    uploadArea?.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#4f46e5';
        uploadArea.style.backgroundColor = '#f5f3ff';
    });
    uploadArea?.addEventListener('dragleave', () => {
        uploadArea.style.borderColor = '#cbd5e1';
        uploadArea.style.backgroundColor = '#ffffff';
    });
    uploadArea?.addEventListener('drop', async (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#cbd5e1';
        uploadArea.style.backgroundColor = '#ffffff';
        if (e.dataTransfer.files?.length) {
            await handleIncomingFiles(Array.from(e.dataTransfer.files));
        }
    });

    fileInput?.addEventListener('change', async (e) => {
        if (e.target.files?.length) {
            await handleIncomingFiles(Array.from(e.target.files));
            fileInput.value = '';
        }
    });

    // 3. Clear Queue
    btnClearBundle?.addEventListener('click', () => {
        if (isEvaluatingBundle) return;
        queuedBundlePapers = [];
        renderBundleQueue();
        showToast("Bundle queue cleared.", "info");
    });

    // 4. Manual Evaluate Now Trigger
    btnEvaluateNow?.addEventListener('click', () => {
        startBundleEvaluation();
    });

    // 5. Scheduling
    scheduleToggle?.addEventListener('change', (e) => {
        const scheduleControls = document.getElementById('bundleScheduleControls');
        if (scheduleControls) {
            scheduleControls.style.display = e.target.checked ? 'flex' : 'none';
        }
    });

    btnSetSchedule?.addEventListener('click', () => {
        const timeVal = scheduleTimeInput?.value;
        if (!timeVal) {
            showToast("Please pick a scheduled time first", "warning");
            return;
        }
        setupSchedule(timeVal);
    });

    btnCancelSchedule?.addEventListener('click', () => {
        cancelSchedule();
    });
}

export async function loadBundleSessions() {
    const sessionSelect = document.getElementById('bundleSessionSelect');
    if (!sessionSelect) return;

    try {
        const q = query(collection(db, 'testSessions'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        bundleSessionsList = [];

        sessionSelect.innerHTML = '<option value="">-- Select Test Session for Bundle --</option>';
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const sessionObj = { id: docSnap.id, ...data };
            bundleSessionsList.push(sessionObj);

            const opt = document.createElement('option');
            opt.value = sessionObj.id;
            opt.textContent = `${data.name || 'Untitled'} (${data.class || ''} - ${data.subject || ''}) [Max: ${data.maxMarks || 0}]`;
            sessionSelect.appendChild(opt);
        });

        if (bundleSessionsList.length > 0) {
            sessionSelect.value = bundleSessionsList[0].id;
            selectedBundleSession = bundleSessionsList[0];
            renderSessionCacheStatus();
        }
    } catch (err) {
        console.error("Failed to load sessions for bundle evaluator:", err);
    }
}

function renderSessionCacheStatus() {
    const cacheStatusWrap = document.getElementById('bundleCacheStatusWrap');
    if (!cacheStatusWrap) return;

    if (!selectedBundleSession) {
        cacheStatusWrap.innerHTML = '';
        return;
    }

    const hasCache = Boolean(selectedBundleSession.cachedContentId);
    cacheStatusWrap.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; background: ${hasCache ? '#f0fdf4' : '#fffbeb'}; border: 1.5px solid ${hasCache ? '#bbf7d0' : '#fde68a'}; border-radius: 10px; padding: 0.75rem 1.25rem; margin-top: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.65rem;">
                <span style="font-size: 1.3rem;">${hasCache ? '⚡' : '⚠️'}</span>
                <div>
                    <div style="font-weight: 700; color: ${hasCache ? '#166534' : '#92400e'}; font-size: 0.95rem;">
                        ${hasCache ? 'Context Cache Active (75% Token Discount Guaranteed)' : 'Context Cache Not Yet Provisioned'}
                    </div>
                    <div style="font-size: 0.8rem; color: #64748b;">
                        Subject: <strong>${escapeHtml(selectedBundleSession.subject || 'General')}</strong> · Max Marks: <strong>${selectedBundleSession.maxMarks || 0}</strong>
                    </div>
                </div>
            </div>
            <div>
                ${hasCache ? `
                    <span style="background: #dcfce7; color: #166534; font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 999px;">
                        READY FOR BATCH RUN
                    </span>
                ` : `
                    <button type="button" onclick="window.cacheTestSession('${selectedBundleSession.id}')" style="background: #f59e0b; color: white; border: none; padding: 0.4rem 0.85rem; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
                        ⚡ Build Cache (75% Off)
                    </button>
                `}
            </div>
        </div>
    `;
}

// Convert files and add to bundle queue
async function handleIncomingFiles(fileList) {
    if (fileList.length === 0) return;

    const validFiles = fileList.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (validFiles.length === 0) {
        showToast("Please upload images (JPEG/PNG) or PDF student papers", "warning");
        return;
    }

    showToast(`Adding ${validFiles.length} file(s) to bundle queue...`, "info");

    for (const file of validFiles) {
        try {
            const base64Data = await readFileAsBase64(file);
            // Suggest student name from filename (e.g. "Rohit_Sharma_Q1.jpg" -> "Rohit Sharma")
            const cleanName = file.name
                .replace(/\.[^/.]+$/, "")
                .replace(/[_-]+/g, " ")
                .replace(/\b(sheet|paper|scan|page|answer|class|10th|12th)\b/gi, "")
                .trim() || `Student ${queuedBundlePapers.length + 1}`;

            queuedBundlePapers.push({
                id: 'paper_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                studentName: cleanName,
                fileName: file.name,
                mimeType: file.type,
                base64: base64Data,
                status: 'ready', // 'ready', 'evaluating', 'completed', 'error'
                result: null,
                errorMessage: null
            });
        } catch (e) {
            console.error("Error reading file for bundle:", file.name, e);
        }
    }

    renderBundleQueue();
    showToast(`Bundle updated: ${queuedBundlePapers.length} paper(s) in queue.`, "success");
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const res = reader.result;
            const b64 = typeof res === 'string' ? res.split(',')[1] : '';
            resolve(b64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function renderBundleQueue() {
    const queueTbody = document.getElementById('bundleQueueTbody');
    const queueCard = document.getElementById('bundleQueueCard');
    const queueCountBadge = document.getElementById('bundleQueueCountBadge');
    const btnEvaluateNow = document.getElementById('btnEvaluateBundleNow');

    if (!queueTbody) return;

    if (queuedBundlePapers.length === 0) {
        if (queueCard) queueCard.style.display = 'none';
        if (btnEvaluateNow) btnEvaluateNow.disabled = true;
        return;
    }

    if (queueCard) queueCard.style.display = 'block';
    if (btnEvaluateNow) {
        btnEvaluateNow.disabled = isEvaluatingBundle;
        btnEvaluateNow.innerHTML = `🚀 Evaluate Bundle Now (${queuedBundlePapers.length} Papers)`;
    }
    if (queueCountBadge) queueCountBadge.textContent = `${queuedBundlePapers.length} Papers`;

    let html = '';
    queuedBundlePapers.forEach((paper, idx) => {
        let statusBadge = `<span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700;">READY</span>`;
        if (paper.status === 'evaluating') {
            statusBadge = `<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700;">⚙️ GRADING...</span>`;
        } else if (paper.status === 'completed') {
            statusBadge = `<span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700;">✓ DONE (${paper.result?.totalScore}/${paper.result?.maxMarks})</span>`;
        } else if (paper.status === 'error') {
            statusBadge = `<span style="background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700;">❌ FAILED</span>`;
        }

        html += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 0.75rem 1rem; color: #64748b; font-size: 0.85rem;">#${idx + 1}</td>
                <td style="padding: 0.75rem 1rem;">
                    <input type="text" value="${escapeHtml(paper.studentName)}" 
                        onchange="window.updateBundleStudentName('${paper.id}', this.value)"
                        style="padding: 0.35rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.9rem; font-weight: 600; width: 100%; max-width: 220px;" 
                        ${paper.status === 'completed' || isEvaluatingBundle ? 'disabled' : ''}/>
                </td>
                <td style="padding: 0.75rem 1rem; font-size: 0.82rem; color: #475569;">
                    📄 ${escapeHtml(paper.fileName)}
                </td>
                <td style="padding: 0.75rem 1rem;">${statusBadge}</td>
                <td style="padding: 0.75rem 1rem; text-align: right;">
                    ${paper.status === 'ready' && !isEvaluatingBundle ? `
                        <button type="button" onclick="window.removeBundlePaper('${paper.id}')" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.9rem;" title="Remove paper">🗑️</button>
                    ` : (paper.status === 'completed' ? `
                        <a href="ocr-scan.html?resultId=${paper.resultId || ''}" target="_blank" style="color: #4f46e5; font-size: 0.8rem; font-weight: 600; text-decoration: none;">View ↗</a>
                    ` : '')}
                </td>
            </tr>
        `;
    });

    queueTbody.innerHTML = html;
}

window.updateBundleStudentName = function(paperId, newName) {
    const item = queuedBundlePapers.find(p => p.id === paperId);
    if (item && newName.trim()) {
        item.studentName = newName.trim();
    }
};

window.removeBundlePaper = function(paperId) {
    if (isEvaluatingBundle) return;
    queuedBundlePapers = queuedBundlePapers.filter(p => p.id !== paperId);
    renderBundleQueue();
};

// ==================== BUNDLE EVALUATION RUNNER ====================
async function startBundleEvaluation() {
    if (isEvaluatingBundle) return;
    if (!selectedBundleSession) {
        showToast("Please select a Test Session first.", "warning");
        return;
    }
    const pendingPapers = queuedBundlePapers.filter(p => p.status === 'ready' || p.status === 'error');
    if (pendingPapers.length === 0) {
        showToast("No pending papers to evaluate.", "info");
        return;
    }

    isEvaluatingBundle = true;
    renderBundleQueue();

    const progressCard = document.getElementById('bundleProgressCard');
    const progressBar = document.getElementById('bundleProgressBar');
    const progressStatus = document.getElementById('bundleProgressStatus');
    const progressCount = document.getElementById('bundleProgressCount');

    if (progressCard) progressCard.style.display = 'block';

    const gateToken = localStorage.getItem('gate_token') || '';
    let completedCount = 0;
    const totalToProcess = pendingPapers.length;

    // Auto-create context cache if missing before starting bulk execution
    let activeCacheId = selectedBundleSession.cachedContentId || null;
    if (!activeCacheId && selectedBundleSession.questions && selectedBundleSession.markingScheme) {
        try {
            if (progressStatus) progressStatus.textContent = "⚡ Building shared Gemini Context Cache for bundle (75% savings)...";
            const cacheRes = await fetch('/api/create-cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Gate-Token': gateToken },
                body: JSON.stringify({
                    sessionId: selectedBundleSession.id,
                    examName: selectedBundleSession.name,
                    subject: selectedBundleSession.subject,
                    questions: selectedBundleSession.questions,
                    markingScheme: selectedBundleSession.markingScheme,
                    model: 'gemini-4-argon',
                    ttlHours: 72
                })
            });
            const rawText = await cacheRes.text();
            let cacheData = {};
            try { cacheData = JSON.parse(rawText); } catch (_) {}
            if (cacheData && cacheData.cachedContentId) {
                activeCacheId = cacheData.cachedContentId;
                selectedBundleSession.cachedContentId = activeCacheId;
                await updateDoc(doc(db, 'testSessions', selectedBundleSession.id), {
                    cachedContentId: activeCacheId,
                    cacheExpiresAt: cacheData.expireTime || null
                });
                renderSessionCacheStatus();
                console.log("⚡ Context cache created for bundle run:", activeCacheId);
            }
        } catch (cErr) {
            console.warn("Bundle cache creation notice:", cErr.message);
        }
    }

    // Process each paper sequentially
    for (let i = 0; i < pendingPapers.length; i++) {
        const paper = pendingPapers[i];
        paper.status = 'evaluating';
        renderBundleQueue();

        if (progressStatus) progressStatus.textContent = `Grading paper ${i + 1} of ${totalToProcess}: ${paper.studentName}...`;
        if (progressCount) progressCount.textContent = `${i + 1} / ${totalToProcess}`;
        if (progressBar) progressBar.style.width = `${Math.round(((i) / totalToProcess) * 100)}%`;

        try {
            const payload = {
                mode: 'session-evaluate',
                model: 'gemini-4-argon',
                thinkingLevel: 'low',
                questions: selectedBundleSession.questions,
                markingScheme: selectedBundleSession.markingScheme,
                maxMarks: selectedBundleSession.maxMarks,
                images: [{ data: paper.base64, mimeType: paper.mimeType }],
                subject: selectedBundleSession.subject,
                otherInstructions: selectedBundleSession.otherInstructions || "",
                cachedContentId: activeCacheId
            };

            const evalRes = await fetch('/api/ocr-evaluate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Gate-Token': gateToken
                },
                body: JSON.stringify(payload)
            });

            const evalData = await evalRes.json();
            if (!evalRes.ok) {
                throw new Error(evalData.error || "Grading error");
            }

            // Save to Firestore
            const lockedMax = Number(selectedBundleSession.maxMarks) || 40;
            const clampedScore = Math.min(Math.max(0, Number(evalData.totalScore) || 0), lockedMax);

            const docRef = await addDoc(collection(db, 'testResults'), {
                studentName: paper.studentName,
                studentId: null,
                batch: selectedBundleSession.targetGroup || 'Both',
                class: selectedBundleSession.class || 'Class 12th',
                subject: selectedBundleSession.subject || 'Economics',
                sessionId: selectedBundleSession.id,
                sessionName: selectedBundleSession.name || 'Bundle Exam',
                score: clampedScore,
                maxMarks: lockedMax,
                overallFeedback: evalData.overallFeedback || '',
                improvements: evalData.improvements || [],
                breakdown: evalData.results || [],
                modelUsed: evalData.modelUsed || 'gemini-4-argon',
                tokenUsage: evalData.tokenUsage || null,
                isBundleEvaluated: true,
                createdAt: serverTimestamp()
            });

            paper.status = 'completed';
            paper.result = evalData;
            paper.resultId = docRef.id;
            completedCount++;

        } catch (evalErr) {
            console.error(`Error evaluating paper for ${paper.studentName}:`, evalErr);
            paper.status = 'error';
            paper.errorMessage = evalErr.message;
        }

        renderBundleQueue();
        if (progressBar) progressBar.style.width = `${Math.round(((i + 1) / totalToProcess) * 100)}%`;
    }

    isEvaluatingBundle = false;
    if (progressBar) progressBar.style.width = '100%';
    if (progressStatus) progressStatus.textContent = `🎉 Bundle evaluation completed! ${completedCount} of ${totalToProcess} papers successfully graded.`;

    renderBundleQueue();
    showToast(`Bundle grading finished! ${completedCount} papers evaluated.`, 'success');
}

// ==================== SCHEDULING LOGIC ====================
function setupSchedule(timeString) {
    cancelSchedule(); // clear existing if any

    const [targetHours, targetMinutes] = timeString.split(':').map(Number);
    const now = new Date();
    const target = new Date();
    target.setHours(targetHours, targetMinutes, 0, 0);

    // If target time has already passed today, schedule for tomorrow
    if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
    }

    const msUntilTarget = target.getTime() - now.getTime();
    scheduledTimeStr = target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const statusBadge = document.getElementById('bundleScheduleCountdown');
    if (statusBadge) {
        statusBadge.style.display = 'inline-block';
        statusBadge.textContent = `⏰ Scheduled for ${scheduledTimeStr} (waiting...)`;
    }

    bundleScheduleTimer = setTimeout(() => {
        showToast(`⏰ Scheduled time reached! Starting bundle evaluation...`, 'info');
        startBundleEvaluation();
        cancelSchedule();
    }, msUntilTarget);

    showToast(`Bundle evaluation scheduled for ${scheduledTimeStr}!`, 'success');
}

function cancelSchedule() {
    if (bundleScheduleTimer) {
        clearTimeout(bundleScheduleTimer);
        bundleScheduleTimer = null;
    }
    scheduledTimeStr = null;
    const statusBadge = document.getElementById('bundleScheduleCountdown');
    if (statusBadge) {
        statusBadge.style.display = 'none';
        statusBadge.textContent = '';
    }
}
