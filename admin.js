import { auth, db, isAdmin } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

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

// Valid categories for validation
const VALID_CATEGORIES = [
    'Microeconomics',
    'Macroeconomics',
    'International Economics',
    'Development Economics',
    'Public Economics',
    'Monetary Economics',
    'Labor Economics',
    'Environmental Economics',
    'Econometrics',
    'Economic Theory'
];

// DOM Elements
const elements = {
    loginContainer: document.getElementById('loginContainer'),
    adminContainer: document.getElementById('adminContainer'),
    accessDeniedContainer: document.getElementById('accessDeniedContainer'),
    userEmail: document.getElementById('userEmail'),
    deniedEmail: document.getElementById('deniedEmail'),
    questionForm: document.getElementById('questionForm'),
    editQuestionForm: document.getElementById('editQuestionForm'),
    loginForm: document.getElementById('loginForm'),
    googleSignIn: document.getElementById('googleSignIn'),
    btnLogout: document.getElementById('btnLogout'),
    questionsList: document.getElementById('questionsList'),
    statsGrid: document.getElementById('statsGrid'),
    toast: document.getElementById('toast'),
    editModal: document.getElementById('editModal'),
    btnCloseModal: document.getElementById('btnCloseModal'),
    searchBox: document.getElementById('searchBox'),
    filterCategory: document.getElementById('filterCategory'),
    // Excel upload elements
    excelFileInput: document.getElementById('excelFileInput'),
    uploadArea: document.getElementById('uploadArea'),
    previewSection: document.getElementById('previewSection'),
    previewTableBody: document.getElementById('previewTableBody'),
    validCount: document.getElementById('validCount'),
    invalidCount: document.getElementById('invalidCount'),
    uploadCountText: document.getElementById('uploadCountText'),
    btnCancelUpload: document.getElementById('btnCancelUpload'),
    btnConfirmUpload: document.getElementById('btnConfirmUpload'),
    btnDownloadTemplate: document.getElementById('btnDownloadTemplate'),
    btnDownloadSample: document.getElementById('btnDownloadSample'),
    uploadProgress: document.getElementById('uploadProgress'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText')
};

// Global variables
let allQuestions = [];
let currentEditId = null;
let parsedExcelData = [];
let validQuestionsToUpload = [];
let selectedQuestions = new Set();
let deletedQuestionBackup = null;
let undoTimeout = null;
let draftSaveTimeout = null;
let chartInstances = {};



// Initialize
function init() {
    setupAuth();
    setupEventListeners();
    setupExcelUpload();
    setupNewFeatures();
    setupMcqFields(); // NEW: Setup MCQ toggle
    loadDraft();
}

// Toggle MCQ fields based on question type
function toggleMcqFields(type, prefix = '') {
    const fieldsId = prefix ? 'editMcqFields' : 'mcqFields';
    const modelAnswerContainerId = prefix ? 'editModelAnswerContainer' : 'modelAnswerContainer';
    const marksId = prefix ? 'editMarks' : 'marks';

    const mcqFields = document.getElementById(fieldsId);
    const modelAnswerContainer = document.getElementById(modelAnswerContainerId);
    const marksInput = document.getElementById(marksId);

    if (type === 'mcq') {
        // Show MCQ fields, hide model answer
        if (mcqFields) mcqFields.style.display = 'block';
        if (modelAnswerContainer) modelAnswerContainer.style.display = 'none';

        // Set required on MCQ fields
        ['optionA', 'optionB', 'optionC', 'optionD', 'correctAnswer'].forEach(id => {
            const el = document.getElementById(prefix ? 'edit' + id.charAt(0).toUpperCase() + id.slice(1) : id);
            el?.setAttribute('required', '');
        });

        // Remove required from model answer
        const modelAnswer = document.getElementById(prefix ? 'editModelAnswer' : 'modelAnswer');
        modelAnswer?.removeAttribute('required');

        // Set marks to 1 for MCQ
        if (marksInput) {
            marksInput.value = 1;
            marksInput.setAttribute('disabled', 'true');
        }
    } else {
        // Show model answer, hide MCQ fields
        if (mcqFields) mcqFields.style.display = 'none';
        if (modelAnswerContainer) modelAnswerContainer.style.display = 'block';

        // Remove required from MCQ fields
        ['optionA', 'optionB', 'optionC', 'optionD', 'correctAnswer'].forEach(id => {
            const el = document.getElementById(prefix ? 'edit' + id.charAt(0).toUpperCase() + id.slice(1) : id);
            el?.removeAttribute('required');
        });

        // Set required on model answer
        const modelAnswer = document.getElementById(prefix ? 'editModelAnswer' : 'modelAnswer');
        modelAnswer?.setAttribute('required', '');

        // Re-enable marks
        if (marksInput) {
            marksInput.removeAttribute('disabled');
        }
    }
}

// Setup MCQ field toggles
function setupMcqFields() {
    const questionType = document.getElementById('questionType');
    const editQuestionType = document.getElementById('editQuestionType');

    questionType?.addEventListener('change', (e) => {
        toggleMcqFields(e.target.value);
    });

    editQuestionType?.addEventListener('change', (e) => {
        toggleMcqFields(e.target.value, 'edit');
    });

    // Initialize state
    toggleMcqFields(questionType?.value || 'text');
}

// Auth Setup
function setupAuth() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            if (isAdmin(user.email) || user.email?.includes('admin')) {
                showAdminPanel(user);
            } else {
                showAccessDenied(user);
            }
        } else {
            showLoginForm();
        }
    });
}

// Show Admin Panel
function showAdminPanel(user) {
    elements.loginContainer.style.display = 'none';
    elements.accessDeniedContainer.style.display = 'none';
    elements.adminContainer.style.display = 'block';

    if (elements.userEmail) {
        elements.userEmail.textContent = user.email;
    }

    loadTestSessionsForDropdown();
    loadTestSessionsForManagement();
}

// Show Access Denied
function showAccessDenied(user) {
    elements.loginContainer.style.display = 'none';
    elements.adminContainer.style.display = 'none';
    elements.accessDeniedContainer.style.display = 'block';

    if (elements.deniedEmail) {
        elements.deniedEmail.textContent = user.email;
    }
}

// Show Login Form
function showLoginForm() {
    elements.loginContainer.style.display = 'block';
    elements.adminContainer.style.display = 'none';
    elements.accessDeniedContainer.style.display = 'none';
}

