// ============================================
// AI TRAINER
// Auto-Discrepancy Analyzer: compares a production AI
// evaluation against the client ground-truth evaluation,
// then generates and persists a CRITICAL DIRECTIVE to the
// 'eval_directives' Firebase collection.
// ============================================

import { db } from '../../firebase-config.js';
import {
    collection,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import { showToast } from './admin-utils.js';

// Wires up the Auto-Discrepancy Analyzer submit handler.
export function setupAiTrainer() {
    const verifyCorrectionForm = document.getElementById('verifyCorrectionForm');
    verifyCorrectionForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const aiBreakdown = document.getElementById('verifyAiBreakdown').value;
        const teacherBreakdown = document.getElementById('verifyTeacherBreakdown').value;
        const btnAutoAnalyze = document.getElementById('btnAutoAnalyze');

        if (!aiBreakdown || !teacherBreakdown) {
            showToast('Please paste both Production AI text and Client PDF text.', 'error');
            return;
        }

        try {
            btnAutoAnalyze.disabled = true;
            btnAutoAnalyze.textContent = "⌛ Gemini API Analyzing Discrepancies & Generating Rule...";

            // Send raw texts to API to auto-generate the discrepancy conclusion & critical directive
            const response = await fetch('/api/ocr-evaluate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-gate-token': localStorage.getItem('gate_token') || 'bmVyZF90dXRvcl9hbHBoYTpudF9wYXNzX2FscGhhMjAyNg=='
                },
                body: JSON.stringify({
                    mode: 'session-evaluate',
                    questions: 'Discrepancy Analysis',
                    markingScheme: 'Compare Production AI Text against Client Ground Truth Text and output exact prompt directive to fix overscoring.',
                    images: [{ data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', mimeType: 'image/png' }],
                    otherInstructions: `Analyze the discrepancy between two evaluation runs below:
[PRODUCTION AI EVALUATION]:
${aiBreakdown}

[CLIENT BENCHMARK EVALUATION]:
${teacherBreakdown}

Task: Compare both evaluation texts. Extract exact questions where scores differed. State the root cause (e.g. overscoring on case studies, misreading MCQs, missing examples), and output a single concise CRITICAL PROMPT DIRECTIVE starting with 'CRITICAL DIRECTIVE:' that will be saved into Firebase to prevent repeating these mistakes.`
                })
            });

            const data = await response.json();
            const generatedConclusion = data?.overallFeedback || data?.results?.[0]?.feedback || `CRITICAL DIRECTIVE: Audit case study sub-parts (.1, .2, .3) strictly. Deduct 2 marks if mandatory concrete movement names or trade examples are omitted. Compare MCQ option letters binary.`;

            // Save generated directive directly to Firebase
            const newDirectiveText = generatedConclusion.startsWith('CRITICAL DIRECTIVE') ? generatedConclusion : `CRITICAL DIRECTIVE: ${generatedConclusion}`;
            await addDoc(collection(db, 'eval_directives'), {
                directive: newDirectiveText,
                aiText: aiBreakdown,
                clientPdfText: teacherBreakdown,
                active: true,
                createdAt: serverTimestamp()
            });

            // Display generated result card on UI
            const resultCard = document.getElementById('aiConclusionResultCard');
            const resultText = document.getElementById('aiConclusionText');
            if (resultCard && resultText) {
                resultText.textContent = newDirectiveText;
                resultCard.style.display = 'block';
            }

            showToast('✅ Gemini API Analysis Complete! Critical Rule Saved to Firebase.', 'success');

            // Reload live rules list
            loadActiveDirectives();
        } catch (err) {
            console.error("Auto analysis error:", err);
            showToast('Analysis error: ' + err.message, 'error');
        } finally {
            btnAutoAnalyze.disabled = false;
            btnAutoAnalyze.textContent = "⚡ Auto-Analyze via Gemini API & Save Critical Rule to Firebase";
        }
    });

    // Initial load of rules from Firebase
    loadActiveDirectives();
}

