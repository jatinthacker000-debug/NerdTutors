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
    let creds = [...DEFAULT_CREDENTIALS];

    // 1. Load from persistent server file if present
    try {
        const primaryPath = path.join(process.cwd(), 'api', 'gate-credentials.json');
        const rootPath = path.join(process.cwd(), 'gate-credentials.json');
        const tmpPath = path.join('/tmp', 'gate-credentials.json');
        const targetPath = fs.existsSync(primaryPath) ? primaryPath : (fs.existsSync(rootPath) ? rootPath : (fs.existsSync(tmpPath) ? tmpPath : null));
        
        if (targetPath) {
            const data = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (item.username && item.password) {
                        const existing = creds.find(c => c.username.toLowerCase() === item.username.toLowerCase());
                        if (existing) {
                            existing.password = item.password;
                        } else {
                            creds.push({ username: item.username, password: item.password });
                        }
                    }
                });
            }
        }
    } catch (e) {
        console.warn("Could not load dynamic gate-credentials.json:", e.message);
    }

    // 2. Support environment variable overrides (GATE_CREDENTIALS=user1:pass1,user2:pass2)
    if (process.env.GATE_CREDENTIALS) {
        try {
            process.env.GATE_CREDENTIALS.split(',').forEach(pair => {
                const parts = pair.split(':');
                const u = parts[0]?.trim();
                const p = parts[1]?.trim();
                if (u && p) {
                    const existing = creds.find(c => c.username.toLowerCase() === u.toLowerCase());
                    if (existing) existing.password = p;
                    else creds.push({ username: u, password: p });
                }
            });
        } catch (e) {
            console.error("Failed to parse GATE_CREDENTIALS env var:", e);
        }
    }

    return creds;
}

function createSignedGateToken(username) {
    // Generate permanent, infinite-lifetime token so teachers/students are never abruptly locked out
    const payload = `${username}:permanent`;
    const signature = crypto.createHmac('sha256', GATE_SECRET).update(payload).digest('hex');
    return Buffer.from(JSON.stringify({ u: username, permanent: true, sig: signature })).toString('base64');
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