// Event Listeners
function setupEventListeners() {
    // Login form
    elements.loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('adminEmail').value;
        const password = document.getElementById('adminPassword').value;

        try {
            await signInWithEmailAndPassword(auth, email, password);
            showToast('Login successful!', 'success');
        } catch (error) {
            showToast('Login failed: ' + error.message, 'error');
        }
    });

    // Google Sign In
    elements.googleSignIn?.addEventListener('click', async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
            showToast('Login successful!', 'success');
        } catch (error) {
            showToast('Login failed: ' + error.message, 'error');
        }
    });

    // Logout
    elements.btnLogout?.addEventListener('click', async () => {
        try {
            await signOut(auth);
            showToast('Logged out successfully', 'success');
        } catch (error) {
            showToast('Logout failed', 'error');
        }
    });

    // Create Session Form
    const createSessionForm = document.getElementById('createSessionForm');
    createSessionForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await createTestSession();
    });

    // Results Session Select
    const resultSessionSelect = document.getElementById('resultSessionSelect');
    resultSessionSelect?.addEventListener('change', (e) => {
        const sessionId = e.target.value;
        if (sessionId) {
            loadResultsForSession(sessionId);
        } else {
            document.getElementById('resultsTableBody').innerHTML = `
                <tr>
                    <td colspan="6" style="padding: 2rem; text-align: center; color: #666; font-style: italic;">
                        Select a session to load student results.
                    </td>
                </tr>
            `;
        }
    });

    // Populate Mock Data Button
    const btnPopulateMockData = document.getElementById('btnPopulateMockData');
    btnPopulateMockData?.addEventListener('click', async () => {
        if (confirm("Do you want to populate mock test sessions and 10 student evaluations into the database? This is great for dashboard testing!")) {
            await populateMockData();
        }
    });

    // AI Trainer Verification Form (Auto Gemini API Analysis)
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

    // Close modal
    elements.btnCloseModal?.addEventListener('click', closeEditModal);
    elements.editModal?.addEventListener('click', (e) => {
        if (e.target === elements.editModal) {
            closeEditModal();
        }
    });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });

    // Bypassing Authentication back-door (Ctrl + Alt + B) for local debugging
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            console.log("🔑 Bypassing Admin Login...");
            showToast("Bypassing Auth (Developer Mode)", "success");
            showAdminPanel({ email: 'local-dev-admin@nerdtutors.com' });
        }
    });
}

// ============================================
// EXCEL UPLOAD FUNCTIONALITY - NEW
// ============================================

function setupExcelUpload() {
    // File input change
    elements.excelFileInput?.addEventListener('change', handleFileSelect);

    // Drag and drop
    elements.uploadArea?.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.uploadArea.classList.add('dragover');
    });

    elements.uploadArea?.addEventListener('dragleave', () => {
        elements.uploadArea.classList.remove('dragover');
    });

    elements.uploadArea?.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processExcelFile(files[0]);
        }
    });

    // Download template
    elements.btnDownloadTemplate?.addEventListener('click', downloadTemplate);

    // Download sample
    elements.btnDownloadSample?.addEventListener('click', downloadSampleData);

    // Cancel upload
    elements.btnCancelUpload?.addEventListener('click', cancelUpload);

    // Confirm upload
    elements.btnConfirmUpload?.addEventListener('click', confirmUpload);
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        processExcelFile(file);
    }
}

function processExcelFile(file) {
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();

    if (!validExtensions.includes(fileExt)) {
        showToast('Please upload a valid Excel file (.xlsx, .xls, .csv)', 'error');
        return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            // Get first sheet
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            // Convert to JSON
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

            if (jsonData.length === 0) {
                showToast('The Excel file is empty', 'error');
                return;
            }

            // Process and validate data
            parsedExcelData = validateExcelData(jsonData);
            displayPreview(parsedExcelData);

        } catch (error) {
            console.error('Error parsing Excel:', error);
            showToast('Error parsing Excel file: ' + error.message, 'error');
        }
    };

    reader.onerror = () => {
        showToast('Error reading file', 'error');
    };

    reader.readAsArrayBuffer(file);
}

function validateExcelData(data) {
    return data.map((row, index) => {
        const errors = [];
        const type = String(row.type || 'text').toLowerCase().trim();

        // Check required fields
        if (!row.text || String(row.text).trim() === '') {
            errors.push('Question text is required');
        }

        if (!row.category || String(row.category).trim() === '') {
            errors.push('Category is required');
        } else if (!VALID_CATEGORIES.includes(row.category)) {
            errors.push(`Invalid category: "${row.category}"`);
        }

        // MCQ-specific validation
        if (type === 'mcq') {
            if (!row.optionA || String(row.optionA).trim() === '') {
                errors.push('Option A is required for MCQ');
            }
            if (!row.optionB || String(row.optionB).trim() === '') {
                errors.push('Option B is required for MCQ');
            }
            if (!row.optionC || String(row.optionC).trim() === '') {
                errors.push('Option C is required for MCQ');
            }
            if (!row.optionD || String(row.optionD).trim() === '') {
                errors.push('Option D is required for MCQ');
            }
            if (!row.correctAnswer || !['A', 'B', 'C', 'D'].includes(String(row.correctAnswer).toUpperCase().trim())) {
                errors.push('Correct answer must be A, B, C, or D for MCQ');
            }
        } else {
            // Text question validation
            if (!row.marks || isNaN(parseInt(row.marks))) {
                errors.push('Marks must be a number');
            } else if (parseInt(row.marks) < 1 || parseInt(row.marks) > 100) {
                errors.push('Marks must be between 1-100');
            }

            if (!row.modelAnswer || String(row.modelAnswer).trim() === '') {
                errors.push('Model answer is required for text questions');
            }
        }

        // Validate optional fields
        let difficulty = row.difficulty || 'Medium';
        if (!['Easy', 'Medium', 'Hard'].includes(difficulty)) {
            difficulty = 'Medium';
        }

        let status = row.status || 'active';
        if (!['active', 'inactive'].includes(status)) {
            status = 'active';
        }

        const result = {
            rowNumber: index + 2, // Excel rows start at 1, header is row 1
            type: type === 'mcq' ? 'mcq' : 'text',
            text: String(row.text || '').trim(),
            category: String(row.category || '').trim(),
            marks: type === 'mcq' ? 1 : (parseInt(row.marks) || 0),
            difficulty: difficulty,
            status: status,
            isValid: errors.length === 0,
            errors: errors
        };

        // Add MCQ-specific or text-specific fields
        if (type === 'mcq') {
            result.options = {
                A: String(row.optionA || '').trim(),
                B: String(row.optionB || '').trim(),
                C: String(row.optionC || '').trim(),
                D: String(row.optionD || '').trim()
            };
            result.correctAnswer = String(row.correctAnswer || '').toUpperCase().trim();
        } else {
            result.modelAnswer = String(row.modelAnswer || '').trim();
        }

        return result;
    });
}

