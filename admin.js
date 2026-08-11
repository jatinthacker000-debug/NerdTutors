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
import { showToast, switchTab } from './js/admin-modules/admin-utils.js';
import { setupAiTrainer } from './js/admin-modules/ai-trainer.js';
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
    loadTestSessionsForDropdown,
    loadTestSessionsForManagement,
    populateMockData
} from './js/admin-modules/session-manager.js';

// Initialize
function init() {
    setupAuth();
    setupEventListeners();
    setupExcelUpload();
    setupNewFeatures();
    setupMcqFields(); // NEW: Setup MCQ toggle
    setupAiTrainer(); // AI Trainer: Auto-Discrepancy Analyzer
    loadDraft();
}

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

// Initialize app
init();
