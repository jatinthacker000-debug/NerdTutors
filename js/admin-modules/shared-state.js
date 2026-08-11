// ============================================
// SHARED STATE - Constants & DOM element cache
// Extracted verbatim from the original admin.js
// ============================================

// Valid categories for validation
export const VALID_CATEGORIES = [
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
export const elements = {
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
