import { escapeHtml as chartEscape } from '../js/student-progress-chart.js';
import fs from 'fs';

function extractEscapeHtml(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    const match = code.match(/const HTML_ESCAPE_MAP = \{[^}]+\};[\s\S]*?(?:export\s+)?function escapeHtml\(str\) \{[\s\S]*?\n\s*\}/);
    if (!match) throw new Error(`Could not find escapeHtml in ${filePath}`);
    const fnBody = match[0].replace(/export\s+/g, '');
    const fn = new Function(`${fnBody}; return escapeHtml;`)();
    return fn;
}

function runTests(name, fn) {
    console.log(`Running tests for ${name}...`);
    // Basic tags
    if (fn('<script>alert("xss")</script>') !== '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;') {
        throw new Error(`${name} failed on script tag test: got ${fn('<script>alert("xss")</script>')}`);
    }
    // Attribute breakout
    if (fn('"><img src=x onerror=alert(1)>') !== '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;') {
        throw new Error(`${name} failed on attribute breakout test`);
    }
    // Single quote breakout
    if (fn("' onclick='alert(1)") !== '&#39; onclick=&#39;alert(1)') {
        throw new Error(`${name} failed on single quote breakout test`);
    }
    // Ampersand
    if (fn('Tom & Jerry') !== 'Tom &amp; Jerry') {
        throw new Error(`${name} failed on ampersand test`);
    }
    // Falsy & Numeric
    if (fn(0) !== '0') {
        throw new Error(`${name} failed on numeric 0 test`);
    }
    if (fn(null) !== '') {
        throw new Error(`${name} failed on null test`);
    }
    if (fn(undefined) !== '') {
        throw new Error(`${name} failed on undefined test`);
    }
    if (fn('') !== '') {
        throw new Error(`${name} failed on empty string test`);
    }
    console.log(`✓ ${name} passed all tests`);
}

// 1. Direct ESM export test from student-progress-chart.js
runTests('student-progress-chart.js:escapeHtml', chartEscape);

// 2. Extracted tests directly from other files
runTests('admin-utils.js:escapeHtml', extractEscapeHtml('js/admin-modules/admin-utils.js'));
runTests('dashboard.js:escapeHtml', extractEscapeHtml('dashboard.js'));
runTests('matrix-manager.js:escapeHtml', extractEscapeHtml('js/matrix-manager.js'));
runTests('ocr-scan.html:escapeHtml', extractEscapeHtml('ocr-scan.html'));
runTests('results.html:escapeHtml', extractEscapeHtml('results.html'));

console.log('\nAll XSS Sanitizer test suites passed with 100% precision!');
