import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Force load .env.local if present locally to bypass Vercel CLI sync overrides
try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.substring(1, value.length - 1);
                }
                process.env[key] = value;
            }
        });
    }
} catch (e) {
    console.warn("Env force load error:", e.message);
}

const GATE_SECRET = process.env.GATE_SECRET || 'nt_gate_hmac_secret_2026_super_secure';

const DEFAULT_CREDENTIALS = [
    { username: 'nerd_tutor_alpha', password: 'nt_pass_alpha2026' },
    { username: 'nerd_tutor_beta', password: 'nt_pass_beta2026' },
    { username: 'nerd_tutor_gamma', password: 'nt_pass_gamma2026' },
    { username: 'nerd_tutor_delta', password: 'nt_pass_delta2026' },
    { username: 'nerd_tutor_epsilon', password: 'nt_pass_epsilon2026' }
];

function getCredentials() {
    if (process.env.GATE_CREDENTIALS) {
        try {
            // Support comma-separated format: user1:pass1,user2:pass2
            return process.env.GATE_CREDENTIALS.split(',').map(pair => {
                const parts = pair.split(':');
                return {
                    username: parts[0]?.trim(),
                    password: parts[1]?.trim()
                };
            }).filter(c => c.username && c.password);
        } catch (e) {
            console.error("Failed to parse GATE_CREDENTIALS env var, using defaults:", e);
        }
    }
    return DEFAULT_CREDENTIALS;
}

function createSignedGateToken(username) {
    const expiresAt = Date.now() + (12 * 60 * 60 * 1000); // Valid for 12 hours
    const payload = `${username}:${expiresAt}`;
    const signature = crypto.createHmac('sha256', GATE_SECRET).update(payload).digest('hex');
    return Buffer.from(JSON.stringify({ u: username, exp: expiresAt, sig: signature })).toString('base64');
}

export default async function handler(req, res) {
    // CORS headers
    const allowedOrigins = [
        "https://nerd-tutors.vercel.app",
        "https://nerd-tutors-two.vercel.app",
        "http://localhost:3000",
        "http://localhost:5000"
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
        let body = req.body;
        if (typeof body === "string") body = JSON.parse(body);

        const { username, password } = body;
        if (!username || !password) {
            return res.status(400).json({ error: "Username and password are required" });
        }

        const creds = getCredentials();
        const cleanUser = username.trim();
        const cleanPass = password.trim();
        const matched = creds.find(c => c.username === cleanUser && c.password === cleanPass);

        if (matched) {
            // Generate cryptographically signed HMAC token with 12h expiration
            const token = createSignedGateToken(cleanUser);
            return res.status(200).json({ success: true, token });
        } else {
            return res.status(401).json({ error: "Invalid username or password" });
        }
    } catch (error) {
        console.error("Gate verification error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}
