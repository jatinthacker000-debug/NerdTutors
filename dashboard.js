// Firebase imports
import { auth, db } from './firebase-config.js';
import {
    signInAnonymously,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// ==================== APP STATE ==================== 
const appState = {
    testResults: [],
    filteredResults: [],
    charts: {},
    sortField: 'date',
    sortOrder: 'desc',
    chartMetric: 'percentage'
};

// ==================== DOM ELEMENTS ====================
const elements = {
    sidebar: document.getElementById('sidebar'),
    mobileMenuBtn: document.getElementById('mobileMenuBtn'),
    mobileMenuOverlay: document.getElementById('mobileMenuOverlay'),
    menuIcon: document.getElementById('menuIcon'),
    refreshBtn: document.getElementById('refreshBtn'),
    exportBtn: document.getElementById('exportBtn'),
    loadingState: document.getElementById('loadingState'),
    dashboardContent: document.getElementById('dashboardContent'),

    // Pages
    dashboardPage: document.getElementById('dashboardPage'),
    studentsPage: document.getElementById('studentsPage'),
    resultsPage: document.getElementById('resultsPage'),
    analyticsPage: document.getElementById('analyticsPage'),
    exportPage: document.getElementById('exportPage'),

    // Stats
    totalStudents: document.getElementById('totalStudents'),
    totalTests: document.getElementById('totalTests'),
    avgScore: document.getElementById('avgScore'),
    recentActivity: document.getElementById('recentActivity'),

    // Dashboard recent results
    recentResultsBody: document.getElementById('recentResultsBody'),

    // Students page
    studentsGrid: document.getElementById('studentsGrid'),
    studentSearchInput: document.getElementById('studentSearchInput'),
    studentSortFilter: document.getElementById('studentSortFilter'),

    // Results page filters
    searchInput: document.getElementById('searchInput'),
    scoreFilter: document.getElementById('scoreFilter'),
    dateFilter: document.getElementById('dateFilter'),
    testTypeFilter: document.getElementById('testTypeFilter'),

    // Table
    resultsTableBody: document.getElementById('resultsTableBody'),
    emptyState: document.getElementById('emptyState'),

    // Analytics
    typeBreakdownBody: document.getElementById('typeBreakdownBody'),
    analyticsClassFilter: document.getElementById('analyticsClassFilter'),
    analyticsSubjectFilter: document.getElementById('analyticsSubjectFilter'),
    analyticsSessionFilter: document.getElementById('analyticsSessionFilter'),
    btnToggleChartMetric: document.getElementById('btnToggleChartMetric'),

    // Modal
    detailModal: document.getElementById('detailModal'),
    closeModal: document.getElementById('closeModal'),

    // View All
    viewAllBtn: document.getElementById('viewAllBtn')
};

// Current page state
let currentPage = 'dashboard';

// ==================== AUTHENTICATION ====================
async function setupAuth() {
    return new Promise((resolve, reject) => {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                console.log('✅ Admin authenticated');
                resolve(user);
            } else {
                try {
                    const credential = await signInAnonymously(auth);
                    console.log('✅ Admin signed in');
                    resolve(credential.user);
                } catch (error) {
                    console.error('❌ Auth error:', error);
                    reject(error);
                }
            }
        });
    });
}

// ==================== LOAD TEST RESULTS ====================
async function loadTestResults() {
    try {
        console.log('📊 Loading test results...');

        const resultsRef = collection(db, 'testResults');
        const q = query(resultsRef);
        const snapshot = await getDocs(q);

        appState.testResults = [];

        snapshot.forEach((doc) => {
            const data = doc.data();
            const dateObj = data.submittedAt || data.createdAt;
            
            let pct = data.percentage;
            let totScore = data.totalScore;
            
            // Standardize OCR score fields
            if (pct === undefined && data.score !== undefined && data.maxMarks) {
                pct = `${Math.round((data.score / data.maxMarks) * 100)}%`;
            }
            if (totScore === undefined && data.score !== undefined && data.maxMarks) {
                totScore = `${data.score}/${data.maxMarks}`;
            }

            appState.testResults.push({
                id: doc.id,
                ...data,
                percentage: pct || '0%',
                totalScore: totScore || '0/0',
                submittedAt: dateObj?.toDate?.() || dateObj?.toDate || new Date()
            });
        });

        // Sort in memory by date descending
        appState.testResults.sort((a, b) => b.submittedAt - a.submittedAt);

        appState.filteredResults = [...appState.testResults];

        updateStats();
        renderTable();
        renderRecentResults();

        // Only update charts if they exist
        if (appState.charts.scoreDistribution && appState.charts.dailyActivity) {
            updateCharts();
        }

    } catch (error) {
        console.error('❌ Error loading results:', error);
        throw error;
    }
}

// ==================== UPDATE STATISTICS ====================
function updateStats() {
    // Total unique students
    const uniqueStudents = new Set(appState.testResults.map(r => r.studentId));
    elements.totalStudents.textContent = uniqueStudents.size;

    // Total tests
    elements.totalTests.textContent = appState.testResults.length;

    // Average score
    if (appState.testResults.length > 0) {
        const avgPercentage = appState.testResults.reduce((sum, r) => {
            const percent = parseFloat(r.percentage) || 0;
            return sum + percent;
        }, 0) / appState.testResults.length;

        elements.avgScore.textContent = `${avgPercentage.toFixed(1)}%`;
    } else {
        elements.avgScore.textContent = '0%';
    }

    // Today's activity
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todaysTests = appState.testResults.filter(r => {
        const testDate = new Date(r.submittedAt);
        testDate.setHours(0, 0, 0, 0);
        return testDate.getTime() === today.getTime();
    });

    elements.recentActivity.textContent = todaysTests.length;
}

