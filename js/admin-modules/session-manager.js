// ============================================
// SESSION MANAGER
// Test session creation & management, student results
// tables, report card preview + PDF printing, score and
// per-question mark editing, and the mock data populator.
// ============================================

import { db } from '../../firebase-config.js';
import {
    collection,
    addDoc,
    getDocs,
    getDoc,
    doc,
    deleteDoc,
    updateDoc,
    serverTimestamp,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import { showToast, escapeHtml } from './admin-utils.js';

export async function createTestSession() {
    const btn = document.getElementById('btnCreateSession');
    if (btn) btn.disabled = true;

    const sessionClass = document.getElementById('sessionClass').value;
    const sessionSubject = document.getElementById('sessionSubject').value;
    const sessionName = document.getElementById('sessionName').value;
    const sessionMaxMarks = document.getElementById('sessionMaxMarks').value;
    const sessionQuestions = document.getElementById('sessionQuestions').value;
    const sessionMarkingScheme = document.getElementById('sessionMarkingScheme').value;
    const sessionOtherInstructions = document.getElementById('sessionOtherInstructions')?.value || "";

    try {
        await addDoc(collection(db, 'testSessions'), {
            class: sessionClass,
            subject: sessionSubject,
            name: sessionName,
            maxMarks: parseInt(sessionMaxMarks) || 100,
            questions: sessionQuestions,
            markingScheme: sessionMarkingScheme,
            otherInstructions: sessionOtherInstructions,
            status: "active",
            createdAt: serverTimestamp()
        });

        showToast('Test Session published successfully!', 'success');
        document.getElementById('createSessionForm').reset();
        loadTestSessionsForDropdown();
        loadTestSessionsForManagement();
    } catch (error) {
        console.error('Error creating session:', error);
        showToast('Failed to create test session: ' + error.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

let allTestSessions = [];
export async function loadTestSessionsForDropdown() {
    const selectEl = document.getElementById('resultSessionSelect');
    if (!selectEl) return;

    try {
        const q = query(collection(db, 'testSessions'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        allTestSessions = [];

        let optionsHtml = '<option value="">-- Select a Test Session --</option>';
        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            allTestSessions.push({ id, ...data });
            optionsHtml += `<option value="${id}">${data.name} (${data.class} - ${data.subject})</option>`;
        });

        selectEl.innerHTML = optionsHtml;
    } catch (error) {
        console.error('Error loading sessions:', error);
        showToast('Failed to load test sessions', 'error');
    }
}

export async function loadResultsForSession(sessionId) {
    const tbody = document.getElementById('resultsTableBody');
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="6" style="padding: 2rem; text-align: center;">
                <div class="spinner" style="margin: 0 auto;"></div>
            </td>
        </tr>
    `;

    try {
        const querySnapshot = await getDocs(collection(db, 'testResults'));
        let results = [];

        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.sessionId === sessionId) {
                results.push({ id: docSnap.id, ...data });
            }
        });

        if (results.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="padding: 2rem; text-align: center; color: #666; font-style: italic;">
                        No student evaluations found for this session yet.
                    </td>
                </tr>
            `;
            return;
        }

        // Sort by date desc
        results.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        let html = '';
        results.forEach(res => {
            const dateStr = res.createdAt ? new Date(res.createdAt.seconds * 1000).toLocaleDateString() : 'N/A';
            html += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 1rem; font-weight: 600; color: #2d3748;">${escapeHtml(res.studentName)}</td>
                    <td style="padding: 1rem; color: #4a5568;">${escapeHtml(res.class)}</td>
                    <td style="padding: 1rem; color: #4a5568;">${escapeHtml(res.subject)}</td>
                    <td style="padding: 1rem;">
                        <span style="background: #edf2f7; padding: 0.25rem 0.5rem; border-radius: 4px; font-weight: 700; color: #2b6cb0; display: inline-flex; align-items: center; gap: 0.35rem;">
                            <span>${res.score} / ${res.maxMarks}</span>
                            <span style="cursor: pointer; color: #718096; font-size: 0.9rem;" title="Edit Score" onclick="window.editStudentScore('${res.id}', ${res.score}, ${res.maxMarks})">✏️</span>
                        </span>
                    </td>
                    <td style="padding: 1rem; color: #718096;">${dateStr}</td>
                    <td style="padding: 1rem; text-align: right;">
                        <button class="btn-submit" style="padding: 0.35rem 0.75rem; font-size: 0.85rem; background: #3182ce; margin-right: 0.35rem; width: auto;" onclick="window.viewReportCard('${res.id}')">
                            👁️ View Card
                        </button>
                        <button class="btn-submit" style="padding: 0.35rem 0.75rem; font-size: 0.85rem; background: #2f855a; margin-right: 0.35rem; width: auto;" onclick="window.printReportCard('${res.id}')">
                            🖨️ Print
                        </button>
                        <button class="btn-submit" style="padding: 0.35rem 0.75rem; font-size: 0.85rem; background: #e53e3e; width: auto;" onclick="window.deleteResult('${res.id}')">
                            🗑️ Delete
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
        window.currentResults = results;

    } catch (error) {
        console.error('Error loading results:', error);
        showToast('Failed to load student results', 'error');
    }
}

// Global hooks for dynamic actions
window.viewReportCard = function(resultId) {
    const res = window.currentResults?.find(r => r.id === resultId);
    if (!res) return;

    const modal = document.getElementById('resultPreviewModal');
    const content = document.getElementById('modalReportCardContent');
    const printBtn = document.getElementById('modalPrintBtn');
    
    if (!modal || !content) return;

    const pct = Math.round((res.score / res.maxMarks) * 100);
    const dateObj = res.createdAt ? new Date(res.createdAt.seconds * 1000) : new Date();
    const dateStr = dateObj.toLocaleDateString();
    const timeStr = dateObj.toLocaleTimeString();

    let grade = 'F';
    let performance = 'Needs Work';
    if (pct >= 90) { grade = 'A+'; performance = 'Excellent'; }
    else if (pct >= 80) { grade = 'A'; performance = 'Very Good'; }
    else if (pct >= 70) { grade = 'B'; performance = 'Good'; }
    else if (pct >= 50) { grade = 'C'; performance = 'Average'; }
    else if (pct >= 33) { grade = 'D'; performance = 'Below Average'; }

    let correctCount = 0;
    let partialCount = 0;
    let incorrectCount = 0;

    const questionsArr = res.results || res.breakdown || [];
    questionsArr.forEach(q => {
        const eM = Number(q.earnedMarks !== undefined ? q.earnedMarks : (q.score || 0));
        const mM = Number(q.marks !== undefined ? q.marks : (q.maxMarks || 1));
        if (eM === mM) {
            correctCount++;
        } else if (eM === 0) {
            incorrectCount++;
        } else {
            partialCount++;
        }
    });

    let appealHtml = '';
    if (res.totalAppealPotential && res.totalAppealPotential !== 'Low') {
        appealHtml = `
            <div style="background: #fffaf0; border: 1px solid #feebc8; border-left: 4px solid #dd6b20; border-radius: 8px; padding: 1.25rem; margin-top: 1.5rem;">
                <h4 style="color: #dd6b20; margin: 0 0 0.5rem 0; font-size: 1.1rem; font-weight: 700;">⚖️ Re-evaluation Appeal Advisor</h4>
                <p style="color: #7b341e; font-weight: 700; margin: 0 0 0.25rem 0; font-size: 0.95rem;">Appeal Case: ${res.totalAppealPotential}</p>
                <p style="color: #7b341e; margin: 0; font-size: 0.9rem; line-height: 1.5;">${res.appealSummary}</p>
            </div>
        `;
    }

    content.innerHTML = `
        <div style="text-align: center; border-bottom: 4px solid #1e3c72; padding-bottom: 1rem; margin-bottom: 1.5rem;">
            <h2 style="color: #1e3c72; margin: 0; font-size: 2rem; font-weight: 800; font-family: 'Poppins', sans-serif;">NERD TUTORS</h2>
            <p style="margin: 4px 0 0 0; color: #718096; font-size: 0.85rem; text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Official Academic Report Card</p>
        </div>

        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; background: #f8fafc; border: 1px solid #e2e8f0; padding: 1rem; border-radius: 12px; margin-bottom: 1.5rem; font-size: 0.9rem;">
            <div style="display: flex; flex-direction: column; gap: 0.15rem;">
                <span style="font-weight: 500; color: #718096; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px;">Student Name</span>
                <span style="font-weight: 700; color: #2d3748;">${escapeHtml(res.studentName)}</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.15rem;">
                <span style="font-weight: 500; color: #718096; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px;">Date Evaluated</span>
                <span style="font-weight: 700; color: #2d3748;">${dateStr}</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.15rem;">
                <span style="font-weight: 500; color: #718096; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px;">Class</span>
                <span style="font-weight: 700; color: #2d3748;">${escapeHtml(res.class || 'N/A')}</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.15rem;">
                <span style="font-weight: 500; color: #718096; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px;">Subject</span>
                <span style="font-weight: 700; color: #2d3748;">${escapeHtml(res.subject || 'N/A')}</span>
            </div>
        </div>

        <!-- Split Dashboard Panel -->
        <div style="display: flex; gap: 1.5rem; margin-bottom: 2rem; align-items: stretch; flex-wrap: wrap;">
            
            <!-- Left Score Card -->
            <div style="flex: 1; min-width: 250px; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 16px; padding: 1rem; display: flex; flex-direction: column; align-items: center; justify-content: space-between; box-shadow: 0 4px 12px rgba(0,0,0,0.01);">
                <div style="font-weight: 700; font-size: 0.8rem; color: #c53030; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem;">🏆 Final Score</div>
                
                <div style="font-size: 2.75rem; font-weight: 900; color: #c53030; font-family: 'Poppins', sans-serif; line-height: 1; margin: 0.25rem 0 0.5rem 0; text-align: center;">${res.score} / ${res.maxMarks}</div>
                
                <div style="width: 100%; border-top: 1px solid #edf2f7; padding-top: 0.5rem; margin-bottom: 0.75rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0; font-size: 0.85rem; color: #4a5568;">
                        <span>Grade:</span>
                        <strong style="color: #2d3748;">${grade}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0; font-size: 0.85rem; color: #4a5568;">
                        <span>Performance:</span>
                        <strong style="color: #dd6b20;">${performance}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0; font-size: 0.85rem; color: #4a5568;">
                        <span>Maximum Marks:</span>
                        <strong style="color: #2d3748;">${res.maxMarks}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0; font-size: 0.85rem; color: #4a5568;">
                        <span>Marks Lost:</span>
                        <strong style="color: #c53030;">${res.maxMarks - res.score}</strong>
                    </div>
                </div>

                <div style="display: flex; gap: 0.4rem; width: 100%; justify-content: space-between; margin-top: auto;">
                    <div style="flex: 1; display: flex; flex-direction: column; align-items: center; padding: 0.4rem 0.2rem; border-radius: 8px; font-size: 0.7rem; font-weight: 600; text-align: center; background-color: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d;">
                        <span style="font-size: 1rem; font-weight: 900; margin-bottom: 0.1rem;">${correctCount}</span>
                        <span>Correct</span>
                    </div>
                    <div style="flex: 1; display: flex; flex-direction: column; align-items: center; padding: 0.4rem 0.2rem; border-radius: 8px; font-size: 0.7rem; font-weight: 600; text-align: center; background-color: #fffaf0; border: 1px solid #fef3c7; color: #b7791f;">
                        <span style="font-size: 1rem; font-weight: 900; margin-bottom: 0.1rem;">${partialCount}</span>
                        <span>Partial</span>
                    </div>
                    <div style="flex: 1; display: flex; flex-direction: column; align-items: center; padding: 0.4rem 0.2rem; border-radius: 8px; font-size: 0.7rem; font-weight: 600; text-align: center; background-color: #fff5f5; border: 1px solid #fed7d7; color: #c53030;">
                        <span style="font-size: 1rem; font-weight: 900; margin-bottom: 0.1rem;">${incorrectCount}</span>
                        <span>Incorrect</span>
                    </div>
                </div>
                
                <div style="text-align: center; color: #718096; font-size: 0.72rem; margin-top: 1rem; border-top: 1px dashed #e2e8f0; padding-top: 0.5rem; width: 100%;">Time Evaluated: ${timeStr}</div>
            </div>

            <!-- Right Question Grid Card -->
            <div style="flex: 1.5; min-width: 300px; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 16px; padding: 1rem; box-shadow: 0 4px 12px rgba(0,0,0,0.01); display: flex; flex-direction: column;">
                <div style="font-weight: 700; font-size: 0.8rem; color: #1e3c72; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem;">📋 Question Performance</div>
                
                <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.4rem; margin-bottom: 0.75rem;">
                    ${questionsArr.map((q, idx) => {
                        const eM = Number(q.earnedMarks !== undefined ? q.earnedMarks : (q.score || 0));
                        const mM = Number(q.marks !== undefined ? q.marks : (q.maxMarks || 1));
                        const qLabel = q.questionNumber || `Q${idx + 1}`;
                        
                        let bg = '#f0fdf4';
                        let border = '#bbf7d0';
                        let color = '#15803d';
                        let icon = '✓';
                        if (eM === 0) {
                            bg = '#fff5f5';
                            border = '#fed7d7';
                            color = '#c53030';
                            icon = '✗';
                        } else if (eM < mM) {
                            bg = '#fffaf0';
                            border = '#fef3c7';
                            color = '#b7791f';
                            icon = '!';
                        }

                        return `
                            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid ${border}; background-color: ${bg}; color: ${color}; padding: 0.4rem 0.2rem; font-size: 0.7rem;">
                                <span style="font-weight: 700; margin-bottom: 0.15rem;">${qLabel}</span>
                                <span style="font-size: 0.95rem; margin-bottom: 0.15rem;">${icon}</span>
                                <span style="font-weight: 500; opacity: 0.85;">${eM}/${mM}</span>
                            </div>
                        `;
                    }).join('')}
                </div>

                <div style="display: flex; gap: 0.5rem; font-size: 0.68rem; font-weight: 600; color: #718096; margin-top: auto; border-top: 1px solid #edf2f7; padding-top: 0.5rem; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 0.2rem;"><span style="color: #15803d;">✓</span> Correct (Full Marks)</div>
                    <div style="display: flex; align-items: center; gap: 0.2rem;"><span style="color: #b7791f;">!</span> Partial (Partial Marks)</div>
                    <div style="display: flex; align-items: center; gap: 0.2rem;"><span style="color: #c53030;">✗</span> Incorrect (No Marks)</div>
                </div>

                <div style="background-color: #f0f4f8; border: 1px solid #d0d7de; border-left: 4px solid #1e3c72; border-radius: 8px; padding: 0.5rem 0.75rem; font-size: 0.75rem; color: #3182ce; line-height: 1.3; display: flex; align-items: flex-start; gap: 0.35rem; margin-top: 0.75rem; text-align: left;">
                    <span>💡</span>
                    <span><strong>Note:</strong> This sheet lists only the questions where marks were lost. Review your mistakes and the model answers below to prepare for corrections.</span>
                </div>
            </div>

        </div>

        <h4 style="color: #1e3c72; border-bottom: 1px solid #edf2f7; padding-bottom: 0.25rem; margin-top: 1.5rem; margin-bottom: 0.5rem; font-size: 1.1rem; font-weight: 700;">📋 Performance Summary</h4>
        <p style="font-size: 0.95rem; color: #4a5568; line-height: 1.5; margin: 0;">${escapeHtml(res.overallFeedback)}</p>

        <h4 style="color: #1e3c72; border-bottom: 1px solid #edf2f7; padding-bottom: 0.25rem; margin-top: 1.5rem; margin-bottom: 0.5rem; font-size: 1.1rem; font-weight: 700;">🚀 Recommended Areas to Improve</h4>
        <ul style="padding-left: 1.25rem; margin: 0; line-height: 1.5; font-size: 0.95rem; color: #4a5568;">
            ${res.improvements.map(imp => `<li>${escapeHtml(imp)}</li>`).join('')}
        </ul>

        ${(() => {
            const resultsArr = res.results || res.breakdown;
            if (resultsArr && resultsArr.length > 0) {
                const wrongQuestions = resultsArr.filter(q => {
                    const earned = q.earnedMarks !== undefined ? q.earnedMarks : (q.score || 0);
                    const max = q.marks !== undefined ? q.marks : (q.maxMarks || 1);
                    return earned < max;
                });
                
                return `
                <h4 style="color: #1e3c72; border-bottom: 1px solid #edf2f7; padding-bottom: 0.25rem; margin-top: 1.5rem; margin-bottom: 0.5rem; font-size: 1.1rem; font-weight: 700;">🔍 Detailed Question Breakdown (Mistakes Only)</h4>
                <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;">
                    ${wrongQuestions.length > 0 ? wrongQuestions.map((q, idx) => {
                        const originalIndex = resultsArr.findIndex(x => x.questionNumber === q.questionNumber || x.questionText === q.questionText);
                        const earned = q.earnedMarks !== undefined ? q.earnedMarks : (q.score || 0);
                        const max = q.marks !== undefined ? q.marks : (q.maxMarks || 1);
                        const studentAns = q.studentAnswer || q.extractedAnswer || q.studentAnswerText || '';
                        const qText = q.questionText || q.questionNumber || `Question ${originalIndex + 1}`;
                        
                        return `
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem; gap: 1rem; align-items: flex-start;">
                                <strong>${escapeHtml(qText)}</strong>
                                <span style="background: #e2e8f0; padding: 0.25rem 0.75rem; border-radius: 12px; font-weight: bold; font-size: 0.9rem; white-space: nowrap; flex-shrink: 0; display: inline-flex; align-items: center; gap: 0.35rem;">
                                    <span>${earned} / ${max}</span>
                                    <span style="cursor: pointer; color: #1e3c72; font-size: 0.85rem;" title="Edit Question Marks" onclick="window.editQuestionScore('${res.id}', ${originalIndex})">✏️</span>
                                </span>
                            </div>
                            ${studentAns ? `<div style="margin-bottom: 0.5rem; font-size: 0.9rem; color: #4a5568;"><strong>Student Answer:</strong> ${escapeHtml(studentAns)}</div>` : ''}
                            ${q.incorrectPhrases && q.incorrectPhrases.length > 0 ? `
                                <div style="margin-bottom: 0.5rem; background: #fff5f5; border: 1px solid #fed7d7; padding: 0.75rem; border-radius: 6px; font-size: 0.85rem;">
                                    <strong style="color: #c53030; display: block; margin-bottom: 0.25rem;">❌ Identified Mistakes in Student Text:</strong>
                                    <ul style="margin: 0; padding-left: 1rem; color: #9b2c2c;">
                                        ${q.incorrectPhrases.map(phrase => `
                                            <li>
                                                <span style="background: #ffebeb; text-decoration: line-through; font-weight: 600;">"${escapeHtml(phrase.wrongText)}"</span> 
                                                &mdash; <span style="font-style: italic; color: #4a5568;">${escapeHtml(phrase.explanation)}</span>
                                            </li>
                                        `).join('')}
                                    </ul>
                                </div>
                            ` : ''}
                            ${q.feedback ? `<div style="font-size: 0.9rem; color: #2b6cb0; margin-bottom: 0.5rem;"><strong>AI Feedback:</strong> ${escapeHtml(q.feedback)}</div>` : ''}
                            ${q.improvements && q.improvements.length > 0 ? `
                                <div style="font-size: 0.85rem; color: #c05621;">
                                    <strong>Required Answer / Corrective Steps:</strong>
                                    <ul style="margin: 0; padding-left: 1rem;">
                                        ${q.improvements.map(i => `<li>${escapeHtml(i)}</li>`).join('')}
                                    </ul>
                                </div>
                            ` : ''}
                        </div>`;
                    }).join('') : `
                        <div style="text-align: center; padding: 1.5rem; color: #2e7d32;">
                            <strong>Perfect Score! No mistakes to report.</strong>
                        </div>
                    `}
                </div>`;
            }
            return '';
        })()}

        ${appealHtml}
    `;

    if (printBtn) {
        printBtn.onclick = () => window.printReportCard(res.id);
    }

    modal.style.display = 'flex';
};

window.printReportCard = function(resultId) {
    const res = window.currentResults?.find(r => r.id === resultId);
    if (!res) return;

    const completedDate = res.createdAt ? new Date(res.createdAt.seconds * 1000) : new Date();
    const dateStr = completedDate.toLocaleDateString();
    const timeStr = completedDate.toLocaleTimeString();

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("Please allow popups to print reports.");
        return;
    }

    const questionsArr = res.results || res.breakdown || [];
    let totalMarks = 0;
    let earnedMarks = 0;
    questionsArr.forEach(q => {
        totalMarks += q.marks !== undefined ? q.marks : (q.maxMarks || 0);
        earnedMarks += q.earnedMarks !== undefined ? q.earnedMarks : (q.score || 0);
    });

    const pct = Math.round((earnedMarks / totalMarks) * 100);

    // Fetch marking scheme text dynamically
    let markingSchemeText = '';
    if (window.currentSessions) {
        const sess = window.currentSessions.find(s => s.id === res.sessionId);
        if (sess) {
            markingSchemeText = sess.markingScheme || '';
        }
    }

    let grade = 'F';
    let performance = 'Needs Work';
    if (pct >= 90) { grade = 'A+'; performance = 'Excellent'; }
    else if (pct >= 80) { grade = 'A'; performance = 'Very Good'; }
    else if (pct >= 70) { grade = 'B'; performance = 'Good'; }
    else if (pct >= 50) { grade = 'C'; performance = 'Average'; }
    else if (pct >= 33) { grade = 'D'; performance = 'Below Average'; }

    let correctCount = 0;
    let partialCount = 0;
    let incorrectCount = 0;

    questionsArr.forEach(q => {
        const eM = Number(q.earnedMarks !== undefined ? q.earnedMarks : (q.score || 0));
        const mM = Number(q.marks !== undefined ? q.marks : (q.maxMarks || 1));
        if (eM === mM) {
            correctCount++;
        } else if (eM === 0) {
            incorrectCount++;
        } else {
            partialCount++;
        }
    });

    printWindow.document.write(`
        <html>
        <head>
            <title>Report Card - ${res.studentName || 'Student'}</title>
            <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap" rel="stylesheet">
            <style>
                @page {
                    size: auto;
                    margin: 0;
                }
                *, *:before, *:after {
                    box-sizing: border-box !important;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }
                body { 
                    font-family: 'Poppins', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    padding: 10mm 15mm !important;
                    margin: 0;
                    color: #2d3748; 
                    line-height: 1.5; 
                }
                .header { border-bottom: 4px solid #1e3c72; padding-bottom: 0.5rem; margin-bottom: 1rem; text-align: center; }
                .header h1 { margin: 0; color: #1e3c72; font-size: 2rem; font-weight: 800; letter-spacing: 1px; }
                .header p { margin: 6px 0 0 0; color: #718096; font-size: 0.85rem; letter-spacing: 2px; text-transform: uppercase; font-weight: 600; }
                
                .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin-bottom: 1rem; background: #f8fafc; padding: 0.75rem; border-radius: 12px; border: 1px solid #e2e8f0; }
                .meta-item { display: flex; flex-direction: column; gap: 0.15rem; font-size: 0.95rem; }
                .meta-item .label { font-weight: 500; color: #718096; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; }
                .meta-item .value { font-weight: 700; color: #2d3748; }

                .dashboard-split { display: flex; gap: 1rem; margin-bottom: 1.5rem; align-items: stretch; flex-wrap: wrap; }
                .score-card-left { flex: 1; min-width: 250px; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 16px; padding: 1rem; display: flex; flex-direction: column; align-items: center; justify-content: space-between; }
                .perf-card-right { flex: 1.5; min-width: 300px; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 16px; padding: 1rem; display: flex; flex-direction: column; }
                
                .card-title { font-weight: 700; font-size: 0.8rem; color: #c53030; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem; }
                .score-display { font-size: 2.75rem; font-weight: 900; color: #c53030; line-height: 1; margin: 0.25rem 0 0.5rem 0; text-align: center; }
                
                .score-stats { width: 100%; border-top: 1px solid #edf2f7; padding-top: 0.5rem; margin-bottom: 0.75rem; }
                .stat-row { display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0; font-size: 0.85rem; color: #4a5568; }
                
                .badge-row { display: flex; gap: 0.4rem; width: 100%; justify-content: space-between; margin-top: auto; }
                .badge-box { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 0.4rem 0.2rem; border-radius: 8px; font-size: 0.7rem; font-weight: 600; text-align: center; }
                .badge-box.correct { background-color: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
                .badge-box.partial { background-color: #fffaf0; border: 1px solid #fef3c7; color: #b7791f; }
                .badge-box.incorrect { background-color: #fff5f5; border: 1px solid #fed7d7; color: #c53030; }
                .badge-num { font-size: 1rem; font-weight: 900; margin-bottom: 0.1rem; }

                .perf-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.4rem; margin-bottom: 0.75rem; }
                .perf-badge { display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid transparent; padding: 0.4rem 0.2rem; font-size: 0.7rem; }
                .perf-badge.correct { background-color: #f0fdf4; border-color: #bbf7d0; color: #15803d; }
                .perf-badge.partial { background-color: #fffaf0; border-color: #fef3c7; color: #b7791f; }
                .perf-badge.incorrect { background-color: #fff5f5; border-color: #fed7d7; color: #c53030; }
                
                .legend-row { display: flex; gap: 0.5rem; font-size: 0.68rem; font-weight: 600; color: #718096; margin-top: auto; border-top: 1px solid #edf2f7; padding-top: 0.5rem; flex-wrap: wrap; }
                .info-note { background-color: #f0f4f8; border: 1px solid #d0d7de; border-left: 4px solid #1e3c72; border-radius: 8px; padding: 0.5rem 0.75rem; font-size: 0.75rem; color: #3182ce; line-height: 1.3; display: flex; align-items: flex-start; gap: 0.35rem; margin-top: 0.75rem; text-align: left; }

                .section-title { color: #1e3c72; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.4rem; margin-top: 1.5rem; font-size: 1.15rem; font-weight: 700; }
                ul { padding-left: 1.25rem; }
                li { margin-bottom: 0.4rem; font-size: 0.9rem; color: #4a5568; }
                p { font-size: 0.9rem; color: #4a5568; }
                
                .report-block {
                    display: inline-block;
                    width: 100%;
                    break-inside: avoid !important;
                    page-break-inside: avoid !important;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>NERD TUTORS</h1>
                <p>EVALUATION REPORT CARD</p>
            </div>
            
            <div class="meta-grid">
                <div class="meta-item">
                    <span class="label">Student Name</span>
                    <span class="value">${res.studentName || 'Student'}</span>
                </div>
                <div class="meta-item">
                    <span class="label">Date Evaluated</span>
                    <span class="value">${dateStr}</span>
                </div>
                <div class="meta-item">
                    <span class="label">Class</span>
                    <span class="value">${res.class || 'N/A'}</span>
                </div>
                <div class="meta-item">
                    <span class="label">Subject</span>
                    <span class="value">${res.subject || 'N/A'}</span>
                </div>
            </div>

            <!-- Split Dashboard Panel -->
            <div class="dashboard-split">
                
                <!-- Left Score Card -->
                <div class="score-card-left report-block">
                    <div class="card-title">🏆 Final Score</div>
                    <div class="score-display">${earnedMarks} / ${totalMarks}</div>
                    <div class="score-stats">
                        <div class="stat-row">
                            <span>Grade:</span>
                            <strong>${grade}</strong>
                        </div>
                        <div class="stat-row">
                            <span>Performance:</span>
                            <strong style="color: #dd6b20;">${performance}</strong>
                        </div>
                        <div class="stat-row">
                            <span>Maximum Marks:</span>
                            <strong>${totalMarks}</strong>
                        </div>
                        <div class="stat-row">
                            <span>Marks Lost:</span>
                            <strong style="color: #c53030;">${totalMarks - earnedMarks}</strong>
                        </div>
                    </div>
                    <div class="badge-row">
                        <div class="badge-box correct">
                            <span class="badge-num">${correctCount}</span>
                            <span>Correct</span>
                        </div>
                        <div class="badge-box partial">
                            <span class="badge-num">${partialCount}</span>
                            <span>Partial</span>
                        </div>
                        <div class="badge-box incorrect">
                            <span class="badge-num">${incorrectCount}</span>
                            <span>Incorrect</span>
                        </div>
                    </div>
                    <div style="text-align: center; color: #718096; font-size: 0.72rem; margin-top: 0.75rem; border-top: 1px dashed #e2e8f0; padding-top: 0.4rem; width: 100%;">Time Evaluated: ${timeStr}</div>
                </div>

                <!-- Right Question Grid Card -->
                <div class="perf-card-right">
                    <div class="card-title" style="color: #1e3c72;">📋 Question Performance</div>
                    <div class="perf-grid">
                        ${questionsArr.map((q, idx) => {
                            const eM = Number(q.earnedMarks !== undefined ? q.earnedMarks : (q.score || 0));
                            const mM = Number(q.marks !== undefined ? q.marks : (q.maxMarks || 1));
                            const qLabel = q.questionNumber || `Q${idx + 1}`;
                            
                            let bgClass = 'correct';
                            let icon = '✓';
                            if (eM === 0) {
                                bgClass = 'incorrect';
                                icon = '✗';
                            } else if (eM < mM) {
                                bgClass = 'partial';
                                icon = '!';
                            }

                            return `
                                <div class="perf-badge ${bgClass}">
                                    <span style="font-weight: 700; margin-bottom: 0.15rem;">${qLabel}</span>
                                    <span style="font-size: 0.95rem; margin-bottom: 0.15rem;">${icon}</span>
                                    <span style="font-weight: 500; opacity: 0.85;">${eM}/${mM}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="legend-row">
                        <div><span style="color: #15803d;">✓</span> Correct (Full Marks)</div>
                        <div><span style="color: #b7791f;">!</span> Partial (Partial Marks)</div>
                        <div><span style="color: #c53030;">✗</span> Incorrect (No Marks)</div>
                    </div>
                    <div class="info-note">
                        <span>💡</span>
                        <span><strong>Note:</strong> This sheet lists only the questions where marks were lost. Review your mistakes and the model answers below to prepare for corrections.</span>
                    </div>
                </div>
            </div>

            ${res.improvements && res.improvements.length > 0 ? `
            <div class="report-block">
                <h3 class="section-title">🚀 Areas to Improve</h3>
                <ul>
                    ${res.improvements.map(imp => `<li>${imp}</li>`).join('')}
                </ul>
            </div>
            ` : ''}

            ${(() => {
                const wrongQuestions = questionsArr.filter(q => {
                    const earned = Number(q.earnedMarks !== undefined ? q.earnedMarks : (q.score || 0));
                    const max = Number(q.marks !== undefined ? q.marks : (q.maxMarks || 1));
                    return earned < max;
                });
                
                if (wrongQuestions.length > 0) {
                    return `
                    <h3 class="section-title">🔍 Detailed Question-by-Question Mistakes</h3>
                    <div style="margin-top: 1rem;">
                        ${wrongQuestions.map((q, idx) => {
                            const originalIndex = questionsArr.findIndex(x => x.questionNumber === q.questionNumber || x.questionText === q.questionText);
                            const earned = q.earnedMarks !== undefined ? q.earnedMarks : (q.score || 0);
                            const max = q.marks !== undefined ? q.marks : (q.maxMarks || 1);
                            const studentAns = q.studentAnswer || q.extractedAnswer || q.studentAnswerText || '';
                            const qText = q.questionText || q.questionNumber || `Question ${originalIndex + 1}`;
                            const correctAns = q.modelAnswer || getCorrectAnswer(markingSchemeText, originalIndex);
                            
                            return `
                            <div class="report-block" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; display: inline-block; width: 100%; break-inside: avoid; page-break-inside: avoid;">
                                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem; margin-bottom: 0.5rem; gap: 1rem; align-items: flex-start;">
                                    <strong>${qText}</strong>
                                    <span style="font-weight: bold; background: #fed7d7; color: #9b2c2c; padding: 0.25rem 0.75rem; border-radius: 12px; white-space: nowrap; flex-shrink: 0;">${earned} / ${max}</span>
                                </div>
                                ${studentAns ? `<p style="margin: 0 0 0.5rem 0; font-size: 0.95rem;"><strong>Student Answer:</strong> <em>"${studentAns}"</em></p>` : ''}
                                ${q.incorrectPhrases && q.incorrectPhrases.length > 0 ? `
                                    <div style="margin: 0.5rem 0; background: #fff5f5; border: 1px solid #fed7d7; padding: 0.75rem; border-radius: 6px; font-size: 0.9rem; break-inside: avoid;">
                                        <strong style="color: #c53030; display: block; margin-bottom: 0.25rem;">❌ Identified Mistakes in Student Text:</strong>
                                        <ul style="margin: 0; padding-left: 1.25rem; color: #9b2c2c;">
                                            ${q.incorrectPhrases.map(phrase => `
                                                <li>
                                                    <span style="background: #ffebeb; text-decoration: line-through; font-weight: 600;">"${phrase.wrongText}"</span> 
                                                    &mdash; <span style="font-style: italic; color: #4a5568;">${phrase.explanation}</span>
                                                </li>
                                            `).join('')}
                                        </ul>
                                    </div>
                                ` : ''}
                                ${q.feedback ? `<p style="margin: 0 0 0.5rem 0; font-size: 0.95rem; color: #c53030;"><strong>Feedback:</strong> ${q.feedback}</p>` : ''}
                                <div style="margin-top: 0.5rem; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 0.75rem; border-radius: 6px; font-size: 0.9rem; color: #15803d; line-height: 1.5;">
                                    <strong>🔑 Correct Answer:</strong>
                                    <div style="margin-top: 0.25rem;">${correctAns}</div>
                                </div>
                                ${q.improvements && q.improvements.length > 0 ? `
                                    <div style="font-size: 0.9rem; color: #dd6b20; margin-top: 0.5rem;">
                                        <strong>Required Answer / Corrective Steps:</strong>
                                        <ul style="margin: 0.25rem 0 0 0;">
                                            ${q.improvements.map(i => `<li>${i}</li>`).join('')}
                                        </ul>
                                    </div>
                                ` : ''}
                            </div>
                            `;
                        }).join('')}
                    </div>`;
                }
                return '';
            })()}
            
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.title = "Nerd Tutors - " + res.studentName;
    printWindow.document.close();
};

export async function populateMockData() {
    const btn = document.getElementById('btnPopulateMockData');
    if (btn) btn.disabled = true;
    showToast("Generating mock test data...", "info");

    try {
        // 1. Create Session A: Grade 12 Economics (10-Question Master Test)
        const sessionA = await addDoc(collection(db, 'testSessions'), {
            class: "Class 12th",
            subject: "Economics",
            name: "Economics 10-Question Master Test",
            maxMarks: 100,
            questions: `Q1. Define microeconomics. (10 marks)
Q2. What is price elasticity of demand? (10 marks)
Q3. Explain the law of variable proportions. (10 marks)
Q4. What is perfect competition? (10 marks)
Q5. Define GDP. (10 marks)
Q6. What is marginal propensity to consume (MPC)? (10 marks)
Q7. Explain the function of Central Bank as banker's bank. (10 marks)
Q8. Difference between direct and indirect taxes. (10 marks)
Q9. What is balance of payments (BOP)? (10 marks)
Q10. Define aggregate demand. (10 marks)`,
            markingScheme: `Q1. Give 10 marks for definition of individual economic units behavior study.
Q2. Give 10 marks for price responsiveness definition & formula (% change in QD / % change in P).
Q3. Give 10 marks for stage-wise explanations of marginal product behavior (initially rises, then falls, then negative).
Q4. Give 10 marks for naming key features (large buyers/sellers, homogeneous product, free entry/exit).
Q5. Give 10 marks for definition of total money value of final goods/services within domestic territory in a year.
Q6. Give 10 marks for ratio definition & formula (Delta C / Delta Y) lying between 0 and 1.
Q7. Give 10 marks for mentioning accepts deposits, grants loans, and lender of last resort function.
Q8. Give 10 marks for correct definition & shiftability explanation (direct tax cannot shift burden, indirect tax shifts burden).
Q9. Give 10 marks for definition of systematic record of economic transactions between residents and rest of the world.
Q10. Give 10 marks for total value sectors plan to buy and formula AD = C + I + G + (X-M).`,
            createdAt: serverTimestamp()
        });

        // 2. Create Session B: Grade 10 Social Science
        const sessionB = await addDoc(collection(db, 'testSessions'), {
            class: "Class 10th",
            subject: "Social Science",
            name: "SST Quiz (Mock)",
            maxMarks: 50,
            questions: "Q1. What is democracy?\nQ2. Explain sustainable development.",
            markingScheme: "Q1. 25 marks for citizen rights & voting representation. Q2. 25 marks for resources conservation.",
            createdAt: serverTimestamp()
        });

        // 3. Create 5 results for Session A (Class 12 Economics)
        const studentsA = [
            { name: "Amit Pathak", score: 92, potential: "Low", summary: "N/A" },
            { name: "Priya Sharma", score: 85, potential: "Low", summary: "N/A" },
            { name: "Rahul Verma", score: 48, potential: "High", summary: "Student defined Law of Demand perfectly but got marked down 15 marks by human error." },
            { name: "Sneha Reddy", score: 76, potential: "Medium", summary: "Circular flow explanation was correct but examiner missed 5 marks on diagrams." },
            { name: "Jatin Thacker", score: 98, potential: "Low", summary: "N/A" }
        ];

        for (const s of studentsA) {
            await addDoc(collection(db, 'testResults'), {
                studentName: s.name,
                class: "Class 12th",
                subject: "Economics",
                sessionId: sessionA.id,
                score: s.score,
                maxMarks: 100,
                overallFeedback: `Excellent conceptual clarity shown by ${s.name}. Answer structure aligns well with model answers.`,
                improvements: [
                    "Improve handwriting legibility in definitions.",
                    "Provide graphical illustrations for curve representation where applicable."
                ],
                totalAppealPotential: s.potential,
                appealSummary: s.summary,
                breakdown: [
                    {
                        questionNumber: "Q1",
                        questionText: "Define Law of Demand.",
                        score: Math.min(s.score, 50),
                        maxMarks: 50,
                        studentAnswerText: "Quantity demanded goes down when price goes up.",
                        feedback: "Good response.",
                        improvements: ["Add ceteris paribus clause."],
                        appealPotential: s.potential,
                        appealJustification: s.summary
                    }
                ],
                createdAt: serverTimestamp()
            });
        }

        // 4. Create 5 results for Session B (Class 10 Social Science)
        const studentsB = [
            { name: "Vikram Malhotra", score: 44, potential: "Low", summary: "N/A" },
            { name: "Kunal Sen", score: 38, potential: "Medium", summary: "Citizens representation points deserved 5 extra marks." },
            { name: "Ananya Iyer", score: 18, potential: "Low", summary: "N/A" },
            { name: "Rohit Bansal", score: 49, potential: "Low", summary: "N/A" },
            { name: "Nisha Gupta", score: 32, potential: "High", summary: "Democracy definition was fully matching grading criteria but was marked zero." }
        ];

        for (const s of studentsB) {
            await addDoc(collection(db, 'testResults'), {
                studentName: s.name,
                class: "Class 10th",
                subject: "Social Science",
                sessionId: sessionB.id,
                score: s.score,
                maxMarks: 50,
                overallFeedback: `Solid understanding of SST core principles. Good attempt.`,
                improvements: [
                    "Give real-world country examples in political science.",
                    "Be more precise about environmental sustainability acts."
                ],
                totalAppealPotential: s.potential,
                appealSummary: s.summary,
                breakdown: [
                    {
                        questionNumber: "Q1",
                        questionText: "What is democracy?",
                        score: Math.min(s.score, 25),
                        maxMarks: 25,
                        studentAnswerText: "Government by the people, of the people, for the people.",
                        feedback: "Excellent definition.",
                        improvements: ["None"],
                        appealPotential: s.potential,
                        appealJustification: s.summary
                    }
                ],
                createdAt: serverTimestamp()
            });
        }

        showToast("Successfully generated 10 student evaluations!", "success");
        loadTestSessionsForDropdown();
    } catch (err) {
        console.error("Failed to populate mock data:", err);
        showToast("Mock data insertion failed: " + err.message, "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

export async function loadTestSessionsForManagement() {
    const tbody = document.getElementById('sessionManageTableBody');
    if (!tbody) return;

    try {
        const q = query(collection(db, 'testSessions'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        
        let html = '';
        if (querySnapshot.empty) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="padding: 1.5rem; text-align: center; color: #666; font-style: italic;">
                        No published test sessions found. Create one above!
                    </td>
                </tr>
            `;
            return;
        }

        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            const status = data.status || 'active';
            const isActive = status === 'active';
            
            html += `
                <tr style="border-bottom: 1px solid #edf2f7;">
                    <td style="padding: 0.75rem; font-weight: 600; color: #2d3748;">${escapeHtml(data.name)}</td>
                    <td style="padding: 0.75rem; color: #4a5568;">${escapeHtml(data.class)}</td>
                    <td style="padding: 0.75rem; color: #4a5568;">${escapeHtml(data.subject)}</td>
                    <td style="padding: 0.75rem; color: #4a5568;">${data.maxMarks}</td>
                    <td style="padding: 0.75rem;">
                        <span style="background: ${isActive ? '#c6f6d5' : '#fed7d7'}; color: ${isActive ? '#22543d' : '#742a2a'}; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700; text-transform: uppercase;">
                            ${status}
                        </span>
                    </td>
                    <td style="padding: 0.75rem; text-align: right;">
                        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center; flex-wrap: wrap;">
                            <button style="padding: 0.3rem 0.6rem; font-size: 0.8rem; border-radius: 4px; border: 1px solid #cbd5e0; background: #e0f2fe; color: #0369a1; cursor: pointer; font-weight: 600; white-space: nowrap;" onclick="window.editSession('${id}')">
                                ✏️ Edit
                            </button>
                            <button style="padding: 0.3rem 0.6rem; font-size: 0.8rem; border-radius: 4px; border: 1px solid #cbd5e0; background: white; cursor: pointer; font-weight: 600; white-space: nowrap;" onclick="window.toggleSessionStatus('${id}', '${status}')">
                                ${isActive ? '⏸️ Deactivate' : '▶️ Activate'}
                            </button>
                            <button style="padding: 0.3rem 0.6rem; font-size: 0.8rem; border-radius: 4px; border: none; background: #e53e3e; color: white; cursor: pointer; font-weight: 600; white-space: nowrap;" onclick="window.deleteSession('${id}')">
                                🗑️ Delete
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    } catch (error) {
        console.error('Error loading sessions for management:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="padding: 1.5rem; text-align: center; color: #e53e3e; font-weight: 600;">
                    Error loading test sessions.
                </td>
            </tr>
        `;
    }
}

async function toggleSessionStatus(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
        await updateDoc(doc(db, 'testSessions', id), {
            status: newStatus
        });
        showToast(`Test Session status changed to ${newStatus}!`, 'success');
        loadTestSessionsForManagement();
        loadTestSessionsForDropdown();
    } catch (error) {
        console.error("Error updating session status:", error);
        showToast("Failed to update status: " + error.message, "error");
    }
}

async function deleteSession(id) {
    if (!confirm("Are you sure you want to delete this test session? Students will no longer be able to submit results for it.")) return;

    try {
        await deleteDoc(doc(db, 'testSessions', id));
        showToast("Test Session deleted successfully!", "success");
        loadTestSessionsForManagement();
        loadTestSessionsForDropdown();
    } catch (error) {
        console.error("Error deleting session:", error);
        showToast("Failed to delete session: " + error.message, "error");
    }
}

async function deleteResult(id) {
    if (!confirm("Are you sure you want to delete this student evaluation result?")) return;

    try {
        await deleteDoc(doc(db, 'testResults', id));
        showToast("Student result deleted successfully!", "success");
        // Reload results table for current session
        const resultSessionSelect = document.getElementById('resultSessionSelect');
        if (resultSessionSelect && resultSessionSelect.value) {
            loadResultsForSession(resultSessionSelect.value);
        }
    } catch (error) {
        console.error("Error deleting student result:", error);
        showToast("Failed to delete result: " + error.message, "error");
    }
}

async function editStudentScore(id, currentScore, maxMarks) {
    document.getElementById('editScoreModalTitle').textContent = '✏️ Edit Total Score';
    document.getElementById('editScoreInputLabel').textContent = `Enter Total Marks (Max: ${maxMarks}):`;
    
    const inputVal = document.getElementById('editScoreInputValue');
    inputVal.value = currentScore;
    inputVal.max = maxMarks;

    document.getElementById('editScoreTargetId').value = id;
    document.getElementById('editScoreTargetType').value = 'total';
    document.getElementById('editScoreTargetIndex').value = '';

    const modal = document.getElementById('editScoreModal');
    if (modal) modal.style.display = 'flex';
}

async function editQuestionScore(resultId, questionIndex) {
    const res = window.currentResults?.find(r => r.id === resultId);
    if (!res) return;

    const breakdown = res.results || res.breakdown || [];
    const targetQ = breakdown[questionIndex];
    if (!targetQ) return;

    const earned = targetQ.earnedMarks !== undefined ? targetQ.earnedMarks : (targetQ.score || 0);
    const max = targetQ.marks !== undefined ? targetQ.marks : (targetQ.maxMarks || 1);

    document.getElementById('editScoreModalTitle').textContent = '✏️ Edit Question Score';
    document.getElementById('editScoreInputLabel').textContent = `Change score for "${targetQ.questionText || targetQ.questionNumber || 'Question'}" (Max: ${max}):`;

    const inputVal = document.getElementById('editScoreInputValue');
    inputVal.value = earned;
    inputVal.max = max;

    document.getElementById('editScoreTargetId').value = resultId;
    document.getElementById('editScoreTargetType').value = 'question';
    document.getElementById('editScoreTargetIndex').value = questionIndex;

    const modal = document.getElementById('editScoreModal');
    if (modal) modal.style.display = 'flex';
}

// Submit listener for score updates
document.getElementById('editScoreForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editScoreTargetId').value;
    const type = document.getElementById('editScoreTargetType').value;
    const indexStr = document.getElementById('editScoreTargetIndex').value;
    const newScore = parseFloat(document.getElementById('editScoreInputValue').value);
    const maxVal = parseFloat(document.getElementById('editScoreInputValue').max) || 1000;

    const modal = document.getElementById('editScoreModal');
    if (isNaN(newScore) || newScore < 0 || newScore > maxVal) {
        alert(`Please enter a valid number between 0 and ${maxVal}.`);
        return;
    }

    try {
        if (type === 'total') {
            await updateDoc(doc(db, 'testResults', id), {
                score: newScore
            });
            showToast("Student total score updated successfully!", "success");
        } else {
            const res = window.currentResults?.find(r => r.id === id);
            if (!res) return;

            const breakdown = res.results || res.breakdown || [];
            const targetQ = breakdown[parseInt(indexStr)];
            if (!targetQ) return;

            if (targetQ.earnedMarks !== undefined) {
                targetQ.earnedMarks = newScore;
            } else {
                targetQ.score = newScore;
            }

            // Recalculate total score
            let newTotalScore = 0;
            breakdown.forEach(q => {
                newTotalScore += parseFloat(q.earnedMarks !== undefined ? q.earnedMarks : (q.score || 0));
            });

            await updateDoc(doc(db, 'testResults', id), {
                score: newTotalScore,
                results: breakdown,
                breakdown: breakdown
            });

            res.score = newTotalScore;
            showToast("Question score updated successfully!", "success");
            window.viewReportCard(id);
        }

        if (modal) modal.style.display = 'none';

        // Reload results table
        const resultSessionSelect = document.getElementById('resultSessionSelect');
        if (resultSessionSelect && resultSessionSelect.value) {
            loadResultsForSession(resultSessionSelect.value);
        }
    } catch (error) {
        console.error("Error saving score change:", error);
        showToast("Failed to save score: " + error.message, "error");
    }
});

async function editSession(id) {
    try {
        const docRef = doc(db, 'testSessions', id);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
            showToast("Session not found", "error");
            return;
        }
        const data = docSnap.data();
        
        // Populate modal inputs
        document.getElementById('editSessionId').value = id;
        document.getElementById('editSessionName').value = data.name || '';
        document.getElementById('editSessionClass').value = data.class || 'Class 12th';
        document.getElementById('editSessionSubject').value = data.subject || 'Economics';
        document.getElementById('editSessionMaxMarks').value = data.maxMarks || 100;
        document.getElementById('editSessionQuestions').value = data.questions || '';
        document.getElementById('editSessionMarkingScheme').value = data.markingScheme || '';
        document.getElementById('editSessionOtherInstructions').value = data.otherInstructions || '';

        // Show Modal
        const modal = document.getElementById('editSessionModal');
        if (modal) modal.classList.add('show');
    } catch (error) {
        console.error("Error loading session for editing:", error);
        showToast("Failed to load session details", "error");
    }
}

// Bind Close and Submit events for the Session Edit Modal
document.getElementById('btnCloseSessionModal')?.addEventListener('click', () => {
    document.getElementById('editSessionModal')?.classList.remove('show');
});

document.getElementById('editSessionModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('editSessionModal')) {
        document.getElementById('editSessionModal')?.classList.remove('show');
    }
});

document.getElementById('editSessionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editSessionId').value;
    const name = document.getElementById('editSessionName').value;
    const cls = document.getElementById('editSessionClass').value;
    const subject = document.getElementById('editSessionSubject').value;
    const maxMarks = parseInt(document.getElementById('editSessionMaxMarks').value) || 100;
    const questions = document.getElementById('editSessionQuestions').value;
    const markingScheme = document.getElementById('editSessionMarkingScheme').value;
    const otherInstructions = document.getElementById('editSessionOtherInstructions').value;

    try {
        await updateDoc(doc(db, 'testSessions', id), {
            name,
            class: cls,
            subject,
            maxMarks,
            questions,
            markingScheme,
            otherInstructions
        });
        showToast("Test Session updated successfully!", "success");
        document.getElementById('editSessionModal')?.classList.remove('show');
        loadTestSessionsForManagement();
        loadTestSessionsForDropdown();
    } catch (error) {
        console.error("Error updating session:", error);
        showToast("Failed to save changes: " + error.message, "error");
    }
});

// Bind to window for HTML click calls
window.toggleSessionStatus = toggleSessionStatus;
window.deleteSession = deleteSession;
window.deleteResult = deleteResult;
window.editStudentScore = editStudentScore;
window.editQuestionScore = editQuestionScore;
window.editSession = editSession;
