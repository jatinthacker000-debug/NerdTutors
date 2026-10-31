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
export function initQuestionMatrix(appState, sessionsList = [], db = null, firestoreUtils = null) {
    matrixState.results = appState.testResults || [];
    matrixState.sessions = sessionsList || [];
    matrixState.db = db;
    matrixState.firestoreUtils = firestoreUtils;

    setupMatrixDomListeners(appState);
    populateMatrixSessionDropdown();
    renderQuestionMatrix();
}

/**
 * Canonical Normalizer for Academic Question Identifiers:
 * Unifies formatting variances so matrix rows never fragment:
 * - "Question 1", "Q.1", "Q 1" -> "Q1"
 * - "Q2a", "Q2(a)", "Q2.a", "Q2-a", "Q2 A" -> "Q2(a)"
 * - "Q2b", "Q2(b)", "Q2.b", "Q2-b" -> "Q2(b)"
 * - "Q5i", "Q5(i)", "Q5.i", "Q5-i", "Q5 (I)" -> "Q5(i)"
 * - "Q5ii", "Q5(ii)", "Q5.ii" -> "Q5(ii)"
 * - "Q17a(i)", "Q17(a)(i)" -> "Q17(a)(i)"
 */
export function normalizeQuestionNumber(raw) {
    if (!raw && raw !== 0) return '';
    let str = String(raw).trim();
    if (!str) return '';

    // Standardize 'Question' prefix to 'Q'
    str = str.replace(/^Question\s*/i, 'Q');

    // Case 1: Q<number> with roman numeral subpart: Q5i, Q5(i), Q5.i, Q5-i, Q5 (ii), Q5(I), Q5II, Q5iv -> Q5(i), Q5(ii), Q5(iv)
    const mRoman = str.match(/^Q\s*(\d+)\s*[._\s-]?\(?([ivxIVX]+)\)?$/i);
    if (mRoman) {
        return `Q${mRoman[1]}(${mRoman[2].toLowerCase()})`;
    }

    // Case 2a: Q<number>(<letter>)(<roman or number>) e.g. Q17a(i), Q17(a)(i), Q17(a)(1) -> Q17(a)(i), Q17(a)(1)
    const mMulti1 = str.match(/^Q\s*(\d+)\s*[._\s-]?\(?([a-zA-Z])\)?\s*[._\s-]?\(?([ivxIVX]+|\d+)\)?$/i);
    if (mMulti1) {
        return `Q${mMulti1[1]}(${mMulti1[2].toLowerCase()})(${mMulti1[3].toLowerCase()})`;
    }

    // Case 2b: Q<number>(<roman>)(<letter>) e.g. Q17(i)(a), Q17i(a) -> Q17(i)(a)
    const mMulti2 = str.match(/^Q\s*(\d+)\s*[._\s-]?\(?([ivxIVX]+)\)?\s*[._\s-]?\(?([a-zA-Z])\)?$/i);
    if (mMulti2) {
        return `Q${mMulti2[1]}(${mMulti2[2].toLowerCase()})(${mMulti2[3].toLowerCase()})`;
    }

    // Case 3: Q<number> with single letter subpart e.g. Q2a, Q2(a), Q2.a, Q2 - a, Q2A, Q2(A) -> Q2(a)
    const mLetter = str.match(/^Q\s*(\d+)\s*[._\s-]?\(?([a-zA-Z])\)?$/);
    if (mLetter) {
        return `Q${mLetter[1]}(${mLetter[2].toLowerCase()})`;
    }

    // Case 4: Q<number> with numeric subpart e.g. Q10.1, Q10(1) -> Q10(1)
    const mNumSub = str.match(/^Q\s*(\d+)\s*[._\s-]\(?(\d+)\)?$/);
    if (mNumSub) {
        return `Q${mNumSub[1]}(${mNumSub[2]})`;
    }

    // Case 5: Q.1, Q 1, Q-1, Q1 -> Q1
    const mBasic = str.match(/^Q\s*[._\s-]*(\d+)$/i);
    if (mBasic) {
        return `Q${mBasic[1]}`;
    }

    return str;
}

