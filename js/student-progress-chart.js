// ============================================
// STUDENT PROGRESS CHART MODULE
// Stacked multi-exam longitudinal progression chart
// with trend-lines, percentage/marks toggling, and interactive data editing
// ============================================

export function initStudentProgressChart() {
    const wrap = document.getElementById('studentProgressChartSection');
    if (!wrap) return;

    var subjects = ["Accountancy", "Business Studies", "Economics", "English"];
    var colors = ["#5b6cf0", "#f2a53a", "#2fb98a", "#e8607a", "#9a6bdc"];
    var exams = [
        { n: "Pre-Midterm", max: 40, m: [22, 25, 20, 28] },
        { n: "Midterm", max: 80, m: [52, 48, 55, 60] },
        { n: "Post-Midterm", max: 40, m: [30, 27, 33, 29] },
        { n: "Final", max: 80, m: [66, 60, 70, 64] }
    ];

    var mode = "pct", H = 314;
    var tip = document.getElementById("progressTip");
    if (!tip) {
        tip = document.createElement("div");
        tip.className = "progress-tip";
        tip.id = "progressTip";
        document.body.appendChild(tip);
    }

    function num(v) {
        v = parseFloat(v);
        return isNaN(v) ? 0 : v;
    }

    function showTip(ev, html) {
        if (!tip) return;
        tip.innerHTML = html;
        tip.style.opacity = '1';
        var x = ev.clientX + 14, y = ev.clientY - 62;
        if (x + tip.offsetWidth > window.innerWidth - 8) x = ev.clientX - tip.offsetWidth - 14;
        if (y < 8) y = ev.clientY + 16;
        tip.style.left = x + "px";
        tip.style.top = y + "px";
    }

    function hideTip() {
        if (tip) tip.style.opacity = '0';
    }

    function drawTrend(plot, stacks) {
        var old = plot.querySelector("svg.progress-trend");
        if (old) old.remove();
        if (stacks.length < 2) return;
        var pr = plot.getBoundingClientRect();
        var pts = stacks.map(function (s) {
            var r = s.getBoundingClientRect();
            return [r.left + r.width / 2 - pr.left, r.top - pr.top - 34];
        });
        var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
        svg.setAttribute("class", "progress-trend");
        var line = document.createElementNS(ns, "polyline");
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
        var studentInput = document.getElementById("progressStudentInput");
        var name = studentInput ? studentInput.value : "Student";
        var titleEl = document.getElementById("progressChartTitle");
        if (titleEl) titleEl.textContent = name + "’s Multi-Exam Progress";

        var legendEl = document.getElementById("progressLegend");
        if (legendEl) {
            legendEl.innerHTML = subjects.map(function (s, j) {
                return '<span><i style="background:' + colors[j % 5] + '"></i>' + s + '</span>';
            }).join("");
        }

        var plot = document.getElementById("progressPlot");
        if (!plot) return;
        plot.innerHTML = "";

        var info = exams.map(function (e) {
            var t = e.m.reduce(function (a, b) { return a + b; }, 0);
            var f = e.max * subjects.length;
            return { t: t, f: f, p: f ? (t / f * 100) : 0 };
        });

        var scale = mode === "pct" ? 100 : Math.max.apply(null, info.map(function (x) { return x.f; }).concat([1]));

        [0, 25, 50, 75, 100].forEach(function (p) {
            var g = document.createElement("div");
            g.className = "grid";
            g.style.top = (26 + H - p / 100 * H) + "px";
            g.innerHTML = "<span>" + (mode === "pct" ? p + "%" : Math.round(scale * p / 100)) + "</span>";
            plot.appendChild(g);
        });

        var cols = document.createElement("div");
        cols.className = "cols";
        plot.appendChild(cols);

        var prev = null, stacks = [];
        exams.forEach(function (e, i) {
            var inf = info[i];
            var col = document.createElement("div");
            col.className = "col";
            var d = "";
            if (prev !== null) {
                var df = inf.p - prev;
                d = '<div class="delta ' + (df >= 0 ? "up" : "down") + '">' + (df >= 0 ? "▲ +" : "▼ ") + df.toFixed(1) + "%</div>";
            }
            var tot = document.createElement("div");
            tot.className = "tot";
            tot.innerHTML = (mode === "pct" ? inf.p.toFixed(1) + "%" : inf.t + "/" + inf.f) + d;

            var st = document.createElement("div");
            st.className = "stack";
            var hh = (mode === "pct" ? inf.p : inf.t) / scale * (H - 34);
            st.style.height = Math.max(hh, 0) + "px";

            e.m.forEach(function (v, j) {
                var s = document.createElement("div");
                s.className = "seg";
                s.style.background = colors[j % 5];
                s.style.flex = (v || 0.0001) + " 1 0";
                var html = '<span>' + e.n + '</span><br>' + subjects[j] + '<b>' + v + ' / ' + e.max + ' <span>(' + (e.max ? (v / e.max * 100).toFixed(0) : 0) + '%)</span></b>';
                s.addEventListener("pointerenter", function (ev) { showTip(ev, html); });
                s.addEventListener("pointermove", function (ev) { showTip(ev, html); });
                s.addEventListener("pointerleave", hideTip);
                st.appendChild(s);
            });

            var l = document.createElement("div");
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
        var tbl = document.getElementById("progressTbl");
        if (!tbl) return;
        var h = "<tr><th>Exam</th><th>Max</th>" + subjects.map(function (s) { return "<th>" + s + "</th>"; }).join("") + "<th></th></tr>";
        exams.forEach(function (e, i) {
            h += '<tr><td><input class="name" data-i="' + i + '" data-k="n" value="' + e.n + '"></td><td><input type="number" data-i="' + i + '" data-k="max" value="' + e.max + '"></td>';
            e.m.forEach(function (v, j) {
                h += '<td><input type="number" min="0" data-i="' + i + '" data-j="' + j + '" value="' + v + '"></td>';
            });
            h += '<td><button class="progress-mini" style="margin:0" data-del="' + i + '">✕</button></td></tr>';
        });
        tbl.innerHTML = h;
    }

    const tblEl = document.getElementById("progressTbl");
    if (tblEl) {
        tblEl.addEventListener("input", function (ev) {
            var el = ev.target, i = el.dataset.i;
            if (i === undefined) return;
            if (el.dataset.k === "n") exams[i].n = el.value;
            else if (el.dataset.k === "max") exams[i].max = num(el.value);
            else exams[i].m[el.dataset.j] = num(el.value);
            render();
        });

        tblEl.addEventListener("click", function (ev) {
            var d = ev.target.dataset.del;
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

    window.setStudentProgressName = function (name) {
        if (!name) return;
        const input = document.getElementById("progressStudentInput");
        if (input) {
            input.value = name;
            render();
        }
    };

    window.addEventListener("resize", render);

    table();
    render();
    setTimeout(render, 500);
}

if (typeof window !== 'undefined') {
    window.initStudentProgressChart = initStudentProgressChart;
}
