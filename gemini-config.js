// 🔹 Gemini API Configuration (Robust - Supports Vercel Backend & Client-Side Fallback)

// 🔹 Main Evaluation Function
export async function evaluateWithGemini({ question, modelAnswer, studentAnswer, maxMarks }) {
    try {
        console.log('📤 Attempting evaluation via backend...');

        // 1. Try Vercel Backend First
        const response = await fetch('/api/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, modelAnswer, studentAnswer, maxMarks })
        });

        if (response.ok) {
            const result = await response.json();
            console.log('✅ Backend evaluation successful:', result);
            return {
                score: result.score ?? 0,
                improvements: result.improvements ?? [],
                feedback: result.feedback ?? "No feedback available."
            };
        } else {
            console.warn(`⚠️ Backend unavailable (Status: ${response.status}). Switching to client-side fallback.`);
            throw new Error('Backend failed');
        }

    } catch (error) {
        console.log('🔄 Falling back to client-side Gemini call...', error);
        return await evaluateWithClientSide({ question, modelAnswer, studentAnswer, maxMarks });
    }
}

// 🔹 Client-Side Fallback (For Local Testing / Static Hosting)
// 🔹 Single Evaluation Fallback (Non-Interactive)
async function evaluateWithClientSide({ question, modelAnswer, studentAnswer, maxMarks }) {
    console.error("❌ Backend evaluation failed. Client-side fallback is disabled for security.");
    return {
        score: 0,
        improvements: ["System error: Evaluation service unavailable."],
        feedback: "Unable to grade this answer at the moment. Please try again later."
    };
}


// 🔹 Batch Evaluation Function (Optimized for Capacity)
export async function evaluateBatchWithGemini(questions, answers) {
    try {
        console.log('📦 Attempting batch evaluation via backend...');

        // Convert answers Map to Object for JSON serialization if needed, 
        // but wait, appState.answers is a Map? Yes.
        // JSON.stringify handles Map? No, it returns {}.
        // So we must convert it.
        const answersObj = {};
        answers.forEach((value, key) => {
            answersObj[key] = value;
        });

        // 1. Try Vercel Backend First
        const response = await fetch('/api/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                questions,
                answers: answersObj
            })
        });

        if (response.ok) {
            const results = await response.json();
            console.log('✅ Backend batch evaluation successful:', results);
            return results;
        } else {
            // Try to get error details
            let errorMsg = 'Backend failed';
            let details = '';
            try {
                const errorData = await response.json();
                if (errorData.error) errorMsg = errorData.error;
                if (errorData.details) details = `: ${errorData.details}`;
            } catch (e) {
                // If not JSON, use status text
                errorMsg = `Backend Error ${response.status}: ${response.statusText}`;
            }

            const fullError = `${errorMsg}${details}`;
            console.warn(`⚠️ Backend unavailable: ${fullError}`);
            throw new Error(fullError);
        }

    } catch (error) {
        console.error('❌ Batch evaluation failed:', error.message);

        // Return specific error to user
        return questions.map(q => ({
            questionId: q.id,
            score: 0,
            feedback: `System Error: ${error.message}`,
            improvements: ["Please check Vercel logs.", "Ensure API Key is set."]
        }));
    }
}

// 🔹 Batch Evaluation Fallback (Non-Interactive)
async function evaluateBatchClientSide(questions, answers) {
    console.error("❌ Backend batch evaluation failed. Client-side fallback is disabled for security.");
    return questions.map(q => ({
        questionId: q.id,
        score: 0,
        feedback: "System error: Evaluation service unavailable.",
        improvements: ["Please try again later or contact support."]
    }));
}

// 🔹 OCR Evaluation Function (Single Answer)
export async function evaluateWithOCR({ image, mimeType, question, modelAnswer, maxMarks }) {
    try {
        console.log('📸 Attempting OCR evaluation via backend...');

        const response = await fetch('/api/ocr-evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: 'single',
                image,
                mimeType: mimeType || 'image/jpeg',
                question,
                modelAnswer,
                maxMarks: maxMarks || 5
            })
        });

        if (response.ok) {
            const result = await response.json();
            console.log('✅ OCR evaluation successful:', result);
            return result;
        } else {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }
    } catch (error) {
        console.error('❌ OCR evaluation failed:', error);
        return {
            extractedText: '',
            score: 0,
            maxMarks: maxMarks || 5,
            improvements: ['OCR evaluation failed: ' + error.message],
            feedback: 'Could not process the image. Please try again.'
        };
    }
}

// 🔹 OCR Batch Evaluation Function (Full Sheet)
export async function evaluateBatchWithOCR({ image, mimeType, questions }) {
    try {
        console.log(`📄 Attempting OCR batch evaluation (${questions.length} questions)...`);

        const response = await fetch('/api/ocr-evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: 'full-sheet',
                image,
                mimeType: mimeType || 'image/jpeg',
                questions
            })
        });

        if (response.ok) {
            const result = await response.json();
            console.log('✅ OCR batch evaluation successful:', result);
            return result;
        } else {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }
    } catch (error) {
        console.error('❌ OCR batch evaluation failed:', error);
        return {
            extractedText: '',
            results: questions.map(q => ({
                questionId: q.id,
                score: 0,
                maxMarks: q.marks || 5,
                feedback: 'OCR evaluation failed: ' + error.message,
                improvements: ['Please try again with a clearer photo.']
            })),
            totalScore: 0,
            totalMaxMarks: questions.reduce((sum, q) => sum + (q.marks || 5), 0),
            overallFeedback: 'Failed to process the answer sheet.'
        };
    }
}

console.log("✅ Gemini API configured (Backend Only Mode + OCR Support)");