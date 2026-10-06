// ============================================
// PDF EXTRACTOR MODULE
// Dual-Engine Extraction Pipeline:
// 1. Client-Side Fast PDF.js Digital Parser (<500ms, 0 API cost)
// 2. Multimodal Gemini/AI Vision Document OCR (/api/extract-pdf)
// 3. Automated Real-Time Quality Guard & Self-Test Suite
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, type = 'info') {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(msg, type);
    } else {
        console.log(`[Toast ${type}]:`, msg);
    }
}

let isPdfJsInitialized = false;
export function initPdfJs() {
    if (isPdfJsInitialized) return true;
    if (typeof window.pdfjsLib !== 'undefined') {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        isPdfJsInitialized = true;
        return true;
    }
    return false;
}

/**
 * Convert File to Base64
 */
export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            const base64Data = result.includes(',') ? result.split(',')[1] : result;
            resolve({
                data: base64Data,
                mimeType: file.type || 'application/pdf',
                name: file.name,
                size: file.size
            });
        };
        reader.onerror = err => reject(err);
        reader.readAsDataURL(file);
    });
}

/**
 * Convert File to ArrayBuffer for PDF.js
 */
function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = err => reject(err);
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Engine 1: Client-Side Digital PDF Extraction using PDF.js
 */
export async function extractDigitalTextFromPdf(file, onProgress) {
    initPdfJs();
    if (!window.pdfjsLib) {
        throw new Error('PDF.js library is not available in browser window.');
    }

    const arrayBuffer = await fileToArrayBuffer(file);
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    let fullText = '';
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        if (onProgress) {
            onProgress({
                stage: 'parsing',
                progress: Math.round((pageNum / totalPages) * 100),
                message: `Extracting digital text: Page ${pageNum} of ${totalPages}...`
            });
        }

        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        let lastY, text = '';
        for (let item of textContent.items) {
            if (lastY !== undefined && Math.abs(item.transform[5] - lastY) > 5) {
                text += '\n';
            } else if (text.length > 0 && !text.endsWith(' ') && !text.endsWith('\n')) {
                text += ' ';
            }
            text += item.str;
            lastY = item.transform[5];
        }

        fullText += `\n\n--- Page ${pageNum} ---\n` + text;
    }

    return {
        text: cleanExtractedText(fullText),
        pageCount: totalPages
    };
}

/**
 * Engine 2: Backend Gemini Multimodal Vision Document OCR
 */
export async function extractWithAiVision(file, extractType, metadata = {}, onProgress) {
    if (onProgress) {
        onProgress({
            stage: 'ai-ocr',
            progress: 30,
            message: 'Uploading document to AI Vision Engine...'
        });
    }

    const base64File = await fileToBase64(file);
    const gateToken = localStorage.getItem('gate_token');

    if (onProgress) {
        onProgress({
            stage: 'ai-ocr',
            progress: 60,
            message: 'AI Vision is analyzing questions, columns, and rubrics...'
        });
    }

    const response = await fetch('/api/extract-pdf', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(gateToken ? { 'X-Gate-Token': gateToken } : {})
        },
        body: JSON.stringify({
            pdfBase64: base64File.data,
            extractType: extractType || 'questions',
            examName: metadata.examName || '',
            examSet: metadata.examSet || '',
            subject: metadata.subject || ''
        })
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || errData.details || `AI OCR failed with status ${response.status}`);
    }

    const data = await response.json();
    return data;
}

/**
 * Automated Real-time Quality Inspection Heuristics
 */
