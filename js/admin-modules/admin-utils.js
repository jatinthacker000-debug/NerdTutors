// ============================================
// ADMIN UTILS
// Toast notifications, tab switching, HTML escaping,
// and the shared confirmation modal.
// ============================================

import { loadTestSessionsForDropdown, loadTestSessionsForManagement } from './session-manager.js';

// Escape HTML
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Switch tabs
export function switchTab(tabName) {
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

// Show Toast
export function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = `toast ${type} show`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Confirmation Modal
let confirmCallback = null;

export function setupConfirmModal() {
    document.getElementById('confirmCancel')?.addEventListener('click', closeConfirmModal);
    document.getElementById('confirmOk')?.addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        closeConfirmModal();
    });
    document.getElementById('confirmModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'confirmModal') closeConfirmModal();
    });
}

export function showConfirmModal(icon, title, message, type, callback) {
    document.getElementById('confirmIcon').textContent = icon;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;

    const okBtn = document.getElementById('confirmOk');
    okBtn.className = `btn-confirm ${type}`;
    okBtn.textContent = type === 'danger' ? 'Delete' : 'Confirm';

    confirmCallback = callback;
    document.getElementById('confirmModal').classList.add('show');
}

export function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('show');
    confirmCallback = null;
}