// ==================== RENDER TABLE ====================
function renderTable() {
    const tbody = elements.resultsTableBody;
    tbody.innerHTML = '';

    if (appState.filteredResults.length === 0) {
        elements.emptyState.style.display = 'block';
        return;
    }

    elements.emptyState.style.display = 'none';

    // Show only first 10 results in dashboard view
    const resultsToShow = appState.filteredResults.slice(0, 10);

    resultsToShow.forEach(result => {
        const row = document.createElement('tr');

        // Parse percentage
        const percentage = parseFloat(result.percentage) || 0;
        let scoreClass = 'score-medium';
        if (percentage >= 80) scoreClass = 'score-high';
        if (percentage < 50) scoreClass = 'score-low';

        // Format date
        const date = new Date(result.submittedAt);
        const dateStr = date.toLocaleDateString();
        const timeStr = date.toLocaleTimeString();

        row.innerHTML = `
                <td class="student-name">${result.studentName || 'Anonymous'}</td>
                <td>${result.studentId?.substring(0, 8) || '-'}</td>
                <td>${dateStr}<br><small style="color: #94a3b8;">${timeStr}</small></td>
                <td>${result.totalScore || '0/0'}</td>
                <td><span class="score-badge ${scoreClass}">${result.percentage || '0%'}</span></td>
                <td>${result.totalQuestions || 0}</td>
                <td>
                    <button class="action-btn" onclick="window.viewDetails('${result.id}')">👁️ View</button>
                    <button class="action-btn" onclick="window.exportResult('${result.id}')">📥 Export</button>
                </td>
            `;

        tbody.appendChild(row);
    });
}