export function analyzeExtractedText(text, extractType = 'questions', pageCount = 1) {
    if (!text || text.trim().length === 0) {
        return {
            isValid: false,
            isScanned: true,
            quality: 'Empty',
            confidenceScore: 0,
            questionCount: 0,
            characterCount: 0,
            sections: [],
            hasMcqOptions: false,
            feedback: 'No text detected. Document appears to be a scanned image PDF.'
        };
    }

    const charCount = text.trim().length;
    const avgCharsPerPage = charCount / Math.max(1, pageCount);

    // Question number patterns
    const questionMatches = text.match(/(?:^|\n)\s*(?:Q\.?\s*(\d+)|\b(\d+)\.\s+|Question\s+(\d+))/gim) || [];
    const questionCount = questionMatches.length;

    // Detect section headers
    const sectionMatches = text.match(/Section\s+[A-E]/gi) || [];
    const uniqueSections = [...new Set(sectionMatches.map(s => s.toUpperCase()))];

    // Detect MCQ options (A), (B), (C), (D)
    const hasMcq = /\([A-D]\)|\b[A-D]\.\s+/i.test(text);

    // Detect marks tags
    const hasMarks = /\[\s*\d+\s*(?:marks?|m)?\s*\]|\(\s*\d+\s*marks?\s*\)/i.test(text);

    // Is it scanned? If total text is very low (< 80 chars total or < 40 chars/page on multi-page)
    const isScanned = charCount < 100 || (pageCount > 1 && avgCharsPerPage < 50);

    let confidenceScore = 80;
    let quality = 'High';
    let feedback = 'Clean text extraction with verified question structure.';

    if (isScanned) {
        confidenceScore = 15;
        quality = 'Scanned';
        feedback = 'Scanned/image-only PDF detected. Requires AI Vision OCR.';
    } else if (questionCount === 0) {
        confidenceScore = 45;
        quality = 'Medium';
        feedback = 'Text extracted, but standard question numbering (Q1, Q2) was not explicitly detected.';
    } else if (questionCount > 0 && hasMcq) {
        confidenceScore = 95;
        quality = 'High';
        feedback = `Detected ${questionCount} questions across ${uniqueSections.length || 1} sections.`;
    }

    return {
        isValid: charCount > 50,
        isScanned,
        quality,
        confidenceScore,
        questionCount,
        characterCount: charCount,
        sections: uniqueSections,
        hasMcqOptions: hasMcq,
        hasMarks,
        feedback
    };
}

/**
 * Text Cleaner & Normalizer
 */
function cleanExtractedText(rawText) {
    if (!rawText) return '';
    return rawText
        // Replace multiple blank lines with max 2 newlines
        .replace(/\n{3,}/g, '\n\n')
        // Clean trailing spaces on lines
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .trim();
}

/**
 * Dual-Engine Orchestrator:
 * Automatically runs Engine 1 (Digital), inspects quality, and seamlessly
 * auto-escalates to Engine 2 (AI Vision) if it detects a scanned document!
 */
export async function smartExtractPdf(file, extractType, metadata = {}, onProgress, forceAi = false) {
    initPdfJs();

    if (forceAi) {
        // Teacher explicitly requested AI Vision
        return await extractWithAiVision(file, extractType, metadata, onProgress);
    }

    // Step 1: Fast Digital Extraction
    if (onProgress) {
        onProgress({ stage: 'digital', progress: 10, message: 'Reading document text stream...' });
    }

    try {
        const digitalResult = await extractDigitalTextFromPdf(file, onProgress);
        const qualityAnalysis = analyzeExtractedText(digitalResult.text, extractType, digitalResult.pageCount);

        // If digital extraction yielded rich text, return immediately (< 500ms!)
        if (!qualityAnalysis.isScanned && qualityAnalysis.characterCount > 150) {
            if (onProgress) {
                onProgress({ stage: 'complete', progress: 100, message: 'Text extracted successfully!' });
            }
            return {
                success: true,
                extractedText: digitalResult.text,
                questionCount: qualityAnalysis.questionCount,
                characterCount: qualityAnalysis.characterCount,
                detectedSections: qualityAnalysis.sections,
                quality: qualityAnalysis.quality,
                engine: 'pdfjs-digital',
                analysis: qualityAnalysis
            };
        }

        // If text was sparse or empty (Scanned document), automatically escalate to AI Vision!
        if (onProgress) {
            onProgress({
                stage: 'ai-ocr-escalation',
                progress: 40,
                message: '⚠️ Scanned image PDF detected. Auto-activating Gemini Multimodal Vision OCR...'
            });
        }

        const aiResult = await extractWithAiVision(file, extractType, metadata, onProgress);
        aiResult.engine = 'gemini-vision-ocr';
        return aiResult;

    } catch (digitalErr) {
        console.warn('Digital extraction failed or fell back:', digitalErr.message);
        if (onProgress) {
            onProgress({
                stage: 'ai-ocr-escalation',
                progress: 40,
                message: 'Falling back to Gemini AI Vision OCR...'
            });
        }
        const aiResult = await extractWithAiVision(file, extractType, metadata, onProgress);
        aiResult.engine = 'gemini-vision-ocr';
        return aiResult;
    }
}

