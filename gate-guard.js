(function() {
    // 1. Check for Auto-Authentication query params from Coaching Submissions redirect
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const incomingToken = urlParams.get('gate_token') || urlParams.get('token');
        const incomingPass = urlParams.get('gate_pass') || urlParams.get('pass');

        if (incomingToken) {
            localStorage.setItem('gate_authenticated', 'true');
            localStorage.setItem('gate_token', incomingToken);
        } else if (incomingPass) {
            // Auto-generate standard base64 gate token
            const autoToken = btoa('coaching_student:' + incomingPass);
            localStorage.setItem('gate_authenticated', 'true');
            localStorage.setItem('gate_token', autoToken);
        }

        // If authenticated via URL, cleanly remove secret params from browser address bar
        if (incomingToken || incomingPass) {
            urlParams.delete('gate_token');
            urlParams.delete('token');
            urlParams.delete('gate_pass');
            urlParams.delete('pass');
            const cleanQuery = urlParams.toString() ? '?' + urlParams.toString() : '';
            const cleanUrl = window.location.pathname + cleanQuery + window.location.hash;
            window.history.replaceState({}, document.title, cleanUrl);
        }
    } catch (_) {}

    const authenticated = localStorage.getItem('gate_authenticated');
    const token = localStorage.getItem('gate_token');
    
    // Check if the current page is not login-gate.html
    const isLoginPage = window.location.pathname.endsWith('login-gate.html');
    
    if (!isLoginPage) {
        if (authenticated !== 'true' || !token) {
            // Get current path including query parameters for redirecting back
            const currentPath = window.location.pathname + window.location.search;
            window.location.href = 'login-gate.html?redirect=' + encodeURIComponent(currentPath);
        }
    }
})();
