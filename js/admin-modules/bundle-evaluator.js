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
    setDoc,
    updateDoc,
    addDoc,
    deleteDoc,
    onSnapshot,
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
    const btnSubmitBatch = document.getElementById('btnSubmitBatchJob');
    const btnClearBundle = document.getElementById('btnClearBundle');
    const btnRefreshBatchJobs = document.getElementById('btnRefreshBatchJobs');

    // 1. Load Sessions into Dropdown & load active Batch Jobs
    loadBundleSessions();
    loadBatchJobs();

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

    // 5. Submit Batch Job Trigger (Asynchronous 50% discount)
    btnSubmitBatch?.addEventListener('click', () => {
        submitGoogleBatchJob();
    });

    btnRefreshBatchJobs?.addEventListener('click', () => {
        loadBatchJobs(true);
    });

    // Global window handlers for student card and batch registry interactions
    window.addBundleStudentSegment = () => addStudentSegment();
    window.removeBundleStudent = (studentId) => removeStudent(studentId);
    window.updateBundleStudentName = (studentId, name) => updateStudentName(studentId, name);
    window.handleStudentPagesUpload = (studentId, files) => handleStudentPages(studentId, Array.from(files));
    window.removePageFromStudent = (studentId, pageId) => removePage(studentId, pageId);
    window.checkAndSyncBatchJob = (batchId, docId) => checkAndSyncBatch(batchId, docId);
    window.downloadBatchPredictionsDoc = (batchId, docId) => downloadBatchPredictions(batchId, docId);
    window.deleteBatchJobDoc = (docId) => deleteBatchJob(docId);
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
            const compressed = await readAndCompressImage(f, 1200, 0.75);
            std.pages.push({
                id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                fileName: f.name,
                mimeType: compressed.mimeType,
                base64: compressed.base64,
                preview: compressed.preview
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
// Ingest multiple files dropped all at once
async function handleBulkFilesIngest(fileList) {
    if (fileList.length === 0) return;

    const validFiles = fileList.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (validFiles.length === 0) {
        showToast("Please upload images (JPEG/PNG) or PDF papers", "warning");
        return;
    }

    showToast(`Processing ${validFiles.length} file(s)...`, "info");

    // Helper to determine if a filename is a generic camera/whatsapp/screenshot export
    const isGenericCaptureName = (fileName) => {
        const lower = fileName.toLowerCase().replace(/\.[^/.]+$/, "");
        return lower.startsWith('whatsapp') ||
               lower.startsWith('img') ||
               lower.startsWith('dsc') ||
               lower.startsWith('photo') ||
               lower.startsWith('scan') ||
               lower.startsWith('screenshot') ||
               lower.startsWith('camera') ||
               /^\d+$/.test(lower) ||
               /\d{4}[-_]\d{2}[-_]\d{2}/.test(lower);
    };

    // Check if filename has an explicit student + page pattern like "Rahul_page1.jpg", "Aman_p2.png"
    const parseExplicitStudentPage = (fileName) => {
        if (isGenericCaptureName(fileName)) return null;
        const base = fileName.replace(/\.[^/.]+$/, "");
        const match = base.match(/^(.+?)[-_\s]+(?:page|p|scan|sheet)[-_\s]*(\d+)$/i);
        if (match && match[1].trim().length > 2) {
            return {
                studentName: match[1].replace(/[_-]+/g, " ").trim(),
                pageNum: parseInt(match[2], 10)
            };
        }
        return null;
    };

    // Group files: distinct student for generic files, grouped for explicit multi-page
    const groups = {};

    for (const file of validFiles) {
        const explicit = parseExplicitStudentPage(file.name);
        if (explicit) {
            // Group by the explicit student name
            if (!groups[explicit.studentName]) groups[explicit.studentName] = [];
            groups[explicit.studentName].push(file);
        } else {
            // Generic camera/whatsapp/single file -> THIS IS A DISTINCT STUDENT!
            const studentIdx = Object.keys(groups).length + queuedBundleStudents.length + 1;
            const singleStudentName = `Student ${studentIdx}`;
            groups[singleStudentName] = [file];
        }
    }

    for (const [studentName, files] of Object.entries(groups)) {
        let std = {
            id: 'std_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            studentName: studentName,
            pages: [],
            status: 'ready',
            result: null,
            resultId: null,
            errorMessage: null
        };
        queuedBundleStudents.push(std);

        for (const f of files) {
            try {
                const compressed = await readAndCompressImage(f, 1200, 0.75);
                std.pages.push({
                    id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    fileName: f.name,
                    mimeType: compressed.mimeType,
                    base64: compressed.base64,
                    preview: compressed.preview
                });
            } catch (err) {
                console.error("Error reading bulk file:", f.name, err);
            }
        }
    }

    renderBundleQueue();
    showToast(`🎉 Created ${Object.keys(groups).length} distinct student segments (${validFiles.length} pages total)!`, "success");
}

function readAndCompressImage(file, maxDim = 1200, quality = 0.75) {
    return new Promise((resolve, reject) => {
        if (!file.type || !file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = () => {
                const res = reader.result;
                const b64 = typeof res === 'string' ? res.split(',')[1] : '';
                resolve({ base64: b64, mimeType: file.type || 'application/octet-stream', preview: null });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                const b64 = dataUrl.split(',')[1];
                resolve({
                    base64: b64,
                    mimeType: 'image/jpeg',
                    preview: dataUrl
                });
            };
            img.onerror = () => {
                const res = e.target.result;
                const b64 = typeof res === 'string' ? res.split(',')[1] : '';
                resolve({ base64: b64, mimeType: file.type, preview: typeof res === 'string' ? res : null });
            };
            img.src = e.target.result;
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

    const btnSubmitBatch = document.getElementById('btnSubmitBatchJob');
    if (totalStudents === 0) {
        if (emptyDropZone) emptyDropZone.style.display = 'block';
        if (container) {
            container.style.display = 'none';
            container.innerHTML = '';
        }
        if (queueCard) queueCard.style.display = 'none';
        if (btnSubmitBatch) {
            btnSubmitBatch.disabled = true;
            btnSubmitBatch.innerHTML = `⚡ Submit Google Batch Job (0 Students)`;
        }
        return;
    }

    if (emptyDropZone) emptyDropZone.style.display = 'none';
    if (container) container.style.display = 'flex';
    if (queueCard) queueCard.style.display = 'block';

    const totalBytes = queuedBundleStudents.reduce((sum, s) => {
        return sum + s.pages.reduce((pSum, p) => pSum + (p.base64 ? p.base64.length : 0), 0);
    }, 0);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    const isPayloadTooLarge = totalBytes > 4.2 * 1024 * 1024;

    if (btnSubmitBatch) {
        btnSubmitBatch.disabled = isEvaluatingBundle || totalPages === 0 || isPayloadTooLarge;
        if (isPayloadTooLarge) {
            btnSubmitBatch.innerHTML = `⚠️ Payload Too Large (${totalMB} MB / Max 4.2 MB) - Split Into 2 Batches`;
            btnSubmitBatch.style.background = '#dc2626';
        } else {
            btnSubmitBatch.innerHTML = `⚡ Submit Google Batch Job (${totalStudents} Students · ${totalPages} Pages · ~${totalMB} MB)`;
            btnSubmitBatch.style.background = 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)';
        }
    }
    if (queueCountBadge) {
        queueCountBadge.textContent = `${totalStudents} Students (${totalPages} Pages · ~${totalMB} MB)`;
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
// ==================== BUNDLE BATCH RUNNER (ASYNCHRONOUS) ====================
async function submitGoogleBatchJob() {
        if (isEvaluatingBundle) return;
        if (!selectedBundleSession) {
            showToast("Please select an Exam Session first.", "warning");
            return;
        }

        const pendingStudents = queuedBundleStudents.filter(s => s.pages && s.pages.length > 0);
        if (pendingStudents.length === 0) {
            showToast("Please add at least 1 student with answer sheet pages before submitting.", "warning");
            return;
        }

        const btnSubmit = document.getElementById('btnSubmitBatchJob');
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `⏳ Submitting Batch to Google Cloud...`;
        }
        isEvaluatingBundle = true;

        try {
            showToast("⚡ Connecting to Google Gemini Batch API...", "info");

            // Format payload for /api/batch-evaluate
            const studentsPayload = pendingStudents.map(st => ({
                studentName: st.studentName || "Student",
                pages: st.pages.map(p => ({
                    base64: p.base64,
                    mimeType: p.mimeType || "image/jpeg"
                }))
            }));

            const requestBody = {
                action: 'create',
                sessionId: selectedBundleSession.id,
                examName: selectedBundleSession.name,
                subject: selectedBundleSession.subject,
                questions: selectedBundleSession.questions,
                markingScheme: selectedBundleSession.markingScheme,
                maxMarks: Number(selectedBundleSession.maxMarks) || 40,
                otherInstructions: selectedBundleSession.otherInstructions || "",
                cachedContentId: selectedBundleSession.cachedContentId || null,
                model: 'gemini-4-argon',
                students: studentsPayload
            };

            const res = await fetch('/api/batch-evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const rawText = await res.text();
            let data = {};
            try { data = JSON.parse(rawText); } catch (_) {}

            if (data.authAudit) {
                console.group("%c🔐 VERTEX AI SERVICE ACCOUNT AUDIT", "background: #0f172a; color: #38bdf8; font-size: 13px; font-weight: bold; padding: 4px 8px; border-radius: 4px;");
                console.log("%c🔑 SA Key Loaded in Vercel:  ", "font-weight: bold; color: " + (data.authAudit.serviceAccountFetched ? "#10b981" : "#ef4444") + ";", data.authAudit.serviceAccountFetched ? "✅ YES (Key parsed successfully)" : "❌ NO (Missing)");
                console.log("%c🛡️ Authorization Key (API): ", "font-weight: bold; color: " + (data.authAudit.hasApiKey ? "#10b981" : "#f59e0b") + ";", data.authAudit.hasApiKey ? "✅ ACTIVE (GCP Vertex/Gemini Auth Key)" : "⚠️ Not found");
                console.log("%c📧 Service Account Principal:", "font-weight: bold; color: #0284c7;", data.authAudit.serviceAccountEmail || "None");
                console.log("%c🆔 GCP Project ID:          ", "font-weight: bold;", data.authAudit.projectId || "None");
                console.log("%c🎫 OAuth2 Token Active:     ", "font-weight: bold; color: " + (data.authAudit.tokenActive ? "#10b981" : "#ef4444") + ";", data.authAudit.tokenActive ? "✅ YES (Handshake approved)" : "❌ FAILED");
                console.log("%c🏛️ Cloud Infrastructure:    ", "font-weight: bold; color: #8b5cf6;", data.authAudit.cloudProvider);
                if (data.authAudit.authError) {
                    console.error("Token Handshake Error:", data.authAudit.authError);
                }
                console.groupEnd();
            }

            if (!res.ok || !data.batchId) {
                const errMsg = data.error || (typeof data.details === 'string' ? data.details : JSON.stringify(data.details)) || (rawText.startsWith('<') ? "Server returned HTML error page. Check function logs." : rawText) || "Failed to submit Google Batch Job";
                const errObj = new Error(errMsg);
                errObj.authAudit = data.authAudit;
                throw errObj;
            }

            // 📦 Authentic Google Batch Verification Log
            console.group("%c📦 VERTEX AI BATCH AUDIT - JOB SUBMISSION RECEIPT", "background: #4f46e5; color: #ffffff; font-size: 13px; font-weight: bold; padding: 4px 8px; border-radius: 4px;");
            console.log("%c🆔 Google Batch Job ID:", "font-weight: bold; color: #0284c7;", data.batchId);
            console.log("%c📚 Exam Session:      ", "font-weight: bold;", selectedBundleSession.name);
            console.log("%c👥 Students Queued:   ", "font-weight: bold; color: #16a34a;", pendingStudents.length);
            console.log("%c💰 Pricing Tier:      ", "font-weight: bold; color: #d97706;", "Official Google 50% Batch Discount");
            console.log("%c🕒 Current State:     ", "font-weight: bold;", data.state || "JOB_STATE_PENDING");
            console.log("%c📡 Lifecycle Notice:  ", "color: #64748b;", "Job is queued asynchronously on Google Cloud. Click 'Sync' in the registry when completed.");
            console.groupEnd();

            // Clear the upper segment inputs smoothly without full page refresh
            queuedBundleStudents = [];
            renderBundleQueue();

            try {
                const cleanDocId = String(data.batchId).replace(/[^a-zA-Z0-9_-]/g, '_');
                const jobMeta = {
                    batchId: data.batchId,
                    sessionId: selectedBundleSession?.id || null,
                    sessionName: selectedBundleSession?.name || 'Exam Assessment',
                    class: selectedBundleSession?.class || 'Class 12th',
                    subject: selectedBundleSession?.subject || 'Business Studies',
                    maxMarks: Number(selectedBundleSession?.maxMarks) || 30,
                    targetGroup: selectedBundleSession?.targetGroup || 'Both',
                    studentsMetadata: pendingStudents.map(st => ({ studentName: st.studentName || "Student" }))
                };
                localStorage.setItem('nt_batch_job_' + cleanDocId, JSON.stringify(jobMeta));
                console.log("%c💾 Batch Job metadata saved to persistent local storage!", "color: #10b981; font-weight: bold;");
            } catch (storageErr) {
                console.warn("Notice: Local storage cache:", storageErr);
            }

            showToast(`🎉 Batch Job created: ${data.batchId}! Track progress in registry below.`, "success");
            await loadBatchJobs(true);

        } catch (err) {
            console.group("%c❌ VERTEX AI BATCH DISPATCH FAILED", "background: #dc2626; color: #ffffff; font-size: 13px; font-weight: bold; padding: 4px 8px; border-radius: 4px;");
            console.error("Error Message:", err.message);
            if (err.authAudit?.serviceAccountFetched) {
                console.log("%c🔑 Key Check:", "color: #10b981; font-weight: bold;", "✅ The Service Account Key IS successfully loaded and recognized by Vercel!");
                console.log("%c📧 Principal:", "font-weight: bold;", err.authAudit.serviceAccountEmail);
            } else {
                console.warn("%c🔑 Key Check:", "color: #ef4444; font-weight: bold;", "❌ Vercel has NOT fetched the key. Check GCP_SERVICE_ACCOUNT_KEY in Vercel Environment Variables.");
            }

            if (err.message.includes("403") || err.message.includes("permission") || err.message.includes("IAM") || err.message.includes("denied")) {
                console.warn("%c👉 ROOT CAUSE DIAGNOSIS:", "color: #f59e0b; font-weight: bold;", "The key was loaded by Vercel, but GCP IAM denied access. Please go to GCP Console -> IAM & Admin and assign the role 'Vertex AI User' to " + (err.authAudit?.serviceAccountEmail || "the service account") + ".");
            } else if (err.message.includes("insufficient") || err.message.includes("scopes")) {
                console.warn("%c👉 ROOT CAUSE DIAGNOSIS:", "color: #f59e0b; font-weight: bold;", "Ensure the service account has Vertex AI permissions enabled.");
            }
            console.groupEnd();
            showToast(err.message, "error");
        } finally {
            isEvaluatingBundle = false;
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = `⚡ Submit Google Batch Job (${queuedBundleStudents.length} Students)`;
            }
        }
    }

    // ==================== BATCH JOBS REGISTRY & SYNC ====================
    let cachedBatchJobs = [];

    export async function loadBatchJobs(forceToast = false) {
        const container = document.getElementById('batchJobsListContainer');
        if (!container) return;

        try {
            console.log("🔄 Fetching batch jobs from Google Cloud Vertex AI...");
            const res = await fetch('/api/batch-evaluate?action=list');
            const data = await res.json();
            let liveJobs = (res.ok && Array.isArray(data.jobs)) ? data.jobs : [];

            // Fetch persistent session metadata from localStorage
            let fsMetadataMap = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('nt_batch_job_')) {
                    try {
                        const parsed = JSON.parse(localStorage.getItem(key));
                        if (parsed?.batchId) {
                            fsMetadataMap[parsed.batchId] = parsed;
                            const shortId = parsed.batchId.split('/').pop();
                            fsMetadataMap[shortId] = parsed;
                        }
                    } catch (_) {}
                }
            }

            // Merge Firestore metadata so sessionId and sessionName are NEVER lost
            cachedBatchJobs = liveJobs.map(job => {
                const shortId = (job.batchId || job.id || '').split('/').pop();
                const meta = fsMetadataMap[job.batchId] || fsMetadataMap[shortId] || {};
                return {
                    ...job,
                    sessionId: job.sessionId || meta.sessionId || null,
                    sessionName: (job.sessionName && job.sessionName !== 'Vertex AI Batch Job') ? job.sessionName : (meta.sessionName || job.sessionName),
                    class: job.class || meta.class || 'Class 12th',
                    subject: job.subject || meta.subject || 'Business Studies',
                    maxMarks: job.maxMarks || meta.maxMarks || 30,
                    targetGroup: job.targetGroup || meta.targetGroup || 'Both',
                    studentsMetadata: (job.studentsMetadata && job.studentsMetadata.length) ? job.studentsMetadata : (meta.studentsMetadata || [])
                };
            });

            // Sort jobs chronologically in ascending order as requested (earliest test -> latest test)
            cachedBatchJobs.sort((a, b) => {
                const timeA = new Date(a.createdAt || a.createTime || 0).getTime();
                const timeB = new Date(b.createdAt || b.createTime || 0).getTime();
                return timeA - timeB;
            });

            console.log("📋 Current Batch Jobs with Firestore Metadata:", cachedBatchJobs);
            renderBatchJobs(cachedBatchJobs);
            if (forceToast) showToast("Batch jobs registry refreshed.", "info");
        } catch (err) {
            console.warn("Batch jobs fetch error:", err.message);
            container.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 1rem;">Failed to load batch jobs: ${escapeHtml(err.message)}</div>`;
        }
    }

    function formatCleanBatchSession(job) {
        let rawName = job.sessionName || job.displayName || 'Exam Assessment';
        let cleanTestName = rawName
            .replace(/^NerdTutors_/i, '')
            .replace(/__\d+$/g, '')
            .replace(/_\d{10,}$/g, '')
            .replace(/[_-]+/g, ' ')
            .trim();
        
        let subject = job.subject || '';
        if (!subject || subject === 'General' || subject.toLowerCase() === 'none') {
            const lower = (rawName + ' ' + (job.displayName || '')).toLowerCase();
            if (lower.includes('account')) subject = 'Accountancy';
            else if (lower.includes('business')) subject = 'Business Studies';
            else if (lower.includes('economics') || lower.includes('eco')) subject = 'Economics';
            else if (lower.includes('social') || lower.includes('sst')) subject = 'Social Science';
            else subject = 'General Subject';
        }

        let grade = job.class || 'Class 12th';
        return { cleanTestName, subject, grade };
    }

    function renderBatchJobs(jobs) {
        const container = document.getElementById('batchJobsListContainer');
        if (!container) return;

        if (!jobs || jobs.length === 0) {
            container.innerHTML = `
            <div style="text-align: center; color: #94a3b8; padding: 2rem 1rem; background: #fafafa; border-radius: 8px; border: 1.5px dashed #e2e8f0;">
                <div style="font-size: 1.8rem; margin-bottom: 0.25rem;">📦</div>
                <strong style="color: #475569; font-size: 0.95rem;">No Batch Jobs Found</strong>
                <p style="margin: 0.25rem 0 0 0; font-size: 0.82rem; color: #64748b;">Add students above and click "Submit Google Batch Job" to create an asynchronous batch.</p>
            </div>
        `;
            return;
        }

        let html = '';
        jobs.forEach(job => {
            const batchId = job.batchId || job.name || 'batches/unknown';
            const shortId = (batchId || '').split('/').pop();
            const { cleanTestName, subject, grade } = formatCleanBatchSession(job);
            
            const studentCount = job.studentCount || job.studentsMetadata?.length || 0;
            const studentsList = (job.studentsMetadata || []).map(s => typeof s === 'string' ? s : s.studentName).filter(Boolean);
            const status = job.status || 'JOB_STATE_PENDING';

            let statusPill = `<span style="background: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">⏳ PENDING</span>`;
            if (status === 'JOB_STATE_RUNNING') {
                statusPill = `<span style="background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">🔄 RUNNING ON GOOGLE</span>`;
            } else if (status === 'JOB_STATE_SUCCEEDED') {
                statusPill = `<span style="background: #dcfce7; color: #166534; padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">🎉 SUCCEEDED (READY)</span>`;
            } else if (status === 'SYNCED') {
                statusPill = `<span style="background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">✅ SYNCED TO RESULTS</span>`;
            } else if (status === 'JOB_STATE_FAILED') {
                statusPill = `<span style="background: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">❌ FAILED</span>`;
            }

            // Subject Pill Color
            let subBadgeStyle = "background: #f1f5f9; color: #334155;";
            const sLower = subject.toLowerCase();
            if (sLower.includes('eco')) subBadgeStyle = "background: #ede9fe; color: #5b21b6; border: 1px solid #ddd6fe;";
            else if (sLower.includes('account')) subBadgeStyle = "background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0;";
            else if (sLower.includes('business')) subBadgeStyle = "background: #fef3c7; color: #92400e; border: 1px solid #fde68a;";
            else if (sLower.includes('social')) subBadgeStyle = "background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd;";

            // Clean formatted Date & Time
            const dateRaw = job.createdAt || job.createTime;
            let dateStr = 'Recently submitted';
            if (dateRaw) {
                const dateObj = new Date(dateRaw);
                if (!isNaN(dateObj)) {
                    dateStr = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' at ' + dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                }
            }

            html += `
            <div style="background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 1.15rem 1.35rem; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; box-shadow: 0 1px 4px rgba(0,0,0,0.03);">
                <div style="min-width: 280px; flex: 1;">
                    <!-- Top Row: Subject Badge, Grade, Status, Short Batch ID -->
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; flex-wrap: wrap;">
                        <span style="${subBadgeStyle} padding: 2px 9px; border-radius: 999px; font-size: 0.75rem; font-weight: 700;">
                            📘 ${escapeHtml(subject)}
                        </span>
                        <span style="background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; padding: 2px 8px; border-radius: 999px; font-size: 0.74rem; font-weight: 600;">
                            ${escapeHtml(grade)}
                        </span>
                        ${statusPill}
                        <span style="font-family: monospace; font-size: 0.74rem; font-weight: 600; color: #64748b; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;" title="Google Cloud Batch ID: ${escapeHtml(batchId)}">
                            #${escapeHtml(shortId)}
                        </span>
                    </div>

                    <!-- Clean Class Test Title -->
                    <div style="font-weight: 800; color: #0f172a; font-size: 1.05rem; letter-spacing: -0.01em;">
                        ${escapeHtml(cleanTestName)}
                    </div>

                    <!-- Students in this batch -->
                    ${studentsList.length > 0 ? `
                        <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                            <span style="font-size: 0.76rem; font-weight: 700; color: #475569;">👥 Students (${studentsList.length}):</span>
                            ${studentsList.slice(0, 8).map(name => `
                                <span style="background: #f8fafc; color: #1e293b; border: 1px solid #cbd5e1; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 600;">
                                    ${escapeHtml(name)}
                                </span>
                            `).join('')}
                            ${studentsList.length > 8 ? `<span style="font-size: 0.72rem; color: #64748b; font-weight: 600;">+${studentsList.length - 8} more</span>` : ''}
                        </div>
                    ` : `
                        <div style="margin-top: 0.35rem; font-size: 0.8rem; color: #64748b; font-weight: 600;">
                            👥 ${studentCount} Student(s)
                        </div>
                    `}

                    <!-- Timestamp -->
                    <div style="color: #94a3b8; font-size: 0.76rem; margin-top: 0.45rem; display: flex; align-items: center; gap: 0.35rem;">
                        <span>🕒</span>
                        <span>Sent: <strong style="color: #64748b;">${dateStr}</strong></span>
                    </div>
                </div>

                <!-- Action Buttons: Download JSON, Check & Sync, Delete -->
                <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-top: 0.25rem;">
                    <button type="button" onclick="window.downloadBatchPredictionsDoc('${escapeHtml(batchId)}', '${job.id}')"
                        style="background: #0284c7; color: white; border: none; padding: 0.45rem 0.85rem; border-radius: 6px; font-size: 0.82rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 0.35rem; box-shadow: 0 1px 3px rgba(2,132,199,0.2);"
                        title="Download raw prediction output JSON">
                        📥 Download JSON
                    </button>
                    <button type="button" onclick="window.checkAndSyncBatchJob('${escapeHtml(batchId)}', '${job.id}')"
                        style="background: #4f46e5; color: white; border: none; padding: 0.45rem 0.85rem; border-radius: 6px; font-size: 0.82rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 0.35rem; box-shadow: 0 1px 3px rgba(79,70,229,0.2);">
                        🔄 Check Status & Sync
                    </button>
                    <button type="button" onclick="window.deleteBatchJobDoc('${job.id}')"
                        style="background: #f8fafc; color: #dc2626; border: 1px solid #fee2e2; padding: 0.45rem 0.65rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer;"
                        title="Delete batch record from registry">
                        🗑️
                    </button>
                </div>
            </div>
        `;
        });

        container.innerHTML = html;
    }

    async function checkAndSyncBatch(batchId, docId) {
        console.group(`%c🚀 BATCH SYNC PROCESSOR: ${batchId}`, "background: #1e3c72; color: #ffffff; font-size: 13px; font-weight: bold; padding: 4px 8px; border-radius: 4px;");
        console.log("Job ID / Short ID:", docId);
        console.log("Full Batch Resource Name:", batchId);

        try {
            showToast(`Checking status of ${batchId}...`, "info");

            // 1. Check status on Google Vertex AI
            console.log("📡 Step 1: Polling Vertex AI batch status...");
            const statusRes = await fetch(`/api/batch-evaluate?action=status&batchId=${encodeURIComponent(batchId)}`);
            const statusData = await statusRes.json();
            console.log("📡 Status Response from Google Cloud:", statusData);

            if (!statusRes.ok) {
                throw new Error(statusData.error || "Failed to check batch status");
            }

            const currentState = statusData.state || 'JOB_STATE_PENDING';
            console.log("📊 Batch State on Google Cloud:", currentState);

            if (currentState === 'JOB_STATE_RUNNING' || currentState === 'JOB_STATE_PENDING') {
                showToast(`⏳ Batch is still processing in Google's queue (${currentState}). Check back in a few minutes.`, "info");
                await loadBatchJobs(false);
                console.groupEnd();
                return;
            }

            if (currentState === 'JOB_STATE_FAILED') {
                console.error("❌ Batch failed on Google Cloud:", statusData.error);
                showToast(`⚠️ Batch job failed on Google Cloud: ${statusData.error?.message || 'Unknown error'}`, "error");
                await loadBatchJobs(false);
                console.groupEnd();
                return;
            }

            if (currentState === 'JOB_STATE_SUCCEEDED') {
                showToast("🎉 Batch completed by Google! Syncing parsed report cards to Firestore...", "info");

                // Find existing job metadata
                let batchJobData = cachedBatchJobs.find(j => j.batchId === batchId || j.id === batchId || j.id === docId) || {};
                console.log("🔍 Initial Cached Batch Job Data:", batchJobData);

                // If sessionId is missing, try reading from localStorage
                if (!batchJobData.sessionId) {
                    try {
                        const cleanDocId = String(batchId).replace(/[^a-zA-Z0-9_-]/g, '_');
                        const localRaw = localStorage.getItem('nt_batch_job_' + cleanDocId);
                        if (localRaw) {
                            const localData = JSON.parse(localRaw);
                            console.log("📂 Retrieved metadata from localStorage cache:", localData);
                            batchJobData = { ...batchJobData, ...localData };
                        }
                    } catch (_) {}
                }

                // If STILL missing, fallback to current session dropdown selection
                if (!batchJobData.sessionId && selectedBundleSession) {
                    console.log("⚠️ Fallback: using currently selected bundle session:", selectedBundleSession.name);
                    batchJobData.sessionId = selectedBundleSession.id;
                    batchJobData.sessionName = selectedBundleSession.name;
                    batchJobData.subject = selectedBundleSession.subject;
                    batchJobData.class = selectedBundleSession.class;
                    batchJobData.maxMarks = Number(selectedBundleSession.maxMarks) || 30;
                }

                // Or fallback to dropdown selection on page
                if (!batchJobData.sessionId) {
                    const bundleSelectVal = document.getElementById('bundleSessionSelect')?.value;
                    const resultSelectVal = document.getElementById('resultSessionSelect')?.value;
                    const fallbackId = bundleSelectVal || resultSelectVal;
                    if (fallbackId && Array.isArray(bundleSessionsList)) {
                        const matchedSession = bundleSessionsList.find(s => s.id === fallbackId);
                        if (matchedSession) {
                            console.log("⚠️ Fallback: matched session from dropdown list:", matchedSession.name);
                            batchJobData.sessionId = matchedSession.id;
                            batchJobData.sessionName = matchedSession.name;
                            batchJobData.subject = matchedSession.subject;
                            batchJobData.class = matchedSession.class;
                            batchJobData.maxMarks = Number(matchedSession.maxMarks) || 30;
                        }
                    }
                }

                console.log("📋 Resolved Job Metadata for Firestore Insertion:", {
                    sessionId: batchJobData.sessionId,
                    sessionName: batchJobData.sessionName,
                    subject: batchJobData.subject,
                    class: batchJobData.class,
                    maxMarks: batchJobData.maxMarks
                });

                console.log("📥 Step 2: Requesting parsed results from /api/batch-evaluate (action: sync)...");
                const syncRes = await fetch('/api/batch-evaluate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'sync',
                        batchId: batchId,
                        maxMarks: batchJobData.maxMarks || 30,
                        studentsMetadata: batchJobData.studentsMetadata || []
                    })
                });

                const syncData = await syncRes.json();
                console.log("📦 Sync Response from API:", syncData);

                if (!syncRes.ok) {
                    throw new Error(syncData.error || "Failed to parse batch results from Google Cloud");
                }

                const parsedResults = syncData.parsedResults || [];
                console.log(`📑 Total Students Parsed from Batch: ${parsedResults.length}`);

                let syncedCount = 0;

                for (let i = 0; i < parsedResults.length; i++) {
                    const item = parsedResults[i];
                    console.group(`👤 Processing Student [${i + 1}/${parsedResults.length}]: ${item.studentName || 'Student'}`);
                    console.log("Student Evaluation Object:", item.result);

                    if (item.result) {
                        const lockedMax = Number(batchJobData.maxMarks) || Number(item.result.totalMaxMarks) || 30;
                        const clampedScore = Math.min(Math.max(0, Number(item.result.totalScore) || 0), lockedMax);

                        const payload = {
                            studentName: item.studentName || `Student ${i + 1}`,
                            studentId: null,
                            batch: batchJobData.targetGroup || 'Both',
                            class: batchJobData.class || 'Class 12th',
                            subject: batchJobData.subject || 'Business Studies',
                            sessionId: batchJobData.sessionId || null,
                            sessionName: batchJobData.sessionName || 'Batch Exam',
                            score: clampedScore,
                            maxMarks: lockedMax,
                            overallFeedback: item.result.overallFeedback || '',
                            improvements: item.result.improvements || [],
                            breakdown: item.result.results || [],
                            modelUsed: 'gemini-4-argon',
                            isBatchEvaluated: true,
                            batchId: batchId,
                            createdAt: serverTimestamp()
                        };

                        console.log("💾 Writing record to Firestore 'testResults':", payload);
                        const docRef = await addDoc(collection(db, 'testResults'), payload);
                        console.log(`%c✅ SUCCESS: Document inserted into testResults with ID: ${docRef.id}`, "color: #10b981; font-weight: bold;");
                        syncedCount++;
                    } else if (item.error) {
                        console.error("❌ Student evaluation contained an error:", item.error);
                    }
                    console.groupEnd();
                }

                // Update batch status to SYNCED in localStorage
                try {
                    const cleanDocId = String(batchId).replace(/[^a-zA-Z0-9_-]/g, '_');
                    const updatedMeta = {
                        ...batchJobData,
                        status: 'SYNCED',
                        syncedCount: syncedCount,
                        syncedAt: new Date().toISOString()
                    };
                    localStorage.setItem('nt_batch_job_' + cleanDocId, JSON.stringify(updatedMeta));
                } catch (_) {}

                // If on Admin page, refresh resultSessionSelect if matched
                const resultSessionSelect = document.getElementById('resultSessionSelect');
                if (resultSessionSelect && batchJobData.sessionId) {
                    resultSessionSelect.value = batchJobData.sessionId;
                    resultSessionSelect.dispatchEvent(new Event('change'));
                }

                await loadBatchJobs(false);
                showToast(`🎉 Success! ${syncedCount} student papers successfully synced into testResults!`, "success");
                console.log(`%c🎉 BATCH SYNC COMPLETE: ${syncedCount} records written to testResults.`, "color: #10b981; font-weight: bold; font-size: 14px;");
            }
        } catch (err) {
            console.error("❌ Check & sync error:", err);
            showToast(err.message, "error");
        } finally {
            console.groupEnd();
        }
    }

    async function deleteBatchJob(docId) {
        if (!confirm("Are you sure you want to delete this batch job record from the registry?")) return;
        try {
            const res = await fetch('/api/batch-evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete', batchId: docId })
            });
            if (!res.ok) throw new Error("Failed to delete batch job");
            showToast("Batch job record deleted.", "info");
            await loadBatchJobs(false);
        } catch (e) {
            showToast("Error deleting batch job: " + e.message, "error");
        }
    }

    async function downloadBatchPredictions(batchId, docId) {
        try {
            showToast("Fetching batch prediction records...", "info");
            const res = await fetch('/api/batch-evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'sync',
                    batchId: batchId
                })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to fetch batch predictions from server");
            }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const shortId = (batchId || '').split('/').pop();
            a.href = url;
            a.download = `batch_predictions_${shortId}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast("🎉 Batch predictions downloaded successfully!", "success");
        } catch (err) {
            console.error("❌ Download error:", err);
            showToast("Download failed: " + err.message, "error");
        }
    }
