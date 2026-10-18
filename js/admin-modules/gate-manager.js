// ============================================
// GATE MANAGER MODULE (FIREBASE FIRESTORE NATIVE)
// All Gate Passwords & Access Keys are stored in and managed
// directly via Firebase Firestore (collection: 'gateCredentials').
// ============================================

import { db, auth } from '../../firebase-config.js';
import {
    collection,
    addDoc,
    getDocs,
    deleteDoc,
    doc,
    setDoc,
    serverTimestamp,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { showToast, escapeHtml } from './admin-utils.js';

let gateCredentialsCache = [];

const DEFAULT_FIREBASE_CREDENTIALS = [
    { username: 'nerd_tutor_alpha', password: 'nt_pass_alpha2026', label: 'Alpha Master Moderator Key', role: 'system' },
    { username: 'nerd_tutor_beta', password: 'nt_pass_beta2026', label: 'Beta Master Moderator Key', role: 'system' },
    { username: 'nerd_tutor_gamma', password: 'nt_pass_gamma2026', label: 'Gamma Master Moderator Key', role: 'system' },
    { username: 'nerd_tutor_delta', password: 'nt_pass_delta2026', label: 'Delta Master Moderator Key', role: 'system' },
    { username: 'nerd_tutor_epsilon', password: 'nt_pass_epsilon2026', label: 'Epsilon Master Moderator Key', role: 'system' }
];

export function setupGateManager() {
    console.log("🔐 Initializing Gate Manager Module (Firebase Firestore)...");
    setupEventListeners();
    loadGateCredentials();
}

/**
 * Load credentials directly from Firebase Firestore collection 'gateCredentials'.
 * Auto-seeds the default 5 master credentials into Firestore if collection is empty.
 */
export async function loadGateCredentials() {
    const listBody = document.getElementById('gateKeysTableBody');
    if (!listBody) return;

    listBody.innerHTML = `
        <tr>
            <td colspan="6" style="padding: 2.5rem; text-align: center; color: #64748b;">
                <div style="display: inline-block; width: 22px; height: 22px; border: 3px solid #cbd5e1; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 8px;"></div>
                Loading secure gate credentials from Firebase Firestore...
            </td>
        </tr>
    `;

    try {
        const credsRef = collection(db, 'gateCredentials');
        const snapshot = await getDocs(credsRef);

        let creds = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            creds.push({
                id: docSnap.id,
                ...data,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString())
            });
        });

        // If Firestore collection has no credentials yet, auto-seed the 5 default master keys into Firestore
        if (creds.length === 0) {
            console.log("🌱 Auto-seeding initial default Gate Credentials into Firebase Firestore...");
            for (const item of DEFAULT_FIREBASE_CREDENTIALS) {
                const docRef = await addDoc(credsRef, {
                    ...item,
                    createdAt: serverTimestamp()
                });
                creds.push({
                    id: docRef.id,
                    ...item,
                    createdAt: new Date().toISOString()
                });
            }
        } else {
            // Ensure all 5 default keys exist in Firestore
            for (const item of DEFAULT_FIREBASE_CREDENTIALS) {
                if (!creds.some(c => c.username === item.username)) {
                    const docRef = await addDoc(credsRef, {
                        ...item,
                        createdAt: serverTimestamp()
                    });
                    creds.push({
                        id: docRef.id,
                        ...item,
                        createdAt: new Date().toISOString()
                    });
                }
            }
        }

        gateCredentialsCache = creds;
        renderGateCredentials(creds);

        // Sync Firestore credentials with backend API /api/manage-gate so /api/verify-gate is always 100% updated
        syncCredentialsToBackend(creds);

    } catch (err) {
        console.error("❌ Failed to load gate credentials from Firestore:", err);
        listBody.innerHTML = `
            <tr>
                <td colspan="6" style="padding: 2rem; text-align: center; color: #ef4444;">
                    ⚠️ Error loading from Firebase: ${escapeHtml(err.message)}
                    <br><button class="btn" style="margin-top: 8px; padding: 4px 12px; font-size: 0.8rem;" onclick="window.reloadGateCredentials()">Retry</button>
                </td>
            </tr>
        `;
    }
}

/**
 * Synchronize loaded Firestore credentials to the backend server
 */
