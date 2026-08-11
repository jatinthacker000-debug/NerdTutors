// ============================================
// EXCEL UPLOADER
// Bulk question import: drag & drop, XLSX/CSV parsing,
// row validation, preview table, batched upload to
// Firebase, plus template / sample downloads.
// ============================================

import { auth, db } from '../../firebase-config.js';
import {
    collection,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import { VALID_CATEGORIES, elements } from './shared-state.js';
import { showToast, escapeHtml } from './admin-utils.js';
import { loadQuestions, loadStatistics } from './question-manager.js';

// Module state
let parsedExcelData = [];
let validQuestionsToUpload = [];

export function setupExcelUpload() {
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

export function processExcelFile(file) {
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

export function validateExcelData(data) {
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

export function displayPreview(data) {
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

export function downloadTemplate() {
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

export function downloadSampleData() {
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
