// ============================================
// STUDENT PROGRESS CHART MODULE
// Stacked multi-exam longitudinal progression chart
// with trend-lines, percentage/marks toggling, and interactive data editing
// Powered by real student test results from Firestore
// ============================================

let cachedResults = [];
let subjects = ["Accountancy", "Business Studies", "Economics", "English"];
const colors = ["#5b6cf0", "#f2a53a", "#2fb98a", "#e8607a", "#9a6bdc", "#0284c7", "#f43f5e"];
let exams = [
    { n: "Pre-Midterm", max: 40, m: [22, 25, 20, 28] },
    { n: "Midterm", max: 80, m: [52, 48, 55, 60] },
    { n: "Post-Midterm", max: 40, m: [30, 27, 33, 29] },
    { n: "Final", max: 80, m: [66, 60, 70, 64] }
];

let mode = "pct";
const H = 314;
let tip = null;

function num(v) {
    v = parseFloat(v);
    return isNaN(v) ? 0 : v;
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

function drawTrend(plot, stacks) {
    const old = plot.querySelector("svg.progress-trend");
    if (old) old.remove();
    if (stacks.length < 2) return;
    const pr = plot.getBoundingClientRect();
    const pts = stacks.map(function (s) {
        const r = s.getBoundingClientRect();
        return [r.left + r.width / 2 - pr.left, r.top - pr.top - 34];
    });
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "progress-trend");
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", pts.map(function (p) { return p.join(","); }).join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#8890a8");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "5 5");
    line.setAttribute("opacity", ".75");
    svg.appendChild(line);
    plot.appendChild(svg);
}

function render() {
    const studentInput = document.getElementById("progressStudentInput");
    const name = studentInput ? studentInput.value : "Student";
    const titleEl = document.getElementById("progressChartTitle");
    if (titleEl) titleEl.textContent = name + "’s Multi-Exam Progress";

    const legendEl = document.getElementById("progressLegend");
    if (legendEl) {
        legendEl.innerHTML = subjects.map(function (s, j) {
            return '<span><i style="background:' + colors[j % colors.length] + '"></i>' + s + '</span>';
        }).join("");
    }

    const plot = document.getElementById("progressPlot");
    if (!plot) return;
    plot.innerHTML = "";

    const info = exams.map(function (e) {
        const t = e.m.reduce(function (a, b) { return a + b; }, 0);
        const f = e.max * Math.max(1, subjects.length);
        return { t: t, f: f, p: f ? (t / f * 100) : 0 };
    });

    const scale = mode === "pct" ? 100 : Math.max.apply(null, info.map(function (x) { return x.f; }).concat([1]));

    [0, 25, 50, 75, 100].forEach(function (p) {
        const g = document.createElement("div");
        g.className = "grid";
        g.style.top = (26 + H - p / 100 * H) + "px";
        g.innerHTML = "<span>" + (mode === "pct" ? p + "%" : Math.round(scale * p / 100)) + "</span>";
        plot.appendChild(g);
    });

    const cols = document.createElement("div");
    cols.className = "cols";
    plot.appendChild(cols);

    let prev = null;
    const stacks = [];
    exams.forEach(function (e, i) {
        const inf = info[i];
        const col = document.createElement("div");
        col.className = "col";
        let d = "";
        if (prev !== null) {
            const df = inf.p - prev;
            d = '<div class="delta ' + (df >= 0 ? "up" : "down") + '">' + (df >= 0 ? "▲ +" : "▼ ") + df.toFixed(1) + "%</div>";
        }
        const tot = document.createElement("div");
        tot.className = "tot";
        tot.innerHTML = (mode === "pct" ? inf.p.toFixed(1) + "%" : inf.t + "/" + inf.f) + d;

        const st = document.createElement("div");
        st.className = "stack";
        const hh = (mode === "pct" ? inf.p : inf.t) / scale * (H - 34);
        st.style.height = Math.max(hh, 0) + "px";

        e.m.forEach(function (v, j) {
            const s = document.createElement("div");
            s.className = "seg";
            s.style.background = colors[j % colors.length];
            s.style.flex = (v || 0.0001) + " 1 0";
            const subName = subjects[j] || 'Marks';
            const html = '<span>' + e.n + '</span><br>' + subName + '<b>' + v + ' / ' + e.max + ' <span>(' + (e.max ? (v / e.max * 100).toFixed(0) : 0) + '%)</span></b>';
            s.addEventListener("pointerenter", function (ev) { showTip(ev, html); });
            s.addEventListener("pointermove", function (ev) { showTip(ev, html); });
            s.addEventListener("pointerleave", hideTip);
            st.appendChild(s);
        });

        const l = document.createElement("div");
        l.className = "lbl";
        l.innerHTML = e.n + "<small>out of " + e.max + " each</small>";
        col.appendChild(tot);
        col.appendChild(st);
        col.appendChild(l);
        cols.appendChild(col);
        stacks.push(st);
        prev = inf.p;
    });

    drawTrend(plot, stacks);
}