function displayPreview(data) {
    validQuestionsToUpload = data.filter(row => row.isValid);
    const invalidRows = data.filter(row => !row.isValid);

    elements.validCount.textContent = `${validQuestionsToUpload.length} valid`;
    elements.invalidCount.textContent = `${invalidRows.length} invalid`;
    elements.uploadCountText.textContent = validQuestionsToUpload.length;

    // Enable/disable upload button
    elements.btnConfirmUpload.disabled = validQuestionsToUpload.length === 0;

    // Build preview table
    let html = '';
    data.forEach((row, index) => {
        html += `
                <tr style="${row.isValid ? '' : 'background: #fff3f3;'}">
                    <td>${row.rowNumber}</td>
                    <td>
                        <span class="row-status ${row.isValid ? 'valid' : 'invalid'}"></span>
                        ${row.isValid ? '✓ Valid' : '✗ Error'}
                    </td>
                    <td class="text-cell" title="${escapeHtml(row.text)}">
                        ${escapeHtml(row.text.substring(0, 100))}${row.text.length > 100 ? '...' : ''}
                        ${row.errors.length > 0 ? `<div class="row-error">${row.errors.join(', ')}</div>` : ''}
                    </td>
                    <td>${escapeHtml(row.category)}</td>
                    <td>${row.marks}</td>
                    <td>${row.difficulty}</td>
                </tr>
            `;
    });

    elements.previewTableBody.innerHTML = html;
    elements.previewSection.classList.add('show');

    showToast(`Found ${validQuestionsToUpload.length} valid questions out of ${data.length} rows`, 'success');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function confirmUpload() {
    if (validQuestionsToUpload.length === 0) {
        showToast('No valid questions to upload', 'error');
        return;
    }

    const confirmMsg = `Are you sure you want to upload ${validQuestionsToUpload.length} questions?`;
    if (!confirm(confirmMsg)) return;

    elements.btnConfirmUpload.disabled = true;
    elements.uploadProgress.classList.add('show');

    let uploaded = 0;
    let failed = 0;

    for (let i = 0; i < validQuestionsToUpload.length; i++) {
        const question = validQuestionsToUpload[i];

        try {
            // Build question data based on type
            let questionData = {
                type: question.type || 'text',
                text: question.text,
                category: question.category,
                marks: question.marks,
                difficulty: question.difficulty,
                status: question.status,
                createdAt: serverTimestamp(),
                createdBy: auth.currentUser?.email,
                uploadedVia: 'excel'
            };

            // Add type-specific fields
            if (question.type === 'mcq') {
                questionData.options = question.options;
                questionData.correctAnswer = question.correctAnswer;
            } else {
                questionData.modelAnswer = question.modelAnswer;
            }

            await addDoc(collection(db, 'questions'), questionData);
            uploaded++;
        } catch (error) {
            console.error('Error uploading question:', error);
            failed++;
        }

        // Update progress
        const progress = ((i + 1) / validQuestionsToUpload.length) * 100;
        elements.progressBar.style.width = progress + '%';
        elements.progressText.textContent = `Uploading... ${Math.round(progress)}% (${i + 1}/${validQuestionsToUpload.length})`;
    }

    // Complete
    elements.progressText.textContent = `Complete! Uploaded: ${uploaded}, Failed: ${failed}`;

    if (uploaded > 0) {
        showToast(`Successfully uploaded ${uploaded} questions!`, 'success');
        loadQuestions();
        loadStatistics();
    }

    if (failed > 0) {
        showToast(`Failed to upload ${failed} questions`, 'error');
    }

    // Reset after 2 seconds
    setTimeout(() => {
        cancelUpload();
    }, 2000);
}

function cancelUpload() {
    parsedExcelData = [];
    validQuestionsToUpload = [];
    elements.previewSection.classList.remove('show');
    elements.uploadProgress.classList.remove('show');
    elements.progressBar.style.width = '0%';
    elements.progressText.textContent = 'Uploading... 0%';
    elements.excelFileInput.value = '';
    elements.btnConfirmUpload.disabled = false;
}

function downloadTemplate() {
    const templateData = [
        {
            type: 'text/mcq',
            text: '',
            category: '',
            marks: '(for text only)',
            modelAnswer: '(for text only)',
            optionA: '(for MCQ only)',
            optionB: '(for MCQ only)',
            optionC: '(for MCQ only)',
            optionD: '(for MCQ only)',
            correctAnswer: 'A/B/C/D (for MCQ)',
            difficulty: '',
            status: ''
        }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Questions');

    // Set column widths
    ws['!cols'] = [
        { wch: 10 },  // type
        { wch: 50 },  // text
        { wch: 25 },  // category
        { wch: 15 },  // marks
        { wch: 50 },  // modelAnswer
        { wch: 25 },  // optionA
        { wch: 25 },  // optionB
        { wch: 25 },  // optionC
        { wch: 25 },  // optionD
        { wch: 15 },  // correctAnswer
        { wch: 12 },  // difficulty
        { wch: 10 }   // status
    ];

    XLSX.writeFile(wb, 'questions_template.xlsx');
    showToast('Template downloaded!', 'success');
}

function downloadSampleData() {
    const sampleData = [
        {
            type: 'text',
            text: 'Explain the law of demand and its exceptions.',
            category: 'Microeconomics',
            marks: 10,
            modelAnswer: 'The law of demand states that, ceteris paribus, as the price of a good increases, the quantity demanded decreases, and vice versa. This creates a downward-sloping demand curve. Exceptions include Giffen goods, Veblen goods, expectations of future price changes, and necessary goods.',
            optionA: '',
            optionB: '',
            optionC: '',
            optionD: '',
            correctAnswer: '',
            difficulty: 'Medium',
            status: 'active'
        },
        {
            type: 'mcq',
            text: 'Which of the following is NOT a component of GDP?',
            category: 'Macroeconomics',
            marks: 1,
            modelAnswer: '',
            optionA: 'Consumption',
            optionB: 'Investment',
            optionC: 'Imports',
            optionD: 'Government Spending',
            correctAnswer: 'C',
            difficulty: 'Easy',
            status: 'active'
        },
        {
            type: 'mcq',
            text: 'When demand is elastic, a decrease in price will:',
            category: 'Microeconomics',
            marks: 1,
            modelAnswer: '',
            optionA: 'Decrease total revenue',
            optionB: 'Increase total revenue',
            optionC: 'Keep total revenue unchanged',
            optionD: 'Cannot be determined',
            correctAnswer: 'B',
            difficulty: 'Medium',
            status: 'active'
        },
        {
            type: 'text',
            text: 'Explain the concept of comparative advantage in international trade.',
            category: 'International Economics',
            marks: 12,
            modelAnswer: 'Comparative advantage refers to the ability of a country to produce a good at a lower opportunity cost than another country. Even if a country has absolute advantage in all goods, trade can still be beneficial if countries specialize in goods where they have comparative advantage.',
            optionA: '',
            optionB: '',
            optionC: '',
            optionD: '',
            correctAnswer: '',
            difficulty: 'Hard',
            status: 'active'
        },
        {
            type: 'mcq',
            text: 'Which ministry is responsible for fiscal policy in India?',
            category: 'Public Economics',
            marks: 1,
            modelAnswer: '',
            optionA: 'Reserve Bank of India',
            optionB: 'Ministry of Finance',
            optionC: 'NITI Aayog',
            optionD: 'Ministry of Commerce',
            correctAnswer: 'B',
            difficulty: 'Easy',
            status: 'active'
        }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Questions');

    // Set column widths
    ws['!cols'] = [
        { wch: 10 },  // type
        { wch: 60 },  // text
        { wch: 25 },  // category
        { wch: 10 },  // marks
        { wch: 80 },  // modelAnswer
        { wch: 25 },  // optionA
        { wch: 25 },  // optionB
        { wch: 25 },  // optionC
        { wch: 25 },  // optionD
        { wch: 15 },  // correctAnswer
        { wch: 12 },  // difficulty
        { wch: 10 }   // status
    ];

    XLSX.writeFile(wb, 'questions_sample.xlsx');
    showToast('Sample data downloaded!', 'success');
}

// ============================================
// END EXCEL UPLOAD FUNCTIONALITY
// ============================================

// Switch tabs
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === tabName + 'Tab');
    });

    if (tabName === 'view-results') {
        loadTestSessionsForDropdown();
    } else if (tabName === 'create-session') {
        loadTestSessionsForManagement();
    }
}

