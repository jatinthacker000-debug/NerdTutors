import fs from 'fs';
import path from 'path';

// Force load .env.local if present locally to bypass Vercel CLI sync overrides
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
    console.warn("Env force load error in extract-pdf:", e.message);
}

const DEFAULT_CREDENTIALS = [
    { username: 'nerd_tutor_alpha', password: 'nt_pass_alpha2026' },
    { username: 'nerd_tutor_beta', password: 'nt_pass_beta2026' },
    { username: 'nerd_tutor_gamma', password: 'nt_pass_gamma2026' },
    { username: 'nerd_tutor_delta', password: 'nt_pass_delta2026' },
    { username: 'nerd_tutor_epsilon', password: 'nt_pass_epsilon2026' }
];

function getCredentials() {
    if (process.env.GATE_CREDENTIALS) {
        try {
            return process.env.GATE_CREDENTIALS.split(',').map(pair => {
                const parts = pair.split(':');
                return {
                    username: parts[0]?.trim(),
                    password: parts[1]?.trim()
                };
            }).filter(c => c.username && c.password);
        } catch (e) {
            console.error("Failed to parse GATE_CREDENTIALS in extract-pdf:", e);
        }
    }
    return DEFAULT_CREDENTIALS;
}

export default async function handler(req, res) {
    // ===== CORS =====
    const allowedOrigins = [
        "https://nerd-tutors.vercel.app",
        "https://nerd-tutors-two.vercel.app",
        "http://localhost:3000",
        "http://localhost:5000"
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Gate-Token");

    if (req.method === "OPTIONS") return res.status(200).end();

    // ===== Validate Gate Authentication Token =====
    const gateToken = req.headers['x-gate-token'];
    if (!gateToken) {
        return res.status(401).json({ error: "Unauthorized: Missing Gate Authentication Token" });
    }

    const creds = getCredentials();
    const isValidGateToken = creds.some(c => {
        const expectedToken = Buffer.from(`${c.username}:${c.password}`).toString('base64');
        return expectedToken === gateToken;
    });

    if (!isValidGateToken) {
        return res.status(401).json({ error: "Unauthorized: Invalid Gate Authentication Token" });
    }

    // ===== Parse Body =====
    let body = req.body || {};
    if (typeof body === "string") {
        try {
            body = JSON.parse(body);
        } catch (e) {
            return res.status(400).json({ error: "Invalid JSON body" });
        }
    }

    // ===== Fast Diagnostic Self-Test Mode =====
    if (body.action === 'self-test' || body.mode === 'test') {
        const rawKeys = process.env.GEMINI_API_KEY || process.env.GEMINI_API || process.env.GEMINI_KEY;
        const hasKeys = Boolean(rawKeys && rawKeys.trim().length > 0);
        return res.status(200).json({
            success: true,
            status: "online",
            message: "PDF Extraction AI Engine is operational",
            geminiConfigured: hasKeys,
            timestamp: new Date().toISOString()
        });
    }

    // ===== Extract API Keys =====
    let apiKeys = [];
    const rawKeys = process.env.GEMINI_API_KEY || process.env.GEMINI_API || process.env.GEMINI_KEY;
    if (rawKeys) {
        apiKeys = apiKeys.concat(rawKeys.split(",").map(k => k.trim()).filter(Boolean));
    }
    const secondaryKeys = [
        process.env.GEMINI_API_KEY_2,
        process.env.GEMINI_API_KEY_3,
        process.env.GEMINI_API_KEY_4
    ];
    secondaryKeys.forEach(k => {
        if (k) apiKeys.push(k.trim());
    });

    if (apiKeys.length === 0) {
        return res.status(500).json({ error: "Gemini API key missing in environment variables" });
    }

    const {
        pdfBase64,
        extractType = 'questions', // 'questions' or 'markingScheme'
        examName = '',
        examSet = '',
        subject = ''
    } = body;

    if (!pdfBase64) {
        return res.status(400).json({ error: "Missing pdfBase64 data in payload." });
    }

    // Clean base64 string if it contains data URI prefix
    let cleanBase64 = pdfBase64;
    if (cleanBase64.includes('base64,')) {
        cleanBase64 = cleanBase64.split('base64,')[1];
    }

    console.log(`📑 [Extract-PDF API] Processing PDF extraction: type=${extractType}, set=${examSet || 'standard'}, length=${cleanBase64.length} bytes`);

    // Build the specialized prompt based on extraction target
    let systemInstruction = "";
    if (extractType === 'markingScheme') {
        systemInstruction = `You are an expert academic board examiner extracting a formal Marking Scheme / Answer Key from an exam document PDF.
The input PDF may be digital, scanned, or photographed.

YOUR OBJECTIVE:
Extract the full answer key / marking scheme guidelines cleanly, question-by-question.

RULES:
1. Maintain exact Question Numbering: Format each question with a bold header, e.g.:
   Q1. [Correct Option Letter & Text]
   Q2. ...
2. For MCQs: Explicitly specify the correct option letter (A, B, C, or D) followed by the text of the option and mark awarded (e.g. "Q1. Option (B) - Shift to the right. [1 Mark]").
3. For Subjective / Long Answer Questions:
   - Extract the point-wise model answer.
   - Extract the specific mark distribution rubric (e.g., "1 Mark for Definition + 2 Marks for Diagram + 1 Mark for Explanation = 4 Marks Total").
4. If there are distinct sections (Section A, Section B, etc.), include section headers clearly.
5. If there are Case Studies or sub-questions (e.g., Q34.1, Q34.2), retain their hierarchical numbering.
6. Do NOT add unnecessary conversational preamble. Return only the cleanly formatted, structured marking scheme markdown text.`;
    } else {
        // 'questions' extraction
        systemInstruction = `You are an expert academic board examiner extracting an Examination Question Paper from a PDF document.
The input PDF may be a digital board exam paper or a scanned paper with multiple columns, tables, or complex formatting.

YOUR OBJECTIVE:
Extract every exam question cleanly and accurately into standardized academic text.

RULES:
1. Fix Multi-Column Layouts: If the PDF has 2 or more columns, read down the column hierarchy correctly. Do NOT merge separate questions from different columns into one sentence.
2. Maintain Exact Question Numbers:
   Format each question as:
   Q1. [Question text...] [Marks]
   Q2. [Question text...] [Marks]
3. Section Headers: Extract and clearly preserve all section titles and instructions (e.g. "### SECTION A: 20 Multiple Choice Questions (1 Mark each)").
4. MCQ Formatting: Ensure all multiple-choice options (A, B, C, D) are neatly listed on separate lines below the question statement:
   Q3. Which of the following is not a function of the Central Bank? [1 Mark]
   (A) Currency issuance
   (B) Accepting deposits from the general public
   (C) Banker to the government
   (D) Lender of last resort
5. Case Studies / Data Tables:
   - If a question refers to a passage, extract the passage header clearly.
   - For sub-questions, use numbering like Q34.1, Q34.2, Q34.3.
   - If tables exist, format them as clean Markdown tables.
6. Marks Allocation: Always extract the marks weight for each question (e.g., [1 Mark], [3 Marks], [5 Marks], [6 Marks]).
7. Do NOT omit any question. Extract all questions from the first to the last page.
8. Do NOT add conversational pleasantries. Return only the complete, structured question paper text.`;
    }

    const requestPayload = {
        contents: [
            {
                parts: [
                    {
                        inlineData: {
                            mimeType: "application/pdf",
                            data: cleanBase64
                        }
                    },
                    {
                        text: `${systemInstruction}\n\nExam Information:\nExam Name: ${examName || 'Unspecified'}\nExam Set: ${examSet || 'Standard'}\nSubject: ${subject || 'General'}\n\nPlease extract and structure the complete content from the attached PDF document now.`
                    }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.1
        }
    };

    // Primary model for Vision PDF Document understanding
    const MODEL_NAME = "gemini-3.5-flash-lite";
    let lastError = null;

    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
        const apiKey = apiKeys[attempt];
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

        try {
            console.log(`📡 [Extract-PDF] Calling ${MODEL_NAME} with key ${attempt + 1}/${apiKeys.length}...`);
            const response = await fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestPayload)
            });

            if (!response.ok) {
                const errText = await response.text();
                console.warn(`⚠️ [Extract-PDF] Key ${attempt + 1} failed (${response.status}):`, errText.substring(0, 150));
                lastError = new Error(`Gemini API error (${response.status}): ${errText}`);
                continue;
            }

            const data = await response.json();
            const extractedText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

            if (!extractedText || extractedText.trim().length === 0) {
                throw new Error("Gemini returned empty text candidate for the provided PDF.");
            }

            // Programmatic Quality Analysis of Extracted Content
            const detectedQuestions = extractedText.match(/(?:Q(?:uestion)?\.?\s*(\d+)|\b(\d+)\.\s+|Section\s+[A-E])/gim) || [];
            const detectedSections = (extractedText.match(/Section\s+[A-E]/gi) || []).filter((v, i, a) => a.indexOf(v) === i);
            const questionCount = (extractedText.match(/(?:^|\n)\s*(?:Q\.?\s*(\d+)|\b(\d+)\.)/gim) || []).length;
            const charCount = extractedText.length;

            let quality = "High";
            if (questionCount === 0 || charCount < 150) {
                quality = "Low";
            } else if (questionCount < 5) {
                quality = "Medium";
            }

            console.log(`✅ [Extract-PDF] Success! Questions: ~${questionCount}, Chars: ${charCount}, Quality: ${quality}`);

            return res.status(200).json({
                success: true,
                extractedText: extractedText.trim(),
                questionCount: questionCount || detectedQuestions.length,
                detectedSections: detectedSections,
                characterCount: charCount,
                quality: quality,
                modelUsed: MODEL_NAME,
                extractType: extractType,
                examSet: examSet
            });

        } catch (err) {
            console.error(`❌ [Extract-PDF] Attempt ${attempt + 1} threw error:`, err.message);
            lastError = err;
        }
    }

    return res.status(500).json({
        error: "Failed to extract PDF after attempting all available API keys",
        details: lastError?.message || "Unknown error"
    });
}
