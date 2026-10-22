import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

let cachedToken = null;
let tokenExpiresAt = 0;

export async function getVertexAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    // Reuse cached token if valid for more than 5 minutes
    if (cachedToken && tokenExpiresAt > now + 300) {
        return cachedToken;
    }

    let credentials = null;

    // 1. Try reading from vertex-key.json in root
    try {
        const keyPath = path.join(process.cwd(), 'vertex-key.json');
        if (fs.existsSync(keyPath)) {
            credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        }
    } catch (_) {}

    // 2. Fallback to environment variable
    if (!credentials && process.env.GCP_SERVICE_ACCOUNT_KEY) {
        try {
            credentials = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
        } catch (_) {}
    }

    if (!credentials || !credentials.client_email || !credentials.private_key) {
        throw new Error("No valid Vertex AI Service Account credentials found (vertex-key.json or GCP_SERVICE_ACCOUNT_KEY).");
    }

    // Build JWT Header & Claims
    const header = {
        alg: "RS256",
        typ: "JWT"
    };

    const payload = {
        iss: credentials.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now
    };

    const base64UrlEncode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedToken);
    const signature = signer.sign(credentials.private_key, 'base64url');
    const jwt = `${unsignedToken}.${signature}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: jwt
        })
    });

    const data = await res.json();
    if (!res.ok || !data.access_token) {
        throw new Error(`Google OAuth2 Token Exchange Failed (${res.status}): ${data.error_description || data.error || JSON.stringify(data)}`);
    }

    cachedToken = data.access_token;
    tokenExpiresAt = now + (data.expires_in || 3600);
    return cachedToken;
}
