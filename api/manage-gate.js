import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Force load .env.local if present locally
try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length - 1);
                }
                process.env[key] = value;
            }
        });
    }
} catch (_) {}

const GATE_SECRET = process.env.GATE_SECRET || 'nt_gate_hmac_secret_2026_super_secure';

const DEFAULT_CREDENTIALS = [
    { id: 'gate_sys_1', username: 'nerd_tutor_alpha', password: 'nt_pass_alpha2026', label: 'Alpha Master Moderator Key', role: 'system', createdAt: '2026-10-18T00:00:00.000Z' },
    { id: 'gate_sys_2', username: 'nerd_tutor_beta', password: 'nt_pass_beta2026', label: 'Beta Master Moderator Key', role: 'system', createdAt: '2026-10-18T00:00:00.000Z' },
    { id: 'gate_sys_3', username: 'nerd_tutor_gamma', password: 'nt_pass_gamma2026', label: 'Gamma Master Moderator Key', role: 'system', createdAt: '2026-10-18T00:00:00.000Z' },
    { id: 'gate_sys_4', username: 'nerd_tutor_delta', password: 'nt_pass_delta2026', label: 'Delta Master Moderator Key', role: 'system', createdAt: '2026-10-18T00:00:00.000Z' },
    { id: 'gate_sys_5', username: 'nerd_tutor_epsilon', password: 'nt_pass_epsilon2026', label: 'Epsilon Master Moderator Key', role: 'system', createdAt: '2026-10-18T00:00:00.000Z' }
];

function getCredFilePath() {
    const primaryPath = path.join(process.cwd(), 'api', 'gate-credentials.json');
    if (fs.existsSync(primaryPath)) return primaryPath;
    const rootPath = path.join(process.cwd(), 'gate-credentials.json');
    if (fs.existsSync(rootPath)) return rootPath;
    // Serverless fallback
    return path.join('/tmp', 'gate-credentials.json');
}

export function loadAllCredentials() {
    const creds = [...DEFAULT_CREDENTIALS];
    const filePath = getCredFilePath();

    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (Array.isArray(data)) {
                data.forEach(item => {
                    const idx = creds.findIndex(c => c.username === item.username);
                    if (idx >= 0) {
                        creds[idx] = { ...creds[idx], ...item };
                    } else if (item.username && item.password) {
                        creds.push({
                            id: item.id || `gate_custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                            username: item.username,
                            password: item.password,
                            label: item.label || 'Custom Moderator Key',
                            role: item.role || 'custom',
                            createdAt: item.createdAt || new Date().toISOString()
                        });
                    }
                });
            }
        }
    } catch (e) {
        console.warn("Failed to read gate-credentials.json:", e.message);
    }

    return creds;
}

export function saveCredentials(credentialsList) {
    const filePath = getCredFilePath();
    try {
        fs.writeFileSync(filePath, JSON.stringify(credentialsList, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("Failed to write to primary path, trying /tmp:", e.message);
        try {
            fs.writeFileSync(path.join('/tmp', 'gate-credentials.json'), JSON.stringify(credentialsList, null, 2), 'utf8');
            return true;
        } catch (tmpErr) {
            console.error("Failed to write to /tmp as well:", tmpErr.message);
            return false;
        }
    }
}

export default async function handler(req, res) {
    // CORS configuration
    const allowedOrigins = [
        "https://nerd-tutors.vercel.app",
        "https://nerd-tutors-two.vercel.app",
        "http://localhost:3000",
        "http://localhost:5000"
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-gate-token, x-user-email");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");

    if (req.method === "OPTIONS") return res.status(200).end();

    try {
        if (req.method === "GET") {
            const allCreds = loadAllCredentials();
            return res.status(200).json({
                success: true,
                count: allCreds.length,
                credentials: allCreds
            });
        }

        if (req.method === "POST") {
            let body = req.body;
            if (typeof body === "string") {
                try { body = JSON.parse(body); } catch (_) { body = {}; }
            }

            const { action, username, password, label, id } = body || {};

            if (action === "add" || action === "create") {
                const cleanUser = (username || "").trim();
                const cleanPass = (password || "").trim();
                const cleanLabel = (label || "").trim() || "Batch Gate Access";

                if (!cleanUser || cleanUser.length < 3) {
                    return res.status(400).json({ error: "Username must be at least 3 characters long." });
                }
                if (!/^[a-zA-Z0-9_\-\.]+$/.test(cleanUser)) {
                    return res.status(400).json({ error: "Username can only contain letters, numbers, hyphens, and underscores." });
                }
                if (!cleanPass || cleanPass.length < 4) {
                    return res.status(400).json({ error: "Password must be at least 4 characters long." });
                }

                const currentCreds = loadAllCredentials();
                const existing = currentCreds.find(c => c.username.toLowerCase() === cleanUser.toLowerCase());
                if (existing) {
                    return res.status(400).json({ error: `Username "${cleanUser}" already exists. Please choose a different username.` });
                }

                const newCredential = {
                    id: `gate_custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    username: cleanUser,
                    password: cleanPass,
                    label: cleanLabel,
                    role: "custom",
                    createdAt: new Date().toISOString()
                };

                currentCreds.push(newCredential);
                const saved = saveCredentials(currentCreds);

                if (!saved) {
                    return res.status(500).json({ error: "Failed to persist new credential to server." });
                }

                return res.status(201).json({
                    success: true,
                    message: `Gate password for "${cleanUser}" created successfully!`,
                    credential: newCredential,
                    credentials: currentCreds
                });
            }

            if (action === "delete" || action === "remove") {
                const targetId = id;
                const targetUser = (username || "").trim();

                let currentCreds = loadAllCredentials();
                const toDelete = currentCreds.find(c => (targetId && c.id === targetId) || (targetUser && c.username === targetUser));

                if (!toDelete) {
                    return res.status(404).json({ error: "Credential not found." });
                }

                if (toDelete.role === "system") {
                    return res.status(403).json({ error: "System default credentials cannot be deleted." });
                }

                currentCreds = currentCreds.filter(c => c.id !== toDelete.id && c.username !== toDelete.username);
                saveCredentials(currentCreds);

                return res.status(200).json({
                    success: true,
                    message: `Gate credential "${toDelete.username}" successfully deleted.`,
                    credentials: currentCreds
            if (action === "sync" && Array.isArray(body.credentials)) {
                let currentCreds = loadAllCredentials();
                body.credentials.forEach(item => {
                    if (item.username && item.password) {
                        const idx = currentCreds.findIndex(c => c.username.toLowerCase() === item.username.toLowerCase());
                        if (idx >= 0) {
                            currentCreds[idx] = { ...currentCreds[idx], ...item };
                        } else {
                            currentCreds.push(item);
                        }
                    }
                });
                saveCredentials(currentCreds);
                return res.status(200).json({ success: true, count: currentCreds.length, message: "Credentials synced successfully." });
            }

            return res.status(400).json({ error: "Invalid action. Supported actions: 'add', 'delete', 'sync'" });
        }

        return res.status(405).json({ error: "Method not allowed. Use GET or POST." });

    } catch (err) {
        console.error("❌ Gate Manager error:", err);
        return res.status(500).json({ error: "Internal server error", details: err.message });
    }
}
