// ============================================
// GATE MANAGER MODULE (FIREBASE FIRESTORE NATIVE)
// All Gate Passwords & Access Keys are stored in and managed
// directly via Firebase Firestore (collection: 'gateCredentials')
// with a seamless backend API fallback if Firestore rules are pending.
// ============================================

import { db, auth } from '../../firebase-config.js';
import {
    collection,
    getDocs,
    deleteDoc,
    doc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { showToast, escapeHtml } from './admin-utils.js';

let gateCredentialsCache = [];
let isGateManagerInitialized = false;
let isFirestorePermissionRestricted = false;

const DEFAULT_FIREBASE_CREDENTIALS = [
    { username: 'nerd_tutor_alpha', password: 'nt_pass_alpha2026', label: 'Alpha Master Moderator Key', role: 'system' },
    { username: 'nerd_tutor_beta', password: 'nt_pass_beta2026', label: 'Beta Master Moderator Key', role: 'system' },
    { username: 'nerd_tutor_gamma', password: 'nt_pass_gamma2026', label: 'Gamma Master Moderator Key', role: 'system' },
    { username: 'nerd_tutor_delta', password: 'nt_pass_delta2026', label: 'Delta Master Moderator Key', role: 'system' },
    { username: 'nerd_tutor_epsilon', password: 'nt_pass_epsilon2026', label: 'Epsilon Master Moderator Key', role: 'system' }
];

export function setupGateManager() {
    console.log("🔐 Initializing Gate Manager Module (Firebase Firestore)...");
    if (!isGateManagerInitialized) {
        setupEventListeners();
        isGateManagerInitialized = true;
    }
    loadGateCredentials();
}

/**
 * Load credentials directly from Firebase Firestore collection 'gateCredentials'.
 * Falls back to secure backend API if Firebase Security Rules deny client access.
 */
export async function loadGateCredentials() {
    const listBody = document.getElementById('gateKeysTableBody');
    if (!listBody) return;

    listBody.innerHTML = `
        <tr>
            <td colspan="6" style="padding: 2.5rem; text-align: center; color: #64748b;">
                <div style="display: inline-block; width: 22px; height: 22px; border: 3px solid #cbd5e1; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 8px;"></div>
                Loading secure gate credentials...
            </td>
        </tr>
    `;

    try {
        const credsRef = collection(db, 'gateCredentials');
        const snapshot = await getDocs(credsRef);

        let creds = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const uname = data.username || docSnap.id;
            creds.push({
                id: docSnap.id,
                username: uname,
                password: data.password,
                label: data.label || 'Moderator Gate Key',
                role: data.role || (uname.startsWith('nerd_tutor_') ? 'system' : 'custom'),
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
                source: 'firebase'
            });
        });

        // Auto-shift: Guarantee that all 5 default master keys are permanently saved in Firebase Firestore
        let newlySeededCount = 0;
        for (const item of DEFAULT_FIREBASE_CREDENTIALS) {
            const exists = creds.some(c => c.username.toLowerCase() === item.username.toLowerCase());
            if (!exists) {
                try {
                    await setDoc(doc(db, 'gateCredentials', item.username), {
                        username: item.username,
                        password: item.password,
                        label: item.label,
                        role: item.role,
                        source: 'firebase',
                        createdAt: serverTimestamp()
                    });
                    creds.push({
                        id: item.username,
                        ...item,
                        source: 'firebase',
                        createdAt: new Date().toISOString()
                    });
                    newlySeededCount++;
                } catch (_) {}
            }
        }

        if (newlySeededCount > 0) {
            console.log(`🔥 Auto-shifted ${newlySeededCount} master credentials directly into Firebase Firestore collection 'gateCredentials'.`);
        }

        isFirestorePermissionRestricted = false;
        gateCredentialsCache = creds;
        renderGateCredentials(creds, false);

        // Sync to backend cache for server token verification
        syncCredentialsToBackend(creds);

    } catch (err) {
        console.warn("⚠️ Firebase Firestore gateCredentials permission notice:", err.message);
        isFirestorePermissionRestricted = true;

        // Graceful resilient fallback to /api/manage-gate backend handler
        try {
            const res = await fetch('/api/manage-gate');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.credentials) && data.credentials.length > 0) {
                    gateCredentialsCache = data.credentials;
                    renderGateCredentials(data.credentials, true);
                    return;
                }
            }
        } catch (_) {}

        // Secondary fallback to default master credentials
        gateCredentialsCache = DEFAULT_FIREBASE_CREDENTIALS;
        renderGateCredentials(DEFAULT_FIREBASE_CREDENTIALS, true);
    }
}

