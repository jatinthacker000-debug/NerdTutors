import {
    handleCors,
    validateInvocation,
    createSignedGateToken,
    getRegisteredCredentials,
    sendError
} from './_security.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (validateInvocation(req, res)) return;

    if (req.method !== "POST") {
        return sendError(res, 405, "Method not allowed. Use POST.");
    }

    try {
        let body = req.body;
        if (typeof body === "string") {
            try { body = JSON.parse(body); } catch (_) { body = {}; }
        }

        const { username, password } = body || {};
        if (!username || !password) {
            return sendError(res, 400, "Username and password are required");
        }

        const creds = getRegisteredCredentials();
        const cleanUser = String(username).trim();
        const cleanPass = String(password).trim();
        const matched = creds.find(c => c.username === cleanUser && c.password === cleanPass);

        if (matched) {
            // Generate cryptographically signed HMAC token
            const token = createSignedGateToken(cleanUser);
            return res.status(200).json({ success: true, token });
        } else {
            return sendError(res, 401, "Invalid username or password");
        }
    } catch (error) {
        console.error("Gate verification error:", error);
        return sendError(res, 500, "Internal server error");
    }
}

