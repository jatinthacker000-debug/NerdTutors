// ============================================
// ANSWER EVALUATOR
// PDF answer-sheet comparison: loads a model answer PDF
// and a student answer PDF as base64, sends them to the
// evaluation API, and renders the comprehensive report card.
// ============================================

import { showToast } from './admin-utils.js';

export function setupAnswerEvaluation() {
    let modelFile = null;
    let studentFile = null;

    const modelFileInput = document.getElementById('modelFileInput');
    const modelUploadArea = document.getElementById('modelUploadArea');
    const modelFileInfo = document.getElementById('modelFileInfo');
    const modelFileName = document.getElementById('modelFileName');
    const btnRemoveModelFile = document.getElementById('btnRemoveModelFile');

    const studentFileInput = document.getElementById('studentFileInput');
    const studentUploadArea = document.getElementById('studentUploadArea');
    const studentFileInfo = document.getElementById('studentFileInfo');
    const studentFileName = document.getElementById('studentFileName');
    const btnRemoveStudentFile = document.getElementById('btnRemoveStudentFile');

    const btnStartEvaluation = document.getElementById('btnStartEvaluation');
    const evalLoading = document.getElementById('evalLoading');
    const evalResults = document.getElementById('evalResults');
    const evalMaxMarks = document.getElementById('evalMaxMarks');

    // Helper to read file as base64
    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64String = reader.result.split(',')[1];
                resolve({
                    data: base64String,
                    mimeType: file.type,
                    name: file.name
                });
            };
            reader.onerror = error => reject(error);
            reader.readAsDataURL(file);
        });
    }

    function updateSubmitButtonState() {
        if (btnStartEvaluation) {
            btnStartEvaluation.disabled = !(modelFile && studentFile);
        }
    }

    // Model Upload handlers
    modelFileInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                modelFile = await readFileAsBase64(file);
                if (modelFileName) modelFileName.textContent = file.name;
                if (modelFileInfo) modelFileInfo.style.display = 'flex';
                if (modelUploadArea) modelUploadArea.style.display = 'none';
                updateSubmitButtonState();
            } catch (err) {
                showToast('Failed to read model answer file', 'error');
            }
        }
    });

    btnRemoveModelFile?.addEventListener('click', () => {
        modelFile = null;
        if (modelFileInput) modelFileInput.value = '';
        if (modelFileInfo) modelFileInfo.style.display = 'none';
        if (modelUploadArea) modelUploadArea.style.display = 'block';
        updateSubmitButtonState();
    });

    // Student Upload handlers
    studentFileInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                studentFile = await readFileAsBase64(file);
                if (studentFileName) studentFileName.textContent = file.name;
                if (studentFileInfo) studentFileInfo.style.display = 'flex';
                if (studentUploadArea) studentUploadArea.style.display = 'none';
                updateSubmitButtonState();
            } catch (err) {
                showToast('Failed to read student answer file', 'error');
            }
        }
    });

    btnRemoveStudentFile?.addEventListener('click', () => {
        studentFile = null;
        if (studentFileInput) studentFileInput.value = '';
        if (studentFileInfo) studentFileInfo.style.display = 'none';
        if (studentUploadArea) studentUploadArea.style.display = 'block';
        updateSubmitButtonState();
    });

    // Drag & Drop for Model Answer
    modelUploadArea?.addEventListener('dragover', (e) => {
        e.preventDefault();
        modelUploadArea.classList.add('dragover');
    });
    modelUploadArea?.addEventListener('dragleave', () => {
        modelUploadArea.classList.remove('dragover');
    });
    modelUploadArea?.addEventListener('drop', async (e) => {
        e.preventDefault();
        modelUploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) {
            try {
                modelFile = await readFileAsBase64(file);
                if (modelFileName) modelFileName.textContent = file.name;
                if (modelFileInfo) modelFileInfo.style.display = 'flex';
                if (modelUploadArea) modelUploadArea.style.display = 'none';
                updateSubmitButtonState();
            } catch (err) {
                showToast('Failed to read model answer file', 'error');
            }
        }
    });

    // Drag & Drop for Student Answer
    studentUploadArea?.addEventListener('dragover', (e) => {
        e.preventDefault();
        studentUploadArea.classList.add('dragover');
    });
    studentUploadArea?.addEventListener('dragleave', () => {
        studentUploadArea.classList.remove('dragover');
    });
    studentUploadArea?.addEventListener('drop', async (e) => {
        e.preventDefault();
        studentUploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) {
            try {
                studentFile = await readFileAsBase64(file);
                if (studentFileName) studentFileName.textContent = file.name;
                if (studentFileInfo) studentFileInfo.style.display = 'flex';
                if (studentUploadArea) studentUploadArea.style.display = 'none';
                updateSubmitButtonState();
            } catch (err) {
                showToast('Failed to read student answer file', 'error');
            }
        }
    });

    // Start Evaluation Action
    btnStartEvaluation?.addEventListener('click', async () => {
        if (!modelFile || !studentFile) return;

        btnStartEvaluation.disabled = true;
        if (evalLoading) evalLoading.style.display = 'block';
        if (evalResults) evalResults.style.display = 'none';

        try {
            const maxMarksVal = evalMaxMarks ? (parseInt(evalMaxMarks.value) || 100) : 100;
            const response = await fetch('/api/ocr-evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'pdf-comparison',
                    modelAnswerFile: modelFile.data,
                    modelAnswerMimeType: modelFile.mimeType,
                    studentAnswerFile: studentFile.data,
                    studentAnswerMimeType: studentFile.mimeType,
                    maxMarks: maxMarksVal
                })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Server error during evaluation');
            }

            const report = await response.json();
            renderReport(report);
            showToast('Evaluation completed successfully!', 'success');
        } catch (error) {
            console.error('Evaluation failed:', error);
            showToast('Evaluation failed: ' + error.message, 'error');
        } finally {
            if (evalLoading) evalLoading.style.display = 'none';
            btnStartEvaluation.disabled = false;
        }
    });

    function renderReport(report) {
        const scoreEl = document.getElementById('evalReportScore');
        const maxEl = document.getElementById('evalReportMax');
        const pctEl = document.getElementById('evalReportPct');
        const feedbackEl = document.getElementById('evalReportFeedback');
        const improvementsList = document.getElementById('evalReportImprovements');
        const breakdownContainer = document.getElementById('evalReportBreakdown');

        if (scoreEl) scoreEl.textContent = report.totalScore ?? 0;
        if (maxEl) maxEl.textContent = report.maxMarks ?? 100;
        
        const pct = report.maxMarks > 0 ? Math.round(((report.totalScore ?? 0) / report.maxMarks) * 100) : 0;
        if (pctEl) pctEl.textContent = pct + '%';
        
        if (feedbackEl) feedbackEl.textContent = report.overallFeedback || 'No overall feedback available.';

        // Render Appeal summary
        const appealContainer = document.getElementById('evalReportAppealContainer');
        const appealPotentialEl = document.getElementById('evalReportAppealPotential');
        const appealSummaryEl = document.getElementById('evalReportAppealSummary');

        if (appealContainer && report.totalAppealPotential) {
            appealContainer.style.display = 'block';
            if (appealPotentialEl) {
                appealPotentialEl.textContent = `Appeal Potential: ${report.totalAppealPotential}`;
                // Set color based on potential
                if (report.totalAppealPotential === 'High') {
                    appealPotentialEl.style.backgroundColor = '#2f855a'; // green
                } else if (report.totalAppealPotential === 'Medium') {
                    appealPotentialEl.style.backgroundColor = '#dd6b20'; // orange
                } else {
                    appealPotentialEl.style.backgroundColor = '#718096'; // grey
                }
            }
            if (appealSummaryEl) {
                appealSummaryEl.textContent = report.appealSummary || 'No appeal summary available.';
            }
        } else if (appealContainer) {
            appealContainer.style.display = 'none';
        }

        // Render Improvements
        if (improvementsList) {
            improvementsList.innerHTML = '';
            if (report.improvements && report.improvements.length > 0) {
                report.improvements.forEach(imp => {
                    const li = document.createElement('li');
                    li.textContent = imp;
                    improvementsList.appendChild(li);
                });
            } else {
                improvementsList.innerHTML = '<li style="color: #666; list-style: none;">No immediate improvement actions needed. Excellent work!</li>';
            }
        }

        // Render Breakdown
        if (breakdownContainer) {
            breakdownContainer.innerHTML = '';

            if (report.results && report.results.length > 0) {
                report.results.forEach(res => {
                    const card = document.createElement('div');
                    card.className = 'breakdown-card';
                    card.style.cssText = 'border: 1px solid #e2e8f0; border-radius: 6px; padding: 1rem; background: #fff; margin-bottom: 0.75rem;';
                    
                    let improvementsHtml = '';
                    if (res.improvements && res.improvements.length > 0) {
                        improvementsHtml = `
                            <div style="margin-top: 0.75rem;">
                                <strong style="color: #2f855a; font-size: 0.85rem;">Suggestions:</strong>
                                <ul style="margin: 0.25rem 0 0 0; padding-left: 1.25rem; font-size: 0.85rem; color: #4a5568;">
                                    ${res.improvements.map(i => `<li>${i}</li>`).join('')}
                                </ul>
                            </div>
                        `;
                    }

                    let appealHtml = '';
                    if (res.appealPotential && res.appealPotential !== 'Low' && res.appealJustification && res.appealJustification !== 'N/A') {
                        appealHtml = `
                            <div style="margin-top: 0.75rem; background: #fffaf0; border: 1px solid #feebc8; border-radius: 6px; padding: 0.75rem; border-left: 3px solid #dd6b20;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                                    <strong style="color: #dd6b20; font-size: 0.85rem;">⚖️ Appeal Case (${res.appealPotential} Potential)</strong>
                                </div>
                                <p style="margin: 0; font-size: 0.85rem; color: #7b341e; line-height: 1.4;">
                                    <strong>Justification:</strong> ${res.appealJustification}
                                </p>
                            </div>
                        `;
                    }

                    card.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                            <span style="font-weight: 700; color: #2d3748;">${res.questionNumber || 'Q'}</span>
                            <span style="background: #edf2f7; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.85rem; font-weight: 600; color: #4a5568;">
                                Score: ${res.score} / ${res.maxMarks}
                            </span>
                        </div>
                        <div style="margin-bottom: 0.5rem; font-size: 0.9rem; color: #718096; font-style: italic;">
                            <strong>Question Description:</strong> ${res.questionText || 'N/A'}
                        </div>
                        <div style="margin-bottom: 0.5rem; font-size: 0.9rem; background: #f7fafc; padding: 0.5rem; border-radius: 4px; border-left: 3px solid #cbd5e0;">
                            <strong>Student Answer Summary:</strong> ${res.studentAnswerText || 'N/A'}
                        </div>
                        <div style="font-size: 0.9rem; color: #4a5568; line-height: 1.5; margin-bottom: 0.5rem;">
                            <strong>Feedback:</strong> ${res.feedback || 'No detailed feedback.'}
                        </div>
                        ${improvementsHtml}
                        ${appealHtml}
                    `;
                    breakdownContainer.appendChild(card);
                });
            } else {
                breakdownContainer.innerHTML = '<p style="color: #666; font-style: italic;">No detailed question-by-question breakdown generated.</p>';
            }
        }

        if (evalResults) {
            evalResults.style.display = 'block';
            evalResults.scrollIntoView({ behavior: 'smooth' });
        }
    }
}