/**
 * Explicit Shift & Migrate: Reads all default credentials and server credentials
 * and writes every single one directly into Firebase Firestore ('gateCredentials').
 */
export async function shiftCredentialsToFirebase() {
    const shiftBtn = document.getElementById('btnShiftToFirebase');
    const originalText = shiftBtn ? shiftBtn.innerHTML : '';
    if (shiftBtn) {
        shiftBtn.disabled = true;
        shiftBtn.innerHTML = `⏳ Shifting to Firebase...`;
    }

    try {
        let count = 0;
        // 1. Shift all default credentials
        for (const item of DEFAULT_FIREBASE_CREDENTIALS) {
            await setDoc(doc(db, 'gateCredentials', item.username), {
                username: item.username,
                password: item.password,
                label: item.label,
                role: item.role,
                source: 'firebase',
                lastUpdated: serverTimestamp()
            }, { merge: true });
            count++;
        }

        // 2. Query any existing credentials from backend file/memory to shift them into Firebase
        try {
            const res = await fetch('/api/manage-gate');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.credentials)) {
                    for (const cred of data.credentials) {
                        if (cred.username && cred.password) {
                            await setDoc(doc(db, 'gateCredentials', cred.username), {
                                username: cred.username,
                                password: cred.password,
                                label: cred.label || 'Moderator Key',
                                role: cred.role || (cred.username.startsWith('nerd_tutor_') ? 'system' : 'custom'),
                                source: 'firebase',
                                lastUpdated: serverTimestamp()
                            }, { merge: true });
                            count++;
                        }
                    }
                }
            }
        } catch (_) {}

        showToast(`🔥 Successfully shifted & saved ${count} credentials to Firebase Firestore!`, 'success');
        await loadGateCredentials();
    } catch (err) {
        console.error("❌ Error shifting credentials to Firebase:", err);
        if (err.message.includes('permission') || err.code === 'permission-denied') {
            window.copyFirestoreRuleSnippet();
            showToast("Firebase Firestore rules blocked direct write. Rule copied to clipboard! Paste in Firebase Console > Rules.", "error");
        } else {
            showToast("Error shifting to Firebase: " + err.message, 'error');
        }
    } finally {
        if (shiftBtn) {
            shiftBtn.disabled = false;
            shiftBtn.innerHTML = originalText || `🔥 Shift / Sync to Firebase`;
        }
    }
}

