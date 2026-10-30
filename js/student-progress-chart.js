// ============================================
// STUDENT PROGRESS CHART MODULE (V2 - Subject & Multi-Exam Comparison)
// Sleek, Longitudinal Performance Engine across Exams of the Same Subject
// Pure Data Visualization (Editing Removed) with Dynamic Subject & Exam Filters
// ============================================

let cachedResults = [];
let activeStudent = null;
let activeSubject = "ALL";
let deselectedExamIds = new Set();
let mode = "pct"; // "pct" or "marks"
const H = 320;
let tip = null;

const SUBJECT_THEMES = {
    "Economics": { color: "#4f46e5", bg: "#eef2ff", border: "#c7d2fe", icon: "📘", barBg: "linear-gradient(180deg, #6366f1 0%, #4f46e5 100%)" },
    "Business Studies": { color: "#d97706", bg: "#fffbeb", border: "#fde68a", icon: "📙", barBg: "linear-gradient(180deg, #f59e0b 0%, #d97706 100%)" },
    "Accountancy": { color: "#0284c7", bg: "#f0f9ff", border: "#bae6fd", icon: "📊", barBg: "linear-gradient(180deg, #38bdf8 0%, #0284c7 100%)" },
    "Social Science": { color: "#059669", bg: "#ecfdf5", border: "#a7f3d0", icon: "🌍", barBg: "linear-gradient(180deg, #10b981 0%, #059669 100%)" },
    "English": { color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe", icon: "📝", barBg: "linear-gradient(180deg, #8b5cf6 0%, #7c3aed 100%)" },
    "Mathematics": { color: "#e11d48", bg: "#fff1f2", border: "#fecdd3", icon: "📐", barBg: "linear-gradient(180deg, #f43f5e 0%, #e11d48 100%)" },
    "default": { color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", icon: "📑", barBg: "linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)" }
};

function getTheme(subject) {
    if (!subject) return SUBJECT_THEMES.default;
    for (const key of Object.keys(SUBJECT_THEMES)) {
        if (subject.toLowerCase().includes(key.toLowerCase())) {
            return SUBJECT_THEMES[key];
        }
    }
    return SUBJECT_THEMES.default;
}

/**
 * Strips raw timestamp IDs and prefixes to produce clean, humanized examination names
 */
function formatExamName(raw) {
    if (!raw) return 'Exam';
    // Remove trailing timestamp suffixes like _1793101570263 or -1793101570263
    let cleaned = raw.replace(/[_-]\d{10,}\b/g, '');
    // Replace underscores with spaces
    cleaned = cleaned.replace(/_/g, ' ');
    // Remove leading "NerdTutors" prefix if present
    cleaned = cleaned.replace(/^NerdTutors\s*[-:]?\s*/i, '');
    // Collapse extra spaces
    cleaned = cleaned.trim().replace(/\s+/g, ' ');
    return cleaned || raw;
}

function showTip(ev, html) {
    if (!tip) {
        tip = document.getElementById("progressTip");
        if (!tip) {
            tip = document.createElement("div");
            tip.className = "progress-tip";
            tip.id = "progressTip";
            document.body.appendChild(tip);
        }
    }
    tip.innerHTML = html;
    tip.style.opacity = '1';
    let x = ev.clientX + 14, y = ev.clientY - 62;
    if (x + tip.offsetWidth > window.innerWidth - 8) x = ev.clientX - tip.offsetWidth - 14;
    if (y < 8) y = ev.clientY + 16;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
}

function hideTip() {
    if (tip) tip.style.opacity = '0';
}

/**
 * Draws crisp SVG trendline with smooth gradient, glowing milestone nodes,
 * and an arrowhead accurately pointing between the tops of consecutive bars.
 */
function drawTrend(plot) {
    const old = plot.querySelector("svg.progress-trend");
    if (old) old.remove();

    const cols = Array.from(plot.querySelectorAll(".col"));
    if (cols.length === 0) return;

    const plotRect = plot.getBoundingClientRect();
    const pts = [];

    cols.forEach(col => {
        const stack = col.querySelector(".stack");
        if (!stack) return;
        const colRect = col.getBoundingClientRect();
        const stackRect = stack.getBoundingClientRect();
        const x = (colRect.left + colRect.width / 2) - plotRect.left;
        const y = stackRect.top - plotRect.top;
        pts.push({ x: Math.round(x), y: Math.round(y) });
    });

    if (pts.length === 0) return;

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "progress-trend");
    svg.setAttribute("style", "position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 5;");

    // Defs for arrowhead & gradient
    const defs = document.createElementNS(ns, "defs");
    defs.innerHTML = `
        <marker id="trendArrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#3b82f6" />
        </marker>
        <linearGradient id="trendGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#6366f1" />
            <stop offset="100%" stop-color="#3b82f6" />
        </linearGradient>
    `;
    svg.appendChild(defs);

    // Draw connecting line if 2 or more exams
    if (pts.length >= 2) {
        const line = document.createElementNS(ns, "polyline");
        line.setAttribute("points", pts.map(p => `${p.x},${p.y}`).join(" "));
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", "url(#trendGradient)");
        line.setAttribute("stroke-width", "2.5");
        line.setAttribute("stroke-dasharray", "6 4");
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("marker-end", "url(#trendArrow)");
        svg.appendChild(line);
    }

    // Draw glowing milestone circles on the top of each bar
    pts.forEach(p => {
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", p.x);
        circle.setAttribute("cy", p.y);
        circle.setAttribute("r", "5");
        circle.setAttribute("fill", "#ffffff");
        circle.setAttribute("stroke", "#3b82f6");
        circle.setAttribute("stroke-width", "2.5");
        circle.setAttribute("style", "filter: drop-shadow(0 2px 4px rgba(59, 130, 246, 0.4));");
        svg.appendChild(circle);
    });

    plot.appendChild(svg);
}

/**
 * Extracts and prepares all valid exam attempts for the student
 */
function getStudentExams(studentName) {
    if (!cachedResults || cachedResults.length === 0 || !studentName) return [];

    const studentRecords = cachedResults.filter(r =>
        r.studentName && r.studentName.trim().toLowerCase() === studentName.trim().toLowerCase()
    );

    if (studentRecords.length === 0) return [];

    // Map each test result into a normalized exam record
    const list = studentRecords.map((r, idx) => {
        const rawName = r.sessionName || r.testType || r.subject || `Test ${idx + 1}`;
        const score = Number(r.score) || 0;
        const maxMarks = Number(r.maxMarks) || 40;
        const pct = maxMarks > 0 ? (score / maxMarks) * 100 : 0;

        let dateStr = '';
        let time = 0;
        if (r.submittedAt) {
            const dt = r.submittedAt.toDate ? r.submittedAt.toDate() : new Date(r.submittedAt);
            dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            time = dt.getTime();
        } else if (r.createdAt) {
            const dt = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
            dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            time = dt.getTime();
        }

        const id = r.id || r.sessionId || `${rawName}_${time}_${idx}`;
        return {
            id,
            rawName,
            name: formatExamName(rawName),
            subject: r.subject || 'General',
            score: Math.round(score * 10) / 10,
            maxMarks: Math.round(maxMarks * 10) / 10,
            pct: Math.round(pct * 10) / 10,
            date: dateStr,
            time: time || idx
        };
    });

    // Sort chronologically (oldest to newest)
    return list.sort((a, b) => a.time - b.time);
}

/**
 * Main Render Engine
 */
function render() {
    const titleEl = document.getElementById("progressChartTitle");
    if (titleEl) {
        titleEl.textContent = activeStudent ? `${activeStudent}’s Multi-Exam Progress` : "Student Multi-Exam Progress";
    }

    const allStudentExams = getStudentExams(activeStudent);
    if (allStudentExams.length === 0) {
        renderEmptyState("No evaluation records found for this student.");
        return;
    }

    // 1. Gather all unique subjects for this student and their counts
    const subjectCounts = {};
    allStudentExams.forEach(e => {
        subjectCounts[e.subject] = (subjectCounts[e.subject] || 0) + 1;
    });
    const availableSubjects = Object.keys(subjectCounts);

    // If active subject not in student's subjects, fallback to ALL
    if (activeSubject !== "ALL" && !availableSubjects.includes(activeSubject)) {
        activeSubject = "ALL";
    }

    // 2. Render Subject Filter Tabs
    renderSubjectTabs(availableSubjects, subjectCounts, allStudentExams.length);

    // 3. Filter exams by subject
    const subjectExams = activeSubject === "ALL"
        ? allStudentExams
        : allStudentExams.filter(e => e.subject === activeSubject);

    // 4. Render Exam Comparison Filter Chips
    renderExamChips(subjectExams);

    // 5. Filter out deselected exams
    const displayedExams = subjectExams.filter(e => !deselectedExamIds.has(e.id));

    // 6. Render KPI Summary Strip
    renderKpiStrip(displayedExams);

    // 7. Update Legend
    const legendEl = document.getElementById("progressLegend");
    if (legendEl) {
        const subjectsInView = [...new Set(displayedExams.map(e => e.subject))];
        legendEl.innerHTML = subjectsInView.map(sub => {
            const theme = getTheme(sub);
            return `<span><i style="background:${theme.color}"></i>${sub}</span>`;
        }).join("");
    }

    // 8. Render the Plot Bars & Grid
    renderPlot(displayedExams);
}

function renderEmptyState(message) {
    const plot = document.getElementById("progressPlot");
    if (plot) {
        plot.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #94a3b8; font-size: 0.95rem; text-align: center;">
                <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📊</div>
                <div style="font-weight: 700; color: #475569;">${message}</div>
                <div style="font-size: 0.82rem; margin-top: 4px;">Select another student or subject to view progress.</div>
            </div>
        `;
    }
    const kpiStrip = document.getElementById("progressKpiStrip");
    if (kpiStrip) kpiStrip.innerHTML = '';
    const chipsContainer = document.getElementById("progressExamChips");
    if (chipsContainer) chipsContainer.innerHTML = '';
}

/**
 * Render sleek subject filter pills
 */
function renderSubjectTabs(subjectsList, counts, totalCount) {
    const container = document.getElementById("progressSubjectTabs");
    if (!container) return;

    let html = `
        <button type="button" class="progress-subject-pill ${activeSubject === 'ALL' ? 'active' : ''}" data-subject="ALL">
            <span>📚 All Subjects</span>
            <span class="pill-count">${totalCount}</span>
        </button>
    `;

    subjectsList.forEach(sub => {
        const theme = getTheme(sub);
        const isActive = activeSubject === sub;
        html += `
            <button type="button" class="progress-subject-pill ${isActive ? 'active' : ''}" data-subject="${sub}">
                <span>${theme.icon} ${sub}</span>
                <span class="pill-count">${counts[sub] || 0}</span>
            </button>
        `;
    });

    container.innerHTML = html;

    container.querySelectorAll(".progress-subject-pill").forEach(btn => {
        btn.onclick = function () {
            activeSubject = this.dataset.subject;
            deselectedExamIds.clear(); // Reset exam selection on subject switch
            render();
        };
    });
}

/**
 * Render clickable multi-exam filter chips
 */
function renderExamChips(examsList) {
    const container = document.getElementById("progressExamChips");
    const wrap = document.getElementById("progressExamSelectorWrap");
    if (!container || !wrap) return;

    if (examsList.length <= 1) {
        wrap.style.display = 'none';
        return;
    }
    wrap.style.display = 'flex';

    container.innerHTML = examsList.map(e => {
        const isSelected = !deselectedExamIds.has(e.id);
        return `
            <button type="button" class="progress-exam-chip ${isSelected ? 'selected' : ''}" data-id="${e.id}">
                <span class="check-icon">${isSelected ? '✓' : '+'}</span>
                <span>${e.name}</span>
            </button>
        `;
    }).join('');

    container.querySelectorAll(".progress-exam-chip").forEach(chip => {
        chip.onclick = function () {
            const id = this.dataset.id;
            if (deselectedExamIds.has(id)) {
                deselectedExamIds.delete(id);
            } else {
                // Ensure at least 1 exam stays selected
                if (examsList.length - deselectedExamIds.size > 1) {
                    deselectedExamIds.add(id);
                }
            }
            render();
        };
    });
}

/**
 * Render Top KPI summary metrics
 */
function renderKpiStrip(examsList) {
    const strip = document.getElementById("progressKpiStrip");
    if (!strip) return;

    if (examsList.length === 0) {
        strip.innerHTML = '';
        return;
    }

    const count = examsList.length;
    const avgPct = Math.round(examsList.reduce((acc, x) => acc + x.pct, 0) / count * 10) / 10;
    const peakPct = Math.max(...examsList.map(x => x.pct));

    let deltaHtml = '';
    if (count >= 2) {
        const delta = Math.round((examsList[count - 1].pct - examsList[0].pct) * 10) / 10;
        const isUp = delta >= 0;
        deltaHtml = `
            <div class="progress-kpi-badge ${isUp ? 'positive' : 'negative'}">
                <span>Trajectory:</span>
                <strong>${isUp ? '▲ +' : '▼ '}${delta}%</strong>
            </div>
        `;
    }

    strip.innerHTML = `
        <div class="progress-kpi-badge">
            <span>Tests:</span>
            <strong>${count}</strong>
        </div>
        <div class="progress-kpi-badge">
            <span>Average:</span>
            <strong>${avgPct}%</strong>
        </div>
        <div class="progress-kpi-badge">
            <span>Peak:</span>
            <strong>${peakPct}%</strong>
        </div>
        ${deltaHtml}
    `;
}

/**
 * Renders the main column bars and Y-axis grid
 */
function renderPlot(examsList) {
    const plot = document.getElementById("progressPlot");
    if (!plot) return;
    plot.innerHTML = "";

    if (examsList.length === 0) {
        renderEmptyState("All examinations for this subject are deselected.");
        return;
    }

    // Determine Y-axis max scale
    const maxVal = mode === "pct" ? 100 : Math.max(...examsList.map(x => x.maxMarks), 1);
    const step = 25;

    // Gridlines
    [0, 25, 50, 75, 100].forEach(p => {
        const g = document.createElement("div");
        g.className = "grid";
        g.style.top = `${26 + H - (p / 100) * H}px`;
        const label = mode === "pct" ? `${p}%` : Math.round((maxVal * p) / 100);
        g.innerHTML = `<span>${label}</span>`;
        plot.appendChild(g);
    });

    // Column container
    const cols = document.createElement("div");
    cols.className = "cols";
    plot.appendChild(cols);

    let prevPct = null;

    examsList.forEach((e, i) => {
        const col = document.createElement("div");
        col.className = "col";

        // Score Delta from previous test
        let deltaHtml = '';
        if (prevPct !== null) {
            const df = Math.round((e.pct - prevPct) * 10) / 10;
            const isUp = df >= 0;
            deltaHtml = `<div class="delta ${isUp ? 'up' : 'down'}">${isUp ? '▲ +' : '▼ '}${df}%</div>`;
        } else if (examsList.length > 1) {
            deltaHtml = `<div class="delta" style="color:#64748b; font-weight:700;">Base</div>`;
        }

        // Header above bar
        const tot = document.createElement("div");
        tot.className = "tot";
        const mainScore = mode === "pct" ? `${e.pct}%` : `${e.score}/${e.maxMarks}`;
        tot.innerHTML = `<div>${mainScore}</div>${deltaHtml}`;

        // The Bar
        const theme = getTheme(e.subject);
        const val = mode === "pct" ? e.pct : e.score;
        const barHeight = Math.max((val / maxVal) * (H - 36), 4);

        const st = document.createElement("div");
        st.className = "stack";
        st.style.height = `${barHeight}px`;
        st.style.background = theme.barBg;
        st.style.borderRadius = "8px 8px 0 0";
        st.style.boxShadow = `0 4px 14px ${theme.color}33`;
        st.style.cursor = "pointer";
        st.style.transition = "height 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s ease";

        // Hover Tooltip
        const tipHtml = `
            <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8; margin-bottom: 2px;">
                ${theme.icon} ${e.subject}
            </div>
            <strong style="font-size: 0.95rem; color: #ffffff;">${e.name}</strong>
            <div style="margin-top: 6px; font-size: 0.85rem; color: #38bdf8; font-weight: 700;">
                Score: ${e.score} / ${e.maxMarks} (${e.pct}%)
            </div>
            ${e.date ? `<div style="font-size: 0.74rem; opacity: 0.7; margin-top: 2px;">Date: ${e.date}</div>` : ''}
        `;
        st.addEventListener("pointerenter", ev => {
            st.style.transform = "scaleX(1.05) translateY(-3px)";
            showTip(ev, tipHtml);
        });
        st.addEventListener("pointermove", ev => showTip(ev, tipHtml));
        st.addEventListener("pointerleave", () => {
            st.style.transform = "none";
            hideTip();
        });

        // Bottom label
        const lbl = document.createElement("div");
        lbl.className = "lbl";
        lbl.style.maxWidth = "160px";
        lbl.style.whiteSpace = "normal";
        lbl.style.wordBreak = "break-word";
        lbl.innerHTML = `
            <strong style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.25;" title="${e.rawName}">
                ${e.name}
            </strong>
            <small>out of ${e.maxMarks}${e.date ? ' · ' + e.date : ''}</small>
        `;

        col.appendChild(tot);
        col.appendChild(st);
        col.appendChild(lbl);
        cols.appendChild(col);

        prevPct = e.pct;
    });

    // Draw the trendline after browser finishes DOM layout pass
    requestAnimationFrame(() => {
        drawTrend(plot);
    });
}

/**
 * Public Data Ingestion Function
 */
export function loadRealDataIntoProgressChart(testResults, targetStudent = null) {
    if (testResults && Array.isArray(testResults)) {
        cachedResults = testResults;
    }

    if (!cachedResults || cachedResults.length === 0) {
        render();
        return;
    }

    // Extract all unique real student names
    const availableStudents = [...new Set(cachedResults.map(r => r.studentName).filter(Boolean))].sort();
    const selectEl = document.getElementById("progressStudentSelect");

    if (selectEl && availableStudents.length > 0) {
        const currentVal = targetStudent || selectEl.value;
        selectEl.innerHTML = availableStudents.map(s =>
            `<option value="${s}" ${s === currentVal ? 'selected' : ''}>${s}</option>`
        ).join('');
    }

    activeStudent = targetStudent || (selectEl ? selectEl.value : null) || availableStudents[0];
    if (selectEl && activeStudent) selectEl.value = activeStudent;

    render();
}

/**
 * Module Initialization
 */
export function initStudentProgressChart(initialResults = null) {
    const wrap = document.getElementById('studentProgressChartSection');
    if (!wrap) return;

    if (initialResults && Array.isArray(initialResults)) {
        cachedResults = initialResults;
    }

    tip = document.getElementById("progressTip");
    if (!tip) {
        tip = document.createElement("div");
        tip.className = "progress-tip";
        tip.id = "progressTip";
        document.body.appendChild(tip);
    }

    // Student Select change handler
    const sSelect = document.getElementById("progressStudentSelect");
    if (sSelect) {
        sSelect.onchange = function () {
            activeStudent = this.value;
            activeSubject = "ALL";
            deselectedExamIds.clear();
            render();
        };
    }

    // Percentage / Marks toggle buttons
    const bPct = document.getElementById("progressBtnPct");
    const bMarks = document.getElementById("progressBtnMarks");
    if (bPct && bMarks) {
        bPct.onclick = function () {
            mode = "pct";
            this.className = "on";
            bMarks.className = "";
            render();
        };
        bMarks.onclick = function () {
            mode = "marks";
            this.className = "on";
            bPct.className = "";
            render();
        };
    }

    // Window synchronization hook
    window.syncStudentProgressChart = function (studentName) {
        if (!studentName) return;
        activeStudent = studentName;
        const sel = document.getElementById("progressStudentSelect");
        if (sel) sel.value = studentName;
        activeSubject = "ALL";
        deselectedExamIds.clear();
        render();
    };

    window.addEventListener("resize", () => {
        const plot = document.getElementById("progressPlot");
        if (plot) drawTrend(plot);
    });

    if (cachedResults && cachedResults.length > 0) {
        loadRealDataIntoProgressChart(cachedResults);
    } else {
        render();
    }
}

if (typeof window !== 'undefined') {
    window.initStudentProgressChart = initStudentProgressChart;
    window.loadRealDataIntoProgressChart = loadRealDataIntoProgressChart;
}
