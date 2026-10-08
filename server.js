import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

// Helper to parse POST request body
function getRequestBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                resolve(body);
            }
        });
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${pathname}`);

    // Set baseline security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Route API requests
    if (pathname.startsWith('/api/')) {
        const handlerName = pathname.replace('/api/', '').split('?')[0];

        // Security check: restrict API handler names to alphanumeric characters, dashes, and underscores
        if (!/^[a-zA-Z0-9_-]+$/.test(handlerName)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ error: 'Invalid API endpoint name' }));
        }

        const handlerPath = path.join(__dirname, 'api', `${handlerName}.js`);

        if (fs.existsSync(handlerPath)) {
            try {
                // Dynamically import the Vercel handler
                const module = await import(`file://${handlerPath}?update=${Date.now()}`); // query param to bypass module caching
                const handler = module.default;

                // Mock req and res for Vercel
                const mockReq = {
                    method: req.method,
                    headers: req.headers,
                    query: Object.fromEntries(url.searchParams),
                    body: req.method === 'POST' ? await getRequestBody(req) : {}
                };

                const mockRes = {
                    headers: {},
                    setHeader(name, value) {
                        this.headers[name] = value;
                        res.setHeader(name, value);
                        return this;
                    },
                    status(code) {
                        res.statusCode = code;
                        return this;
                    },
                    json(data) {
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify(data));
                        return this;
                    },
                    end(data) {
                        res.end(data);
                        return this;
                    }
                };

                await handler(mockReq, mockRes);
            } catch (err) {
                console.error(`❌ Error in handler ${handlerName}:`, err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Internal Server Error', details: err.message }));
            }
        } else {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'API endpoint not found' }));
        }
        return;
    }

    // Serve static files safely
    // 1. Sanitize pathname and resolve absolute path
    const sanitizedRelPath = pathname === '/' ? 'ocr-scan.html' : pathname.replace(/^\/+/, '');
    const resolvedPath = path.resolve(__dirname, sanitizedRelPath);
    const rootDir = path.resolve(__dirname);

    // 2. Prevent directory traversal: resolved path must strictly stay within rootDir
    if (!resolvedPath.startsWith(rootDir)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/html');
        return res.end('<h3>403 Forbidden</h3><p>Access denied.</p>');
    }

    // 3. Prevent access to sensitive dotfiles (.env, .env.local, .git, .gitignore)
    const fileName = path.basename(resolvedPath);
    if (fileName.startsWith('.') || fileName.toLowerCase().includes('.env')) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/html');
        return res.end('<h3>403 Forbidden</h3><p>Access to configuration files is restricted.</p>');
    }

    let filePath = resolvedPath;
    
    // Fallback HTML resolution if extension is omitted (like "/login-gate")
    if (!path.extname(filePath)) {
        if (fs.existsSync(`${filePath}.html`)) {
            filePath += '.html';
        }
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf'
        };

        res.statusCode = 200;
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<h3>404 Not Found</h3><p>File not found: ${pathname}</p>`);
    }
});

server.listen(PORT, () => {
    console.log(`🚀 Standalone Local Server running at http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/ocr-scan.html in your browser to start scanning!`);
});