/**
 * Synchronize loaded Firestore credentials to the backend server for token creation
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

export function renderGateCredentials(credentials, isPermissionNotice = false) {
    const listBody = document.getElementById('gateKeysTableBody');
    const totalCountEl = document.getElementById('gateTotalKeysCount');
    const systemCountEl = document.getElementById('gateSystemKeysCount');
    const customCountEl = document.getElementById('gateCustomKeysCount');
    const noticeContainer = document.getElementById('gateFirestoreRulesNotice');

    if (totalCountEl) totalCountEl.textContent = credentials.length;
    if (systemCountEl) systemCountEl.textContent = credentials.filter(c => c.role === 'system').length;
    if (customCountEl) customCountEl.textContent = credentials.filter(c => c.role !== 'system').length;

    // Toggle Firestore rules banner if permissions are restricted
    if (noticeContainer) {
        noticeContainer.style.display = isPermissionNotice ? 'block' : 'none';
    }

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
        const elementId = `pass_${cred.username.replace(/[^a-zA-Z0-9_]/g, '_')}`;

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
                        <input type="password" readonly value="${safePass}" id="${elementId}" style="border: 1px solid #e2e8f0; background: #f1f5f9; padding: 4px 8px; border-radius: 6px; font-family: monospace; font-size: 0.85rem; width: 140px; outline: none;">
                        <button type="button" onclick="window.togglePasswordVisibility('${elementId}')" title="Show/Hide" style="background: none; border: none; cursor: pointer; font-size: 0.9rem; color: #64748b;">👁️</button>
                        <button type="button" class="btn-copy-small" onclick="window.copyTextToClipboard('${safePass}', 'Password')" title="Copy Password" style="background: none; border: none; cursor: pointer; color: #64748b; font-size: 0.85rem; padding: 2px;">📋</button>
                    </div>
                </td>
                <td style="padding: 0.9rem 1rem; color: #475569; font-size: 0.9rem;">
                    ${safeLabel}
                </td>
                <td style="padding: 0.9rem 1rem;">
                    ${isSystem 
                        ? `<span style="background: #e0e7ff; color: #4338ca; padding: 3px 8px; border-radius: 12px; font-weight: 700; font-size: 0.75rem; text-transform: uppercase;">🛡️ System Master</span>` 
                        : `<span style="background: #dcfce7; color: #15803d; padding: 3px 8px; border-radius: 12px; font-weight: 700; font-size: 0.75rem; text-transform: uppercase;">🔥 Active Key</span>`
                    }
                </td>
                <td style="padding: 0.9rem 1rem; color: #64748b; font-size: 0.85rem;">
                    <span title="Stored in Database: gateCredentials">☁️ ${dateStr}</span>
                </td>
                <td style="padding: 0.9rem 1rem; text-align: right;">
                    ${isSystem 
                        ? `<span style="color: #94a3b8; font-size: 0.8rem; font-style: italic;">Protected</span>` 
                        : `<button class="btn" onclick="window.deleteGateKey('${safeUser}')" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s;">🗑️ Delete</button>`
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
                submitBtn.textContent = 'Saving key...';
            }

            try {
                // 1. Attempt direct write to Firebase Firestore
                try {
                    await setDoc(doc(db, 'gateCredentials', username), {
                        username,
                        password,
                        label,
                        role: 'custom',
                        source: 'firebase',
                        createdAt: serverTimestamp()
                    });
                } catch (fbErr) {
                    console.warn("Direct Firestore write restricted, saving via backend API:", fbErr.message);
                }

                // 2. Always persist via backend API
                const res = await fetch('/api/manage-gate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'add',
                        username,
                        password,
                        label
                    })
                });

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || 'Failed to save gate key');
                }

                showToast(`Gate password for "${username}" created and active!`, 'success');

                // Reset form fields
                if (usernameInput) usernameInput.value = '';
                if (passwordInput) passwordInput.value = '';
                if (labelInput) labelInput.value = '';

                // Reload credentials
                await loadGateCredentials();

            } catch (err) {
                console.error("❌ Key creation error:", err);
                showToast("Error: " + err.message, 'error');
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
window.shiftCredentialsToFirebase = shiftCredentialsToFirebase;

window.copyFirestoreRuleSnippet = function() {
    const ruleSnippet = `match /gateCredentials/{document=**} {
  allow read, write: if request.auth != null;
}
match /eval_directives/{document=**} {
  allow read, write: if request.auth != null;
}`;
    navigator.clipboard.writeText(ruleSnippet).then(() => {
        showToast("Firestore Security Rules copied! Paste in Firebase Console > Firestore > Rules.", "success");
    }).catch(() => {
        prompt("Copy this rule and paste inside match /databases/{database}/documents in Firebase Console > Firestore > Rules:", ruleSnippet);
    });
};

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

window.deleteGateKey = async function(username) {
    if (!confirm(`Are you sure you want to permanently delete the gate password for "${username}"?`)) {
        return;
    }

    try {
        // 1. Direct deletion from Firebase Firestore if accessible
        try {
            await deleteDoc(doc(db, 'gateCredentials', username));
        } catch (_) {}

        // 2. Deletion from backend API
        await fetch('/api/manage-gate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', username: username, id: username })
        });

        showToast(`Gate password for "${username}" deleted.`, 'success');
        await loadGateCredentials();
    } catch (err) {
        console.error("❌ Delete key error:", err);
        showToast("Deletion error: " + err.message, 'error');
    }
};
