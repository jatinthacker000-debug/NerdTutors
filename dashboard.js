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
    onSnapshot,
    updateDoc,
    doc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { initQuestionMatrix, renderQuestionMatrix, populateMatrixSessionDropdown, resolveQuestionTopic } from './js/matrix-manager.js?v=264';
import { initStudentProgressChart, loadRealDataIntoProgressChart, formatExamName } from './js/student-progress-chart.js?v=263';

// Robust HTML escaping
const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str).replace(/[&<>"']/g, c => HTML_ESCAPE_MAP[c]);
}
if (typeof window !== 'undefined') {
    window.escapeHtml = escapeHtml;
}

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
    matrixPage: document.getElementById('matrixPage'),

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
    studentClassFilter: document.getElementById('studentClassFilter'),
    studentSubjectFilter: document.getElementById('studentSubjectFilter'),
    studentSortFilter: document.getElementById('studentSortFilter'),

    // Results page filters
    searchInput: document.getElementById('searchInput'),
    batchFilter: document.getElementById('batchFilter'),
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
        renderStudentsPage();

        // Only update charts if they exist
        if (appState.charts.scoreDistribution && appState.charts.dailyActivity) {
            updateCharts();
        }

        // Update Question Performance Matrix
        renderQuestionMatrix(appState.testResults);

        // Update Student Progress Chart with real data
        loadRealDataIntoProgressChart(appState.testResults);

    } catch (error) {
        console.error('❌ Error loading results:', error);
        throw error;
    }
}

// ==================== UPDATE STATISTICS ====================
function updateStats() {
    // Total unique students - aggregate by normalized student name with fallback
    const uniqueStudents = new Set(appState.testResults.map(r => {
        const name = (r.studentName || r.name || r.student || '').trim().toLowerCase();
        return name || (r.studentId ? 'id_' + r.studentId : 'res_' + r.id);
    }));
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
                <td class="student-name">${escapeHtml(result.studentName || 'Anonymous')}</td>
                <td><span style="background: #e0f2fe; color: #0369a1; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700; font-size: 0.8rem;">${escapeHtml(result.batch || result.targetGroup || 'Both')}</span></td>
                <td>${escapeHtml(result.studentId?.substring(0, 8) || '-')}</td>
                <td>${dateStr}<br><small style="color: #94a3b8;">${timeStr}</small></td>
                <td>${escapeHtml(result.totalScore || '0/0')}</td>
                <td><span class="score-badge ${scoreClass}">${escapeHtml(result.percentage || '0%')}</span></td>
                <td>${result.totalQuestions || 0}</td>
                <td>
                    <button class="action-btn" onclick="window.viewDetails('${escapeHtml(result.id)}')">👁️ View</button>
                    <button class="action-btn" onclick="window.exportResult('${escapeHtml(result.id)}')">📥 Export</button>
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
            labels: ['Strong / Mastered (>90%)', 'Need Improvement (60%–90%)', 'Critical (<60%)'],
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

    // Update Score Distribution using standardized 3-tier quartiles:
    // >90% (Strong), 60%-90% (Need Improvement), <60% (Critical)
    const strong = appState.testResults.filter(r => parseFloat(r.percentage) > 90).length;
    const improving = appState.testResults.filter(r => {
        const p = parseFloat(r.percentage);
        return p >= 60 && p <= 90;
    }).length;
    const critical = appState.testResults.filter(r => parseFloat(r.percentage) < 60).length;

    appState.charts.scoreDistribution.data.datasets[0].data = [strong, improving, critical];
    appState.charts.scoreDistribution.update();
}

