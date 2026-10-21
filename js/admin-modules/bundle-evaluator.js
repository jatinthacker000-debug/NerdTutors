// ============================================
// BUNDLE EVALUATOR MODULE (STUDENT SEGMENTED)
// Allows teachers to create student segments, attach
// multiple pages per student, and evaluate in sequential
// batches with Gemini Context Caching (75% savings).
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
let queuedBundleStudents = []; // Array of { id, studentName, pages: [{ id, fileName, mimeType, base64, preview }], status, result, resultId, errorMessage }
let isEvaluatingBundle = false;
let bundleScheduleTimer = null;
let scheduledTimeStr = null;

export function setupBundleEvaluator() {
    const sessionSelect = document.getElementById('bundleSessionSelect');
    const fileInput = document.getElementById('bundleFileInput');
    const btnQuickDrop = document.getElementById('btnQuickDropTrigger');
    const emptyDropZone = document.getElementById('bundleEmptyDropZone');
    const btnAddSegment = document.getElementById('btnAddStudentSegment');
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

    // 2. Add Student Segment button
    btnAddSegment?.addEventListener('click', () => {
        if (isEvaluatingBundle) return;
        addStudentSegment();
    });

    // 3. Quick drop / upload triggers
    btnQuickDrop?.addEventListener('click', () => fileInput?.click());
    emptyDropZone?.addEventListener('click', () => {
        if (queuedBundleStudents.length === 0) {
            addStudentSegment();
        } else {
            fileInput?.click();
        }
    });

    // Drag and drop on empty dropzone
    emptyDropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        emptyDropZone.style.borderColor = '#4f46e5';
        emptyDropZone.style.backgroundColor = '#f5f3ff';
    });
    emptyDropZone?.addEventListener('dragleave', () => {
        emptyDropZone.style.borderColor = '#cbd5e1';
        emptyDropZone.style.backgroundColor = '#fafafa';
    });
    emptyDropZone?.addEventListener('drop', async (e) => {
        e.preventDefault();
        emptyDropZone.style.borderColor = '#cbd5e1';
        emptyDropZone.style.backgroundColor = '#fafafa';
        if (e.dataTransfer.files?.length) {
            await handleBulkFilesIngest(Array.from(e.dataTransfer.files));
        }
    });

    fileInput?.addEventListener('change', async (e) => {
        if (e.target.files?.length) {
            await handleBulkFilesIngest(Array.from(e.target.files));
            fileInput.value = '';
        }
    });

    // 4. Clear All Students
    btnClearBundle?.addEventListener('click', () => {
        if (isEvaluatingBundle) return;
        queuedBundleStudents = [];
        renderBundleQueue();
        showToast("All student segments cleared.", "info");
    });

    // 5. Evaluate Bundle Now Trigger
    btnEvaluateNow?.addEventListener('click', () => {
        startBundleEvaluation();
    });

    // 6. Scheduling
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
        showToast("Scheduled bundle evaluation cancelled.", "info");
    });

    // Global window handlers for student card interactions
    window.addBundleStudentSegment = () => addStudentSegment();
    window.removeBundleStudent = (studentId) => removeStudent(studentId);
    window.updateBundleStudentName = (studentId, name) => updateStudentName(studentId, name);
    window.handleStudentPagesUpload = (studentId, files) => handleStudentPages(studentId, Array.from(files));
    window.removePageFromStudent = (studentId, pageId) => removePage(studentId, pageId);
}