// Add Question
async function addQuestion() {
    const questionType = document.getElementById('questionType').value;

    let questionData = {
        type: questionType,
        text: document.getElementById('questionText').value,
        category: document.getElementById('category').value,
        marks: parseInt(document.getElementById('marks').value) || 1,
        difficulty: document.getElementById('difficulty').value,
        status: document.getElementById('status').value,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email
    };

    // Add MCQ-specific or Text-specific fields
    if (questionType === 'mcq') {
        questionData.options = {
            A: document.getElementById('optionA').value,
            B: document.getElementById('optionB').value,
            C: document.getElementById('optionC').value,
            D: document.getElementById('optionD').value
        };
        questionData.correctAnswer = document.getElementById('correctAnswer').value;
        questionData.marks = 1; // MCQs are always 1 mark
    } else {
        questionData.modelAnswer = document.getElementById('modelAnswer').value;
    }

    try {
        await addDoc(collection(db, 'questions'), questionData);
        showToast('Question added successfully!', 'success');
        elements.questionForm.reset();
        toggleMcqFields('text'); // Reset MCQ fields
        // Clear draft after successful submit
        localStorage.removeItem('questionDraft');
        document.getElementById('draftIndicator')?.classList.remove('show');
        loadQuestions();
        loadStatistics();
    } catch (error) {
        showToast('Failed to add question: ' + error.message, 'error');
    }
}

// Load Questions
async function loadQuestions() {
    if (!elements.questionsList) return;

    try {
        const querySnapshot = await getDocs(collection(db, 'questions'));
        allQuestions = [];

        querySnapshot.forEach((docSnap) => {
            allQuestions.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });

        displayQuestions(allQuestions);
    } catch (error) {
        console.error('Error loading questions:', error);
        elements.questionsList.innerHTML = '<p>Error loading questions</p>';
    }
}

// Display questions
function displayQuestions(questions) {
    let html = '';

    questions.forEach((data) => {
        const difficultyClass = data.difficulty?.toLowerCase() || 'medium';
        const status = data.status || 'active';
        const isSelected = selectedQuestions.has(data.id);
        const questionType = data.type || 'text';
        const typeBadge = questionType === 'mcq'
            ? '<span class="badge" style="background: #e8f5e9; color: #2e7d32;">MCQ</span>'
            : '<span class="badge" style="background: #e3f2fd; color: #1565c0;">Text</span>';

        // Build MCQ options preview if applicable
        let mcqPreview = '';
        if (questionType === 'mcq' && data.options) {
            mcqPreview = `
                <div class="mcq-preview" style="margin-top: 1rem; padding: 0.75rem; background: #f8f9fa; border-radius: 8px; font-size: 0.9rem;">
                    <div style="${data.correctAnswer === 'A' ? 'color: #2e7d32; font-weight: bold;' : 'color: #666;'}">A) ${data.options.A || ''}</div>
                    <div style="${data.correctAnswer === 'B' ? 'color: #2e7d32; font-weight: bold;' : 'color: #666;'}">B) ${data.options.B || ''}</div>
                    <div style="${data.correctAnswer === 'C' ? 'color: #2e7d32; font-weight: bold;' : 'color: #666;'}">C) ${data.options.C || ''}</div>
                    <div style="${data.correctAnswer === 'D' ? 'color: #2e7d32; font-weight: bold;' : 'color: #666;'}">D) ${data.options.D || ''}</div>
                </div>
            `;
        }

        html += `
                <div class="question-card ${isSelected ? 'selected' : ''}" data-id="${data.id}">
                    <div class="question-header">
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <input type="checkbox" class="question-checkbox" data-id="${data.id}" ${isSelected ? 'checked' : ''}>
                            <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                            <div class="question-meta">
                                <span class="status-dot ${status}"></span>
                                ${typeBadge}
                                <span class="badge badge-category">${data.category || 'N/A'}</span>
                                <span class="badge badge-marks">${data.marks || 0} marks</span>
                                <span class="badge badge-difficulty ${difficultyClass}">${data.difficulty || 'Medium'}</span>
                            </div>
                        </div>
                        <div class="question-actions">
                            <button class="btn-icon preview" data-id="${data.id}" title="Preview">👁️</button>
                            <button class="btn-icon duplicate" data-id="${data.id}" title="Duplicate">📋</button>
                            <button class="btn-icon edit" data-id="${data.id}" title="Edit">✏️</button>
                            <button class="btn-icon delete" data-id="${data.id}" title="Delete">🗑️</button>
                        </div>
                    </div>
                    <p class="question-text">${data.text || 'No question text'}</p>
                    ${mcqPreview}
                    <div class="question-footer">
                        <span>Created by: ${data.createdBy || 'Unknown'}</span>
                        <span style="display: flex; align-items: center; gap: 0.25rem;">
                            <span class="status-dot ${status}" style="width: 8px; height: 8px;"></span>
                            ${status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                    </div>
                </div>
            `;
    });

    elements.questionsList.innerHTML = html || '<p style="text-align: center; color: #666; padding: 2rem;">No questions found</p>';

    // Setup drag and drop
    if (typeof Sortable !== 'undefined') {
        new Sortable(elements.questionsList, {
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'dragging',
            onEnd: function (evt) {
                showToast('Question order updated', 'success');
            }
        });
    }

    // Attach checkbox handlers
    document.querySelectorAll('.question-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const id = e.target.dataset.id;
            const card = e.target.closest('.question-card');
            if (e.target.checked) {
                selectedQuestions.add(id);
                card.classList.add('selected');
            } else {
                selectedQuestions.delete(id);
                card.classList.remove('selected');
            }
            updateBulkActionsBar();
        });
    });

    // Attach preview handlers
    document.querySelectorAll('.btn-icon.preview').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            openPreviewModal(id);
        });
    });

    // Attach duplicate handlers
    document.querySelectorAll('.btn-icon.duplicate').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            duplicateQuestion(id);
        });
    });

    // Attach edit handlers
    document.querySelectorAll('.btn-icon.edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            openEditModal(id);
        });
    });

    // Attach delete handlers
    document.querySelectorAll('.btn-icon.delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (!id) return;
            showConfirmModal(
                '🗑️',
                'Delete Question?',
                'This action can be undone within 5 seconds.',
                'danger',
                async () => {
                    await deleteQuestionWithUndo(id);
                }
            );
        });
    });
}