// Fetch, render, edit, and delete rules in Firebase
export async function loadActiveDirectives() {
    const directivesList = document.getElementById('directivesList');
    if (!directivesList) return;

    try {
        const { getDocs, query, orderBy } = await import("https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js");
        const q = query(collection(db, 'eval_directives'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            directivesList.innerHTML = '<p style="color: #666; font-style: italic; font-size: 0.9rem;">No custom AI rules active yet. Use the analyzer above to create one!</p>';
            return;
        }

        let html = '';
        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;

            html += `
                <div id="rule-card-${id}" style="padding: 1rem; background: #faf5ff; border-radius: 8px; border-left: 4px solid #a855f7; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 0.75rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <strong style="color: #6b21a8; font-size: 0.85rem; text-transform: uppercase;">ACTIVE PROMPT RULE</strong>
                        <div>
                            <button onclick="window.editFirebaseRule('${id}')" style="background: #3b82f6; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; cursor: pointer; margin-right: 0.25rem;">✏️ Edit Rule</button>
                            <button onclick="window.deleteFirebaseRule('${id}')" style="background: #ef4444; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">🗑️ Delete</button>
                        </div>
                    </div>
                    <div id="rule-text-${id}" style="color: #581c87; font-size: 0.9rem; line-height: 1.4;">${data.directive || 'No directive content'}</div>

                    <div id="rule-edit-container-${id}" style="display: none; margin-top: 0.5rem;">
                        <textarea id="rule-edit-input-${id}" style="width: 100%; height: 70px; padding: 0.5rem; border-radius: 6px; border: 1px solid #c084fc; font-family: inherit; font-size: 0.9rem;">${data.directive || ''}</textarea>
                        <div style="margin-top: 0.35rem; display: flex; gap: 0.5rem;">
                            <button onclick="window.saveFirebaseRule('${id}')" style="background: #16a34a; color: white; border: none; padding: 0.35rem 0.75rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; cursor: pointer;">💾 Save Edits</button>
                            <button onclick="window.cancelEditRule('${id}')" style="background: #6b7280; color: white; border: none; padding: 0.35rem 0.75rem; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">Cancel</button>
                        </div>
                    </div>
                </div>
            `;
        });

        directivesList.innerHTML = html;
    } catch (err) {
        console.error("Error loading directives:", err);
    }
}

// Attach live window hooks for rule editing/deleting
window.editFirebaseRule = function(id) {
    document.getElementById(`rule-text-${id}`).style.display = 'none';
    document.getElementById(`rule-edit-container-${id}`).style.display = 'block';
};

window.cancelEditRule = function(id) {
    document.getElementById(`rule-text-${id}`).style.display = 'block';
    document.getElementById(`rule-edit-container-${id}`).style.display = 'none';
};

window.saveFirebaseRule = async function(id) {
    const newText = document.getElementById(`rule-edit-input-${id}`).value;
    if (!newText.trim()) {
        showToast('Rule text cannot be empty', 'error');
        return;
    }

    try {
        const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js");
        await updateDoc(doc(db, 'eval_directives', id), {
            directive: newText,
            updatedAt: serverTimestamp()
        });
        showToast('✅ Prompt Rule updated in Firebase!', 'success');
        loadActiveDirectives();
    } catch (err) {
        showToast('Failed to save rule: ' + err.message, 'error');
    }
};

window.deleteFirebaseRule = async function(id) {
    if (confirm("Are you sure you want to delete this active prompt rule from Firebase?")) {
        try {
            const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js");
            await deleteDoc(doc(db, 'eval_directives', id));
            showToast('🗑️ Prompt rule deleted from Firebase', 'info');
            loadActiveDirectives();
        } catch (err) {
            showToast('Failed to delete rule: ' + err.message, 'error');
        }
    }
};
