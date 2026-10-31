// ============================================
// ADMIN - MAIN ENTRY ORCHESTRATOR
// Firebase auth handling, global event wiring, and the
// init() bootstrapper. All feature logic lives in the
// modules under ./js/admin-modules/.
// ============================================

import { auth, isAdmin } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

import { elements } from './js/admin-modules/shared-state.js';
import { showToast, switchTab, syncClassSubjects } from './js/admin-modules/admin-utils.js';
import { setupExcelUpload } from './js/admin-modules/excel-uploader.js';
import {
    setupMcqFields,
    setupNewFeatures,
    closeEditModal,
    loadDraft
} from './js/admin-modules/question-manager.js';
import {
    createTestSession,
    loadResultsForSession,
    downloadAllReportsForCurrentSession,
    downloadZipReportsForCurrentSession,
    exportCurrentSessionCSV,
    loadTestSessionsForDropdown,
    loadTestSessionsForManagement,
    populateMockData,
    setupPdfExtractionHub
} from './js/admin-modules/session-manager.js?v=250';
import { setupGateManager } from './js/admin-modules/gate-manager.js';
import { setupBundleEvaluator, loadBundleSessions } from './js/admin-modules/bundle-evaluator.js?v=254';

// Initialize
function init() {
    setupAuth();
    setupEventListeners();
    setupExcelUpload();
    setupNewFeatures();
    setupMcqFields(); // NEW: Setup MCQ toggle
    setupPdfExtractionHub(); // Direct PDF Ingestion & Diagnostic Self-Test Hub
    setupBundleEvaluator(); // NEW: Batch / Bundle Paper Evaluator
    loadDraft();
}

function setupAuth() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            if (isAdmin(user.email) || user.email?.includes('admin')) {
                localStorage.setItem('gate_authenticated', 'true');
                if (!localStorage.getItem('gate_token')) {
                    localStorage.setItem('gate_token', btoa('admin:' + (user.email || 'jatin_admin')));
                }
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
    loadBundleSessions();
    setupGateManager();
    window.reloadBundleSessions = loadBundleSessions;
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

    // Dynamic Class <-> Subject Synchronization (CBSE Standard)
    const sessionClass = document.getElementById('sessionClass');
    const sessionSubject = document.getElementById('sessionSubject');
    if (sessionClass && sessionSubject) {
        sessionClass.addEventListener('change', () => syncClassSubjects(sessionClass, sessionSubject));
        syncClassSubjects(sessionClass, sessionSubject);
    }

    const editSessionClass = document.getElementById('editSessionClass');
    const editSessionSubject = document.getElementById('editSessionSubject');
    if (editSessionClass && editSessionSubject) {
        editSessionClass.addEventListener('change', () => syncClassSubjects(editSessionClass, editSessionSubject));
    }

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
                    <td colspan="7" style="padding: 2rem; text-align: center; color: #666; font-style: italic;">
                        Select a session to load student results.
                    </td>
                </tr>
            `;
            const actionsBar = document.getElementById('resultsActionsBar');
            if (actionsBar) actionsBar.style.display = 'none';
        }
    });

    // Bulk Download All Reports, ZIP & Export CSV Buttons
    const btnDownloadAllReports = document.getElementById('btnDownloadAllReports');
    btnDownloadAllReports?.addEventListener('click', () => {
        downloadAllReportsForCurrentSession();
    });

    const btnDownloadZipReports = document.getElementById('btnDownloadZipReports');
    btnDownloadZipReports?.addEventListener('click', () => {
        downloadZipReportsForCurrentSession();
    });

    const btnExportSessionCSV = document.getElementById('btnExportSessionCSV');
    btnExportSessionCSV?.addEventListener('click', () => {
        exportCurrentSessionCSV();
    });

    // Populate Mock Data Button
    const btnPopulateMockData = document.getElementById('btnPopulateMockData');
    btnPopulateMockData?.addEventListener('click', async () => {
        if (confirm("Do you want to populate mock test sessions and 10 student evaluations into the database? This is great for dashboard testing!")) {
            await populateMockData();
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

    // Check URL hash on load (e.g., admin.html#view-results or admin.html#results)
    const handleHashTab = () => {
        const hash = window.location.hash.replace('#', '').trim();
        if (hash === 'results' || hash === 'view-results') {
            switchTab('view-results');
        } else if (hash && document.querySelector(`.tab-btn[data-tab="${hash}"]`)) {
            switchTab(hash);
        }
    };
    window.addEventListener('hashchange', handleHashTab);
    handleHashTab();

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

// Initialize app
init();