const ROMAN_MAP = {
    '(i)': 1, '(ii)': 2, '(iii)': 3, '(iv)': 4, '(v)': 5,
    '(vi)': 6, '(vii)': 7, '(viii)': 8, '(ix)': 9, '(x)': 10,
    'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5,
    'vi': 6, 'vii': 7, 'viii': 8, 'ix': 9, 'x': 10
};

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
            sub: (match[3] || '').trim().toLowerCase()
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

    // Roman numeral sub-parts comparison (e.g. (iv) before (v), (ix) before (x))
    const romanA = ROMAN_MAP[pa.sub];
    const romanB = ROMAN_MAP[pb.sub];
    if (romanA !== undefined && romanB !== undefined) {
        return romanA - romanB;
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
        const setTag = s.examSet && s.examSet !== 'Standard / All' ? ` - ${s.examSet}` : '';
        html += `<option value="${s.id}">${escapeHtml(s.name)}${setTag} (${s.class} - ${s.subject})</option>`;
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
 * Resolves curriculum topic for a question from AI topicMap, metadata, or text
 */
export function resolveQuestionTopic(qNum, qRecord, activeSession, allSessions = []) {
    if (!qNum) return 'General Concept';

    // 1. Direct on question record
    if (qRecord && qRecord.topic) return qRecord.topic;

    // 2. Lookup helper in a topicMap
    const checkTopicMap = (tMap) => {
        if (!tMap || typeof tMap !== 'object') return null;
        let tInfo = tMap[qNum] || tMap[qNum.toUpperCase()] || tMap[qNum.toLowerCase()];
        if (!tInfo) {
            const digits = qNum.match(/\d+/)?.[0];
            if (digits) {
                tInfo = tMap[`Q${digits}`] || tMap[digits] || tMap[`Question ${digits}`];
            }
        }
        if (!tInfo) {
            const baseQ = qNum.match(/^Q\d+/)?.[0];
            tInfo = baseQ ? (tMap[baseQ] || tMap[baseQ.toLowerCase()] || tMap[baseQ.toUpperCase()]) : null;
        }
        if (!tInfo) {
            const digits = qNum.match(/\d+/)?.[0];
            if (digits) {
                const foundK = Object.keys(tMap).find(k => k.match(new RegExp(`(^|\\D)${digits}(\\D|$)`)));
                if (foundK) tInfo = tMap[foundK];
            }
        }
        if (tInfo) {
            if (typeof tInfo === 'string') return tInfo;
            if (tInfo.topic) return tInfo.topic;
            if (tInfo.chapter) return tInfo.chapter;
        }
        return null;
    };

    if (activeSession && activeSession.topicMap) {
        const found = checkTopicMap(activeSession.topicMap);
        if (found) return found;
    }

    if (Array.isArray(allSessions)) {
        for (const sess of allSessions) {
            if (sess && sess.topicMap) {
                const found = checkTopicMap(sess.topicMap);
                if (found) return found;
            }
        }
    }

    // 3. Fallback: If topic data is unavailable, display a clean dash '-' instead of question text
    return '-';
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
                const rawQ = qItem.questionNumber || qItem.qNum || qItem.number || '';
                const qNum = normalizeQuestionNumber(rawQ);
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

    const activeSession = matrixState.sessions.find(s => s.id === sessionVal);

    // 7. Render Matrix Header (<thead>)
    let theadHtml = `
        <tr>
            <th class="th-question">Question No.</th>
            <th class="th-topic">Topic</th>
    `;

    activeStudents.forEach(st => {
        const batchTag = st.batch || st.targetGroup || 'Both';
        const totalScored = st.score !== undefined ? st.score : (st.totalScore || 0);
        const maxMarks = st.maxMarks || 40;
        theadHtml += `
            <th class="th-student" onclick="window.setStudentProgressName &amp;&amp; window.setStudentProgressName('${escapeHtml(st.studentName)}')" style="cursor: pointer;" title="Click to load progress chart for ${escapeHtml(st.studentName)}">
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
        const topicName = resolveQuestionTopic(qNum, qRecord, activeSession, matrixState.sessions);

        let questionTotalEarned = 0;
        let questionTotalPossible = 0;
        let studentCountForQ = 0;

        let rowCells = '';

        activeStudents.forEach(st => {
            const resp = qRecord.responses.get(st.id);

            if (resp) {
                const score = resp.score;
                const max = resp.maxMarks || maxM;
                const qPct = max > 0 ? (score / max) * 100 : 0;
                questionTotalEarned += score;
                questionTotalPossible += max;
                studentCountForQ++;

                let tdClass = 'td-score-white';
                let symbol = '✓';

                if (qPct <= 30) {
                    // <= 30% marks: ENTIRE BOX IS RED
                    tdClass = 'td-score-red';
                    symbol = score <= 0 ? '✗' : '!';
                } else if (qPct <= 60) {
                    // 31% to 60% marks: ENTIRE BOX IS LIGHT (soft pastel amber/yellow)
                    tdClass = 'td-score-light';
                    symbol = '!';
                } else {
                    // > 60% marks: ENTIRE BOX IS WHITE
                    tdClass = 'td-score-white';
                    symbol = '✓';
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
                    <td class="matrix-cell ${tdClass}" onclick="window.openMatrixDrawerByKey('${payloadKey}')" title="Click to view details: ${score}/${max} (${qPct.toFixed(0)}%)">
                        <div class="matrix-cell-content">
                            <span class="cell-symbol">${symbol}</span>
                            <span class="cell-score">${score}/${max}</span>
                        </div>
                    </td>
                `;
            } else {
                rowCells += `
                    <td class="matrix-cell td-score-empty">
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

        const topicCellHtml = topicName && topicName !== '-'
            ? `<td class="td-topic" title="${escapeHtml(topicName)}"><span class="matrix-topic-pill">${escapeHtml(topicName)}</span></td>`
            : `<td class="td-topic" style="text-align: center; color: #94a3b8; font-weight: normal;">-</td>`;

        tbodyHtml += `
            <tr>
                <td class="td-question">
                    <span style="font-weight: 800; color: #1e293b;">${escapeHtml(qNum)}</span>
                    <span style="background: #f1f5f9; color: #475569; padding: 2px 5px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; margin-left: 4px;">${maxM}M</span>
                </td>
                ${topicCellHtml}
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
            <td class="td-topic" style="font-weight: 700; color: #64748b; font-size: 0.8rem;">All Topics</td>
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

    // Render Topic Mastery & Weakness Analysis
    renderTopicAnalysis(activeSession, questionIndex, sortedQuestions);
}

/**
 * Trigger AI Topic Analysis for a Test Session
 */
export async function triggerTopicAnalysisForSession(sessionId) {
    const session = matrixState.sessions.find(s => s.id === sessionId);
    if (!session) return;

    const btn = document.getElementById('btnTriggerTopicAnalysis');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>⏳</span> Analyzing curriculum topics with AI...`;
    }

    try {
        const res = await fetch('/api/analyze-topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: session.id,
                questions: session.questions || '',
                markingScheme: session.markingScheme || '',
                subject: session.subject || 'General',
                classLevel: session.class || 'Class 12th'
            })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Failed with status ${res.status}`);
        }

        const data = await res.json();
        const analysis = data.analysis;

        // Save to Firestore if available
        if (matrixState.db && matrixState.firestoreUtils) {
            const { updateDoc, doc } = matrixState.firestoreUtils;
            await updateDoc(doc(matrixState.db, 'testSessions', session.id), {
                topicMap: analysis.topicMap,
                chaptersCovered: analysis.chaptersCovered || [],
                curriculumSummary: analysis.curriculumSummary || ''
            });
        }

        // Update in-memory session object
        session.topicMap = analysis.topicMap;
        session.chaptersCovered = analysis.chaptersCovered || [];
        session.curriculumSummary = analysis.curriculumSummary || '';

        // Re-render
        renderTopicAnalysis(session, matrixState.questionIndex, matrixState.activeQuestions);
    } catch (err) {
        console.error('Topic analysis error:', err);
        alert(`Topic Analysis Notice: ${err.message}`);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}
if (typeof window !== 'undefined') {
    window.triggerTopicAnalysisForSession = triggerTopicAnalysisForSession;
}

/**
 * Render CBSE Topic Mastery & Class Weakness Analysis Section
 */
function formatCurriculumSummary(summary) {
    if (!summary) return '';
    let text = escapeHtml(summary);
    // Bold quoted chapter names
    text = text.replace(/'([^']+)'/g, '<strong style="color: #1e293b; background: #e0e7ff; padding: 1px 6px; border-radius: 4px; font-weight: 700;">$1</strong>');
    // Highlight marks breakdown
    text = text.replace(/\((\d+)\s*marks?\)/gi, '<span style="font-weight: 700; color: #4338ca; background: #ede9fe; padding: 1px 6px; border-radius: 4px; font-size: 0.8rem;">$1 Marks</span>');
    return text;
}