// ==================== FILTERS ====================
function applyFilters() {
    const searchTerm = elements.searchInput?.value?.toLowerCase() || '';
    const batchFilter = elements.batchFilter?.value || 'all';
    const scoreFilter = elements.scoreFilter?.value || 'all';
    const dateFilter = elements.dateFilter?.value || 'all';
    const typeFilter = elements.testTypeFilter?.value || 'all';

    appState.filteredResults = appState.testResults.filter(result => {
        // Search filter
        if (searchTerm && !result.studentName?.toLowerCase().includes(searchTerm)) {
            return false;
        }

        // Batch filter
        if (batchFilter !== 'all') {
            const studentBatch = result.batch || result.targetGroup || 'Both';
            if (batchFilter === 'Nerd Tutors Nalanda') {
                if (studentBatch !== 'Nerd Tutors Nalanda' && studentBatch !== 'Nalanda') return false;
            } else if (studentBatch !== batchFilter) {
                return false;
            }
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
                            ${item.improvements.map(s => `<li style="margin-bottom: 0.25rem;">${escapeHtml(s)}</li>`).join('')}
                        </ul>
                    </div>`;
            }

            // Build feedback HTML
            let feedbackHtml = '';
            if (item.feedback) {
                feedbackHtml = `
                    <div style="margin-top: 0.75rem; background: #eff6ff; border-radius: 8px; padding: 0.75rem; border-left: 3px solid #3b82f6;">
                        <div style="font-weight: 600; color: #1e40af; font-size: 0.8rem; margin-bottom: 0.3rem;">🤖 AI Review</div>
                        <div style="color: #1e3a5f; font-size: 0.85rem;">${escapeHtml(item.feedback)}</div>
                    </div>`;
            }

            answerDiv.innerHTML = `
                <div class="answer-question">
                    <strong style="color: #1e3c72;">Q${index + 1}:</strong> ${escapeHtml(item.questionText || 'Question text not available')}
                </div>
                <div style="margin-top: 0.5rem; background: #f1f5f9; border-radius: 8px; padding: 0.75rem; border-left: 3px solid #6366f1;">
                    <div style="font-weight: 600; color: #475569; font-size: 0.8rem; margin-bottom: 0.3rem;">📝 Student's Answer</div>
                    <div style="color: #334155; font-size: 0.9rem; white-space: pre-wrap;">${escapeHtml(studentAnswer)}</div>
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
    let csv = 'Student Name,Batch,Student ID,Date,Score,Percentage,Questions\n';

    appState.filteredResults.forEach(result => {
        const name = `"${(result.studentName || 'Anonymous').replace(/"/g, '""')}"`;
        const batch = `"${(result.batch || result.targetGroup || 'Both').replace(/"/g, '""')}"`;
        const id = result.studentId || '-';
        const date = `"${new Date(result.submittedAt).toLocaleString().replace(/"/g, '""')}"`;
        const score = result.totalScore || '0/0';
        const percentage = result.percentage || '0%';
        const questions = result.totalQuestions || 0;

        csv += `${name},${batch},${id},${date},${score},${percentage},${questions}\n`;
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
                <td class="student-name">${escapeHtml(result.studentName || 'Anonymous')}</td>
                <td><span style="background: #e0f2fe; color: #0369a1; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700; font-size: 0.8rem;">${escapeHtml(result.batch || result.targetGroup || 'Both')}</span></td>
                <td>${escapeHtml(result.studentId?.substring(0, 8) || '-')}</td>
                <td>${dateStr}<br><small style="color: #94a3b8;">${timeStr}</small></td>
                <td>${escapeHtml(result.totalScore || '0/0')}</td>
                <td><span class="score-badge ${scoreClass}">${escapeHtml(result.percentage || '0%')}</span></td>
                <td>${result.totalQuestions || 0}</td>
                <td>
                    <button class="action-btn" onclick="window.viewDetails('${escapeHtml(result.id)}')">👁️ View</button>
                    <button class="action-btn" onclick="window.exportResult('${escapeHtml(result.id)}')">📥 Export</button>
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
    const pages = ['dashboardPage', 'studentsPage', 'resultsPage', 'analyticsPage', 'exportPage', 'matrixPage'];
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
        'export': 'exportPage',
        'matrix': 'matrixPage'
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
            <td class="student-name">${escapeHtml(result.studentName || 'Anonymous')}</td>
            <td>${date.toLocaleDateString()}</td>
            <td><span class="score-badge ${scoreClass}">${escapeHtml(result.percentage || '0%')}</span></td>
            <td><span class="type-badge ${escapeHtml(testType)}">${escapeHtml(testType.toUpperCase())}</span></td>
        `;

        tbody.appendChild(row);
    });
}

// ==================== STUDENTS HUB & COHORT ROSTER ====================

// Cache aggregated students for drawer access
let cachedAggregatedStudents = new Map();

export 
/**
 * Computes recurring critical learning gaps & weak topics for a student across all tests
 */
function extractStudentCriticalGaps(student) {
    if (!student || !student.tests || student.tests.length === 0) {
        return { weakTopics: [], allGaps: [] };
    }

    const topicStats = new Map();

    student.tests.forEach(test => {
        // Find the authoritative testSession document containing topicMap
        const testSession = (appState.sessions || analyticsSessions || []).find(s => s.id === test.sessionId);

        // Robust extraction across all test schema variants (breakdown, results, answers, evaluation)
        const items = test.breakdown || test.results || test.answers || 
            (test.evaluation && (test.evaluation.breakdown || test.evaluation.results)) || [];
        const examName = formatExamName(test.sessionName || test.name || (testSession ? testSession.name : 'Test'));
        const testSubject = test.subject || (testSession ? testSession.subject : '') || student.subject || 'Curriculum';

        if (Array.isArray(items) && items.length > 0) {
            items.forEach((q, idx) => {
                const earned = Number(q.earnedMarks ?? q.marksAwarded ?? q.score ?? q.earned ?? 0);
                const maxM = Number(q.maxMarks ?? q.marks ?? q.max ?? 1);
                if (maxM <= 0) return;

                const rawQ = q.questionNumber || q.qNum || q.number || ('Q' + (idx + 1));
                let topicName = q.topic || q.chapter;

                if (!topicName && typeof resolveQuestionTopic === 'function') {
                    topicName = resolveQuestionTopic(rawQ, q, testSession, appState.sessions || analyticsSessions || []);
                }

                if (!topicName || topicName === 'General Concept' || topicName === '-') {
                    const txt = ((q.questionText || '') + ' ' + (q.feedback || '')).toLowerCase();
                    if (txt.includes('fiscal') || txt.includes('budget') || txt.includes('deficit')) {
                        topicName = 'Govt Budget: Fiscal Deficit';
                    } else if (txt.includes('defend') || txt.includes('refute') || txt.includes('stance')) {
                        topicName = 'Defend / Refute Evaluation';
                    } else if (txt.includes('inflation') || txt.includes('deflation') || txt.includes('repo') || txt.includes('bank') || txt.includes('rbi') || txt.includes('money')) {
                        topicName = 'Money & Banking Policies';
                    } else if (txt.includes('national income') || txt.includes('gdp') || txt.includes('domestic income') || txt.includes('value added')) {
                        topicName = 'National Income Accounting';
                    } else if (txt.includes('bop') || txt.includes('balance of payment') || txt.includes('current account') || txt.includes('foreign exchange') || txt.includes('forex')) {
                        topicName = 'Balance of Payments & Forex';
                    } else if (txt.includes('goodwill') || txt.includes('partnership') || txt.includes('shares') || txt.includes('debenture') || txt.includes('reconstitution')) {
                        topicName = 'Partnership & Company Accounts';
                    } else if (txt.includes('cash flow') || txt.includes('ratio') || txt.includes('financial statement') || txt.includes('balance sheet')) {
                        topicName = 'Financial Statement Analysis';
                    } else if (txt.includes('principles') || txt.includes('management') || txt.includes('fayol') || txt.includes('taylor') || txt.includes('planning') || txt.includes('organising') || txt.includes('directing') || txt.includes('controlling') || txt.includes('staffing')) {
                        topicName = 'Principles & Functions of Management';
                    } else if (txt.includes('marketing') || txt.includes('branding') || txt.includes('packaging') || txt.includes('pricing') || txt.includes('promotion')) {
                        topicName = 'Marketing Management';
                    } else if (maxM === 1) {
                        topicName = 'Objective MCQs';
                    } else {
                        topicName = `${testSubject}: Question ${rawQ}`;
                    }
                }

                if (!topicStats.has(topicName)) {
                    topicStats.set(topicName, {
                        name: topicName,
                        totalEarned: 0,
                        totalPossible: 0,
                        failCount: 0,
                        testAttempts: new Set(),
                        questions: []
                    });
                }

                const stat = topicStats.get(topicName);
                stat.totalEarned += earned;
                stat.totalPossible += maxM;
                stat.testAttempts.add(test.id || examName);

                const pct = (earned / maxM) * 100;
                if (pct < 60) {
                    stat.failCount += 1;
                    stat.questions.push({
                        qNum: rawQ,
                        earned,
                        maxM,
                        examName,
                        feedback: q.feedback || ''
                    });
                }
            });
        } else {
            // Fallback for tests evaluated without question-level breakdown array
            const testScore = Number(test.score) || 0;
            const testMax = Number(test.maxMarks) || 30;
            const testPct = testMax > 0 ? (testScore / testMax) * 100 : 0;
            if (testPct < 60) {
                const topicName = `${testSubject}: ${examName}`;
                if (!topicStats.has(topicName)) {
                    topicStats.set(topicName, {
                        name: topicName,
                        totalEarned: 0,
                        totalPossible: 0,
                        failCount: 0,
                        testAttempts: new Set(),
                        questions: []
                    });
                }
                const stat = topicStats.get(topicName);
                stat.totalEarned += testScore;
                stat.totalPossible += testMax;
                stat.failCount += 1;
                stat.testAttempts.add(test.id || examName);
                stat.questions.push({
                    qNum: 'Overall',
                    earned: testScore,
                    maxM: testMax,
                    examName,
                    feedback: test.overallFeedback || (Array.isArray(test.improvements) ? test.improvements.join('; ') : 'Evaluation score below 60% board threshold.')
                });
            }
        }
    });

    const allGaps = [];
    topicStats.forEach(stat => {
        const accuracy = stat.totalPossible > 0 ? Math.round((stat.totalEarned / stat.totalPossible) * 100) : 0;
        if (accuracy < 60 || stat.failCount > 0) {
            allGaps.push({
                name: stat.name,
                accuracy,
                failCount: stat.failCount,
                testCount: stat.testAttempts.size,
                totalEarned: stat.totalEarned,
                totalPossible: stat.totalPossible,
                questions: stat.questions
            });
        }
    });

    allGaps.sort((a, b) => a.accuracy - b.accuracy || b.failCount - a.failCount);
    const weakTopics = allGaps.slice(0, 2);

    return { weakTopics, allGaps };
}

function aggregateStudentsData(results) {
    const studentMap = new Map();

    results.forEach(res => {
        const rawName = (res.studentName || 'Anonymous Student').trim();
        const key = rawName.toLowerCase();

        // Extract roll number from dedicated fields or parse from studentName
        let detectedRoll = res.rollNumber || res.studentRoll || '';
        if (!detectedRoll) {
            const rollMatch = rawName.match(/\b(?:Roll|RN|No|#)\s*[:.-]?\s*(\d+)\b/i);
            if (rollMatch) {
                detectedRoll = rollMatch[1];
            } else if (res.studentId) {
                detectedRoll = res.studentId.substring(0, 6).toUpperCase();
            } else {
                detectedRoll = 'N/A';
            }
        }

        if (!studentMap.has(key)) {
            studentMap.set(key, {
                key: key,
                name: rawName,
                studentId: res.studentId || null,
                rollNumber: detectedRoll,
                class: res.class || 'Class 12th',
                subject: res.subject || 'Economics',
                batch: res.batch || res.targetGroup || 'Both',
                tests: [],
                totalPointsEarned: 0,
                totalPointsPossible: 0,
                latestDate: new Date(0)
            });
        }

        const student = studentMap.get(key);
        student.tests.push(res);

        const earned = Number(res.score) || 0;
        const maxM = Number(res.maxMarks) || (earned > 0 ? earned : 100);
        student.totalPointsEarned += earned;
        student.totalPointsPossible += maxM;

        const subDate = new Date(res.submittedAt || res.createdAt || 0);
        if (subDate > student.latestDate) {
            student.latestDate = subDate;
            if (res.class) student.class = res.class;
            if (res.subject) student.subject = res.subject;
            if (res.batch) student.batch = res.batch;
            if (detectedRoll && detectedRoll !== 'N/A') student.rollNumber = detectedRoll;
        }
    });

    const students = Array.from(studentMap.values()).map(s => {
        const overallPct = s.totalPointsPossible > 0
            ? Math.round((s.totalPointsEarned / s.totalPointsPossible) * 100)
            : 0;

        let tier = 'critical';
        let badgeLabel = 'Critical (<60%)';
        let badgeColor = '#ef4444';
        let badgeBg = '#fee2e2';
        let badgeBorder = '#fca5a5';

        if (overallPct >= 60 && overallPct <= 90) {
            tier = 'improving';
            badgeLabel = 'Need Improvement (60-90%)';
            badgeColor = '#f59e0b';
            badgeBg = '#fef3c7';
            badgeBorder = '#fde68a';
        } else if (overallPct > 90) {
            tier = 'strong';
            badgeLabel = 'Mastered (>90%)';
            badgeColor = '#10b981';
            badgeBg = '#dcfce7';
            badgeBorder = '#a7f3d0';
        }

        // Sort tests chronologically
        s.tests.sort((a, b) => new Date(a.submittedAt || a.createdAt || 0) - new Date(b.submittedAt || b.createdAt || 0));

        const peakScore = s.tests.length > 0
            ? Math.max(...s.tests.map(t => {
                const sc = Number(t.score) || 0;
                const mm = Number(t.maxMarks) || 40;
                return mm > 0 ? Math.round((sc / mm) * 100) : 0;
            }))
            : 0;

        const firstTest = s.tests[0];
        const latestTest = s.tests[s.tests.length - 1];
        const firstScorePct = firstTest && Number(firstTest.maxMarks) > 0 ? Math.round(((Number(firstTest.score) || 0) / Number(firstTest.maxMarks)) * 100) : 0;
        const latestScorePct = latestTest && Number(latestTest.maxMarks) > 0 ? Math.round(((Number(latestTest.score) || 0) / Number(latestTest.maxMarks)) * 100) : 0;
        const trajectoryDelta = latestScorePct - firstScorePct;

        const { weakTopics, allGaps } = extractStudentCriticalGaps(s);

        return {
            ...s,
            overallPercentage: overallPct,
            tier,
            badgeLabel,
            badgeColor,
            badgeBg,
            badgeBorder,
            peakScore,
            trajectoryDelta,
            weakTopics,
            allGaps,
            avgScore: s.tests.length > 0 ? (s.totalPointsEarned / s.tests.length).toFixed(1) : 0
        };
    });

    // Populate lookup cache
    cachedAggregatedStudents.clear();
    students.forEach(st => cachedAggregatedStudents.set(st.key, st));

    return students;
}

function syncStudentSubjectFilter() {
    const subFilter = document.getElementById('studentSubjectFilter');
    if (!subFilter) return;

    const classVal = document.getElementById('studentClassFilter')?.value || 'all';
    let options = [];

    if (classVal === 'Class 10th') {
        options = [
            { value: 'all', label: 'All Subjects (Class 10th)' },
            { value: 'Social Science', label: 'Social Science' }
        ];
    } else if (classVal === 'Class 12th') {
        options = [
            { value: 'all', label: 'All Subjects (Class 12th)' },
            { value: 'Economics', label: 'Economics' },
            { value: 'Business Studies', label: 'Business Studies' },
            { value: 'Accountancy', label: 'Accountancy' }
        ];
    } else {
        options = [
            { value: 'all', label: 'All Subjects' },
            { value: 'Economics', label: 'Economics' },
            { value: 'Business Studies', label: 'Business Studies' },
            { value: 'Accountancy', label: 'Accountancy' },
            { value: 'Social Science', label: 'Social Science' }
        ];
    }

    const current = subFilter.value;
    subFilter.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    if (options.some(o => o.value === current)) {
        subFilter.value = current;
    }
}

function renderStudentsPage() {
    const grid = elements.studentsGrid;
    if (!grid) return;

    const allStudents = aggregateStudentsData(appState.testResults);

    // Update Quick Tier Counter Pills
    const countCritical = allStudents.filter(s => s.tier === 'critical').length;
    const countImproving = allStudents.filter(s => s.tier === 'improving').length;
    const countStrong = allStudents.filter(s => s.tier === 'strong').length;

    const elTotal = document.getElementById('tierCountAll');
    const elCrit = document.getElementById('tierCountCritical');
    const elImp = document.getElementById('tierCountImproving');
    const elStr = document.getElementById('tierCountStrong');

    if (elTotal) elTotal.textContent = allStudents.length;
    if (elCrit) elCrit.textContent = countCritical;
    if (elImp) elImp.textContent = countImproving;
    if (elStr) elStr.textContent = countStrong;

    // Filter by Search, Class, Subject, Tier, and Sort
    const searchVal = (elements.studentSearchInput?.value || '').toLowerCase().trim();
    const classVal = elements.studentClassFilter?.value || 'all';
    const subjectVal = elements.studentSubjectFilter?.value || 'all';
    const sortBy = elements.studentSortFilter?.value || 'name';
    const activeTier = appState.studentTierFilter || 'all';

    let filtered = allStudents;

    if (activeTier !== 'all') {
        filtered = filtered.filter(s => s.tier === activeTier);
    }
    if (classVal !== 'all') {
        filtered = filtered.filter(s => 
            (s.class && s.class.toLowerCase() === classVal.toLowerCase()) || 
            (s.tests && s.tests.some(t => t.class && t.class.toLowerCase() === classVal.toLowerCase()))
        );
    }
    if (subjectVal !== 'all') {
        filtered = filtered.filter(s => 
            (s.subject && s.subject.toLowerCase() === subjectVal.toLowerCase()) || 
            (s.tests && s.tests.some(t => t.subject && t.subject.toLowerCase() === subjectVal.toLowerCase()))
        );
    }
    if (searchVal) {
        filtered = filtered.filter(s =>
            s.name.toLowerCase().includes(searchVal)
        );
    }

    // Sort
    filtered.sort((a, b) => {
        switch (sortBy) {
            case 'score-desc': return b.overallPercentage - a.overallPercentage;
            case 'score-asc': return a.overallPercentage - b.overallPercentage;
            case 'tests-desc': return b.tests.length - a.tests.length;
            case 'recent': return new Date(b.latestDate) - new Date(a.latestDate);
            default: return a.name.localeCompare(b.name);
        }
    });

    grid.innerHTML = '';

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 3rem 1rem;">
                <div class="empty-icon" style="font-size: 3rem; margin-bottom: 0.5rem;">👥</div>
                <div class="empty-title" style="font-weight: 700; color: #1e293b; font-size: 1.2rem;">No Students Found</div>
                <div style="color: #64748b; font-size: 0.9rem; margin-top: 0.25rem;">Try adjusting your search terms or filter criteria.</div>
            </div>
        `;
        return;
    }

    // Render Bento Cards
    filtered.forEach(student => {
        const card = document.createElement('div');
        card.className = 'student-card student-bento-card';
        card.dataset.studentKey = student.key;
        card.style.cssText = `
            background: #ffffff;
            border-radius: 14px;
            padding: 1.35rem 1.4rem;
            border: 1.5px solid rgba(226, 232, 240, 0.9);
            box-shadow: 0 2px 6px rgba(0,0,0,0.04);
            cursor: pointer;
            transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s ease;
        `;

        card.onmouseenter = () => {
            card.style.transform = 'translateY(-4px) scale(1.01)';
            card.style.boxShadow = '0 12px 24px -4px rgba(15, 23, 42, 0.1)';
        };
        card.onmouseleave = () => {
            card.style.transform = 'none';
            card.style.boxShadow = '0 2px 6px rgba(0,0,0,0.04)';
        };

        const initial = student.name.charAt(0).toUpperCase();
        const latestExam = student.tests[student.tests.length - 1];
        const latestExamName = latestExam ? formatExamName(latestExam.sessionName || latestExam.name || 'Test') : 'Exam';

        const rollLabel = student.rollNumber && student.rollNumber !== 'N/A' 
            ? 'Roll: ' + escapeHtml(student.rollNumber) 
            : 'Roll: —';

        const tierShortLabel = student.tier === 'strong' 
            ? '🟢 Mastered' 
            : (student.tier === 'improving' ? '🟡 Improving' : '🔴 Critical');

        // Focus areas markup
        let focusAreasHtml = '';
        if (student.weakTopics && student.weakTopics.length > 0) {
            focusAreasHtml = `
                <div style="margin-bottom: 0.85rem;">
                    <div style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px; color: #b45309; display: flex; align-items: center; gap: 4px; margin-bottom: 5px;">
                        <span>⚠️</span> Focus Areas (${student.allGaps.length}):
                    </div>
                    <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                        ${student.weakTopics.map(t => `
                            <span style="background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; max-width: 135px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block;" title="${escapeHtml(t.name)} (${t.accuracy}%)">
                                ${escapeHtml(t.name)}
                            </span>
                        `).join('')}
                        ${student.allGaps.length > 2 ? `<span style="font-size: 0.7rem; color: #64748b; font-weight: 700; align-self: center;">+${student.allGaps.length - 2} more</span>` : ''}
                    </div>
                </div>
            `;
        } else {
            focusAreasHtml = `
                <div style="margin-bottom: 0.85rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 0.4rem 0.65rem; display: flex; align-items: center; gap: 5px; font-size: 0.72rem; color: #166534; font-weight: 700;">
                    <span>✨</span> Consistent Concept Mastery
                </div>
            `;
        }

        card.innerHTML = `
            <!-- Card Header: Avatar, Name, Metadata Pills & Tier -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 0.75rem; min-width: 0; flex: 1;">
                    <div class="student-avatar" style="width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; font-weight: 800; flex-shrink: 0; box-shadow: 0 4px 10px rgba(79, 70, 229, 0.25);">
                        ${escapeHtml(initial)}
                    </div>
                    <div style="min-width: 0; flex: 1;">
                        <h4 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.25;" title="${escapeHtml(student.name)}">
                            ${escapeHtml(student.name)}
                        </h4>
                        <div style="display: flex; gap: 4px; align-items: center; margin-top: 4px; flex-wrap: wrap;">
                            <span style="background: #f1f5f9; color: #475569; font-size: 0.72rem; font-weight: 700; padding: 2px 7px; border-radius: 6px;">${escapeHtml(student.class)}</span>
                            <span style="background: #eef2ff; color: #4f46e5; font-size: 0.72rem; font-weight: 700; padding: 2px 7px; border-radius: 6px;">${escapeHtml(student.batch || 'Batch')}</span>
                        </div>
                    </div>
                </div>
                <div style="flex-shrink: 0;">
                    <span style="background: ${student.badgeBg}; color: ${student.badgeColor}; border: 1px solid ${student.badgeBorder}; padding: 3px 8px; border-radius: 20px; font-weight: 800; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap;">
                        ${tierShortLabel}
                    </span>
                </div>
            </div>

            <!-- Sleek Mastery Bar -->
            <div style="margin: 0.75rem 0 0.65rem 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; margin-bottom: 4px;">
                    <span style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.3px;">Overall Mastery</span>
                    <span style="font-weight: 800; font-size: 0.88rem; color: ${student.badgeColor};">${student.overallPercentage}%</span>
                </div>
                <div style="height: 6px; background: #f1f5f9; border-radius: 999px; overflow: hidden;">
                    <div style="height: 100%; width: ${Math.min(100, Math.max(5, student.overallPercentage))}%; background: ${student.badgeColor}; border-radius: 999px;"></div>
                </div>
            </div>

            <!-- Bento Stats Strip -->
            <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.45rem 0.85rem; margin-bottom: 0.85rem;">
                <div style="font-size: 0.76rem; color: #64748b;">
                    <strong style="color: #1e293b; font-size: 0.88rem;">${student.tests.length}</strong> ${student.tests.length === 1 ? 'Exam' : 'Exams'}
                </div>
                <div style="font-size: 0.76rem; color: #64748b;">
                    Peak: <strong style="color: #0284c7; font-size: 0.88rem;">${student.peakScore}%</strong>
                </div>
            </div>

            <!-- Recurring Focus Areas (The Core Feature) -->
            ${focusAreasHtml}

            <!-- Recent Activity Footer -->
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: #64748b; border-top: 1px solid #f1f5f9; padding-top: 0.65rem;">
                <span title="${escapeHtml(latestExamName)}" style="display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; max-width: 140px;">
                    Last: ${escapeHtml(latestExamName)}
                </span>
                <span style="font-weight: 800; color: #4f46e5; display: flex; align-items: center; gap: 3px;">
                    Diagnostic Profile &rarr;
                </span>
            </div>
        `;

        card.addEventListener('click', () => {
            openStudentProfileDrawer(student.key);
        });

        grid.appendChild(card);
    });
}

/**
 * Interactive Student Profile Slide-Over Drawer
 */
export function openStudentProfileDrawer(studentKey) {
    if (!studentKey) return;
    const student = cachedAggregatedStudents.get(studentKey);
    if (!student) return;

    // Dynamically re-evaluate critical learning gaps so drawer is 100% accurate
    const { weakTopics, allGaps } = extractStudentCriticalGaps(student);
    student.weakTopics = weakTopics;
    student.allGaps = allGaps;

    const backdrop = document.getElementById('studentProfileDrawerBackdrop');
    if (!backdrop) return;

    // Header Details
    const avatarEl = document.getElementById('drawerStudentAvatar');
    if (avatarEl) avatarEl.textContent = student.name.charAt(0).toUpperCase();

    const nameEl = document.getElementById('drawerStudentFullName');
    if (nameEl) nameEl.textContent = student.name;

    const metaEl = document.getElementById('drawerStudentMeta');
    if (metaEl) {
        metaEl.textContent = `${student.class} · ${student.subject} · Batch: ${student.batch}`;
    }

    const badgeEl = document.getElementById('drawerMasteryBadge');
    if (badgeEl) {
        badgeEl.textContent = `${student.tier === 'strong' ? '🟢' : (student.tier === 'improving' ? '🟡' : '🔴')} ${student.badgeLabel}`;
        badgeEl.style.background = student.badgeBg;
        badgeEl.style.color = student.badgeColor;
        badgeEl.style.border = `1px solid ${student.badgeBorder}`;
    }

    // Trajectory KPI Strip
    const testsEl = document.getElementById('drawerStatTests');
    if (testsEl) testsEl.textContent = student.tests.length;

    const avgEl = document.getElementById('drawerStatAvg');
    if (avgEl) avgEl.textContent = `${student.overallPercentage}%`;

    const peakEl = document.getElementById('drawerStatPeak');
    if (peakEl) peakEl.textContent = `${student.peakScore}%`;

    const deltaEl = document.getElementById('drawerStatDelta');
    if (deltaEl) {
        const delta = student.trajectoryDelta;
        const isUp = delta >= 0;
        deltaEl.textContent = `${isUp ? '▲ +' : '▼ '}${delta}%`;
        deltaEl.style.color = isUp ? '#10b981' : '#ef4444';
    }

    // Render Trajectory Plot Curve
    const plotEl = document.getElementById('drawerTrajectoryPlot');
    if (plotEl) {
        renderDrawerTrajectoryPlot(plotEl, student.tests);
    }

    // Render Historical Reports List
    const reportsEl = document.getElementById('drawerReportsList');
    if (reportsEl) {
        reportsEl.innerHTML = student.tests.map(t => {
            const sc = Number(t.score) || 0;
            const mm = Number(t.maxMarks) || 40;
            const pct = mm > 0 ? Math.round((sc / mm) * 100) : 0;
            const examTitle = formatExamName(t.sessionName || t.name || 'Exam');
            const dateStr = t.submittedAt || t.createdAt
                ? (new Date(t.submittedAt || t.createdAt)).toLocaleDateString()
                : 'Recent';

            let pillBg = '#fee2e2';
            let pillCol = '#991b1b';
            if (pct >= 60 && pct <= 90) {
                pillBg = '#fef3c7';
                pillCol = '#92400e';
            } else if (pct > 90) {
                pillBg = '#dcfce7';
                pillCol = '#166534';
            }

            return `
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.95rem 1.1rem; display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.02); transition: all 0.2s ease;">
                    <div style="flex: 1; min-width: 0;">
                        <h5 style="margin: 0; font-size: 0.92rem; font-weight: 700; color: #1e293b; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;" title="${escapeHtml(examTitle)}">
                            ${escapeHtml(examTitle)}
                        </h5>
                        <div style="font-size: 0.74rem; color: #64748b; margin-top: 2px;">
                            ${escapeHtml(dateStr)} · ${escapeHtml(t.subject || 'Syllabus')} · Set ${escapeHtml(t.examSet || 'Standard')}
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <span style="background: ${pillBg}; color: ${pillCol}; font-weight: 800; font-size: 0.78rem; padding: 2px 8px; border-radius: 6px;">
                            ${pct}%
                        </span>
                        <div style="font-weight: 800; color: #1e293b; font-size: 0.92rem; min-width: 48px; text-align: right;">
                            ${sc} / ${mm}
                        </div>
                        ${t.id ? `
                            <button type="button" class="btn-view-report" onclick="window.viewTestResultFromDrawer('${escapeHtml(t.id)}')" style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 6px; padding: 4px 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                                Report
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // Populate Recurring Critical Gaps & Weak Topics
    const weakSection = document.getElementById('drawerWeakTopicsSection');
    const weakList = document.getElementById('drawerWeakTopicsList');
    const weakCount = document.getElementById('drawerWeakTopicsCount');

    if (weakSection && weakList) {
        const gaps = student.allGaps || [];
        if (weakCount) weakCount.textContent = `${gaps.length} Gaps Detected`;

        if (gaps.length === 0) {
            weakList.innerHTML = `
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 0.85rem; color: #166534; font-size: 0.85rem; display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 1.2rem;">✨</span>
                    <div>
                        <strong>Exceptional Concept Mastery:</strong> This student has scored >= 60% across all evaluated curriculum questions.
                    </div>
                </div>
            `;
        } else {
            weakList.innerHTML = gaps.map(g => {
                const accColor = g.accuracy < 40 ? '#ef4444' : '#d97706';
                const accBg = g.accuracy < 40 ? '#fee2e2' : '#fef3c7';
                const sampleMistake = (g.questions && g.questions.find(q => q.feedback)) ? g.questions.find(q => q.feedback).feedback : '';

                return `
                    <div style="background: #ffffff; border: 1.5px solid #fed7aa; border-left: 4px solid #f97316; border-radius: 8px; padding: 0.75rem 0.95rem; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem; flex-wrap: wrap; gap: 0.5rem;">
                            <strong style="color: #9a3412; font-size: 0.88rem; display: flex; align-items: center; gap: 0.35rem;">
                                <span>⚠️</span> ${escapeHtml(g.name)}
                            </strong>
                            <span style="background: ${accBg}; color: ${accColor}; font-weight: 800; font-size: 0.74rem; padding: 2px 7px; border-radius: 6px;">
                                ${g.accuracy}% Mastery (${g.totalEarned}/${g.totalPossible}M)
                            </span>
                        </div>
                        <div style="font-size: 0.78rem; color: #475569; line-height: 1.4; margin-bottom: 0.3rem;">
                            <strong>Frequency:</strong> Marked below board standards in ${g.failCount} question(s) across ${g.testCount} exam session(s).
                        </div>
                        ${sampleMistake ? `
                            <div style="font-size: 0.75rem; color: #7c2d12; background: #fff7ed; border-left: 2px solid #fdba74; padding: 4px 8px; border-radius: 4px; font-style: italic;">
                                "${escapeHtml(sampleMistake.slice(0, 120))}${sampleMistake.length > 120 ? '...' : ''}"
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('');
        }
    }

    backdrop.style.display = 'flex';
    requestAnimationFrame(() => {
        backdrop.classList.add('active');
    });
}

function renderDrawerTrajectoryPlot(container, tests) {
    if (!container || !tests || tests.length === 0) {
        container.innerHTML = '<div style="margin: auto; color: #64748b; font-style: italic; font-size: 0.85rem;">No test history recorded yet.</div>';
        return;
    }

    container.innerHTML = '';
    const H = 140;
    const colsWrap = document.createElement('div');
    colsWrap.style.cssText = 'display: flex; align-items: flex-end; justify-content: space-around; width: 100%; height: 100%; gap: 12px; position: relative; z-index: 2;';

    tests.forEach((t, i) => {
        const sc = Number(t.score) || 0;
        const mm = Number(t.maxMarks) || 40;
        const pct = mm > 0 ? Math.round((sc / mm) * 100) : 0;
        const col = document.createElement('div');
        col.style.cssText = 'display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 44px;';

        const labelTop = document.createElement('div');
        labelTop.style.cssText = 'font-size: 0.72rem; font-weight: 800; color: #1e293b; margin-bottom: 4px;';
        labelTop.textContent = `${pct}%`;

        const bar = document.createElement('div');
        const barH = Math.max(8, Math.round((pct / 100) * (H - 30)));
        bar.style.cssText = `
            width: 24px;
            height: ${barH}px;
            background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
            border-radius: 6px 6px 0 0;
            box-shadow: 0 4px 10px rgba(79, 70, 229, 0.25);
            transition: height 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        `;

        const labelBottom = document.createElement('div');
        labelBottom.style.cssText = 'font-size: 0.68rem; color: #64748b; margin-top: 6px; text-align: center; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        labelBottom.textContent = `T${i + 1}`;
        labelBottom.title = formatExamName(t.sessionName || t.name || `Test ${i + 1}`);

        col.appendChild(labelTop);
        col.appendChild(bar);
        col.appendChild(labelBottom);
        colsWrap.appendChild(col);
    });

    container.appendChild(colsWrap);

    // Draw SVG trendline connecting bar tops
    requestAnimationFrame(() => {
        const plotRect = container.getBoundingClientRect();
        const cols = colsWrap.children;
        const pts = [];

        for (let i = 0; i < cols.length; i++) {
            const bar = cols[i].children[1];
            if (!bar) continue;
            const barRect = bar.getBoundingClientRect();
            const x = (barRect.left + barRect.width / 2) - plotRect.left;
            const y = barRect.top - plotRect.top;
            pts.push({ x: Math.round(x), y: Math.round(y) });
        }

        if (pts.length >= 2) {
            const ns = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(ns, "svg");
            svg.setAttribute("style", "position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 5;");

            const defs = document.createElementNS(ns, "defs");
            defs.innerHTML = `
                <marker id="drawerTrendArrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#4f46e5" />
                </marker>
            `;
            svg.appendChild(defs);

            const polyline = document.createElementNS(ns, "polyline");
            polyline.setAttribute("points", pts.map(p => `${p.x},${p.y}`).join(" "));
            polyline.setAttribute("fill", "none");
            polyline.setAttribute("stroke", "#4f46e5");
            polyline.setAttribute("stroke-width", "2.5");
            polyline.setAttribute("stroke-dasharray", "5 3");
            polyline.setAttribute("stroke-linecap", "round");
            polyline.setAttribute("marker-end", "url(#drawerTrendArrow)");
            svg.appendChild(polyline);

            pts.forEach(p => {
                const circle = document.createElementNS(ns, "circle");
                circle.setAttribute("cx", p.x);
                circle.setAttribute("cy", p.y);
                circle.setAttribute("r", "4.5");
                circle.setAttribute("fill", "#ffffff");
                circle.setAttribute("stroke", "#4f46e5");
                circle.setAttribute("stroke-width", "2.5");
                svg.appendChild(circle);
            });

            container.appendChild(svg);
        }
    });
}

if (typeof window !== 'undefined') {
    window.openStudentProfileDrawer = openStudentProfileDrawer;
    window.viewTestResultFromDrawer = function(resultId) {
        if (!resultId) return;
        viewDetails(resultId);
    };
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
        appState.sessions = analyticsSessions;

        syncAnalyticsSubjectFilter();
        updateAnalyticsSessionDropdown();
        populateMatrixSessionDropdown(analyticsSessions);
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
        html += `<option value="${escapeHtml(s.id)}">${escapeHtml(formatExamName(s.name))}${escapeHtml(setTag)} (${escapeHtml(s.class)} - ${escapeHtml(s.subject)})</option>`;
    });

    sessionFilter.innerHTML = html;

    // Optimization: When a specific subject or class is chosen, auto-select the latest test session
    // to eliminate manual test selection bottlenecks
    if ((subjectVal !== 'all' || classVal !== 'all') && filtered.length > 0) {
        sessionFilter.value = filtered[0].id;
    }
}

function syncAnalyticsSubjectFilter() {
    const subFilter = document.getElementById('analyticsSubjectFilter');
    if (!subFilter) return;

    const classVal = document.getElementById('analyticsClassFilter')?.value || 'all';
    let options = [];

    if (classVal === 'Class 10th') {
        options = [
            { value: 'all', label: 'All Subjects (Class 10th)' },
            { value: 'Social Science', label: 'Social Science' }
        ];
    } else if (classVal === 'Class 12th') {
        options = [
            { value: 'all', label: 'All Subjects (Class 12th)' },
            { value: 'Economics', label: 'Economics' },
            { value: 'Business Studies', label: 'Business Studies' },
            { value: 'Accountancy', label: 'Accountancy' }
        ];
    } else {
        options = [
            { value: 'all', label: 'All Subjects' },
            { value: 'Economics', label: 'Economics' },
            { value: 'Business Studies', label: 'Business Studies' },
            { value: 'Accountancy', label: 'Accountancy' },
            { value: 'Social Science', label: 'Social Science' }
        ];
    }

    const current = subFilter.value;
    subFilter.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    if (options.some(o => o.value === current)) {
        subFilter.value = current;
    } else {
        subFilter.value = 'all';
    }
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
                            label: function (context) {
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
                            callback: function (value) {
                                return appState.chartMetric === 'percentage' ? value + '%' : value;
                            }
                        }
                    }
                }
            }
        });
    }

    // 4. Update Score Distribution Doughnut Chart (Aligned to 3-tier board mastery)
    const scoreCanvas = document.getElementById('scoreDistributionChart');
    if (scoreCanvas) {
        if (appState.charts.scoreDistribution) {
            appState.charts.scoreDistribution.destroy();
        }

        const strong = filteredResults.filter(r => parseFloat(r.percentage) > 90).length;
        const improving = filteredResults.filter(r => {
            const p = parseFloat(r.percentage);
            return p >= 60 && p <= 90;
        }).length;
        const critical = filteredResults.filter(r => parseFloat(r.percentage) < 60).length;

        appState.charts.scoreDistribution = new Chart(scoreCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Strong / Mastered (>90%)', 'Need Improvement (60%–90%)', 'Critical (<60%)'],
                datasets: [{
                    data: [strong, improving, critical],
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
                    <td class="student-name">${medal}${escapeHtml(s[0])}</td>
                    <td><span class="score-badge score-high">${escapeHtml(s[1])}%</span></td>
                </tr>
            `;
        }).join('');

    // 2. Detailed Data Table (Sorted by Date Desc)
    const sortedDetails = [...filteredResults].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    detailedBody.innerHTML = sortedDetails.length === 0
        ? '<tr><td colspan="7" style="text-align:center;">No data available</td></tr>'
        : sortedDetails.map(r => {
            const date = new Date(r.submittedAt);
            const dateStr = date.toLocaleDateString();
            return `
                <tr>
                    <td class="student-name">${escapeHtml(r.studentName || 'Anonymous')}</td>
                    <td><span style="background: #e0f2fe; color: #0369a1; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700; font-size: 0.8rem;">${escapeHtml(r.batch || r.targetGroup || 'Both')}</span></td>
                    <td>${escapeHtml(r.class || '-')}</td>
                    <td>${escapeHtml(r.subject || '-')}</td>
                    <td>${escapeHtml(r.totalScore || '0/0')}</td>
                    <td>${escapeHtml(r.percentage || '0%')}</td>
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
        html += `<option value="${escapeHtml(s.id)}">${escapeHtml(formatExamName(s.name))} (${escapeHtml(s.class)} - ${escapeHtml(s.subject)})</option>`;
    });

    sessionFilter.innerHTML = html;
}

// ==================== EXECUTE FILTERED EXPORT ====================
function executeFilteredExport() {
    const batchVal = document.getElementById('exportBatchFilter')?.value || 'all';
    const classVal = document.getElementById('exportClassFilter')?.value || 'all';
    const sessionVal = document.getElementById('exportSessionFilter')?.value || 'all';

    let filtered = [...appState.testResults];

    if (batchVal !== 'all') {
        filtered = filtered.filter(r => {
            const b = r.batch || r.targetGroup || 'Both';
            if (batchVal === 'Nerd Tutors Nalanda') {
                return b === 'Nerd Tutors Nalanda' || b === 'Nalanda';
            }
            return b === batchVal;
        });
    }
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

    // CSV headers including Test Name, Batch, Class, Subject, Student ID, score metrics
    let csv = 'Test Name,Batch,Class,Subject,Student Name,Student ID,Date,Score,Percentage,Type\n';
    filtered.forEach(result => {
        const testName = `"${(result.testSessionName || result.testName || 'General Evaluation').replace(/"/g, '""')}"`;
        const batch = `"${(result.batch || result.targetGroup || 'Both').replace(/"/g, '""')}"`;
        const cls = result.class || '-';
        const sub = result.subject || '-';
        const studentName = `"${(result.studentName || 'Anonymous').replace(/"/g, '""')}"`;
        const studentId = result.studentId || '-';
        const date = `"${new Date(result.submittedAt).toLocaleString().replace(/"/g, '""')}"`;
        const score = result.totalScore || '0/0';
        const percentage = result.percentage || '0%';
        const type = result.testType || 'text';

        csv += `${testName},${batch},${cls},${sub},${studentName},${studentId},${date},${score},${percentage},${type}\n`;
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
    // Hamburger menu toggle for both desktop (collapsible) and mobile
    const toggleSidebar = () => {
        if (window.innerWidth <= 1024) {
            elements.sidebar.classList.toggle('active');
            elements.mobileMenuOverlay.classList.toggle('active');
            elements.menuIcon.textContent = elements.sidebar.classList.contains('active') ? '✕' : '☰';
        } else {
            const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
            try {
                localStorage.setItem('nt_sidebar_collapsed', isCollapsed ? 'true' : 'false');
            } catch (_) { }
        }
    };

    elements.mobileMenuBtn.addEventListener('click', toggleSidebar);

    // Restore saved sidebar preference for desktop
    try {
        if (localStorage.getItem('nt_sidebar_collapsed') === 'true' && window.innerWidth > 1024) {
            document.body.classList.add('sidebar-collapsed');
        }
    } catch (_) { }

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
    if (elements.batchFilter) {
        elements.batchFilter.addEventListener('change', applyFilters);
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
    if (elements.studentClassFilter) {
        elements.studentClassFilter.addEventListener('change', () => {
            syncStudentSubjectFilter();
            renderStudentsPage();
        });
    }
    if (elements.studentSubjectFilter) {
        elements.studentSubjectFilter.addEventListener('change', renderStudentsPage);
    }
    if (elements.studentSortFilter) {
        elements.studentSortFilter.addEventListener('change', renderStudentsPage);
    }

    // Quick tier pill click handlers
    const tierPills = document.querySelectorAll('.tier-pill');
    tierPills.forEach(pill => {
        pill.addEventListener('click', () => {
            tierPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            appState.studentTierFilter = pill.dataset.filterTier || 'all';
            renderStudentsPage();
        });
    });

    // Student Profile Drawer close events
    const closeStudentDrawerBtn = document.getElementById('btnCloseStudentDrawer');
    const studentDrawerBackdrop = document.getElementById('studentProfileDrawerBackdrop');
    if (closeStudentDrawerBtn && studentDrawerBackdrop) {
        const hideStudentDrawer = () => {
            studentDrawerBackdrop.classList.remove('active');
            setTimeout(() => { studentDrawerBackdrop.style.display = 'none'; }, 250);
        };
        closeStudentDrawerBtn.addEventListener('click', hideStudentDrawer);
        studentDrawerBackdrop.addEventListener('click', (e) => {
            if (e.target === studentDrawerBackdrop) hideStudentDrawer();
        });
    }

    // Escape key closes student profile drawer
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && studentDrawerBackdrop?.classList.contains('active')) {
            studentDrawerBackdrop.classList.remove('active');
            setTimeout(() => { studentDrawerBackdrop.style.display = 'none'; }, 250);
        }
    });

    // Analytics Filters
    if (elements.analyticsClassFilter) {
        elements.analyticsClassFilter.addEventListener('change', () => {
            syncAnalyticsSubjectFilter();
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
                case '#matrix':
                    showPage('matrix');
                    renderQuestionMatrix(appState.testResults);
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

    // Go to Matrix button from Analytics
    const btnGoToMatrix = document.getElementById('btnGoToMatrix');
    if (btnGoToMatrix) {
        btnGoToMatrix.addEventListener('click', () => {
            showPage('matrix');
            renderQuestionMatrix(appState.testResults);
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.querySelector('.nav-item[href="#matrix"]')?.classList.add('active');
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

        // Load sessions list FIRST so topicMap and sessions are ready in memory
        await loadSessionsForAnalyticsFilter();

        // Load test results and render students
        await loadTestResults();

        // Initialize Question Performance Matrix
        initQuestionMatrix(appState, analyticsSessions, db, { updateDoc, doc });

        // Initialize Student Multi-Exam Progress Chart with real data
        initStudentProgressChart(appState.testResults);

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
if (typeof window !== 'undefined') {
    window.renderStudentsPage = renderStudentsPage;
}