// ==================== INITIALIZE CHARTS ====================
function initCharts() {
    // Check if Chart.js is loaded and canvas elements exist
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js not loaded, skipping charts');
        return;
    }

    const scoreCanvas = document.getElementById('scoreDistributionChart');

    if (!scoreCanvas) {
        console.warn('Chart canvas not found');
        return;
    }

    // Score Distribution Chart
    const scoreCtx = scoreCanvas.getContext('2d');
    appState.charts.scoreDistribution = new Chart(scoreCtx, {
        type: 'doughnut',
        data: {
            labels: ['High (80%+)', 'Medium (50-79%)', 'Low (<50%)'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: [
                    '#10b981',
                    '#f59e0b',
                    '#ef4444'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });

    // DELETE ALL THE DAILY ACTIVITY CHART CODE THAT WAS HERE
}

// ==================== UPDATE CHARTS ====================
function updateCharts() {
    if (!appState.charts.scoreDistribution) {
        console.log('Chart not initialized yet');
        return;
    }

    // Update Score Distribution
    const high = appState.testResults.filter(r => parseFloat(r.percentage) >= 80).length;
    const medium = appState.testResults.filter(r => {
        const p = parseFloat(r.percentage);
        return p >= 50 && p < 80;
    }).length;
    const low = appState.testResults.filter(r => parseFloat(r.percentage) < 50).length;

    appState.charts.scoreDistribution.data.datasets[0].data = [high, medium, low];
    appState.charts.scoreDistribution.update();
}

// ==================== FILTERS ====================
function applyFilters() {
    const searchTerm = elements.searchInput?.value?.toLowerCase() || '';
    const scoreFilter = elements.scoreFilter?.value || 'all';
    const dateFilter = elements.dateFilter?.value || 'all';
    const typeFilter = elements.testTypeFilter?.value || 'all';

    appState.filteredResults = appState.testResults.filter(result => {
        // Search filter
        if (searchTerm && !result.studentName?.toLowerCase().includes(searchTerm)) {
            return false;
        }

        // Test type filter
        if (typeFilter === 'mcq' && result.testType !== 'mcq') return false;
        if (typeFilter === 'text' && result.testType === 'mcq') return false;

        // Score filter
        const percentage = parseFloat(result.percentage) || 0;
        if (scoreFilter === 'high' && percentage < 80) return false;
        if (scoreFilter === 'medium' && (percentage < 50 || percentage >= 80)) return false;
        if (scoreFilter === 'low' && percentage >= 50) return false;

        // Date filter
        const testDate = new Date(result.submittedAt);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (dateFilter === 'today') {
            testDate.setHours(0, 0, 0, 0);
            if (testDate.getTime() !== today.getTime()) return false;
        }

        if (dateFilter === 'week') {
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);
            if (testDate < weekAgo) return false;
        }

        if (dateFilter === 'month') {
            const monthAgo = new Date(today);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            if (testDate < monthAgo) return false;
        }

        return true;
    });

    renderTable();
}

// ==================== VIEW DETAILS ====================
function viewDetails(resultId) {
    const result = appState.testResults.find(r => r.id === resultId);
    if (!result) return;

    // Populate modal
    document.getElementById('modalStudentName').textContent = result.studentName || 'Anonymous';
    document.getElementById('modalStudentId').textContent = `ID: ${result.studentId || '-'}`;
    document.getElementById('modalScore').textContent = result.totalScore || '0/0';
    document.getElementById('modalPercentage').textContent = result.percentage || '0%';

    const date = new Date(result.submittedAt);
    document.getElementById('modalDate').textContent =
        `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

    // Show answers
    const answersContainer = document.getElementById('modalAnswersList');
    answersContainer.innerHTML = '';

    const resultsArray = result.results || result.breakdown;
    if (resultsArray && resultsArray.length > 0) {
        resultsArray.forEach((item, index) => {
            const answerDiv = document.createElement('div');
            answerDiv.className = 'answer-item';

            // Get student answer — handle both text and OCR field names
            const studentAnswer = item.studentAnswer || item.extractedAnswer || item.studentAnswerText || 'No answer provided';
            
            // Handle score/marks mapping (MCQ uses earnedMarks/marks, OCR uses score/maxMarks)
            const earned = item.earnedMarks !== undefined ? item.earnedMarks : (item.score || 0);
            const max = item.marks !== undefined ? item.marks : (item.maxMarks || 1);

            // Build improvements/suggestions HTML
            let suggestionsHtml = '';
            if (item.improvements && item.improvements.length > 0) {
                suggestionsHtml = `
                    <div style="margin-top: 0.75rem; background: #fef9c3; border-radius: 8px; padding: 0.75rem; border-left: 3px solid #f59e0b;">
                        <div style="font-weight: 600; color: #92400e; font-size: 0.8rem; margin-bottom: 0.4rem;">💡 Suggestions for Improvement</div>
                        <ul style="margin: 0; padding-left: 1.2rem; color: #78350f; font-size: 0.85rem;">
                            ${item.improvements.map(s => `<li style="margin-bottom: 0.25rem;">${s}</li>`).join('')}
                        </ul>
                    </div>`;
            }

            // Build feedback HTML
            let feedbackHtml = '';
            if (item.feedback) {
                feedbackHtml = `
                    <div style="margin-top: 0.75rem; background: #eff6ff; border-radius: 8px; padding: 0.75rem; border-left: 3px solid #3b82f6;">
                        <div style="font-weight: 600; color: #1e40af; font-size: 0.8rem; margin-bottom: 0.3rem;">🤖 AI Review</div>
                        <div style="color: #1e3a5f; font-size: 0.85rem;">${item.feedback}</div>
                    </div>`;
            }

            answerDiv.innerHTML = `
                <div class="answer-question">
                    <strong style="color: #1e3c72;">Q${index + 1}:</strong> ${item.questionText || 'Question text not available'}
                </div>
                <div style="margin-top: 0.5rem; background: #f1f5f9; border-radius: 8px; padding: 0.75rem; border-left: 3px solid #6366f1;">
                    <div style="font-weight: 600; color: #475569; font-size: 0.8rem; margin-bottom: 0.3rem;">📝 Student's Answer</div>
                    <div style="color: #334155; font-size: 0.9rem; white-space: pre-wrap;">${studentAnswer}</div>
                </div>
                <div class="answer-score" style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-weight: 600;">Score: ${earned}/${max}</span>
                    <div style="flex: 1; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                        <div style="height: 100%; width: ${Math.min(100, (earned / max) * 100)}%; background: ${(earned / max) >= 0.7 ? '#22c55e' : (earned / max) >= 0.4 ? '#f59e0b' : '#ef4444'}; border-radius: 3px;"></div>
                    </div>
                </div>
                ${feedbackHtml}
                ${suggestionsHtml}
            `;
            answersContainer.appendChild(answerDiv);
        });
    } else {
        answersContainer.innerHTML = '<p>No detailed results available</p>';
    }

    // Show modal
    elements.detailModal.classList.add('active');
}

// ==================== EXPORT FUNCTIONS ====================
function exportResult(resultId) {
    const result = appState.testResults.find(r => r.id === resultId);
    if (!result) return;

    // Create CSV content
    let csv = 'Student Test Result\n\n';
    csv += `Student Name,${result.studentName || 'Anonymous'}\n`;
    csv += `Student ID,${result.studentId || '-'}\n`;
    csv += `Date,"${new Date(result.submittedAt).toLocaleString().replace(/"/g, '""')}"\n`;
    csv += `Total Score,${result.totalScore || '0/0'}\n`;
    csv += `Percentage,${result.percentage || '0%'}\n`;
    csv += `Total Questions,${result.totalQuestions || 0}\n\n`;

    csv += 'Question,Student Answer,Score,Feedback\n';

    const resultsArrayToExport = result.results || result.breakdown;
    if (resultsArrayToExport) {
        resultsArrayToExport.forEach((item, index) => {
            const question = `"${(item.questionText || '').replace(/"/g, '""')}"`;
            const answerTxt = item.studentAnswer || item.extractedAnswer || item.studentAnswerText || '';
            const answer = `"${answerTxt.replace(/"/g, '""')}"`;
            const feedback = `"${(item.feedback || '').replace(/"/g, '""')}"`;
            const earned = item.earnedMarks !== undefined ? item.earnedMarks : (item.score || 0);
            const max = item.marks !== undefined ? item.marks : (item.maxMarks || 1);
            csv += `${question},${answer},${earned}/${max},${feedback}\n`;
        });
    }

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.studentName || 'student'}_${result.id}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Export all results
function exportAllResults() {
    let csv = 'Student Name,Student ID,Date,Score,Percentage,Questions\n';

    appState.filteredResults.forEach(result => {
        const name = `"${(result.studentName || 'Anonymous').replace(/"/g, '""')}"`;
        const id = result.studentId || '-';
        const date = `"${new Date(result.submittedAt).toLocaleString().replace(/"/g, '""')}"`;
        const score = result.totalScore || '0/0';
        const percentage = result.percentage || '0%';
        const questions = result.totalQuestions || 0;

        csv += `${name},${id},${date},${score},${percentage},${questions}\n`;
    });

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test_results_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// ==================== RENDER FULL TABLE ====================
function renderFullTable() {
    const tbody = elements.resultsTableBody;
    tbody.innerHTML = '';

    if (appState.filteredResults.length === 0) {
        elements.emptyState.style.display = 'block';
        return;
    }

    elements.emptyState.style.display = 'none';

    appState.filteredResults.forEach(result => {
        const row = document.createElement('tr');

        const percentage = parseFloat(result.percentage) || 0;
        let scoreClass = 'score-medium';
        if (percentage >= 80) scoreClass = 'score-high';
        if (percentage < 50) scoreClass = 'score-low';

        const date = new Date(result.submittedAt);
        const dateStr = date.toLocaleDateString();
        const timeStr = date.toLocaleTimeString();

        row.innerHTML = `
                <td class="student-name">${result.studentName || 'Anonymous'}</td>
                <td>${result.studentId?.substring(0, 8) || '-'}</td>
                <td>${dateStr}<br><small style="color: #94a3b8;">${timeStr}</small></td>
                <td>${result.totalScore || '0/0'}</td>
                <td><span class="score-badge ${scoreClass}">${result.percentage || '0%'}</span></td>
                <td>${result.totalQuestions || 0}</td>
                <td>
                    <button class="action-btn" onclick="window.viewDetails('${result.id}')">👁️ View</button>
                    <button class="action-btn" onclick="window.exportResult('${result.id}')">📥 Export</button>
                </td>
            `;

        tbody.appendChild(row);
    });
}

// ==================== SORT TABLE ====================
function sortTable(field) {
    if (appState.sortField === field) {
        appState.sortOrder = appState.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        appState.sortField = field;
        appState.sortOrder = 'asc';
    }

    appState.filteredResults.sort((a, b) => {
        let aVal, bVal;

        if (field === 'name') {
            aVal = a.studentName || '';
            bVal = b.studentName || '';
        } else if (field === 'date') {
            aVal = new Date(a.submittedAt).getTime();
            bVal = new Date(b.submittedAt).getTime();
        } else if (field === 'score') {
            aVal = parseFloat(a.percentage) || 0;
            bVal = parseFloat(b.percentage) || 0;
        }

        if (appState.sortOrder === 'asc') {
            return aVal > bVal ? 1 : -1;
        } else {
            return aVal < bVal ? 1 : -1;
        }
    });

    renderTable();
}

// ==================== PAGE NAVIGATION ====================
function showPage(pageName) {
    currentPage = pageName;

    // Hide all pages
    const pages = ['dashboardPage', 'studentsPage', 'resultsPage', 'analyticsPage', 'exportPage'];
    pages.forEach(page => {
        const el = elements[page];
        if (el) {
            el.style.display = 'none';
            el.classList.remove('active');
        }
    });

    // Show selected page
    const pageMap = {
        'dashboard': 'dashboardPage',
        'students': 'studentsPage',
        'results': 'resultsPage',
        'analytics': 'analyticsPage',
        'export': 'exportPage'
    };

    const targetPage = elements[pageMap[pageName]];
    if (targetPage) {
        targetPage.style.display = 'block';
        targetPage.classList.add('active');
    }
}

// ==================== RENDER RECENT RESULTS (DASHBOARD) ====================
function renderRecentResults() {
    const tbody = elements.recentResultsBody;
    if (!tbody) return;

    tbody.innerHTML = '';

    // Show only first 5 results
    const recentResults = appState.testResults.slice(0, 5);

    recentResults.forEach(result => {
        const row = document.createElement('tr');
        const date = new Date(result.submittedAt);
        const testType = result.testType || 'text';

        let scoreClass = 'score-medium';
        const percentage = parseFloat(result.percentage) || 0;
        if (percentage >= 80) scoreClass = 'score-high';
        if (percentage < 50) scoreClass = 'score-low';

        row.innerHTML = `
            <td class="student-name">${result.studentName || 'Anonymous'}</td>
            <td>${date.toLocaleDateString()}</td>
            <td><span class="score-badge ${scoreClass}">${result.percentage || '0%'}</span></td>
            <td><span class="type-badge ${testType}">${testType.toUpperCase()}</span></td>
        `;

        tbody.appendChild(row);
    });
}

// ==================== RENDER STUDENTS PAGE ====================
function renderStudentsPage() {
    const grid = elements.studentsGrid;
    if (!grid) return;

    grid.innerHTML = '';

    // Group results by student
    const studentMap = {};
    appState.testResults.forEach(result => {
        const id = result.studentId || 'unknown';
        if (!studentMap[id]) {
            studentMap[id] = {
                name: result.studentName || 'Anonymous',
                id: id,
                tests: [],
                totalScore: 0,
                lastTest: result.submittedAt
            };
        }
        studentMap[id].tests.push(result);
        studentMap[id].totalScore += parseFloat(result.percentage) || 0;
        if (new Date(result.submittedAt) > new Date(studentMap[id].lastTest)) {
            studentMap[id].lastTest = result.submittedAt;
        }
    });

    // Convert to array and calculate averages
    const students = Object.values(studentMap).map(s => ({
        ...s,
        avgScore: s.tests.length > 0 ? (s.totalScore / s.tests.length).toFixed(1) : 0
    }));

    // Apply search filter
    const searchTerm = elements.studentSearchInput?.value?.toLowerCase() || '';
    const sortBy = elements.studentSortFilter?.value || 'name';

    let filtered = students.filter(s =>
        s.name.toLowerCase().includes(searchTerm)
    );

    // Sort
    filtered.sort((a, b) => {
        switch (sortBy) {
            case 'tests': return b.tests.length - a.tests.length;
            case 'score': return parseFloat(b.avgScore) - parseFloat(a.avgScore);
            case 'recent': return new Date(b.lastTest) - new Date(a.lastTest);
            default: return a.name.localeCompare(b.name);
        }
    });

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No Students Found</div></div>';
        return;
    }

    // Render student cards
    filtered.forEach(student => {
        const card = document.createElement('div');
        card.className = 'student-card';

        const initial = student.name.charAt(0).toUpperCase();
        const lastDate = new Date(student.lastTest).toLocaleDateString();

        card.innerHTML = `
            <div class="student-card-header">
                <div class="student-avatar">${initial}</div>
                <div class="student-info">
                    <h4>${student.name}</h4>
                    <p>ID: ${student.id.substring(0, 8)}...</p>
                </div>
            </div>
            <div class="student-stats">
                <div class="student-stat-item">
                    <div class="value">${student.tests.length}</div>
                    <div class="label">Tests</div>
                </div>
                <div class="student-stat-item">
                    <div class="value">${student.avgScore}%</div>
                    <div class="label">Avg Score</div>
                </div>
                <div class="student-stat-item">
                    <div class="value">${lastDate}</div>
                    <div class="label">Last Test</div>
                </div>
            </div>
        `;

        grid.appendChild(card);
    });
}

