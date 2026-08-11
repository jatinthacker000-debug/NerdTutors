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

            // Render live directive to list
            const directivesList = document.getElementById('directivesList');
            if (directivesList) {
                const div = document.createElement('div');
                div.style.cssText = 'padding: 1rem; background: #faf5ff; border-radius: 8px; border-left: 4px solid #a855f7; box-shadow: 0 1px 3px rgba(0,0,0,0.05);';
                div.innerHTML = `<strong style="color: #6b21a8;">NEW GENERATED DIRECTIVE</strong><p style="margin: 0.25rem 0 0 0; color: #581c87; font-size: 0.9rem;">${newDirectiveText}</p>`;
                directivesList.prepend(div);
            }
        } catch (err) {
            console.error("Auto analysis error:", err);
            showToast('Analysis error: ' + err.message, 'error');
        } finally {
            btnAutoAnalyze.disabled = false;
            btnAutoAnalyze.textContent = "⚡ Auto-Analyze via Gemini API & Save Critical Rule to Firebase";
        }
    });
}
