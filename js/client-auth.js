/**
 * js/client-auth.js
 * Centralized authentication header and endpoint resolver for all NerdTutors frontend API calls.
 */

export function getApiBaseUrl() {
    if (typeof window === 'undefined') return '';
    // If running on VS Code Live Server (port 5500/5501) where no Node backend exists,
    // route API calls to the live production serverless backend
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
        if (window.location.port === '5500' || window.location.port === '5501' || window.location.port === '8080') {
            return 'https://nerd-tutors-two.vercel.app';
        }
    }
    return '';
}

export function apiUrl(endpoint) {
    const base = getApiBaseUrl();
    const clean = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${base}${clean}`;
}

export async function getNerdAuthHeaders(extraHeaders = {}) {
    let gateToken = null;
    try {
        gateToken = localStorage.getItem('gate_token');
    } catch (_) {}

    if (!gateToken) {
        gateToken = btoa('nerd_tutor_alpha:nt_pass_alpha2026');
        try { localStorage.setItem('gate_token', gateToken); } catch (_) {}
    }

    let adminEmail = null;
    try {
        adminEmail = localStorage.getItem('admin_email');
    } catch (_) {}
    if (!adminEmail) adminEmail = 'kaushtubh457@gmail.com';

    const headers = {
        'Content-Type': 'application/json',
        'X-Gate-Token': gateToken,
        'X-User-Email': adminEmail,
        ...extraHeaders
    };

    // Attach Bearer token if Firebase Auth user is present or cached
    try {
        let idToken = null;
        if (typeof window !== 'undefined') {
            const auth = window.auth || window.firebaseAuth;
            if (auth?.currentUser?.getIdToken) {
                idToken = await auth.currentUser.getIdToken();
            }
            if (!idToken) {
                idToken = localStorage.getItem('firebase_id_token');
            }
        }
        if (idToken) {
            headers['Authorization'] = `Bearer ${idToken}`;
        }
    } catch (_) {}

    return headers;
}

if (typeof window !== 'undefined') {
    window.getNerdAuthHeaders = getNerdAuthHeaders;
    window.apiUrl = apiUrl;
}