// Filtered results for analytics
let analyticsSessions = [];

async function loadSessionsForAnalyticsFilter() {
    const sessionFilter = document.getElementById('analyticsSessionFilter');
    if (!sessionFilter) return;

    try {
        const q = query(collection(db, 'testSessions'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        analyticsSessions = [];
        querySnapshot.forEach(docSnap => {
            analyticsSessions.push({ id: docSnap.id, ...docSnap.data() });
        });
        
        updateAnalyticsSessionDropdown();
    } catch (error) {
        console.error("Error loading sessions for analytics filter:", error);
    }
}

function updateAnalyticsSessionDropdown() {
    const sessionFilter = document.getElementById('analyticsSessionFilter');
    if (!sessionFilter) return;

    const classVal = document.getElementById('analyticsClassFilter')?.value || 'all';
    const subjectVal = document.getElementById('analyticsSubjectFilter')?.value || 'all';

    let filtered = analyticsSessions;
    if (classVal !== 'all') {
        filtered = filtered.filter(s => s.class === classVal);
    }
    if (subjectVal !== 'all') {
        filtered = filtered.filter(s => s.subject === subjectVal);
    }

    let html = '<option value="all">All Test Sessions</option>';
    filtered.forEach(s => {
        const setTag = s.examSet && s.examSet !== 'Standard / All' ? ` [${s.examSet}]` : '';
        html += `<option value="${s.id}">${s.name}${setTag} (${s.class} - ${s.subject})</option>`;
    });

    sessionFilter.innerHTML = html;
}

// Helper to escape HTML safely
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ==================== INITIALIZE ANALYTICS CHARTS ====================
function initAnalyticsCharts() {
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js not loaded, skipping analytics');
        return;
    }

    // 1. Get filter values
    const classVal = document.getElementById('analyticsClassFilter')?.value || 'all';
    const subjectVal = document.getElementById('analyticsSubjectFilter')?.value || 'all';
    const sessionVal = document.getElementById('analyticsSessionFilter')?.value || 'all';

    // 2. Filter testResults dataset
    let filteredResults = appState.testResults;

    if (classVal !== 'all') {
        filteredResults = filteredResults.filter(r => r.class === classVal);
    }
    if (subjectVal !== 'all') {
        filteredResults = filteredResults.filter(r => r.subject === subjectVal);
    }
    if (sessionVal !== 'all') {
        filteredResults = filteredResults.filter(r => r.sessionId === sessionVal);
    }

    // 3. Render Student Performance Bar Chart
    const perfCanvas = document.getElementById('studentPerformanceChart');
    if (perfCanvas) {
        if (appState.charts.studentPerformance) {
            appState.charts.studentPerformance.destroy();
        }

        // Group latest percentage or score per student in this filtered set
        const studentMap = {};
        filteredResults.forEach(r => {
            const sName = r.studentName || 'Anonymous';
            const percentage = parseFloat(r.percentage) || 0;
            const score = parseFloat(r.score) || 0;
            const maxMarks = parseFloat(r.maxMarks) || 100;
            
            // Keep the latest score of each student
            if (!studentMap[sName] || studentMap[sName].percentage < percentage) {
                studentMap[sName] = { score, maxMarks, percentage };
            }
        });

        const labels = Object.keys(studentMap);
        const dataValues = labels.map(label => {
            return appState.chartMetric === 'percentage' 
                ? studentMap[label].percentage 
                : studentMap[label].score;
        });

        const backgroundColors = labels.map(() => '#4f46e5'); // Sleek indigo

        appState.charts.studentPerformance = new Chart(perfCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: appState.chartMetric === 'percentage' ? 'Score Percentage (%)' : 'Marks Obtained',
                    data: dataValues,
                    backgroundColor: backgroundColors,
                    borderRadius: 6,
                    maxBarThickness: 45
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const name = context.label;
                                const val = context.parsed.y;
                                if (appState.chartMetric === 'percentage') {
                                    return `${name}: ${val}%`;
                                } else {
                                    const studentData = studentMap[name];
                                    return `${name}: ${val} / ${studentData.maxMarks} Marks`;
                                }
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: appState.chartMetric === 'percentage' ? 100 : undefined,
                        ticks: {
                            callback: function(value) {
                                return appState.chartMetric === 'percentage' ? value + '%' : value;
                            }
                        }
                    }
                }
            }
        });
    }

    // 4. Update Score Distribution Doughnut Chart
    const scoreCanvas = document.getElementById('scoreDistributionChart');
    if (scoreCanvas) {
        if (appState.charts.scoreDistribution) {
            appState.charts.scoreDistribution.destroy();
        }

        const high = filteredResults.filter(r => parseFloat(r.percentage) >= 80).length;
        const medium = filteredResults.filter(r => {
            const p = parseFloat(r.percentage);
            return p >= 50 && p < 80;
        }).length;
        const low = filteredResults.filter(r => parseFloat(r.percentage) < 50).length;

        appState.charts.scoreDistribution = new Chart(scoreCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['High (80%+)', 'Medium (50-79%)', 'Low (<50%)'],
                datasets: [{
                    data: [high, medium, low],
                    backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }

    // 5. Update Tests Per Day Chart
    const testsCanvas = document.getElementById('testsPerDayChart');
    if (testsCanvas) {
        if (appState.charts.testsPerDay) {
            appState.charts.testsPerDay.destroy();
        }

        const days = [];
        const counts = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            days.push(date.toLocaleDateString('en-US', { weekday: 'short' }));

            const count = filteredResults.filter(r => {
                const testDate = new Date(r.submittedAt);
                testDate.setHours(0, 0, 0, 0);
                return testDate.getTime() === date.getTime();
            }).length;
            counts.push(count);
        }

        appState.charts.testsPerDay = new Chart(testsCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: days,
                datasets: [{
                    label: 'Tests Taken',
                    data: counts,
                    backgroundColor: '#6366f1',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
    }

    // 6. Update Performance Type Breakdown Table
    renderTypeBreakdownWithFiltered(filteredResults);

    // 7. Update Leaderboard and Detailed Data Table
    renderLeaderboardAndDetailedTable(filteredResults);
}

// ==================== RENDER TYPE BREAKDOWN ====================
function renderTypeBreakdownWithFiltered(filteredResults) {
    const tbody = elements.typeBreakdownBody;
    if (!tbody) return;

    tbody.innerHTML = '';

    const mcqResults = filteredResults.filter(r => r.testType === 'mcq');
    const ocrResults = filteredResults.filter(r => r.testType === 'ocr');
    const textResults = filteredResults.filter(r => r.testType !== 'mcq' && r.testType !== 'ocr');

    const calcStats = (results) => {
        if (results.length === 0) return { count: 0, avg: 0, high: 0, low: 0 };
        const scores = results.map(r => parseFloat(r.percentage) || 0);
        return {
            count: results.length,
            avg: (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1),
            high: Math.max(...scores).toFixed(0),
            low: Math.min(...scores).toFixed(0)
        };
    };

    const mcqStats = calcStats(mcqResults);
    const textStats = calcStats(textResults);
    const ocrStats = calcStats(ocrResults);

    tbody.innerHTML = `
        <tr>
            <td><span class="type-badge mcq">MCQ</span></td>
            <td>${mcqStats.count}</td>
            <td>${mcqStats.avg}%</td>
            <td>${mcqStats.high}%</td>
            <td>${mcqStats.low}%</td>
        </tr>
        <tr>
            <td><span class="type-badge text">TEXT</span></td>
            <td>${textStats.count}</td>
            <td>${textStats.avg}%</td>
            <td>${textStats.high}%</td>
            <td>${textStats.low}%</td>
        </tr>
        <tr>
            <td><span class="type-badge" style="background:#e8f5e9;color:#2e7d32;">OCR</span></td>
            <td>${ocrStats.count}</td>
            <td>${ocrStats.avg}%</td>
            <td>${ocrStats.high}%</td>
            <td>${ocrStats.low}%</td>
        </tr>
    `;
}

// ==================== RENDER LEADERBOARD & DETAILED TABLE ====================
function renderLeaderboardAndDetailedTable(filteredResults) {
    const leaderboardBody = document.getElementById('leaderboardBody');
    const detailedBody = document.getElementById('detailedResultsBody');
    if (!leaderboardBody || !detailedBody) return;

    // 1. Leaderboard (Top 5 based on max percentage)
    const studentMap = {};
    filteredResults.forEach(r => {
        const name = r.studentName || 'Anonymous';
        const pct = parseFloat(r.percentage) || 0;
        if (!studentMap[name] || studentMap[name] < pct) {
            studentMap[name] = pct;
        }
    });

    const sortedStudents = Object.entries(studentMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    
    leaderboardBody.innerHTML = sortedStudents.length === 0 
        ? '<tr><td colspan="3" style="text-align:center;">No data available</td></tr>' 
        : sortedStudents.map((s, index) => {
            let medal = '';
            if (index === 0) medal = '🥇 ';
            else if (index === 1) medal = '🥈 ';
            else if (index === 2) medal = '🥉 ';
            return `
                <tr>
                    <td><strong>${index + 1}</strong></td>
                    <td class="student-name">${medal}${s[0]}</td>
                    <td><span class="score-badge score-high">${s[1]}%</span></td>
                </tr>
            `;
        }).join('');

    // 2. Detailed Data Table (Sorted by Date Desc)
    const sortedDetails = [...filteredResults].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    
    detailedBody.innerHTML = sortedDetails.length === 0 
        ? '<tr><td colspan="6" style="text-align:center;">No data available</td></tr>'
        : sortedDetails.map(r => {
            const date = new Date(r.submittedAt);
            const dateStr = date.toLocaleDateString();
            return `
                <tr>
                    <td class="student-name">${r.studentName || 'Anonymous'}</td>
                    <td>${r.class || '-'}</td>
                    <td>${r.subject || '-'}</td>
                    <td>${r.totalScore || '0/0'}</td>
                    <td>${r.percentage || '0%'}</td>
                    <td>${dateStr}</td>
                </tr>
            `;
        }).join('');
}

// ==================== SETUP EXPORT BUTTONS ====================
function setupExportButtons() {
    // Populate session dropdown initially
    updateExportSessionDropdown();

    // Event listener for Class filter change
    document.getElementById('exportClassFilter')?.addEventListener('change', () => {
        updateExportSessionDropdown();
    });

    // Event listener for Export Button click
    document.getElementById('btnExecuteExport')?.addEventListener('click', () => {
        executeFilteredExport();
    });
}

// ==================== UPDATE EXPORT SESSION DROPDOWN ====================
function updateExportSessionDropdown() {
    const sessionFilter = document.getElementById('exportSessionFilter');
    if (!sessionFilter) return;

    const classVal = document.getElementById('exportClassFilter')?.value || 'all';

    // Reuse the analyticsSessions loaded from FireStore during init
    let filtered = analyticsSessions || [];
    if (classVal !== 'all') {
        filtered = filtered.filter(s => s.class === classVal);
    }

    let html = '<option value="all">All Test Sessions</option>';
    filtered.forEach(s => {
        html += `<option value="${s.id}">${s.name} (${s.class} - ${s.subject})</option>`;
    });

    sessionFilter.innerHTML = html;
}

// ==================== EXECUTE FILTERED EXPORT ====================
function executeFilteredExport() {
    const classVal = document.getElementById('exportClassFilter')?.value || 'all';
    const sessionVal = document.getElementById('exportSessionFilter')?.value || 'all';

    let filtered = [...appState.testResults];

    if (classVal !== 'all') {
        filtered = filtered.filter(r => r.class === classVal);
    }
    if (sessionVal !== 'all') {
        filtered = filtered.filter(r => r.sessionId === sessionVal);
    }

    if (filtered.length === 0) {
        alert("No results match the selected filters.");
        return;
    }

    // CSV headers including Test Name, Class, Subject, Student ID, score metrics
    let csv = 'Test Name,Class,Subject,Student Name,Student ID,Date,Score,Percentage,Type\n';
    filtered.forEach(result => {
        const testName = `"${(result.testSessionName || result.testName || 'General Evaluation').replace(/"/g, '""')}"`;
        const cls = result.class || '-';
        const sub = result.subject || '-';
        const studentName = `"${(result.studentName || 'Anonymous').replace(/"/g, '""')}"`;
        const studentId = result.studentId || '-';
        const date = `"${new Date(result.submittedAt).toLocaleString().replace(/"/g, '""')}"`;
        const score = result.totalScore || '0/0';
        const percentage = result.percentage || '0%';
        const type = result.testType || 'text';

        csv += `${testName},${cls},${sub},${studentName},${studentId},${date},${score},${percentage},${type}\n`;
    });

    const sanitizedClass = classVal.replace(/\s+/g, '_');
    const filename = `filtered_export_${sanitizedClass}_session_${sessionVal}`;
    downloadCSV(csv, filename);
}

// ==================== DOWNLOAD CSV HELPER ====================
function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// ==================== LOADING STATE ====================
function showLoading(show) {
    if (show) {
        elements.loadingState.style.display = 'block';
        elements.dashboardContent.style.display = 'none';
    } else {
        elements.loadingState.style.display = 'none';
        elements.dashboardContent.style.display = 'block';
    }
}

// ==================== REALTIME UPDATES ====================
function setupRealtimeUpdates() {
    const resultsRef = collection(db, 'testResults');
    const q = query(resultsRef, orderBy('submittedAt', 'desc'), limit(50));

    onSnapshot(q, (snapshot) => {
        console.log('📊 Real-time update received');
        loadTestResults();
    });
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    // Mobile menu
    elements.mobileMenuBtn.addEventListener('click', () => {
        elements.sidebar.classList.toggle('active');
        elements.mobileMenuOverlay.classList.toggle('active');
        // Change icon between hamburger and close
        if (elements.sidebar.classList.contains('active')) {
            elements.menuIcon.textContent = '✕';
        } else {
            elements.menuIcon.textContent = '☰';
        }
    });

    // Close menu when clicking on overlay
    elements.mobileMenuOverlay.addEventListener('click', () => {
        elements.sidebar.classList.remove('active');
        elements.mobileMenuOverlay.classList.remove('active');
        elements.menuIcon.textContent = '☰';
    });

    // Refresh button
    elements.refreshBtn.addEventListener('click', () => {
        loadTestResults();
    });

    // Export button
    elements.exportBtn.addEventListener('click', exportAllResults);

    // Filters
    if (elements.searchInput) {
        elements.searchInput.addEventListener('input', applyFilters);
    }
    if (elements.scoreFilter) {
        elements.scoreFilter.addEventListener('change', applyFilters);
    }
    if (elements.dateFilter) {
        elements.dateFilter.addEventListener('change', applyFilters);
    }
    if (elements.testTypeFilter) {
        elements.testTypeFilter.addEventListener('change', applyFilters);
    }

    // Student page filters
    if (elements.studentSearchInput) {
        elements.studentSearchInput.addEventListener('input', renderStudentsPage);
    }
    if (elements.studentSortFilter) {
        elements.studentSortFilter.addEventListener('change', renderStudentsPage);
    }

    // Analytics Filters
    if (elements.analyticsClassFilter) {
        elements.analyticsClassFilter.addEventListener('change', () => {
            updateAnalyticsSessionDropdown();
            initAnalyticsCharts();
        });
    }
    if (elements.analyticsSubjectFilter) {
        elements.analyticsSubjectFilter.addEventListener('change', () => {
            updateAnalyticsSessionDropdown();
            initAnalyticsCharts();
        });
    }
    if (elements.analyticsSessionFilter) {
        elements.analyticsSessionFilter.addEventListener('change', initAnalyticsCharts);
    }
    if (elements.btnToggleChartMetric) {
        elements.btnToggleChartMetric.addEventListener('click', () => {
            appState.chartMetric = appState.chartMetric === 'percentage' ? 'score' : 'percentage';
            initAnalyticsCharts();
        });
    }

    // Modal close button
    elements.closeModal.addEventListener('click', () => {
        elements.detailModal.classList.remove('active');
    });

    // Click outside modal to close
    elements.detailModal.addEventListener('click', (e) => {
        if (e.target === elements.detailModal) {
            elements.detailModal.classList.remove('active');
        }
    });

    // ESC key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.detailModal.classList.contains('active')) {
            elements.detailModal.classList.remove('active');
        }
    });

    // View all button
    elements.viewAllBtn.addEventListener('click', () => {
        appState.filteredResults = [...appState.testResults];
        renderFullTable();
    });

    // Sort table headers
    document.querySelectorAll('.sortable').forEach(header => {
        header.addEventListener('click', () => {
            const field = header.dataset.sort;
            sortTable(field);
        });
    });

    // Navigation items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const href = item.getAttribute('href');

            if (href === 'index.html') {
                // Allow normal navigation for home
                return;
            }

            e.preventDefault();

            // Handle navigation
            switch (href) {
                case '#dashboard':
                    showPage('dashboard');
                    break;
                case '#students':
                    showPage('students');
                    renderStudentsPage();
                    break;
                case '#results':
                    showPage('results');
                    renderFullTable();
                    break;
                case '#analytics':
                    showPage('analytics');
                    initAnalyticsCharts();
                    break;
                case '#export':
                    showPage('export');
                    break;
            }

            // Update active state
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Close mobile menu
            elements.sidebar.classList.remove('active');
            elements.mobileMenuOverlay.classList.remove('active');
            elements.menuIcon.textContent = '☰';

            window.scrollTo(0, 0);
        });
    });

    // Export buttons
    setupExportButtons();

    // View all button - go to results page
    if (elements.viewAllBtn) {
        elements.viewAllBtn.addEventListener('click', () => {
            showPage('results');
            renderFullTable();
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.querySelector('.nav-item[href="#results"]').classList.add('active');
        });
    }
}

// ==================== MAKE FUNCTIONS GLOBAL ====================
window.viewDetails = viewDetails;
window.exportResult = exportResult;

// ==================== INITIALIZATION (SINGLE DECLARATION) ====================
async function init() {
    console.log('🚀 Initializing Dashboard...');

    showLoading(true);

    try {
        // Setup authentication
        await setupAuth();

        // Initialize charts FIRST
        initCharts();

        // Load data
        await loadTestResults();

        // Load sessions list for analytics filter
        await loadSessionsForAnalyticsFilter();

        // Setup event listeners
        setupEventListeners();

        // Setup real-time updates
        setupRealtimeUpdates();

        // Update charts after data is loaded
        if (appState.testResults.length > 0) {
            updateCharts();
        }

        showLoading(false);
        console.log('✅ Dashboard initialized successfully');

    } catch (error) {
        console.error('❌ Initialization error:', error);
        showLoading(false);
        alert('Failed to load dashboard. Please refresh.');
    }
}

// ==================== START APP ====================
init();