// Open Edit Modal
function openEditModal(questionId) {
    const question = allQuestions.find(q => q.id === questionId);
    if (!question) return;

    currentEditId = questionId;
    const questionType = question.type || 'text';

    document.getElementById('editQuestionId').value = questionId;
    document.getElementById('editQuestionType').value = questionType;
    document.getElementById('editQuestionText').value = question.text || '';
    document.getElementById('editCategory').value = question.category || '';
    document.getElementById('editMarks').value = question.marks || '';
    document.getElementById('editModelAnswer').value = question.modelAnswer || '';
    document.getElementById('editDifficulty').value = question.difficulty || 'Medium';
    document.getElementById('editStatus').value = question.status || 'active';

    // Populate MCQ fields if applicable
    if (questionType === 'mcq' && question.options) {
        document.getElementById('editOptionA').value = question.options.A || '';
        document.getElementById('editOptionB').value = question.options.B || '';
        document.getElementById('editOptionC').value = question.options.C || '';
        document.getElementById('editOptionD').value = question.options.D || '';
        document.getElementById('editCorrectAnswer').value = question.correctAnswer || '';
    } else {
        // Clear MCQ fields for text questions
        document.getElementById('editOptionA').value = '';
        document.getElementById('editOptionB').value = '';
        document.getElementById('editOptionC').value = '';
        document.getElementById('editOptionD').value = '';
        document.getElementById('editCorrectAnswer').value = '';
    }

    // Toggle field visibility
    toggleMcqFields(questionType, 'edit');

    elements.editModal.classList.add('show');
}

// Close Edit Modal
function closeEditModal() {
    elements.editModal.classList.remove('show');
    currentEditId = null;
}

// Update Question
async function updateQuestion() {
    if (!currentEditId) return;

    const questionType = document.getElementById('editQuestionType').value;

    let updatedData = {
        type: questionType,
        text: document.getElementById('editQuestionText').value,
        category: document.getElementById('editCategory').value,
        marks: parseInt(document.getElementById('editMarks').value) || 1,
        difficulty: document.getElementById('editDifficulty').value,
        status: document.getElementById('editStatus').value,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email
    };

    // Add MCQ-specific or Text-specific fields
    if (questionType === 'mcq') {
        updatedData.options = {
            A: document.getElementById('editOptionA').value,
            B: document.getElementById('editOptionB').value,
            C: document.getElementById('editOptionC').value,
            D: document.getElementById('editOptionD').value
        };
        updatedData.correctAnswer = document.getElementById('editCorrectAnswer').value;
        updatedData.marks = 1; // MCQs are always 1 mark
        // Clear modelAnswer for MCQ
        updatedData.modelAnswer = null;
    } else {
        updatedData.modelAnswer = document.getElementById('editModelAnswer').value;
        // Clear MCQ-specific fields for text questions
        updatedData.options = null;
        updatedData.correctAnswer = null;
    }

    try {
        await updateDoc(doc(db, 'questions', currentEditId), updatedData);
        showToast('Question updated successfully!', 'success');
        closeEditModal();
        loadQuestions();
    } catch (error) {
        showToast('Failed to update question: ' + error.message, 'error');
    }
}

// Filter Questions
function filterQuestions() {
    const searchTerm = elements.searchBox?.value.toLowerCase() || '';
    const categoryFilter = elements.filterCategory?.value || '';

    const filtered = allQuestions.filter(q => {
        const matchesSearch = q.text?.toLowerCase().includes(searchTerm) ||
            q.category?.toLowerCase().includes(searchTerm);
        const matchesCategory = !categoryFilter || q.category === categoryFilter;

        return matchesSearch && matchesCategory;
    });

    displayQuestions(filtered);
}

// Load Statistics
async function loadStatistics() {
    if (!elements.statsGrid) return;

    try {
        const querySnapshot = await getDocs(collection(db, 'questions'));
        const totalQuestions = querySnapshot.size;

        const categoryCount = {};
        const difficultyCount = { Easy: 0, Medium: 0, Hard: 0 };
        const statusCount = { active: 0, inactive: 0 };
        const typeCount = { mcq: 0, text: 0 };
        let totalMarks = 0;

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();

            const category = data.category || 'Uncategorized';
            categoryCount[category] = (categoryCount[category] || 0) + 1;

            const difficulty = data.difficulty || 'Medium';
            difficultyCount[difficulty] = (difficultyCount[difficulty] || 0) + 1;

            const status = data.status || 'active';
            statusCount[status] = (statusCount[status] || 0) + 1;

            const type = data.type || 'text';
            typeCount[type] = (typeCount[type] || 0) + 1;

            totalMarks += data.marks || 0;
        });

        const avgMarks = totalQuestions > 0 ? (totalMarks / totalQuestions).toFixed(1) : 0;

        elements.statsGrid.innerHTML = `
                <div class="stats-grid">
                    <div class="stat-card purple">
                        <h3>Total Questions</h3>
                        <div class="stat-value">${totalQuestions}</div>
                        <div class="stat-label">In Database</div>
                    </div>

                    <div class="stat-card green">
                        <h3>Active Questions</h3>
                        <div class="stat-value">${statusCount.active}</div>
                        <div class="stat-label">${statusCount.inactive} Inactive</div>
                    </div>

                    <div class="stat-card" style="background: linear-gradient(135deg, #2e7d32 0%, #66bb6a 100%);">
                        <h3>MCQ Questions</h3>
                        <div class="stat-value">${typeCount.mcq}</div>
                        <div class="stat-label">${typeCount.text} Text Questions</div>
                    </div>

                    <div class="stat-card orange">
                        <h3>Average Marks</h3>
                        <div class="stat-value">${avgMarks}</div>
                        <div class="stat-label">Per Question</div>
                    </div>
                </div>

                <div class="stats-grid" style="margin-top: 1.5rem;">
                    <div class="stat-card" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);">
                        <h3>Easy Questions</h3>
                        <div class="stat-value">${difficultyCount.Easy}</div>
                        <div class="stat-label">${totalQuestions > 0 ? ((difficultyCount.Easy / totalQuestions) * 100).toFixed(1) : 0}% of Total</div>
                    </div>

                    <div class="stat-card" style="background: linear-gradient(135deg, #30cfd0 0%, #330867 100%);">
                        <h3>Medium Questions</h3>
                        <div class="stat-value">${difficultyCount.Medium}</div>
                        <div class="stat-label">${totalQuestions > 0 ? ((difficultyCount.Medium / totalQuestions) * 100).toFixed(1) : 0}% of Total</div>
                    </div>

                    <div class="stat-card" style="background: linear-gradient(135deg, #ff0844 0%, #ffb199 100%);">
                        <h3>Hard Questions</h3>
                        <div class="stat-value">${difficultyCount.Hard}</div>
                        <div class="stat-label">${totalQuestions > 0 ? ((difficultyCount.Hard / totalQuestions) * 100).toFixed(1) : 0}% of Total</div>
                    </div>
                </div>

                <div class="category-breakdown">
                    <h3>📊 Questions by Category</h3>
                    ${Object.entries(categoryCount)
                .sort((a, b) => b[1] - a[1])
                .map(([category, count]) => `
                            <div class="category-item">
                                <span class="category-name">${category}</span>
                                <span class="category-count">${count}</span>
                            </div>
                        `).join('')}
                </div>

                <!-- Charts Section -->
                <div class="charts-container">
                    <div class="chart-card">
                        <h4>📈 Questions by Category</h4>
                        <div class="chart-wrapper">
                            <canvas id="categoryChart"></canvas>
                        </div>
                    </div>
                    <div class="chart-card">
                        <h4>📊 Difficulty Distribution</h4>
                        <div class="chart-wrapper">
                            <canvas id="difficultyChart"></canvas>
                        </div>
                    </div>
                    <div class="chart-card">
                        <h4>🔄 Status Overview</h4>
                        <div class="chart-wrapper">
                            <canvas id="statusChart"></canvas>
                        </div>
                    </div>
                </div>
            `;

        // Render Charts
        renderCharts(categoryCount, difficultyCount, statusCount);
    } catch (error) {
        console.error('Error loading statistics:', error);
        elements.statsGrid.innerHTML = '<p>Error loading statistics</p>';
    }
}