function table() {
    const tbl = document.getElementById("progressTbl");
    if (!tbl) return;
    let h = "<tr><th>Exam</th><th>Max</th>" + subjects.map(function (s) { return "<th>" + s + "</th>"; }).join("") + "<th></th></tr>";
    exams.forEach(function (e, i) {
        h += '<tr><td><input class="name" data-i="' + i + '" data-k="n" value="' + e.n + '"></td><td><input type="number" data-i="' + i + '" data-k="max" value="' + e.max + '"></td>';
        e.m.forEach(function (v, j) {
            h += '<td><input type="number" min="0" data-i="' + i + '" data-j="' + j + '" value="' + v + '"></td>';
        });
        h += '<td><button class="progress-mini" style="margin:0" data-del="' + i + '">✕</button></td></tr>';
    });
    tbl.innerHTML = h;
}

export function loadRealDataIntoProgressChart(testResults, targetStudent = null) {
    if (testResults && Array.isArray(testResults)) {
        cachedResults = testResults;
    }

    if (!cachedResults || cachedResults.length === 0) {
        table();
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

    const activeStudent = targetStudent || (selectEl ? selectEl.value : null) || availableStudents[0];
    if (!activeStudent) return;

    if (selectEl) selectEl.value = activeStudent;
    const inputEl = document.getElementById("progressStudentInput");
    if (inputEl) inputEl.value = activeStudent;

    // Filter real records for this student
    const studentRecords = cachedResults.filter(r => 
        r.studentName && r.studentName.trim().toLowerCase() === activeStudent.trim().toLowerCase()
    );

    if (studentRecords.length > 0) {
        // Collect real subjects evaluated for this student
        const distinctSubjects = [...new Set(studentRecords.map(r => r.subject).filter(Boolean))];
        subjects = distinctSubjects.length > 0 ? distinctSubjects : ["Economics"];

        // Group into longitudinal exam timeline
        const examMap = new Map();
        studentRecords.forEach(r => {
            const examTitle = r.sessionName || r.testType || r.subject || (r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : 'Exam');
            if (!examMap.has(examTitle)) {
                examMap.set(examTitle, {
                    n: examTitle,
                    max: Number(r.maxMarks) || 40,
                    subjectMarks: {},
                    time: r.submittedAt ? (r.submittedAt.toDate ? r.submittedAt.toDate().getTime() : new Date(r.submittedAt).getTime()) : 0
                });
            }
            const eg = examMap.get(examTitle);
            eg.subjectMarks[r.subject || subjects[0]] = Number(r.score) || 0;
            if (Number(r.maxMarks) > eg.max) eg.max = Number(r.maxMarks);
        });

        const sortedExams = Array.from(examMap.values()).sort((a, b) => a.time - b.time);
        exams = sortedExams.map(eg => ({
            n: eg.n,
            max: eg.max,
            m: subjects.map(sub => eg.subjectMarks[sub] || 0)
        }));
    }

    table();
    render();
}

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

    const tblEl = document.getElementById("progressTbl");
    if (tblEl) {
        tblEl.addEventListener("input", function (ev) {
            const el = ev.target, i = el.dataset.i;
            if (i === undefined) return;
            if (el.dataset.k === "n") exams[i].n = el.value;
            else if (el.dataset.k === "max") exams[i].max = num(el.value);
            else exams[i].m[el.dataset.j] = num(el.value);
            render();
        });

        tblEl.addEventListener("click", function (ev) {
            const d = ev.target.dataset.del;
            if (d === undefined) return;
            exams.splice(d, 1);
            table();
            render();
        });
    }

    const addBtn = document.getElementById("progressAddExam");
    if (addBtn) {
        addBtn.onclick = function () {
            exams.push({ n: "New Exam", max: 40, m: subjects.map(function () { return 0; }) });
            table();
            render();
        };
    }

    const sInput = document.getElementById("progressStudentInput");
    if (sInput) {
        sInput.oninput = render;
    }

    const sSelect = document.getElementById("progressStudentSelect");
    if (sSelect) {
        sSelect.onchange = function () {
            loadRealDataIntoProgressChart(cachedResults, this.value);
        };
    }

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

    window.syncStudentProgressChart = function (studentName) {
        if (!studentName) return;
        loadRealDataIntoProgressChart(cachedResults, studentName);
    };

    window.addEventListener("resize", render);

    if (cachedResults && cachedResults.length > 0) {
        loadRealDataIntoProgressChart(cachedResults);
    } else {
        table();
        render();
    }
}

if (typeof window !== 'undefined') {
    window.initStudentProgressChart = initStudentProgressChart;
    window.loadRealDataIntoProgressChart = loadRealDataIntoProgressChart;
}
