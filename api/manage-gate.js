import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
    handleCors,
    validateInvocation,
    verifyAuth,
    checkIsAdmin,
    sendError,
    DEFAULT_CREDENTIALS,
    GATE_SECRET
} from './_security.js';

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

function sanitizeCredential(c) {
    if (!c) return null;
    return {
        id: c.id,
        username: c.username,
        label: c.label || 'Moderator Key',
        role: c.role || 'custom',
        createdAt: c.createdAt || new Date().toISOString(),
        updatedAt: c.updatedAt || undefined
    };
}

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (validateInvocation(req, res)) return;

    // Strict Admin Authentication Guard
    const authResult = await verifyAuth(req);
    if (!authResult.authenticated) {
        return sendError(res, 401, "Unauthorized: Authentication required to manage gate credentials.");
    }
    if (!authResult.user?.isAdmin) {
        return sendError(res, 403, "Forbidden: Administrator privileges required to manage gate credentials.");
    }

    try {
        if (req.method === "GET") {
            const allCreds = loadAllCredentials();
            const safeCreds = allCreds.map(sanitizeCredential);
            return res.status(200).json({
                success: true,
                count: safeCreds.length,
                credentials: safeCreds
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
                    return sendError(res, 400, "Username must be at least 3 characters long.");
                }
                if (!/^[a-zA-Z0-9_\-\.]+$/.test(cleanUser)) {
                    return sendError(res, 400, "Username can only contain letters, numbers, hyphens, and underscores.");
                }
                if (!cleanPass || cleanPass.length < 4) {
                    return sendError(res, 400, "Password must be at least 4 characters long.");
                }

                const currentCreds = loadAllCredentials();
                const existing = currentCreds.find(c => c.username.toLowerCase() === cleanUser.toLowerCase());
                if (existing) {
                    return sendError(res, 400, `Username "${cleanUser}" already exists. Please choose a different username.`);
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
                    return sendError(res, 500, "Failed to persist new credential to server.");
                }

                return res.status(201).json({
                    success: true,
                    message: `Gate password for "${cleanUser}" created successfully!`,
                    credential: sanitizeCredential(newCredential),
                    credentials: currentCreds.map(sanitizeCredential)
                });
            }

            if (action === "update" || action === "edit" || action === "modify") {
                const targetUser = (username || "").trim();
                const newPassword = (password || "").trim();
                const newLabel = (label || "").trim();

                let currentCreds = loadAllCredentials();
                const toUpdate = currentCreds.find(c => c.username.toLowerCase() === targetUser.toLowerCase() || (id && c.id === id));

                if (!toUpdate) {
                    return sendError(res, 404, `Credential "${targetUser}" not found.`);
                }

                if (newPassword && newPassword.length < 4) {
                    return sendError(res, 400, "Password must be at least 4 characters long.");
                }

                if (newPassword) toUpdate.password = newPassword;
                if (newLabel) toUpdate.label = newLabel;
                toUpdate.updatedAt = new Date().toISOString();

                saveCredentials(currentCreds);

                return res.status(200).json({
                    success: true,
                    message: `Gate credential "${toUpdate.username}" successfully updated!`,
                    credential: sanitizeCredential(toUpdate),
                    credentials: currentCreds.map(sanitizeCredential)
                });
            }

            if (action === "delete" || action === "remove") {
                const targetId = id;
                const targetUser = (username || "").trim();

                let currentCreds = loadAllCredentials();
                const toDelete = currentCreds.find(c => (targetId && c.id === targetId) || (targetUser && c.username.toLowerCase() === targetUser.toLowerCase()));

                if (!toDelete) {
                    return sendError(res, 404, "Credential not found.");
                }

                currentCreds = currentCreds.filter(c => c.id !== toDelete.id && c.username.toLowerCase() !== toDelete.username.toLowerCase());
                saveCredentials(currentCreds);

                return res.status(200).json({
                    success: true,
                    message: `Gate credential "${toDelete.username}" successfully deleted.`,
                    credentials: currentCreds.map(sanitizeCredential)
                });
            }

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
                return res.status(200).json({
                    success: true,
                    count: currentCreds.length,
                    message: "Credentials synced successfully."
                });
            }

            return sendError(res, 400, "Invalid action. Supported actions: 'add', 'update', 'delete', 'sync'");
        }

        return sendError(res, 405, "Method not allowed. Use GET or POST.");

    } catch (err) {
        console.error("❌ Gate Manager error:", err);
        return sendError(res, 500, "Internal server error", err.message);
    }
}