function renderTopicAnalysis(activeSession, questionIndex, sortedQuestions) {
    const container = document.getElementById('matrixTopicAnalysisSection');
    if (!container) return;
    try {

    if (!activeSession || activeSession.id === 'all') {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.style.display = 'block';

    // 1. If topicMap does NOT exist for this session:
    if (!activeSession.topicMap || Object.keys(activeSession.topicMap).length === 0) {
        container.innerHTML = `
            <div style="background: linear-gradient(135deg, #f8fafc 0%, #edf2f7 100%); border: 1px solid #cbd5e1; border-radius: 12px; padding: 1.25rem 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div>
                    <div style="font-weight: 800; color: #1e3c72; font-size: 1.05rem; display: flex; align-items: center; gap: 0.5rem;">
                        <span>🧠</span> CBSE Topic Mastery & Weakness Analysis
                    </div>
                    <p style="color: #64748b; font-size: 0.85rem; margin: 0.35rem 0 0 0;">
                        Extract NCERT syllabus topics, detect class-wide weak areas, and evaluate student misconceptions with AI.
                    </p>
                </div>
                <button id="btnTriggerTopicAnalysis" onclick="window.triggerTopicAnalysisForSession('${activeSession.id}')" style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: white; border: none; padding: 0.65rem 1.25rem; border-radius: 8px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 0.45rem; font-size: 0.85rem; box-shadow: 0 4px 6px rgba(79, 70, 229, 0.25); transition: all 0.2s ease;">
                    <span>⚡</span> Analyze Curriculum Topics with AI
                </button>
            </div>
        `;
        return;
    }

    // 2. If topicMap DOES exist: calculate question-specific topic mastery
    // Each question is rendered as an INDEPENDENT card categorized strictly by its own
    // un-averaged accuracy percentage (eliminating score-averaging across different questions).
    const topicMap = activeSession.topicMap;
    const questionItems = [];

    sortedQuestions.forEach(qNum => {
        const qRec = questionIndex.get(qNum);
        if (!qRec) return;

        let tInfo = topicMap[qNum] || topicMap[qNum.toUpperCase()] || topicMap[qNum.toLowerCase()];
        if (!tInfo) {
            const digits = qNum.match(/\d+/)?.[0];
            if (digits) {
                tInfo = topicMap[`Q${digits}`] || topicMap[digits] || topicMap[`Question ${digits}`];
            }
        }
        if (!tInfo) {
            const baseQ = qNum.match(/^Q\d+/)?.[0];
            tInfo = baseQ ? (topicMap[baseQ] || topicMap[baseQ.toLowerCase()] || topicMap[baseQ.toUpperCase()]) : null;
        }
        if (!tInfo) {
            // Fuzzy search any key containing the question number
            const digits = qNum.match(/\d+/)?.[0];
            if (digits) {
                const foundK = Object.keys(topicMap).find(k => k.match(new RegExp(`(^|\\D)${digits}(\\D|$)`)));
                if (foundK) tInfo = topicMap[foundK];
            }
        }
        if (!tInfo) {
            tInfo = { chapter: activeSession.subject || 'Syllabus', topic: `Question ${qNum}`, subtopic: '' };
        }

        let qEarned = 0;
        let qPossible = 0;
        let responsesCount = 0;
        qRec.responses.forEach(r => {
            qEarned += r.score;
            qPossible += r.maxMarks;
            responsesCount++;
        });

        const accuracy = qPossible > 0 ? Math.round((qEarned / qPossible) * 100) : 0;

        questionItems.push({
            qNum,
            maxMarks: qRec.maxMarks,
            chapter: tInfo.chapter || activeSession.subject || 'Syllabus',
            topic: tInfo.topic || 'General Topic',
            subtopic: tInfo.subtopic || '',
            accuracy,
            earned: qEarned,
            possible: qPossible,
            responsesCount
        });
    });

    const criticalWeak = questionItems.filter(q => q.accuracy < 60).sort((a, b) => a.accuracy - b.accuracy);
    const developing = questionItems.filter(q => q.accuracy >= 60 && q.accuracy <= 90).sort((a, b) => a.accuracy - b.accuracy);
    const mastered = questionItems.filter(q => q.accuracy > 90).sort((a, b) => b.accuracy - a.accuracy);

    let html = `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.5rem 1.6rem; box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05); margin-bottom: 1.5rem;">
            <!-- Header Bar -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
                <div>
                    <div style="font-weight: 800; color: #0f172a; font-size: 1.25rem; display: flex; align-items: center; gap: 0.6rem; letter-spacing: -0.3px;">
                        <span style="font-size: 1.4rem;">🧠</span> CBSE Topic Mastery &amp; Class Weakness Analysis
                        <span style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; padding: 3px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; box-shadow: 0 2px 6px rgba(99, 102, 241, 0.35); display: inline-flex; align-items: center; gap: 4px;">✨ Gemini 4 AI Diagnosed</span>
                    </div>
                    <div style="color: #64748b; font-size: 0.82rem; margin-top: 0.25rem; font-weight: 500;">
                        Curriculum topic extraction and class-wide misconception audit powered by Google Vertex AI deep reasoning.
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                    <button id="btnToggleTopicCollapse" onclick="window.toggleTopicAnalysisCollapse()" style="background: #f8fafc; color: #475569; border: 1.5px solid #e2e8f0; padding: 0.45rem 0.95rem; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.8rem; display: flex; align-items: center; gap: 0.4rem; transition: all 0.2s ease;">
                        <span id="topicCollapseIcon">▲</span> <span id="topicCollapseText">Collapse View</span>
                    </button>
                    <button id="btnTriggerTopicAnalysis" onclick="window.triggerTopicAnalysisForSession('${activeSession.id}')" style="background: #eff6ff; color: #1d4ed8; border: 1.5px solid #bfdbfe; padding: 0.45rem 0.95rem; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.8rem; display: flex; align-items: center; gap: 0.4rem; transition: all 0.2s ease;">
                        <span>🔄</span> Re-Analyze Topics
                    </button>
                </div>
            </div>

            <!-- Curriculum Blueprint & Scope Callout -->
            ${activeSession.curriculumSummary ? `
                <div style="background: linear-gradient(135deg, #f8faff 0%, #f1f5f9 100%); border: 1px solid #e0e7ff; border-left: 4px solid #4f46e5; border-radius: 10px; padding: 1rem 1.25rem; margin: 1.15rem 0 1.35rem 0; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                    <div style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #4338ca; display: flex; align-items: center; gap: 6px; margin-bottom: 0.35rem;">
                        <span>📋</span> Curriculum Blueprint &amp; Chapter Weightage
                    </div>
                    <div style="color: #334155; font-size: 0.88rem; line-height: 1.65;">
                        ${formatCurriculumSummary(activeSession.curriculumSummary)}
                    </div>
                </div>
            ` : ''}

            <!-- Topic Performance Grid -->
            <div id="topicAnalysisGrid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem;">
                
                <!-- 🔴 Critical Weakness Column -->
                <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: 12px; padding: 1.15rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; padding-bottom: 0.5rem; border-bottom: 1px solid #fee2e2;">
                        <span style="font-weight: 800; color: #991b1b; font-size: 0.92rem; display: flex; align-items: center; gap: 0.35rem;">
                            <span>🔴</span> Critical Weaknesses (&lt; 60%)
                        </span>
                        <span style="background: #fee2e2; color: #991b1b; padding: 2px 9px; border-radius: 12px; font-size: 0.75rem; font-weight: 800;">${criticalWeak.length} Questions</span>
                    </div>
                    ${criticalWeak.length === 0
            ? `<div style="font-size: 0.82rem; color: #64748b; font-style: italic; padding: 1rem; text-align: center;">🎉 No critical question weaknesses (&lt; 60%) detected across class!</div>`
            : criticalWeak.map(q => `
                            <div style="background: white; border: 1px solid #fee2e2; border-radius: 10px; padding: 0.85rem; margin-bottom: 0.65rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03); transition: transform 0.15s ease;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform='none'">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                                    <div>
                                        <span style="background: #ef4444; color: white; padding: 2px 7px; border-radius: 4px; font-weight: 800; font-size: 0.75rem; margin-right: 0.35rem; display: inline-block;">
                                            ${escapeHtml(q.qNum)}
                                        </span>
                                        <span style="font-weight: 700; color: #1e293b; font-size: 0.88rem;">
                                            ${escapeHtml(q.topic)}
                                        </span>
                                    </div>
                                    <span style="background: #fee2e2; color: #991b1b; font-weight: 800; font-size: 0.78rem; padding: 2px 7px; border-radius: 6px; flex-shrink: 0;">${q.accuracy}%</span>
                                </div>
                                <div style="font-size: 0.76rem; color: #64748b; margin-top: 0.35rem;">${escapeHtml(q.chapter)} ${q.subtopic ? `· ${escapeHtml(q.subtopic)}` : ''}</div>
                                
                                <!-- Progress Bar -->
                                <div style="background: #f1f5f9; border-radius: 9999px; height: 5px; width: 100%; margin: 0.5rem 0 0.35rem 0; overflow: hidden;">
                                    <div style="background: #ef4444; height: 100%; width: ${q.accuracy}%; border-radius: 9999px;"></div>
                                </div>

                                <div style="margin-top: 0.35rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #94a3b8;">
                                    <span>Weight: <strong style="color: #475569;">${q.maxMarks}M</strong></span>
                                    <span>Class Avg: <strong style="color: #475569;">${q.earned}/${q.possible} pts</strong></span>
                                </div>
                            </div>
                        `).join('')}
                </div>

                <!-- 🟡 Developing Column -->
                <div style="background: #fffbeb; border: 1.5px solid #fde68a; border-radius: 12px; padding: 1.15rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; padding-bottom: 0.5rem; border-bottom: 1px solid #fef3c7;">
                        <span style="font-weight: 800; color: #92400e; font-size: 0.92rem; display: flex; align-items: center; gap: 0.35rem;">
                            <span>🟡</span> Need Improvement (60% – 90%)
                        </span>
                        <span style="background: #fef3c7; color: #92400e; padding: 2px 9px; border-radius: 12px; font-size: 0.75rem; font-weight: 800;">${developing.length} Questions</span>
                    </div>
                    ${developing.length === 0
            ? `<div style="font-size: 0.82rem; color: #64748b; font-style: italic; padding: 1rem; text-align: center;">No questions in 60% – 90% range.</div>`
            : developing.map(q => `
                            <div style="background: white; border: 1px solid #fef3c7; border-radius: 10px; padding: 0.85rem; margin-bottom: 0.65rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03); transition: transform 0.15s ease;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform='none'">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                                    <div>
                                        <span style="background: #f59e0b; color: white; padding: 2px 7px; border-radius: 4px; font-weight: 800; font-size: 0.75rem; margin-right: 0.35rem; display: inline-block;">
                                            ${escapeHtml(q.qNum)}
                                        </span>
                                        <span style="font-weight: 700; color: #1e293b; font-size: 0.88rem;">
                                            ${escapeHtml(q.topic)}
                                        </span>
                                    </div>
                                    <span style="background: #fef3c7; color: #92400e; font-weight: 800; font-size: 0.78rem; padding: 2px 7px; border-radius: 6px; flex-shrink: 0;">${q.accuracy}%</span>
                                </div>
                                <div style="font-size: 0.76rem; color: #64748b; margin-top: 0.35rem;">${escapeHtml(q.chapter)} ${q.subtopic ? `· ${escapeHtml(q.subtopic)}` : ''}</div>
                                
                                <!-- Progress Bar -->
                                <div style="background: #f1f5f9; border-radius: 9999px; height: 5px; width: 100%; margin: 0.5rem 0 0.35rem 0; overflow: hidden;">
                                    <div style="background: #f59e0b; height: 100%; width: ${q.accuracy}%; border-radius: 9999px;"></div>
                                </div>

                                <div style="margin-top: 0.35rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #94a3b8;">
                                    <span>Weight: <strong style="color: #475569;">${q.maxMarks}M</strong></span>
                                    <span>Class Avg: <strong style="color: #475569;">${q.earned}/${q.possible} pts</strong></span>
                                </div>
                            </div>
                        `).join('')}
                </div>

                <!-- 🟢 Mastered Column -->
                <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 12px; padding: 1.15rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; padding-bottom: 0.5rem; border-bottom: 1px solid #dcfce7;">
                        <span style="font-weight: 800; color: #166534; font-size: 0.92rem; display: flex; align-items: center; gap: 0.35rem;">
                            <span>🟢</span> Strong Questions (&gt; 90%)
                        </span>
                        <span style="background: #dcfce7; color: #166534; padding: 2px 9px; border-radius: 12px; font-size: 0.75rem; font-weight: 800;">${mastered.length} Questions</span>
                    </div>
                    ${mastered.length === 0
            ? `<div style="font-size: 0.82rem; color: #64748b; font-style: italic; padding: 1rem; text-align: center;">No questions currently above 90%.</div>`
            : mastered.map(q => `
                            <div style="background: white; border: 1px solid #dcfce7; border-radius: 10px; padding: 0.85rem; margin-bottom: 0.65rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03); transition: transform 0.15s ease;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform='none'">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                                    <div>
                                        <span style="background: #10b981; color: white; padding: 2px 7px; border-radius: 4px; font-weight: 800; font-size: 0.75rem; margin-right: 0.35rem; display: inline-block;">
                                            ${escapeHtml(q.qNum)}
                                        </span>
                                        <span style="font-weight: 700; color: #1e293b; font-size: 0.88rem;">
                                            ${escapeHtml(q.topic)}
                                        </span>
                                    </div>
                                    <span style="background: #dcfce7; color: #166534; font-weight: 800; font-size: 0.78rem; padding: 2px 7px; border-radius: 6px; flex-shrink: 0;">${q.accuracy}%</span>
                                </div>
                                <div style="font-size: 0.76rem; color: #64748b; margin-top: 0.35rem;">${escapeHtml(q.chapter)} ${q.subtopic ? `· ${escapeHtml(q.subtopic)}` : ''}</div>
                                
                                <!-- Progress Bar -->
                                <div style="background: #f1f5f9; border-radius: 9999px; height: 5px; width: 100%; margin: 0.5rem 0 0.35rem 0; overflow: hidden;">
                                    <div style="background: #10b981; height: 100%; width: ${q.accuracy}%; border-radius: 9999px;"></div>
                                </div>

                                <div style="margin-top: 0.35rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #94a3b8;">
                                    <span>Weight: <strong style="color: #475569;">${q.maxMarks}M</strong></span>
                                    <span>Class Avg: <strong style="color: #475569;">${q.earned}/${q.possible} pts</strong></span>
                                </div>
                            </div>
                        `).join('')}
                </div>

            </div>
        </div>
    `;

    container.innerHTML = html;
    } catch (err) {
        console.error("renderTopicAnalysis error:", err);
        container.style.display = "block";
        container.innerHTML = `<div style=\"background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 1rem; border-radius: 8px; font-size: 0.85rem;\">Notice: Unable to render AI topic analytics: ${escapeHtml(err.message)}</div>`;
    }
}

if (typeof window !== 'undefined') {
    window.toggleTopicAnalysisCollapse = function() {
        const grid = document.getElementById('topicAnalysisGrid');
        const icon = document.getElementById('topicCollapseIcon');
        const txt = document.getElementById('topicCollapseText');
        if (!grid) return;
        const isHidden = grid.style.display === 'none';
        grid.style.display = isHidden ? 'grid' : 'none';
        if (icon) icon.textContent = isHidden ? '▲' : '▼';
        if (txt) txt.textContent = isHidden ? 'Collapse View' : 'Expand View';
    };
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
    window.openMatrixDrawerByKey = function (key) {
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

    const sessionVal = document.getElementById('matrixSessionFilter')?.value || 'all';
    const activeSession = matrixState.sessions.find(s => s.id === sessionVal);

    let csv = '';

    // CSV Header Row: Question Number, Topic, Student 1, Student 2, ..., Class Average (%)
    const headers = ['Question Number', 'Topic'];
    students.forEach(st => {
        headers.push(`"${st.studentName.replace(/"/g, '""')} (${st.batch || 'Both'})"`);
    });
    headers.push('Class Average (%)');
    csv += headers.join(',') + '\n';

    // CSV Question Rows
    questions.forEach(qNum => {
        const qRec = qIndex.get(qNum);
        const topicName = resolveQuestionTopic(qNum, qRec, activeSession, matrixState.sessions);
        const row = [
            `"${qNum} (${qRec.maxMarks} Marks)"`,
            `"${topicName.replace(/"/g, '""')}"`
        ];
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
    const totalRow = ['"TOTAL SCORE"', '"All Topics"'];
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