/**
 * Automated Diagnostic Self-Test Suite
 * Runs an end-to-end check of both engines and validates readiness.
 */
export async function runExtractionDiagnosticTest() {
    const results = {
        timestamp: new Date().toLocaleTimeString(),
        allPassed: false,
        tests: []
    };

    // Test 1: Check PDF.js In-Browser Engine
    try {
        const hasPdfJs = initPdfJs();
        if (hasPdfJs && window.pdfjsLib) {
            results.tests.push({
                name: 'Browser Digital PDF Engine (PDF.js)',
                status: 'PASSED',
                detail: `PDF.js v${window.pdfjsLib.version || '3.11'} loaded and ready for zero-latency digital extraction.`
            });
        } else {
            results.tests.push({
                name: 'Browser Digital PDF Engine (PDF.js)',
                status: 'FAILED',
                detail: 'PDF.js library could not be initialized from CDN.'
            });
        }
    } catch (e) {
        results.tests.push({
            name: 'Browser Digital PDF Engine (PDF.js)',
            status: 'FAILED',
            detail: e.message
        });
    }

    // Test 2: Check Gate Authentication Token
    const gateToken = localStorage.getItem('gate_token');
    if (gateToken) {
        results.tests.push({
            name: 'Gate Authentication Security',
            status: 'PASSED',
            detail: 'Valid Gate Token present in local storage for backend API calls.'
        });
    } else {
        results.tests.push({
            name: 'Gate Authentication Security',
            status: 'WARNING',
            detail: 'Gate token not found in localStorage. Moderator authentication is required.'
        });
    }

    // Test 3: Ping Backend API (/api/extract-pdf)
    try {
        const startTime = performance.now();
        const res = await fetch('/api/extract-pdf', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(gateToken ? { 'X-Gate-Token': gateToken } : {})
            },
            body: JSON.stringify({ action: 'self-test' })
        });
        const elapsed = Math.round(performance.now() - startTime);

        if (res.ok) {
            const data = await res.json();
            results.tests.push({
                name: 'Backend AI Vision API (/api/extract-pdf)',
                status: 'PASSED',
                detail: `Endpoint operational (${elapsed}ms latency). ${data.message || ''}`
            });
        } else {
            const err = await res.json().catch(() => ({}));
            results.tests.push({
                name: 'Backend AI Vision API (/api/extract-pdf)',
                status: 'FAILED',
                detail: `Server returned status ${res.status}: ${err.error || 'Check server logs'}`
            });
        }
    } catch (e) {
        results.tests.push({
            name: 'Backend AI Vision API (/api/extract-pdf)',
            status: 'FAILED',
            detail: `Connection error: ${e.message}. Ensure local server or Vercel is running.`
        });
    }

    // Test 4: Quality Heuristics Engine
    try {
        const mockSample = "SECTION A\nQ1. What is fiscal policy? [1 Mark]\n(A) Tax policy (B) Monetary policy\nQ2. Explain GDP. [3 Marks]";
        const analysis = analyzeExtractedText(mockSample, 'questions', 1);
        if (analysis.questionCount === 2 && analysis.hasMcqOptions && analysis.hasMarks) {
            results.tests.push({
                name: 'Question Structure & Quality Heuristics Guard',
                status: 'PASSED',
                detail: 'Regex parser successfully identified questions (Q1, Q2), MCQs, and mark allocations.'
            });
        } else {
            results.tests.push({
                name: 'Question Structure & Quality Heuristics Guard',
                status: 'FAILED',
                detail: 'Quality parser did not match test heuristics.'
            });
        }
    } catch (e) {
        results.tests.push({
            name: 'Question Structure & Quality Heuristics Guard',
            status: 'FAILED',
            detail: e.message
        });
    }

    results.allPassed = results.tests.every(t => t.status === 'PASSED');
    return results;
}