export async function loadBundleSessions() {
    const sessionSelect = document.getElementById('bundleSessionSelect');
    if (!sessionSelect) return;

    try {
        const q = query(collection(db, 'testSessions'), orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);

        bundleSessionsList = [];
        sessionSelect.innerHTML = '<option value="">-- Choose an Exam Session --</option>';

        snap.forEach(d => {
            const data = d.data();
            const sObj = { id: d.id, ...data };
            bundleSessionsList.push(sObj);

            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = `${data.name || 'Untitled Exam'} (${data.subject || 'General'} · Max: ${data.maxMarks || 0}M)`;
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

// ==================== STUDENT SEGMENT ACTIONS ====================

function addStudentSegment(name = '') {
    const newStudent = {
        id: 'std_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        studentName: name.trim() || `Student ${queuedBundleStudents.length + 1}`,
        pages: [],
        status: 'ready',
        result: null,
        resultId: null,
        errorMessage: null
    };

    queuedBundleStudents.push(newStudent);
    renderBundleQueue();
    showToast(`Added segment for ${newStudent.studentName}`, "info");

    // Focus input
    setTimeout(() => {
        const inp = document.getElementById(`name_${newStudent.id}`);
        if (inp) inp.focus();
    }, 50);
}

function removeStudent(studentId) {
    if (isEvaluatingBundle) return;
    queuedBundleStudents = queuedBundleStudents.filter(s => s.id !== studentId);
    renderBundleQueue();
}

function updateStudentName(studentId, newName) {
    const std = queuedBundleStudents.find(s => s.id === studentId);
    if (std && newName.trim()) {
        std.studentName = newName.trim();
    }
}

async function handleStudentPages(studentId, fileList) {
    const std = queuedBundleStudents.find(s => s.id === studentId);
    if (!std || fileList.length === 0) return;

    const validFiles = fileList.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (validFiles.length === 0) {
        showToast("Please upload images (JPEG/PNG) or PDFs", "warning");
        return;
    }

    showToast(`Adding ${validFiles.length} page(s) to ${std.studentName}...`, "info");

    for (const f of validFiles) {
        try {
            const b64 = await readFileAsBase64(f);
            const preview = f.type.startsWith('image/') ? `data:${f.type};base64,${b64}` : null;
            std.pages.push({
                id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                fileName: f.name,
                mimeType: f.type,
                base64: b64,
                preview: preview
            });
        } catch (err) {
            console.error("Error reading student page file:", f.name, err);
        }
    }

    renderBundleQueue();
    showToast(`${std.studentName} now has ${std.pages.length} page(s).`, "success");
}

function removePage(studentId, pageId) {
    if (isEvaluatingBundle) return;
    const std = queuedBundleStudents.find(s => s.id === studentId);
    if (std) {
        std.pages = std.pages.filter(p => p.id !== pageId);
        renderBundleQueue();
    }
}

// Ingest multiple files dropped all at once
async function handleBulkFilesIngest(fileList) {
    if (fileList.length === 0) return;

    const validFiles = fileList.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (validFiles.length === 0) {
        showToast("Please upload images (JPEG/PNG) or PDF papers", "warning");
        return;
    }

    showToast(`Processing ${validFiles.length} file(s)...`, "info");

    // Group files by student prefix (e.g. "Rohit_Sharma_Page1.jpg" and "Rohit_Sharma_Page2.jpg" -> Rohit Sharma)
    const groups = {};

    for (const file of validFiles) {
        // Strip page identifiers like _1, _page2, _p1
        const cleanName = file.name
            .replace(/\.[^/.]+$/, "")
            .replace(/[-_]?(page|p|scan|sheet)?[-_\s]*\d+$/i, "")
            .replace(/[_-]+/g, " ")
            .replace(/\b(sheet|paper|scan|page|answer|class|10th|12th)\b/gi, "")
            .trim() || `Student ${queuedBundleStudents.length + 1}`;

        if (!groups[cleanName]) groups[cleanName] = [];
        groups[cleanName].push(file);
    }

    for (const [studentName, files] of Object.entries(groups)) {
        let std = queuedBundleStudents.find(s => s.studentName.toLowerCase() === studentName.toLowerCase() && s.status === 'ready');
        if (!std) {
            std = {
                id: 'std_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                studentName: studentName,
                pages: [],
                status: 'ready',
                result: null,
                resultId: null,
                errorMessage: null
            };
            queuedBundleStudents.push(std);
        }

        for (const f of files) {
            try {
                const b64 = await readFileAsBase64(f);
                const preview = f.type.startsWith('image/') ? `data:${f.type};base64,${b64}` : null;
                std.pages.push({
                    id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    fileName: f.name,
                    mimeType: f.type,
                    base64: b64,
                    preview: preview
                });
            } catch (err) {
                console.error("Error reading bulk file:", f.name, err);
            }
        }
    }

    renderBundleQueue();
    showToast(`Bundle queue updated: ${queuedBundleStudents.length} student segment(s) ready.`, "success");
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

// ==================== RENDER QUEUE UI ====================

function renderBundleQueue() {
    const container = document.getElementById('bundleStudentsContainer');
    const emptyDropZone = document.getElementById('bundleEmptyDropZone');
    const queueCard = document.getElementById('bundleQueueCard');
    const queueCountBadge = document.getElementById('bundleQueueCountBadge');
    const btnEvaluateNow = document.getElementById('btnEvaluateBundleNow');

    if (!container) return;

    const totalStudents = queuedBundleStudents.length;
    const totalPages = queuedBundleStudents.reduce((sum, s) => sum + s.pages.length, 0);

    if (totalStudents === 0) {
        if (emptyDropZone) emptyDropZone.style.display = 'block';
        if (container) {
            container.style.display = 'none';
            container.innerHTML = '';
        }
        if (queueCard) queueCard.style.display = 'none';
        if (btnEvaluateNow) btnEvaluateNow.disabled = true;
        return;
    }

    if (emptyDropZone) emptyDropZone.style.display = 'none';
    if (container) container.style.display = 'flex';
    if (queueCard) queueCard.style.display = 'block';

    if (btnEvaluateNow) {
        btnEvaluateNow.disabled = isEvaluatingBundle || totalPages === 0;
        btnEvaluateNow.innerHTML = `🚀 Evaluate Bundle Now (${totalStudents} Students · ${totalPages} Pages)`;
    }
    if (queueCountBadge) {
        queueCountBadge.textContent = `${totalStudents} Students (${totalPages} Pages)`;
    }

    let html = '';
    queuedBundleStudents.forEach((student, idx) => {
        let statusBadge = `<span style="background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">READY</span>`;
        let borderColor = '#e2e8f0';

        if (student.status === 'evaluating') {
            statusBadge = `<span style="background: #fef3c7; color: #92400e; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">⚙️ GRADING...</span>`;
            borderColor = '#f59e0b';
        } else if (student.status === 'completed') {
            statusBadge = `<span style="background: #dcfce7; color: #166534; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">✓ DONE (${student.result?.totalScore || 0}/${student.result?.maxMarks || 0})</span>`;
            borderColor = '#22c55e';
        } else if (student.status === 'error') {
            statusBadge = `<span style="background: #fee2e2; color: #991b1b; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">❌ FAILED</span>`;
            borderColor = '#ef4444';
        }

        html += `
            <div class="bundle-student-card" style="background: #ffffff; border: 1.5px solid ${borderColor}; border-radius: 12px; padding: 1.25rem 1.5rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                <!-- Header: Name, Page Count, Status, Action -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem;">
                    <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 260px;">
                        <span style="font-size: 1.35rem;">🧑</span>
                        <input type="text" id="name_${student.id}" value="${escapeHtml(student.studentName)}" 
                            placeholder="Student Name (e.g. Saurabh)" 
                            onchange="window.updateBundleStudentName('${student.id}', this.value)"
                            style="padding: 0.45rem 0.75rem; border: 1.5px solid #cbd5e1; border-radius: 8px; font-weight: 700; font-size: 0.95rem; width: 100%; max-width: 280px;"
                            ${isEvaluatingBundle || student.status === 'completed' ? 'disabled' : ''}>
                        <span style="font-size: 0.8rem; font-weight: 700; color: #64748b; background: #f1f5f9; padding: 4px 10px; border-radius: 999px;">
                            ${student.pages.length} Page(s)
                        </span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        ${statusBadge}
                        ${student.status === 'completed' && student.resultId ? `
                            <a href="ocr-scan.html?resultId=${student.resultId}" target="_blank" style="background: #e0f2fe; color: #0284c7; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.8rem; text-decoration: none;">View Report ↗</a>
                        ` : ''}
                        ${!isEvaluatingBundle && student.status !== 'completed' ? `
                            <button type="button" onclick="window.removeBundleStudent('${student.id}')" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 1.15rem; padding: 4px;" title="Remove this student">🗑️</button>
                        ` : ''}
                    </div>
                </div>

                <!-- Page Thumbnails Gallery -->
                <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center;">
                    ${student.pages.map((page, pIdx) => `
                        <div style="position: relative; width: 85px; height: 110px; border: 1.5px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                            ${page.preview ? `
                                <img src="${page.preview}" style="width: 100%; height: 100%; object-fit: cover;">
                            ` : `
                                <span style="font-size: 1.8rem;">📄</span>
                            `}
                            <span style="position: absolute; bottom: 2px; left: 2px; right: 2px; background: rgba(15, 23, 42, 0.8); color: white; font-size: 0.65rem; font-weight: 700; text-align: center; border-radius: 4px; padding: 1px 0;">
                                Page ${pIdx + 1}
                            </span>
                            ${!isEvaluatingBundle && student.status !== 'completed' ? `
                                <button type="button" onclick="window.removePageFromStudent('${student.id}', '${page.id}')" style="position: absolute; top: 3px; right: 3px; background: #ef4444; color: white; border: none; border-radius: 50%; width: 18px; height: 18px; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1;" title="Remove page">×</button>
                            ` : ''}
                        </div>
                    `).join('')}

                    <!-- Add Page Button for this specific student -->
                    ${!isEvaluatingBundle && student.status !== 'completed' ? `
                        <label style="width: 85px; height: 110px; border: 1.5px dashed #4f46e5; border-radius: 8px; background: #f5f3ff; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; color: #4f46e5; gap: 0.25rem;">
                            <span style="font-size: 1.3rem;">➕</span>
                            <span style="font-size: 0.72rem; font-weight: 700;">Add Page</span>
                            <input type="file" multiple accept="image/*,application/pdf" style="display: none;" onchange="window.handleStudentPagesUpload('${student.id}', this.files); this.value='';">
                        </label>
                    ` : ''}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// ==================== BUNDLE EVALUATION RUNNER ====================
async function startBundleEvaluation() {
    if (isEvaluatingBundle) return;
    if (!selectedBundleSession) {
        showToast("Please select an Exam Session first.", "warning");
        return;
    }

    const pendingStudents = queuedBundleStudents.filter(s => (s.status === 'ready' || s.status === 'error') && s.pages.length > 0);
    if (pendingStudents.length === 0) {
        showToast("No pending students with uploaded pages to evaluate.", "warning");
        return;
    }

    isEvaluatingBundle = true;
    renderBundleQueue();

    const progressCard = document.getElementById('bundleProgressCard');
    const progressBar = document.getElementById('bundleProgressBar');
    const progressStatus = document.getElementById('bundleProgressStatus');
    const progressCount = document.getElementById('bundleProgressCount');

    if (progressCard) progressCard.style.display = 'block';

    let completedCount = 0;
    const totalToProcess = pendingStudents.length;

    // ⚡ CONTEXT CACHING: Auto-create shared context cache if missing (75% savings for all students)
    let activeCacheId = selectedBundleSession.cachedContentId || null;
    if (!activeCacheId && selectedBundleSession.questions && selectedBundleSession.markingScheme) {
        try {
            if (progressStatus) progressStatus.textContent = "⚡ Building shared Gemini Context Cache for bundle (75% discount)...";
            const cacheRes = await fetch('/api/create-cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    // Process each student sequentially (1 student per HTTP request, perfectly within Vercel's 4.5MB limit)
    for (let i = 0; i < pendingStudents.length; i++) {
        const student = pendingStudents[i];
        student.status = 'evaluating';
        renderBundleQueue();

        if (progressStatus) progressStatus.textContent = `Grading student ${i + 1} of ${totalToProcess}: ${student.studentName} (${student.pages.length} pages)...`;
        if (progressCount) progressCount.textContent = `${i + 1} / ${totalToProcess}`;
        if (progressBar) progressBar.style.width = `${Math.round(((i) / totalToProcess) * 100)}%`;

        try {
            // Bundle all pages of this student into the images payload
            const imagesPayload = student.pages.map(p => ({
                data: p.base64,
                mimeType: p.mimeType
            }));

            const payload = {
                mode: 'session-evaluate',
                model: 'gemini-4-argon',
                thinkingLevel: 'medium',
                questions: selectedBundleSession.questions,
                markingScheme: selectedBundleSession.markingScheme,
                maxMarks: selectedBundleSession.maxMarks,
                images: imagesPayload,
                subject: selectedBundleSession.subject,
                otherInstructions: selectedBundleSession.otherInstructions || "",
                cachedContentId: activeCacheId // Enables 75% cached discount
            };

            const evalRes = await fetch('/api/ocr-evaluate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const evalData = await evalRes.json();
            if (!evalRes.ok) {
                throw new Error(evalData.error || "Grading error");
            }

            // Save directly to Firestore testResults collection
            const lockedMax = Number(selectedBundleSession.maxMarks) || 40;
            const clampedScore = Math.min(Math.max(0, Number(evalData.totalScore) || 0), lockedMax);

            const docRef = await addDoc(collection(db, 'testResults'), {
                studentName: student.studentName,
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

            student.status = 'completed';
            student.result = evalData;
            student.resultId = docRef.id;
            completedCount++;

        } catch (evalErr) {
            console.error(`Error evaluating student ${student.studentName}:`, evalErr);
            student.status = 'error';
            student.errorMessage = evalErr.message;
        }

        renderBundleQueue();
        if (progressBar) progressBar.style.width = `${Math.round(((i + 1) / totalToProcess) * 100)}%`;
    }

    isEvaluatingBundle = false;
    if (progressBar) progressBar.style.width = '100%';
    if (progressStatus) progressStatus.textContent = `🎉 Bundle completed! ${completedCount} of ${totalToProcess} students evaluated successfully.`;

    renderBundleQueue();
    showToast(`Bundle grading finished! ${completedCount} student(s) evaluated.`, 'success');
}

// ==================== SCHEDULING LOGIC ====================
function setupSchedule(timeString) {
    cancelSchedule();

    const [targetHours, targetMinutes] = timeString.split(':').map(Number);
    const now = new Date();
    const target = new Date();
    target.setHours(targetHours, targetMinutes, 0, 0);

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
