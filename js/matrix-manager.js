// ============================================
// QUESTION PERFORMANCE MATRIX MODULE
// Generates and manages the Question-by-Student Marks Grid
// with full cross-sectional analytics, drawer flyouts, and CSV export.
// ============================================

function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

let matrixState = {
    results: [],
    sessions: [],
    questionMap: new Map(), // qNum -> { maxMarks, text, responses: Map(studentKey -> response) }
    studentList: [], // [ { id, name, batch, totalScore, maxMarks, percentage } ]
    questionList: [], // [ qNum ] sorted naturally
    activeDrawerData: null
};

/**
 * Initialize Matrix Module with reference to appState
 */
export function initQuestionMatrix(appState, sessionsList = []) {
    matrixState.results = appState.testResults || [];
    matrixState.sessions = sessionsList || [];

    setupMatrixDomListeners(appState);
    populateMatrixSessionDropdown();
    renderQuestionMatrix();
}

/**
 * Natural sort for academic question numbers:
 * Handles Q1, Q2 ... Q10, Q17(i), Q17(ii), Q34b(i), Section A, Section B
 */
export function naturalQuestionSort(a, b) {
    const parseQ = (str) => {
        const match = String(str).match(/^([a-zA-Z]*)\s*(\d+)?\s*(.*)$/);
        if (!match) return { prefix: String(str), num: 0, sub: '' };
        return {
            prefix: (match[1] || '').toUpperCase(),
            num: match[2] ? parseInt(match[2], 10) : 0,
            sub: match[3] || ''
        };
    };

    const pa = parseQ(a);
    const pb = parseQ(b);

    if (pa.prefix !== pb.prefix) {
        return pa.prefix.localeCompare(pb.prefix);
    }
    if (pa.num !== pb.num) {
        return pa.num - pb.num;
    }
    return pa.sub.localeCompare(pb.sub);
}

/**
 * Populate Test Session dropdown based on Class and Subject filters
 */
export function populateMatrixSessionDropdown(sessions) {
    if (sessions) matrixState.sessions = sessions;
    const sessionSelect = document.getElementById('matrixSessionFilter');
    if (!sessionSelect) return;

    const classVal = document.getElementById('matrixClassFilter')?.value || 'all';
    const subjectVal = document.getElementById('matrixSubjectFilter')?.value || 'all';

    let filtered = matrixState.sessions;
    if (classVal !== 'all') {
        filtered = filtered.filter(s => s.class === classVal);
    }
    if (subjectVal !== 'all') {
        filtered = filtered.filter(s => s.subject === subjectVal);
    }

    let html = '<option value="all">All Test Sessions (Combined View)</option>';
    filtered.forEach(s => {
        const setTag = s.examSet && s.examSet !== 'Standard / All' ? ` · ${s.examSet}` : '';
        html += `<option value="${s.id}">${escapeHtml(s.name)}${setTag} (${s.class} · ${s.subject})</option>`;
    });

    sessionSelect.innerHTML = html;
}

/**
 * Synchronize Class <-> Subject options for Matrix filter
 */