// Show Toast
function showToast(message, type = 'success') {
    elements.toast.textContent = message;
    elements.toast.className = `toast ${type} show`;

    setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3000);
}

// Render Charts
function renderCharts(categoryCount, difficultyCount, statusCount) {
    // Destroy existing charts
    Object.values(chartInstances).forEach(chart => chart?.destroy());

    // Category Chart (Bar)
    const categoryCtx = document.getElementById('categoryChart')?.getContext('2d');
    if (categoryCtx) {
        const sortedCategories = Object.entries(categoryCount).sort((a, b) => b[1] - a[1]);
        chartInstances.category = new Chart(categoryCtx, {
            type: 'bar',
            data: {
                labels: sortedCategories.map(([cat]) => cat.length > 15 ? cat.substring(0, 15) + '...' : cat),
                datasets: [{
                    label: 'Questions',
                    data: sortedCategories.map(([, count]) => count),
                    backgroundColor: [
                        '#667eea', '#764ba2', '#f093fb', '#f5576c',
                        '#4facfe', '#00f2fe', '#43e97b', '#38f9d7',
                        '#fa709a', '#fee140'
                    ],
                    borderRadius: 8,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
    }

    // Difficulty Chart (Doughnut)
    const difficultyCtx = document.getElementById('difficultyChart')?.getContext('2d');
    if (difficultyCtx) {
        chartInstances.difficulty = new Chart(difficultyCtx, {
            type: 'doughnut',
            data: {
                labels: ['Easy', 'Medium', 'Hard'],
                datasets: [{
                    data: [difficultyCount.Easy, difficultyCount.Medium, difficultyCount.Hard],
                    backgroundColor: ['#43e97b', '#4facfe', '#f5576c'],
                    borderWidth: 0,
                    cutout: '60%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { padding: 20, usePointStyle: true }
                    }
                }
            }
        });
    }

    // Status Chart (Pie)
    const statusCtx = document.getElementById('statusChart')?.getContext('2d');
    if (statusCtx) {
        chartInstances.status = new Chart(statusCtx, {
            type: 'pie',
            data: {
                labels: ['Active', 'Inactive'],
                datasets: [{
                    data: [statusCount.active, statusCount.inactive],
                    backgroundColor: ['#4caf50', '#f44336'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { padding: 20, usePointStyle: true }
                    }
                }
            }
        });
    }
}

// ============================================
// NEW FEATURES
// ============================================

// Setup all new features
function setupNewFeatures() {
    setupAdvancedFilters();
    setupBulkActions();
    setupExportButtons();
    setupKeyboardShortcuts();
    setupAutoSave();
    setupPreviewModal();
    setupConfirmModal();
    setupShortcutsHelp();
    setupAnswerEvaluation();
}

// Advanced Filters
function setupAdvancedFilters() {
    const btnToggle = document.getElementById('btnToggleFilters');
    const filtersPanel = document.getElementById('advancedFilters');
    const btnApply = document.getElementById('btnApplyFilters');
    const btnClear = document.getElementById('btnClearFilters');

    btnToggle?.addEventListener('click', () => {
        filtersPanel.classList.toggle('show');
    });

    btnApply?.addEventListener('click', applyAdvancedFilters);
    btnClear?.addEventListener('click', clearFilters);
}

function applyAdvancedFilters() {
    const searchTerm = elements.searchBox?.value.toLowerCase() || '';
    const categoryFilter = elements.filterCategory?.value || '';
    const statusFilter = document.getElementById('filterStatus')?.value || '';
    const difficultyFilter = document.getElementById('filterDifficulty')?.value || '';
    const minMarks = parseInt(document.getElementById('filterMinMarks')?.value) || 0;
    const maxMarks = parseInt(document.getElementById('filterMaxMarks')?.value) || 100;

    const filtered = allQuestions.filter(q => {
        const matchesSearch = !searchTerm ||
            q.text?.toLowerCase().includes(searchTerm) ||
            q.category?.toLowerCase().includes(searchTerm);
        const matchesCategory = !categoryFilter || q.category === categoryFilter;
        const matchesStatus = !statusFilter || (q.status || 'active') === statusFilter;
        const matchesDifficulty = !difficultyFilter || q.difficulty === difficultyFilter;
        const matchesMarks = (q.marks || 0) >= minMarks && (q.marks || 0) <= maxMarks;

        return matchesSearch && matchesCategory && matchesStatus && matchesDifficulty && matchesMarks;
    });

    displayQuestions(filtered);
    showToast(`Found ${filtered.length} questions`, 'success');
}

function clearFilters() {
    elements.searchBox.value = '';
    elements.filterCategory.value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterDifficulty').value = '';
    document.getElementById('filterMinMarks').value = '';
    document.getElementById('filterMaxMarks').value = '';
    displayQuestions(allQuestions);
    showToast('Filters cleared', 'success');
}

// Bulk Actions
function setupBulkActions() {
    const selectAll = document.getElementById('selectAllCheckbox');
    const bulkActivate = document.getElementById('bulkActivate');
    const bulkDeactivate = document.getElementById('bulkDeactivate');
    const bulkCategory = document.getElementById('bulkCategory');
    const bulkDelete = document.getElementById('bulkDelete');
    const bulkCancel = document.getElementById('bulkCancel');

    selectAll?.addEventListener('change', (e) => {
        if (e.target.checked) {
            allQuestions.forEach(q => selectedQuestions.add(q.id));
        } else {
            selectedQuestions.clear();
        }
        displayQuestions(allQuestions);
        updateBulkActionsBar();
    });

    bulkActivate?.addEventListener('click', () => bulkUpdateStatus('active'));
    bulkDeactivate?.addEventListener('click', () => bulkUpdateStatus('inactive'));
    bulkCategory?.addEventListener('click', showCategoryChangeModal);
    bulkDelete?.addEventListener('click', bulkDeleteQuestions);
    bulkCancel?.addEventListener('click', () => {
        selectedQuestions.clear();
        document.getElementById('selectAllCheckbox').checked = false;
        displayQuestions(allQuestions);
        updateBulkActionsBar();
    });
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bulkActionsBar');
    const count = document.getElementById('selectedCount');
    count.textContent = selectedQuestions.size;

    if (selectedQuestions.size > 0) {
        bar.classList.add('show');
    } else {
        bar.classList.remove('show');
    }
}

async function bulkUpdateStatus(status) {
    if (selectedQuestions.size === 0) return;

    showConfirmModal(
        status === 'active' ? '✅' : '⏸️',
        `Set ${selectedQuestions.size} questions to ${status}?`,
        'This will update the status of all selected questions.',
        'success',
        async () => {
            for (const id of selectedQuestions) {
                try {
                    await updateDoc(doc(db, 'questions', id), { status });
                } catch (error) {
                    console.error('Error updating:', error);
                }
            }
            selectedQuestions.clear();
            document.getElementById('selectAllCheckbox').checked = false;
            updateBulkActionsBar();
            loadQuestions();
            showToast(`Updated ${selectedQuestions.size} questions to ${status}`, 'success');
        }
    );
}

function showCategoryChangeModal() {
    const category = prompt('Enter new category:\n' + VALID_CATEGORIES.join('\n'));
    if (!category || !VALID_CATEGORIES.includes(category)) {
        if (category) showToast('Invalid category', 'error');
        return;
    }

    bulkUpdateCategory(category);
}

async function bulkUpdateCategory(category) {
    for (const id of selectedQuestions) {
        try {
            await updateDoc(doc(db, 'questions', id), { category });
        } catch (error) {
            console.error('Error updating:', error);
        }
    }
    selectedQuestions.clear();
    document.getElementById('selectAllCheckbox').checked = false;
    updateBulkActionsBar();
    loadQuestions();
    showToast(`Updated category to ${category}`, 'success');
}

async function bulkDeleteQuestions() {
    if (selectedQuestions.size === 0) return;

    showConfirmModal(
        '🗑️',
        `Delete ${selectedQuestions.size} questions?`,
        'This action cannot be undone for bulk deletes.',
        'danger',
        async () => {
            for (const id of selectedQuestions) {
                try {
                    await deleteDoc(doc(db, 'questions', id));
                } catch (error) {
                    console.error('Error deleting:', error);
                }
            }
            selectedQuestions.clear();
            document.getElementById('selectAllCheckbox').checked = false;
            updateBulkActionsBar();
            loadQuestions();
            loadStatistics();
            showToast('Questions deleted successfully', 'success');
        }
    );
}

// Export Functions
function setupExportButtons() {
    document.getElementById('btnExportExcel')?.addEventListener('click', exportToExcel);
    document.getElementById('btnExportPDF')?.addEventListener('click', exportToPDF);
}

function exportToExcel() {
    const data = allQuestions.map(q => ({
        text: q.text,
        category: q.category,
        marks: q.marks,
        modelAnswer: q.modelAnswer,
        difficulty: q.difficulty,
        status: q.status || 'active',
        createdBy: q.createdBy || 'Unknown'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Questions');

    ws['!cols'] = [
        { wch: 60 }, { wch: 25 }, { wch: 10 },
        { wch: 80 }, { wch: 12 }, { wch: 10 }, { wch: 25 }
    ];

    XLSX.writeFile(wb, `questions_export_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('Excel exported successfully!', 'success');
}

function exportToPDF() {
    if (typeof window.jspdf === 'undefined') {
        showToast('PDF library loading...', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.text('Questions Export', 14, 22);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);

    const tableData = allQuestions.map((q, i) => [
        i + 1,
        q.text?.substring(0, 50) + (q.text?.length > 50 ? '...' : ''),
        q.category || 'N/A',
        q.marks || 0,
        q.difficulty || 'Medium',
        q.status || 'active'
    ]);

    doc.autoTable({
        startY: 40,
        head: [['#', 'Question', 'Category', 'Marks', 'Difficulty', 'Status']],
        body: tableData,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 60, 114] }
    });

    doc.save(`questions_export_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast('PDF exported successfully!', 'success');
}

// Preview Modal
function setupPreviewModal() {
    document.getElementById('btnClosePreview')?.addEventListener('click', closePreviewModal);
    document.getElementById('previewModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'previewModal') closePreviewModal();
    });
}

function openPreviewModal(questionId) {
    const question = allQuestions.find(q => q.id === questionId);
    if (!question) return;

    const status = question.status || 'active';
    document.getElementById('previewMeta').innerHTML = `
            <span class="badge badge-category">${question.category || 'N/A'}</span>
            <span class="badge badge-marks">${question.marks || 0} marks</span>
            <span class="badge badge-difficulty ${(question.difficulty || 'medium').toLowerCase()}">${question.difficulty || 'Medium'}</span>
            <span class="badge" style="background: ${status === 'active' ? '#e8f5e9' : '#ffebee'}; color: ${status === 'active' ? '#2e7d32' : '#c62828'}">
                <span class="status-dot ${status}" style="width: 8px; height: 8px;"></span>
                ${status}
            </span>
        `;
    document.getElementById('previewQuestionText').textContent = question.text || 'No question text';
    document.getElementById('previewModelAnswer').textContent = question.modelAnswer || 'No model answer';

    document.getElementById('previewModal').classList.add('show');
}

function closePreviewModal() {
    document.getElementById('previewModal').classList.remove('show');
}

// Duplicate Question
async function duplicateQuestion(questionId) {
    const question = allQuestions.find(q => q.id === questionId);
    if (!question) return;

    try {
        await addDoc(collection(db, 'questions'), {
            text: question.text + ' (Copy)',
            category: question.category,
            marks: question.marks,
            modelAnswer: question.modelAnswer,
            difficulty: question.difficulty,
            status: 'inactive',
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser?.email,
            duplicatedFrom: questionId
        });
        showToast('Question duplicated successfully!', 'success');
        loadQuestions();
    } catch (error) {
        showToast('Failed to duplicate: ' + error.message, 'error');
    }
}

// Confirmation Modal
let confirmCallback = null;

function setupConfirmModal() {
    document.getElementById('confirmCancel')?.addEventListener('click', closeConfirmModal);
    document.getElementById('confirmOk')?.addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        closeConfirmModal();
    });
    document.getElementById('confirmModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'confirmModal') closeConfirmModal();
    });
}

function showConfirmModal(icon, title, message, type, callback) {
    document.getElementById('confirmIcon').textContent = icon;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;

    const okBtn = document.getElementById('confirmOk');
    okBtn.className = `btn-confirm ${type}`;
    okBtn.textContent = type === 'danger' ? 'Delete' : 'Confirm';

    confirmCallback = callback;
    document.getElementById('confirmModal').classList.add('show');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('show');
    confirmCallback = null;
}

// Delete with Undo
async function deleteQuestionWithUndo(questionId) {
    const question = allQuestions.find(q => q.id === questionId);
    if (!question) return;

    deletedQuestionBackup = { ...question };

    try {
        await deleteDoc(doc(db, 'questions', questionId));
        loadQuestions();
        loadStatistics();
        showUndoToast('Question deleted');
    } catch (error) {
        showToast('Failed to delete: ' + error.message, 'error');
        deletedQuestionBackup = null;
    }
}

function showUndoToast(message) {
    const toast = document.getElementById('undoToast');
    document.getElementById('undoMessage').textContent = message;

    const timerBar = document.getElementById('undoTimerBar');
    timerBar.style.animation = 'none';
    timerBar.offsetHeight;
    timerBar.style.animation = 'shrink 5s linear forwards';

    toast.classList.add('show');

    if (undoTimeout) clearTimeout(undoTimeout);
    undoTimeout = setTimeout(() => {
        toast.classList.remove('show');
        deletedQuestionBackup = null;
    }, 5000);

    document.getElementById('undoBtn').onclick = async () => {
        if (deletedQuestionBackup) {
            try {
                const { id, ...data } = deletedQuestionBackup;
                await addDoc(collection(db, 'questions'), {
                    ...data,
                    restoredAt: serverTimestamp()
                });
                showToast('Question restored!', 'success');
                loadQuestions();
                loadStatistics();
            } catch (error) {
                showToast('Failed to restore: ' + error.message, 'error');
            }
        }
        toast.classList.remove('show');
        clearTimeout(undoTimeout);
        deletedQuestionBackup = null;
    };
}

// Auto-save Draft
function setupAutoSave() {
    const fields = ['questionText', 'category', 'marks', 'modelAnswer', 'difficulty', 'status'];

    fields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        field?.addEventListener('input', () => saveDraft());
        field?.addEventListener('change', () => saveDraft());
    });
}

function saveDraft() {
    if (draftSaveTimeout) clearTimeout(draftSaveTimeout);

    const indicator = document.getElementById('draftIndicator');
    const text = document.getElementById('draftText');
    indicator.classList.add('show', 'saving');
    text.textContent = 'Saving...';

    draftSaveTimeout = setTimeout(() => {
        const draft = {
            questionText: document.getElementById('questionText')?.value || '',
            category: document.getElementById('category')?.value || '',
            marks: document.getElementById('marks')?.value || '',
            modelAnswer: document.getElementById('modelAnswer')?.value || '',
            difficulty: document.getElementById('difficulty')?.value || '',
            status: document.getElementById('status')?.value || '',
            savedAt: Date.now()
        };

        localStorage.setItem('questionDraft', JSON.stringify(draft));

        indicator.classList.remove('saving');
        text.textContent = 'Draft saved';

        setTimeout(() => {
            if (!document.getElementById('questionText')?.value) {
                indicator.classList.remove('show');
            }
        }, 2000);
    }, 500);
}

function loadDraft() {
    const draft = localStorage.getItem('questionDraft');
    if (!draft) return;

    try {
        const data = JSON.parse(draft);
        if (Date.now() - data.savedAt > 24 * 60 * 60 * 1000) {
            localStorage.removeItem('questionDraft');
            return;
        }

        if (data.questionText) {
            document.getElementById('questionText').value = data.questionText;
            document.getElementById('category').value = data.category;
            document.getElementById('marks').value = data.marks;
            document.getElementById('modelAnswer').value = data.modelAnswer;
            document.getElementById('difficulty').value = data.difficulty || 'Medium';
            document.getElementById('status').value = data.status || 'active';

            document.getElementById('draftIndicator').classList.add('show');
            document.getElementById('draftText').textContent = 'Draft restored';
        }
    } catch (e) {
        localStorage.removeItem('questionDraft');
    }
}


// Keyboard Shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 's':
                    e.preventDefault();
                    if (document.querySelector('.tab-panel.active#addTab')) {
                        document.getElementById('submitBtn')?.click();
                    }
                    break;
                case 'n':
                    e.preventDefault();
                    switchTab('add');
                    document.getElementById('questionText')?.focus();
                    break;
                case 'f':
                    e.preventDefault();
                    switchTab('manage');
                    elements.searchBox?.focus();
                    break;
                case 'e':
                    e.preventDefault();
                    exportToExcel();
                    break;
                case '/':
                    e.preventDefault();
                    document.getElementById('advancedFilters')?.classList.toggle('show');
                    break;
                case 'a':
                    if (document.querySelector('.tab-panel.active#manageTab')) {
                        e.preventDefault();
                        document.getElementById('selectAllCheckbox')?.click();
                    }
                    break;
            }
        }

        if (e.key === 'Escape') {
            closeEditModal();
            closePreviewModal();
            closeConfirmModal();
        }
    });
}

// Shortcuts Help Panel
function setupShortcutsHelp() {
    const btn = document.getElementById('btnShortcuts');
    const panel = document.getElementById('shortcutsHelp');

    btn?.addEventListener('click', () => {
        panel.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!panel?.contains(e.target) && e.target !== btn) {
            panel?.classList.remove('show');
        }
    });
}

// Answer Evaluation System
function setupAnswerEvaluation() {
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

// ============================================
// SESSION EVALUATION & RESULTS VISUALIZATION
// ============================================

async function createTestSession() {
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
async function loadTestSessionsForDropdown() {
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

async function loadResultsForSession(sessionId) {
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

async function populateMockData() {
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

async function loadTestSessionsForManagement() {
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

// Initialize app
init();