async function syncCredentialsToBackend(credsList) {
    try {
        await fetch('/api/manage-gate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'sync',
                credentials: credsList.map(c => ({
                    id: c.id,
                    username: c.username,
                    password: c.password,
                    label: c.label,
                    role: c.role,
                    createdAt: c.createdAt
                }))
            })
        });
    } catch (_) {
        // Non-blocking sync
    }
}

export function renderGateCredentials(credentials) {
    const listBody = document.getElementById('gateKeysTableBody');
    const totalCountEl = document.getElementById('gateTotalKeysCount');
    const systemCountEl = document.getElementById('gateSystemKeysCount');
    const customCountEl = document.getElementById('gateCustomKeysCount');

    if (totalCountEl) totalCountEl.textContent = credentials.length;
    if (systemCountEl) systemCountEl.textContent = credentials.filter(c => c.role === 'system').length;
    if (customCountEl) customCountEl.textContent = credentials.filter(c => c.role !== 'system').length;

    if (!listBody) return;

    if (credentials.length === 0) {
        listBody.innerHTML = `
            <tr>
                <td colspan="6" style="padding: 2.5rem; text-align: center; color: #64748b; font-style: italic;">
                    No gate credentials configured yet. Create one above!
                </td>
            </tr>
        `;
        return;
    }

    // Sort: system first, then custom by date descending
    const sorted = [...credentials].sort((a, b) => {
        if (a.role === 'system' && b.role !== 'system') return -1;
        if (a.role !== 'system' && b.role === 'system') return 1;
        return (new Date(b.createdAt || 0)) - (new Date(a.createdAt || 0));
    });

    let html = '';
    sorted.forEach(cred => {
        const isSystem = cred.role === 'system';
        const dateStr = cred.createdAt ? new Date(cred.createdAt).toLocaleDateString() : 'Active';
        const safeUser = escapeHtml(cred.username);
        const safePass = escapeHtml(cred.password);
        const safeLabel = escapeHtml(cred.label || 'Moderator Gate Key');

        html += `
            <tr style="border-bottom: 1px solid #e2e8f0; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                <td style="padding: 0.9rem 1rem; font-weight: 600; color: #1e293b; font-family: monospace; font-size: 0.95rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span>👤 ${safeUser}</span>
                        <button type="button" class="btn-copy-small" onclick="window.copyTextToClipboard('${safeUser}', 'Username')" title="Copy Username" style="background: none; border: none; cursor: pointer; color: #64748b; font-size: 0.85rem; padding: 2px;">📋</button>
                    </div>
                </td>
                <td style="padding: 0.9rem 1rem; color: #334155;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <input type="password" readonly value="${safePass}" id="pass_${cred.id}" style="border: 1px solid #e2e8f0; background: #f1f5f9; padding: 4px 8px; border-radius: 6px; font-family: monospace; font-size: 0.85rem; width: 140px; outline: none;">
                        <button type="button" onclick="window.togglePasswordVisibility('pass_${cred.id}')" title="Show/Hide" style="background: none; border: none; cursor: pointer; font-size: 0.9rem; color: #64748b;">👁️</button>
                        <button type="button" class="btn-copy-small" onclick="window.copyTextToClipboard('${safePass}', 'Password')" title="Copy Password" style="background: none; border: none; cursor: pointer; color: #64748b; font-size: 0.85rem; padding: 2px;">📋</button>
                    </div>
                </td>
                <td style="padding: 0.9rem 1rem; color: #475569; font-size: 0.9rem;">
                    ${safeLabel}
                </td>
                <td style="padding: 0.9rem 1rem;">
                    ${isSystem 
                        ? `<span style="background: #e0e7ff; color: #4338ca; padding: 3px 8px; border-radius: 12px; font-weight: 700; font-size: 0.75rem; text-transform: uppercase;">🛡️ System Master</span>` 
                        : `<span style="background: #dcfce7; color: #15803d; padding: 3px 8px; border-radius: 12px; font-weight: 700; font-size: 0.75rem; text-transform: uppercase;">🔥 Firebase Key</span>`
                    }
                </td>
                <td style="padding: 0.9rem 1rem; color: #64748b; font-size: 0.85rem;">
                    ${dateStr}
                </td>
                <td style="padding: 0.9rem 1rem; text-align: right;">
                    ${isSystem 
                        ? `<span style="color: #94a3b8; font-size: 0.8rem; font-style: italic;">Protected</span>` 
                        : `<button class="btn" onclick="window.deleteGateKey('${cred.id}', '${safeUser}')" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s;">🗑️ Delete</button>`
                    }
                </td>
            </tr>
        `;
    });

    listBody.innerHTML = html;
}

function setupEventListeners() {
    const form = document.getElementById('createGateKeyForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const usernameInput = document.getElementById('gateUsernameInput');
            const passwordInput = document.getElementById('gatePasswordInput');
            const labelInput = document.getElementById('gateLabelInput');
            const submitBtn = document.getElementById('btnSaveGateKey');

            const username = usernameInput?.value.trim();
            const password = passwordInput?.value.trim();
            const label = labelInput?.value.trim() || 'Moderator Gate Key';

            if (!username || username.length < 3) {
                showToast("Username must be at least 3 characters.", "error");
                return;
            }
            if (!/^[a-zA-Z0-9_\-\.]+$/.test(username)) {
                showToast("Username can only contain letters, numbers, hyphens, and underscores.", "error");
                return;
            }
            if (!password || password.length < 4) {
                showToast("Password must be at least 4 characters.", "error");
                return;
            }

            // Check if username already exists in cache
            if (gateCredentialsCache.some(c => c.username.toLowerCase() === username.toLowerCase())) {
                showToast(`Username "${username}" already exists. Please choose a different one.`, "error");
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Saving to Firebase...';
            }

            try {
                // 1. Direct write to Firebase Firestore collection 'gateCredentials'
                const docRef = await addDoc(collection(db, 'gateCredentials'), {
                    username,
                    password,
                    label,
                    role: 'custom',
                    createdAt: serverTimestamp()
                });

                showToast(`Gate password for "${username}" saved to Firebase!`, 'success');

                // Reset form fields
                if (usernameInput) usernameInput.value = '';
                if (passwordInput) passwordInput.value = '';
                if (labelInput) labelInput.value = '';

                // Reload from Firestore
                await loadGateCredentials();

            } catch (err) {
                console.error("❌ Key creation error:", err);
                showToast("Firebase Error: " + err.message, 'error');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '➕ Create Gate Key';
                }
            }
        });
    }

    // Helper: Generate Random Password
    const btnGenPass = document.getElementById('btnGenerateGatePassword');
    if (btnGenPass) {
        btnGenPass.addEventListener('click', () => {
            const passInput = document.getElementById('gatePasswordInput');
            if (!passInput) return;
            const words = ['eco', 'nerd', 'tutor', 'cbse', 'exam', 'star', 'batch', 'pro'];
            const w1 = words[Math.floor(Math.random() * words.length)];
            const w2 = words[Math.floor(Math.random() * words.length)];
            const num = Math.floor(1000 + Math.random() * 9000);
            passInput.value = `${w1}_${w2}_${num}`;
            passInput.type = 'text';
            showToast("Secure password generated!", "info");
        });
    }
}

// Global Helpers for HTML attributes
window.reloadGateCredentials = loadGateCredentials;

window.togglePasswordVisibility = function(elementId) {
    const input = document.getElementById(elementId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
};

window.copyTextToClipboard = async function(text, label = 'Text') {
    try {
        await navigator.clipboard.writeText(text);
        showToast(`${label} copied to clipboard!`, 'success');
    } catch (_) {
        showToast(`Failed to copy ${label}`, 'error');
    }
};

window.deleteGateKey = async function(id, username) {
    if (!confirm(`Are you sure you want to permanently delete the gate password for "${username}" from Firebase?`)) {
        return;
    }

    try {
        // Direct deletion from Firebase Firestore
        await deleteDoc(doc(db, 'gateCredentials', id));
        showToast(`Gate password for "${username}" deleted from Firebase.`, 'success');

        // Also notify backend
        try {
            await fetch('/api/manage-gate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete', id, username })
            });
        } catch (_) {}

        await loadGateCredentials();
    } catch (err) {
        console.error("❌ Delete key error:", err);
        showToast("Firebase deletion error: " + err.message, 'error');
    }
};