export function syncMatrixSubjectFilter() {
    const subFilter = document.getElementById('matrixSubjectFilter');
    if (!subFilter) return;

    const classVal = document.getElementById('matrixClassFilter')?.value || 'all';
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

/**
 * Master Render Engine for Question Matrix
 */
export function renderQuestionMatrix(results) {
    if (results) matrixState.results = results;

    const tableHead = document.getElementById('matrixTableHead');
    const tableBody = document.getElementById('matrixTableBody');
    const tableFoot = document.getElementById('matrixTableFoot');
    const emptyState = document.getElementById('matrixEmptyState');
    const tableWrapper = document.getElementById('matrixTableWrapper');

    if (!tableHead || !tableBody || !tableFoot) return;

    // 1. Read Filter Controls
    const classVal = document.getElementById('matrixClassFilter')?.value || 'all';
    const subjectVal = document.getElementById('matrixSubjectFilter')?.value || 'all';
    const sessionVal = document.getElementById('matrixSessionFilter')?.value || 'all';
    const batchVal = document.getElementById('matrixBatchFilter')?.value || 'all';
    const searchVal = (document.getElementById('matrixStudentSearch')?.value || '').toLowerCase().trim();
    const qTypeVal = document.getElementById('matrixQuestionTypeFilter')?.value || 'all';

    // 2. Filter Results Dataset
    let filteredResults = matrixState.results;

    if (classVal !== 'all') {
        filteredResults = filteredResults.filter(r => r.class === classVal);
    }
    if (subjectVal !== 'all') {
        filteredResults = filteredResults.filter(r => r.subject === subjectVal);
    }
    if (sessionVal !== 'all') {
        filteredResults = filteredResults.filter(r => r.sessionId === sessionVal);
    }
    if (batchVal !== 'all') {
        filteredResults = filteredResults.filter(r => (r.batch || r.targetGroup) === batchVal);
    }
    if (searchVal) {
        filteredResults = filteredResults.filter(r => (r.studentName || '').toLowerCase().includes(searchVal));
    }

    // 3. Handle Empty State
    if (!filteredResults || filteredResults.length === 0) {
        tableHead.innerHTML = '';
        tableBody.innerHTML = '';
        tableFoot.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        updateMatrixKpis([], []);
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // 4. Map Unique Students & deduplicate latest attempt per student in session
    const studentMap = new Map();
    filteredResults.forEach(res => {
        const studentName = res.studentName || 'Anonymous Student';
        const key = `${studentName}_${res.sessionId || 'nosess'}`;
        if (!studentMap.has(key)) {
            studentMap.set(key, res);
        } else {
            const existing = studentMap.get(key);
            const dateExisting = new Date(existing.submittedAt || 0).getTime();
            const dateNew = new Date(res.submittedAt || 0).getTime();
            if (dateNew > dateExisting) {
                studentMap.set(key, res);
            }
        }
    });

    const activeStudents = Array.from(studentMap.values());
    // Sort students alphabetically
    activeStudents.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || ''));

    // 5. Extract and Index All Questions Across Student Evaluations
    const questionIndex = new Map();

    activeStudents.forEach(studentResult => {
        const items = studentResult.breakdown || studentResult.results || studentResult.answers || [];
        if (Array.isArray(items)) {
            items.forEach(qItem => {
                const qNum = String(qItem.questionNumber || qItem.qNum || qItem.number || '').trim();
                if (!qNum) return;

                if (!questionIndex.has(qNum)) {
                    questionIndex.set(qNum, {
                        qNum: qNum,
                        maxMarks: Number(qItem.maxMarks) || 1,
                        text: qItem.questionText || qItem.text || '',
                        responses: new Map()
                    });
                }

                const qRecord = questionIndex.get(qNum);
                // Update maxMarks if finite and > 0
                if (Number(qItem.maxMarks) > 0) {
                    qRecord.maxMarks = Math.max(qRecord.maxMarks, Number(qItem.maxMarks));
                }
                if (!qRecord.text && (qItem.questionText || qItem.text)) {
                    qRecord.text = qItem.questionText || qItem.text;
                }

                qRecord.responses.set(studentResult.id, {
                    studentId: studentResult.id,
                    studentName: studentResult.studentName,
                    sessionName: studentResult.sessionName || 'Exam Session',
                    score: Number(qItem.score) || 0,
                    maxMarks: Number(qItem.maxMarks) || qRecord.maxMarks,
                    feedback: qItem.feedback || 'No remarks provided.',
                    studentAnswerText: qItem.studentAnswerText || qItem.studentAnswer || '(No written text recorded)',
                    improvements: qItem.improvements || []
                });
            });
        }
    });

    // 6. Sort Question Numbers Naturally
    let sortedQuestions = Array.from(questionIndex.keys()).sort(naturalQuestionSort);

    // Filter questions based on Question Filter mode
    if (qTypeVal === 'mistakes') {
        sortedQuestions = sortedQuestions.filter(qNum => {
            const q = questionIndex.get(qNum);
            // Include question if at least one student scored less than maxMarks
            return Array.from(q.responses.values()).some(resp => resp.score < resp.maxMarks);
        });
    } else if (qTypeVal === 'full') {
        sortedQuestions = sortedQuestions.filter(qNum => {
            const q = questionIndex.get(qNum);
            // Include question only if every student scored full marks
            const resps = Array.from(q.responses.values());
            return resps.length > 0 && resps.every(resp => resp.score >= resp.maxMarks);
        });
    }

    // Update KPI Cards
    updateMatrixKpis(activeStudents, sortedQuestions, questionIndex);

    // 7. Render Matrix Header (<thead>)
    let theadHtml = `
        <tr>
            <th class="th-question">Question No.</th>
    `;

    activeStudents.forEach(st => {
        const batchTag = st.batch || st.targetGroup || 'Both';
        const totalScored = st.score !== undefined ? st.score : (st.totalScore || 0);
        const maxMarks = st.maxMarks || 40;
        theadHtml += `
            <th class="th-student">
                <div style="font-size: 0.95rem; font-weight: 700; color: #1e293b;">${escapeHtml(st.studentName)}</div>
                <div style="margin-top: 0.2rem; display: flex; align-items: center; justify-content: center; gap: 0.35rem;">
                    <span style="background: #e0f2fe; color: #0369a1; padding: 1px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 700;">${escapeHtml(batchTag)}</span>
                    <span style="font-size: 0.75rem; color: #475569; font-weight: 800;">${totalScored}/${maxMarks}</span>
                </div>
            </th>
        `;
    });

    theadHtml += `
            <th class="th-avg">Class Avg</th>
        </tr>
    `;
    tableHead.innerHTML = theadHtml;

    // 8. Render Matrix Body (<tbody>)
    let tbodyHtml = '';

    sortedQuestions.forEach(qNum => {
        const qRecord = questionIndex.get(qNum);
        const maxM = qRecord.maxMarks;

        let questionTotalEarned = 0;
        let questionTotalPossible = 0;
        let studentCountForQ = 0;

        let rowCells = '';

        activeStudents.forEach(st => {
            const resp = qRecord.responses.get(st.id);

            if (resp) {
                const score = resp.score;
                const max = resp.maxMarks || maxM;
                questionTotalEarned += score;
                questionTotalPossible += max;
                studentCountForQ++;

                let pillClass = 'score-partial';
                let symbol = '!';

                if (score >= max && max > 0) {
                    pillClass = 'score-full';
                    symbol = '✓';
                } else if (score <= 0) {
                    pillClass = 'score-zero';
                    symbol = '✗';
                }

                // Attach payload for drawer on click
                const payloadKey = `resp_${st.id}_${encodeURIComponent(qNum)}`;
                window._matrixDrawerCache = window._matrixDrawerCache || {};
                window._matrixDrawerCache[payloadKey] = {
                    ...resp,
                    qNum,
                    questionText: qRecord.text
                };

                rowCells += `
                    <td>
                        <span class="matrix-score-pill ${pillClass}" onclick="window.openMatrixDrawerByKey('${payloadKey}')" title="Click to view evaluation details">
                            <span>${symbol}</span> <span>${score}/${max}</span>
                        </span>
                    </td>
                `;
            } else {
                rowCells += `
                    <td>
                        <span class="score-empty" title="Question not in evaluated paper">-</span>
                    </td>
                `;
            }
        });

        // Calculate Question Class Average
        let avgPct = 0;
        let avgColor = '#64748b';
        if (questionTotalPossible > 0) {
            avgPct = Math.round((questionTotalEarned / questionTotalPossible) * 100);
            if (avgPct >= 75) avgColor = '#15803d';
            else if (avgPct >= 45) avgColor = '#b45309';
            else avgColor = '#b91c1c';
        }

        tbodyHtml += `
            <tr>
                <td class="td-question">
                    <span style="font-weight: 800; color: #1e293b;">${escapeHtml(qNum)}</span>
                    <span style="background: #f1f5f9; color: #475569; padding: 2px 5px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; margin-left: 4px;">${maxM}M</span>
                </td>
                ${rowCells}
                <td class="td-avg">
                    <span style="color: ${avgColor}; font-weight: 800; font-size: 0.88rem;">${avgPct}%</span>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = tbodyHtml;

    // 9. Render Matrix Footer Summary (<tfoot>)
    let tfootHtml = `
        <tr>
            <td class="td-question" style="font-weight: 800; color: #1e3c72;">TOTAL SCORE</td>
    `;

    let totalClassScored = 0;
    let totalClassPossible = 0;

    activeStudents.forEach(st => {
        const total = st.score !== undefined ? Number(st.score) : Number(st.totalScore || 0);
        const max = Number(st.maxMarks) || 40;
        const pct = max > 0 ? Math.round((total / max) * 100) : 0;

        totalClassScored += total;
        totalClassPossible += max;

        let pctColor = '#b45309';
        if (pct >= 80) pctColor = '#15803d';
        else if (pct < 50) pctColor = '#b91c1c';

        tfootHtml += `
            <td>
                <div style="font-size: 0.95rem; font-weight: 800; color: #1e293b;">${total} / ${max}</div>
                <div style="font-size: 0.75rem; font-weight: 800; color: ${pctColor};">${pct}%</div>
            </td>
        `;
    });

    const classOverallPct = totalClassPossible > 0 ? Math.round((totalClassScored / totalClassPossible) * 100) : 0;
    let classPctColor = classOverallPct >= 75 ? '#15803d' : (classOverallPct >= 45 ? '#b45309' : '#b91c1c');

    tfootHtml += `
            <td class="td-avg">
                <div style="font-size: 0.95rem; font-weight: 800; color: ${classPctColor};">${classOverallPct}%</div>
                <div style="font-size: 0.72rem; color: #64748b;">Class Avg</div>
            </td>
        </tr>
    `;
    tableFoot.innerHTML = tfootHtml;

    // Save active state for CSV export
    matrixState.activeStudents = activeStudents;
    matrixState.activeQuestions = sortedQuestions;
    matrixState.questionIndex = questionIndex;
}

/**
 * Update KPI Summary Chips above matrix
 */
function updateMatrixKpis(students, questions, questionIndex) {
    const studentsEl = document.getElementById('matrixStudentsCount');
    const questionsEl = document.getElementById('matrixQuestionsCount');
    const toughestQEl = document.getElementById('matrixToughestQ');
    const toughestQSub = document.getElementById('matrixToughestQSub');
    const easiestQEl = document.getElementById('matrixEasiestQ');
    const easiestQSub = document.getElementById('matrixEasiestQSub');

    if (studentsEl) studentsEl.textContent = students.length;
    if (questionsEl) questionsEl.textContent = questions.length;

    if (!questions || questions.length === 0 || !questionIndex) {
        if (toughestQEl) toughestQEl.textContent = '-';
        if (easiestQEl) easiestQEl.textContent = '-';
        return;
    }

    let minAvg = 999;
    let maxAvg = -1;
    let toughestQ = null;
    let easiestQ = null;

    questions.forEach(qNum => {
        const qRec = questionIndex.get(qNum);
        if (!qRec) return;
        let earned = 0;
        let possible = 0;
        qRec.responses.forEach(r => {
            earned += r.score;
            possible += r.maxMarks;
        });

        if (possible > 0) {
            const pct = Math.round((earned / possible) * 100);
            if (pct < minAvg) {
                minAvg = pct;
                toughestQ = { qNum, pct };
            }
            if (pct > maxAvg) {
                maxAvg = pct;
                easiestQ = { qNum, pct };
            }
        }
    });

    if (toughestQEl && toughestQ) {
        toughestQEl.textContent = `${toughestQ.qNum} (${toughestQ.pct}%)`;
        if (toughestQSub) toughestQSub.textContent = `Lowest accuracy across class`;
    }
    if (easiestQEl && easiestQ) {
        easiestQEl.textContent = `${easiestQ.qNum} (${easiestQ.pct}%)`;
        if (easiestQSub) easiestQSub.textContent = `Highest accuracy across class`;
    }
}

/**
 * Open Detail Slide-Over Drawer for a specific student's question score
 */
if (typeof window !== 'undefined') {
    window.openMatrixDrawerByKey = function(key) {
        const data = window._matrixDrawerCache?.[key];
        if (!data) return;

        const backdrop = document.getElementById('matrixCellDrawerBackdrop');
        if (!backdrop) return;

        document.getElementById('drawerSessionLabel').textContent = data.sessionName || 'Exam Session';
        document.getElementById('drawerStudentName').textContent = data.studentName || 'Student Details';
        document.getElementById('drawerQuestionNumber').textContent = `Question ${data.qNum} · Max Marks: ${data.maxMarks}`;
        document.getElementById('drawerScoreValue').textContent = `${data.score} / ${data.maxMarks}`;

        const badgeContainer = document.getElementById('drawerScoreBadge');
        if (badgeContainer) {
            if (data.score >= data.maxMarks) {
                badgeContainer.innerHTML = `<span style="background: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.85rem;">✓ Full Marks</span>`;
            } else if (data.score <= 0) {
                badgeContainer.innerHTML = `<span style="background: #fee2e2; color: #b91c1c; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.85rem;">✗ Zero Marks</span>`;
            } else {
                badgeContainer.innerHTML = `<span style="background: #fef3c7; color: #b45309; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.85rem;">! Partial Marks</span>`;
            }
        }

        document.getElementById('drawerQuestionText').textContent = data.questionText || 'Refer to question paper.';
        document.getElementById('drawerStudentAnswer').textContent = data.studentAnswerText || '(No answer text provided)';
        document.getElementById('drawerFeedback').textContent = data.feedback || 'Evaluated successfully.';

        const improvementsBox = document.getElementById('drawerImprovementsBox');
        const improvementsList = document.getElementById('drawerImprovementsList');
        if (improvementsBox && improvementsList) {
            if (Array.isArray(data.improvements) && data.improvements.length > 0) {
                improvementsList.innerHTML = data.improvements.map(imp => `<div style="margin-bottom: 4px;">• ${escapeHtml(imp)}</div>`).join('');
                improvementsBox.style.display = 'block';
            } else {
                improvementsBox.style.display = 'none';
            }
        }

        backdrop.classList.add('active');
    };
}

/**
 * Setup Event Listeners for Matrix Filters and Buttons
 */
function setupMatrixDomListeners(appState) {
    // Class filter sync
    const classFilter = document.getElementById('matrixClassFilter');
    if (classFilter) {
        classFilter.addEventListener('change', () => {
            syncMatrixSubjectFilter();
            populateMatrixSessionDropdown();
            renderQuestionMatrix();
        });
    }

    // Subject filter sync
    const subFilter = document.getElementById('matrixSubjectFilter');
    if (subFilter) {
        subFilter.addEventListener('change', () => {
            populateMatrixSessionDropdown();
            renderQuestionMatrix();
        });
    }

    // Session filter
    const sessFilter = document.getElementById('matrixSessionFilter');
    if (sessFilter) {
        sessFilter.addEventListener('change', () => renderQuestionMatrix());
    }

    // Batch filter
    const batchFilter = document.getElementById('matrixBatchFilter');
    if (batchFilter) {
        batchFilter.addEventListener('change', () => renderQuestionMatrix());
    }

    // Student search box
    const searchInput = document.getElementById('matrixStudentSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => renderQuestionMatrix());
    }

    // Question filter (all, mistakes, full)
    const qFilter = document.getElementById('matrixQuestionTypeFilter');
    if (qFilter) {
        qFilter.addEventListener('change', () => renderQuestionMatrix());
    }

    // Refresh button
    const refreshBtn = document.getElementById('matrixRefreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            renderQuestionMatrix(appState.testResults);
        });
    }

    // Print button
    const printBtn = document.getElementById('matrixPrintBtn');
    if (printBtn) {
        printBtn.addEventListener('click', () => window.print());
    }

    // Export Matrix CSV
    const exportBtn = document.getElementById('matrixExportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => exportMatrixCsv());
    }

    // Drawer close events
    const closeDrawerBtn = document.getElementById('btnCloseMatrixDrawer');
    const drawerBackdrop = document.getElementById('matrixCellDrawerBackdrop');
    if (closeDrawerBtn && drawerBackdrop) {
        closeDrawerBtn.addEventListener('click', () => drawerBackdrop.classList.remove('active'));
        drawerBackdrop.addEventListener('click', (e) => {
            if (e.target === drawerBackdrop) drawerBackdrop.classList.remove('active');
        });
    }

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawerBackdrop?.classList.contains('active')) {
            drawerBackdrop.classList.remove('active');
        }
    });
}

/**
 * Export Matrix directly to formatted CSV
 */
export function exportMatrixCsv() {
    const students = matrixState.activeStudents || [];
    const questions = matrixState.activeQuestions || [];
    const qIndex = matrixState.questionIndex;

    if (!students.length || !questions.length || !qIndex) {
        alert("No matrix data to export.");
        return;
    }

    let csv = '';

    // CSV Header Row: Question Number, Student 1, Student 2, ..., Class Average (%)
    const headers = ['Question Number'];
    students.forEach(st => {
        headers.push(`"${st.studentName.replace(/"/g, '""')} (${st.batch || 'Both'})"`);
    });
    headers.push('Class Average (%)');
    csv += headers.join(',') + '\n';

    // CSV Question Rows
    questions.forEach(qNum => {
        const qRec = qIndex.get(qNum);
        const row = [`"${qNum} (${qRec.maxMarks} Marks)"`];
        let earned = 0;
        let possible = 0;

        students.forEach(st => {
            const resp = qRec.responses.get(st.id);
            if (resp) {
                row.push(resp.score);
                earned += resp.score;
                possible += resp.maxMarks;
            } else {
                row.push('""');
            }
        });

        const avgPct = possible > 0 ? Math.round((earned / possible) * 100) : 0;
        row.push(`${avgPct}%`);
        csv += row.join(',') + '\n';
    });

    // CSV Total Score Row
    const totalRow = ['"TOTAL SCORE"'];
    let grandEarned = 0;
    let grandPossible = 0;
    students.forEach(st => {
        const total = st.score !== undefined ? st.score : (st.totalScore || 0);
        const max = st.maxMarks || 40;
        grandEarned += Number(total);
        grandPossible += Number(max);
        totalRow.push(`"${total} / ${max}"`);
    });

    const grandAvgPct = grandPossible > 0 ? Math.round((grandEarned / grandPossible) * 100) : 0;
    totalRow.push(`"${grandAvgPct}%"`);
    csv += totalRow.join(',') + '\n';

    // Trigger Browser Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `question_performance_matrix_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
