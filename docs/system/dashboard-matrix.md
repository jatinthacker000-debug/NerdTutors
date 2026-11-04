# Dashboard, Question Matrix & Analytics Subsystem

**Document Target**: `docs/system/dashboard-matrix.md`  
**System Module**: Dashboard, Question Matrix & Analytics  
**Primary Files Analyzed**:
- `dashboard.html` (Application DOM structure, page views, modals, drawers, controls)
- `dashboard.js` (State management, Chart.js integrations, real-time Firestore listeners, cascading filters, exports)
- `js/matrix-manager.js` (Question Performance Matrix Engine, canonical normalizer, natural sorter, drawer flyout, matrix CSV export, AI topic analytics)
- `js/student-progress-chart.js` (Longitudinal SVG trendline engine, exam title normalizer, subject themes, trajectory metrics)
- `dashboard.css` (Visual tokens, sticky 2D coordinates, cell color-coding, responsive breakpoints)
- `api/analyze-topics.js` (Gemini 3.8 Flash AI NCERT curriculum mapping endpoint)

---

## 1. Architectural Overview & Component Map

### 1.1 Purpose & Role in the System
The NerdTutors Dashboard is an institutional-grade evaluation, cross-sectional item-response analysis, and longitudinal progress tracking portal designed for educators, school administrators, and students. Built to strictly comply with Central Board of Secondary Education (CBSE) Class 10th and 12th standards, the dashboard unifies three core operational workflows:

1. **Administrative Test Management & Cohort Overview**: Real-time evaluation throughput monitoring, score distribution statistics, cohort leaderboards, and institution-wide filtered data export.
2. **Cross-Sectional Item-Response Matrix (`js/matrix-manager.js`)**: A two-dimensional sticky grid displaying every question in an exam paper side-by-side across all participating students, enabling immediate visual detection of systemic curriculum deficiencies, toughest/easiest questions, and question-level examiner feedback.
3. **Longitudinal Multi-Exam Student Progress (`js/student-progress-chart.js`)**: A pure mathematical SVG vector visualization tracking an individual student's score trajectory across consecutive examinations within identical subjects, computing real-time trajectory deltas and milestone achievements.

### 1.2 Technology Stack
- **Frontend Core**: Vanilla ES Modules (`<script type="module">`), modern semantic HTML5, and CSS3 Custom Properties.
- **Data Persistence & Ingestion**: Google Firebase Firestore SDK v9.22.0 (`getDocs`, `onSnapshot`, `updateDoc`, `query`, `where`, `orderBy`).
- **Authentication**: Firebase Auth v9.22.0 (`signInAnonymously`, `onAuthStateChanged`).
- **Visual Analytics**: Chart.js v3.x (doughnut score distribution, student comparison bar charts, 7-day test frequency) + custom vector SVG DOM charting for longitudinal trendlines.
- **AI Diagnostics**: Google Cloud Vertex AI / Gemini 3.8 Flash integration via `/api/analyze-topics` for curriculum blueprinting and leaf-level NCERT topic attribution.

### 1.3 Subsystem Component Map

```
+----------------------------------------------------------------------------------------------------+
|                                    NERDTUTORS DASHBOARD SUBSYSTEM                                  |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ Presentation Layer: dashboard.html / dashboard.css ]                                           |
|  +-----------------------------------------------------------------------------------------------+ |
|  | #sidebar               | #header              | #dashboardContent                             | |
|  | - Tab Navigation Links | - Mobile Menu Toggle | - #dashboardPage (KPIs & Recent Results)      | |
|  | - Desktop Collapsible  | - Header Actions     | - #studentsPage (Student Card Grid)           | |
|  | - Mobile Overlay       | - Title Display      | - #resultsPage (Filterable Master Table)      | |
|  |                        |                      | - #analyticsPage (Cohort Charts & Leaderboard)| |
|  |                        |                      | - #matrixPage (Item Matrix & Progress Chart)  | |
|  |                        |                      | - #exportPage (Unified Filtered CSV Console)  | |
|  +-----------------------------------------------------------------------------------------------+ |
|                                                    |                                               |
|  [ Application Logic Layer: dashboard.js ]         |                                               |
|  +-------------------------------------------------+---------------------------------------------+ |
|  | appState                | Event Handlers        | Firebase Ingestion                          | |
|  | - testResults: []       | - Hash routing        | - setupAuth() (Anonymous Auth)              | |
|  | - filteredResults: []   | - Dynamic filters     | - loadTestResults() (Collection Scan)       | |
|  | - charts: {}            | - Modal handlers      | - setupRealtimeUpdates() (onSnapshot limit) | |
|  +-------------------------------------------------+---------------------------------------------+ |
|                                   |                                     |                          |
|                                   v                                     v                          |
|  [ Matrix Module: js/matrix-manager.js ]          [ Progress Module: js/student-progress-chart.js] |
|  +----------------------------------------------+ +----------------------------------------------+ |
|  | - Canonical Question Normalizer              | | - formatExamName Date/Title Normalizer       | |
|  | - Natural Question Sorting (with ROMAN_MAP)  | | - Dynamic Subject Themes & Pills             | |
|  | - 2D Sticky Scroll Grid Engine               | | - Interactive Multi-Exam Filter Chips        | |
|  | - Board Threshold Color Logic                | | - SVG Coordinate Vector Trendline Engine     | |
|  | - Toughest / Easiest Question Detection      | | - Real-Time Trajectory KPI Strip             | |
|  | - Interactive Flyout Drawer Cache            | | - Percentage vs Raw Marks Scaling            | |
|  | - Matrix CSV Export Engine                   | | - Responsive Geometry Projection             | |
|  | - AI Topic Mastery Integration               | +----------------------------------------------+ |
|  +----------------------------------------------+                                                  |
|                                   |                                                                |
|                                   v                                                                |
|  [ Backend API Layer: api/analyze-topics.js ]                                                     |
|  +-----------------------------------------------------------------------------------------------+ |
|  | - Vertex AI Gemini 3.8 Flash Execution                                                        | |
|  | - Strict NCERT Chapter, Topic, Subtopic & Cognitive Skill Mapping JSON                         | |
|  | - Firestore testSessions/{sessionId} Persistence                                             | |
|  +-----------------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------------+
```

### 1.4 Data Flow & Lifecycle
1. **Bootstrapping**: On document load, `dashboard.js` invokes `init()`, establishing anonymous Firebase authentication (`setupAuth()`).
2. **Data Hydration**: `loadTestResults()` reads all documents from `testResults` into `appState.testResults`, standardizing OCR score fields (`pct`, `totScore`, `submittedAt`).
3. **Session Metadata Sync**: `loadSessionsForAnalyticsFilter()` queries `testSessions` ordered by creation date, populating session dropdowns in analytics, export, and matrix views.
4. **Sub-Module Initialization**:
   - `initQuestionMatrix(appState, analyticsSessions, db, firestoreUtils)` binds matrix DOM listeners and renders the 2D grid.
   - `initStudentProgressChart(appState.testResults)` populates the student picker, computes subject tabs, and draws the SVG trendline.
5. **Real-Time Synchronous Updates**: `setupRealtimeUpdates()` establishes an `onSnapshot` listener on the 50 most recent submissions in `testResults`. Incoming evaluations trigger automated re-renders of stats, tables, charts, and matrix rows.

---

## 2. Dashboard Navigation Views

### 2.1 Tab Navigation Architecture
Navigation is handled client-side via CSS and DOM visibility switching triggered by URL hash fragments. The sidebar (`#sidebar`) defines anchor navigation links:

| Navigation Item | Anchor Target | Page Section ID | Dedicated Sub-View Purpose |
|---|---|---|---|
| **Dashboard** | `#dashboard` | `#dashboardPage` | High-level KPI metric cards and recent test previews |
| **Students** | `#students` | `#studentsPage` | Student-centric cohort directory and testing history |
| **Test Results** | `#results` | `#resultsPage` | Master tabular view with multi-column sorting and filtering |
| **Analytics** | `#analytics` | `#analyticsPage` | Chart.js cohort distributions, leaderboard, and test breakdowns |
| **Question Matrix** | `#matrix` | `#matrixPage` | 2D item-response matrix, AI topic mastery, and SVG progress chart |
| **Export Data** | `#export` | `#exportPage` | Filtered, consolidated CSV generation console |
| **Back to Home** | `index.html` | N/A | Exits dashboard to the main student evaluation gateway |

### 2.2 Navigation State Transition Logic
In `dashboard.js`, navigation events are intercepted by a unified event listener:

```javascript
function showPage(pageName) {
    currentPage = pageName;
    const pages = ['dashboardPage', 'studentsPage', 'resultsPage', 'analyticsPage', 'exportPage', 'matrixPage'];
    pages.forEach(page => {
        const el = elements[page];
        if (el) {
            el.style.display = 'none';
            el.classList.remove('active');
        }
    });

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
```

When a user clicks a nav link:
1. `e.preventDefault()` prevents browser hash jumping.
2. `showPage(pageName)` hides all other sections and activates the targeted container.
3. The matching view render function is immediately invoked:
   - `#students` $\rightarrow$ `renderStudentsPage()`
   - `#results` $\rightarrow$ `renderFullTable()`
   - `#analytics` $\rightarrow$ `initAnalyticsCharts()`
   - `#matrix` $\rightarrow$ `renderQuestionMatrix(appState.testResults)`
4. Sidebar active classes (`.nav-item.active`) are updated.
5. On mobile screens, the mobile drawer and overlay are dismissed automatically.

### 2.3 Detailed View Inventory

#### 1. Dashboard Page (`#dashboardPage`)
- **Metric Cards Grid (`.stats-grid`)**:
  - `totalStudents`: Set of unique `studentId` counts across all results.
  - `totalTests`: Total length of `appState.testResults`.
  - `avgScore`: Mathematical mean of all valid percentage scores.
  - `recentActivity`: Count of tests submitted on the current calendar day (midnight-to-midnight comparison).
- **Recent Results Preview**: Displays the top 5 most recent submissions with student name, date, formatted score badge, and test type badge. Clicking `#viewAllBtn` transitions directly to `#resultsPage`.

#### 2. Students Page (`#studentsPage`)
- Groups flat test records into discrete student objects keyed by `studentId`.
- Computes aggregate metrics per student: total tests taken, cumulative average score, and timestamp of most recent submission.
- Real-time search (`#studentSearchInput`) filters by name; sort filter (`#studentSortFilter`) orders cards by name, test volume, average percentage, or recency.
- Renders responsive student cards (`.student-card`) featuring an initial avatar, truncated ID, test metrics, and last active date.

#### 3. Results Page (`#resultsPage`)
- Full tabular audit trail of all student examinations (`#resultsTableBody`).
- Multi-parameter filter bar:
  - Text search (`#searchInput` matching student name).
  - Batch select (`#batchFilter`: `all`, `Both`, `Nerd Tutors OSEM`, `Nerd Tutors Nalanda`, `Others`).
  - Test type select (`#testTypeFilter`: `all`, `mcq`, `text`).
  - Score threshold select (`#scoreFilter`: `high` $\ge 80\%$, `medium` $50\text{--}79\%$, `low` $< 50\%$).
  - Date window select (`#dateFilter`: `all`, `today`, `week`, `month`).
- Interactive column sorting: clicking headers with `.sortable` triggers `sortTable(field)` for name, submission date, or score percentage.
- Action buttons: `window.viewDetails(resultId)` opens `#detailModal`; `window.exportResult(resultId)` triggers a single-student CSV download.

#### 4. Analytics Page (`#analyticsPage`)
- **Cascading Filter Bar**: Class (`#analyticsClassFilter`) $\rightarrow$ Subject (`#analyticsSubjectFilter`) $\rightarrow$ Test Session (`#analyticsSessionFilter`).
- **Student Performance Comparison**: A dynamic Chart.js bar chart (`#studentPerformanceChart`) comparing every student in the selected session. The metric toggle button (`#btnToggleChartMetric`) switches between percentage (`0-100%`) and raw points (`0-maxMarks`).
- **Score Distribution**: A doughnut chart (`#scoreDistributionChart`) categorizing cohort performance into High, Medium, and Low.
- **Tests Frequency**: A 7-day rolling bar chart (`#testsPerDayChart`) displaying test volume per day.
- **Breakdown Tables**:
  - `#typeBreakdownBody`: Statistical summary (count, average, high, low) partitioned by MCQ, Text, and OCR evaluation types.
  - `#leaderboardBody`: Top 5 highest percentage achievers decorated with 🥇, 🥈, and 🥉 medals.
  - `#detailedResultsBody`: Tabular records filtered to the current analytics cohort.

#### 5. Question Matrix Page (`#matrixPage`)
- Detailed in Section 3 and Section 4 below. Houses the 2D item-response matrix, CBSE AI topic mastery analysis, and the longitudinal student progress chart.

#### 6. Export Page (`#exportPage`)
- Detailed in Section 6 below. Houses the unified institutional CSV export console.

---

## 3. Question-Wise Student Performance Matrix (`js/matrix-manager.js`)

### 3.1 2D Cross-Sectional Grid Architecture
The Question Performance Matrix displays every question from an exam session as rows and individual students as columns, terminating with an aggregate **Class Average (%)** column on the right and a **TOTAL SCORE** summary row at the bottom:

```
+------------------------------------------------------------------------------------------------------+
| Question No. | Topic                | Alice (Both) 38/40 | Bob (OSEM) 29/40 | Charlie 35/40 | Class Avg |
+--------------+----------------------+--------------------+------------------+---------------+-----------+
| Q1 (1M)      | Price Elasticity     |       ✓ 1/1        |      ✗ 0/1       |     ✓ 1/1     |    67%    |
| Q2(a) (3M)   | Cash Reserve Ratio   |       ✓ 3/3        |      ! 1/3       |     ✓ 3/3     |    78%    |
| Q2(b) (3M)   | Repo Rate Deflation  |       ! 1.5/3      |      ✗ 0.5/3     |     ! 2/3     |    44%    |
| Q10 (4M)     | National Income Calc |       ✓ 4/4        |      ! 2/4       |     ✓ 3.5/4   |    79%    |
+--------------+----------------------+--------------------+------------------+---------------+-----------+
| TOTAL SCORE  | All Topics           |      38 / 40 (95%) |    29 / 40 (73%) | 35 / 40 (88%) |    85%    |
+------------------------------------------------------------------------------------------------------+
```

### 3.2 Two-Dimensional Sticky Coordinate Locking
In `dashboard.css`, coordinate locks ensure fluid navigation across massive cohorts without losing header or question context:

```css
/* Sticky Header Row */
.matrix-table thead th {
    position: sticky;
    top: 0;
    background: #f8fafc;
    z-index: 10;
}

/* Sticky Left Question Column */
.matrix-table thead th.th-question {
    left: 0;
    z-index: 20;
    background: #f1f5f9;
}
.matrix-table tbody td.td-question {
    position: sticky;
    left: 0;
    background: #f8fafc;
    z-index: 5;
    border-right: 1px solid #cbd5e1;
}

/* Sticky Right Class Average Column */
.matrix-table thead th.th-avg {
    position: sticky;
    right: 0;
    z-index: 20;
    background: #f1f5f9;
    border-left: 2px solid #cbd5e1;
}
.matrix-table tbody td.td-avg {
    position: sticky;
    right: 0;
    background: #f8fafc;
    z-index: 5;
    border-left: 2px solid #cbd5e1;
}

/* Sticky Bottom Summary Row */
.matrix-table tfoot tr td {
    position: sticky;
    bottom: 0;
    background: #f1f5f9;
    z-index: 10;
    border-top: 2px solid #cbd5e1;
}
.matrix-table tfoot tr td.td-question {
    z-index: 25;
    left: 0;
}
.matrix-table tfoot tr td.td-avg {
    z-index: 25;
    right: 0;
}
```

### 3.3 Canonical Question Normalization Engine (`normalizeQuestionNumber`)
Raw OCR output, marking scheme variations, and multi-prompt models generate question identifiers inconsistently (e.g., `"Question 1"`, `"Q.1"`, `"Q2a"`, `"Q2(a)"`, `"Q5(i)"`, `"Q5i"`). If left unnormalized, the matrix would create fragmented duplicate rows.

`normalizeQuestionNumber(raw)` in `js/matrix-manager.js` enforces a canonical grammar:

```javascript
export function normalizeQuestionNumber(raw) {
    if (!raw && raw !== 0) return '';
    let str = String(raw).trim();
    if (!str) return '';

    // Standardize 'Question' prefix to 'Q'
    str = str.replace(/^Question\s*/i, 'Q');

    // Case 1: Q<number> with roman numeral subpart: Q5i, Q5(i), Q5.i, Q5-i, Q5 (ii) -> Q5(i), Q5(ii)
    const mRoman = str.match(/^Q\s*(\d+)\s*[._\s-]?\(?([ivxIVX]+)\)?$/i);
    if (mRoman) {
        return `Q${mRoman[1]}(${mRoman[2].toLowerCase()})`;
    }

    // Case 2a: Q<number>(<letter>)(<roman or number>) e.g. Q17a(i), Q17(a)(i) -> Q17(a)(i)
    const mMulti1 = str.match(/^Q\s*(\d+)\s*[._\s-]?\(?([a-zA-Z])\)?\s*[._\s-]?\(?([ivxIVX]+|\d+)\)?$/i);
    if (mMulti1) {
        return `Q${mMulti1[1]}(${mMulti1[2].toLowerCase()})(${mMulti1[3].toLowerCase()})`;
    }

    // Case 2b: Q<number>(<roman>)(<letter>) e.g. Q17(i)(a), Q17i(a) -> Q17(i)(a)
    const mMulti2 = str.match(/^Q\s*(\d+)\s*[._\s-]?\(?([ivxIVX]+)\)?\s*[._\s-]?\(?([a-zA-Z])\)?$/i);
    if (mMulti2) {
        return `Q${mMulti2[1]}(${mMulti2[2].toLowerCase()})(${mMulti2[3].toLowerCase()})`;
    }

    // Case 3: Q<number> with single letter subpart e.g. Q2a, Q2(a), Q2.a, Q2 - a, Q2A -> Q2(a)
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
```

### 3.4 Natural Question Sorting Engine (`naturalQuestionSort`)
Standard JavaScript string sorting (`Array.prototype.sort()`) fails on academic question sequences because ASCII sorting orders `"Q10"` before `"Q2"`, and sorts Roman numerals lexicographically (`"(iv)"` after `"(ix)"`).

`naturalQuestionSort(a, b)` solves this via structured token decomposition and a Roman numeral priority dictionary:

```javascript
const ROMAN_MAP = {
    '(i)': 1, '(ii)': 2, '(iii)': 3, '(iv)': 4, '(v)': 5,
    '(vi)': 6, '(vii)': 7, '(viii)': 8, '(ix)': 9, '(x)': 10,
    'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5,
    'vi': 6, 'vii': 7, 'viii': 8, 'ix': 9, 'x': 10
};

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

    // 1. Prefix comparison (e.g. "Q" vs "SECTION")
    if (pa.prefix !== pb.prefix) {
        return pa.prefix.localeCompare(pb.prefix);
    }
    // 2. Numerical question index comparison (Q2 vs Q10)
    if (pa.num !== pb.num) {
        return pa.num - pb.num;
    }

    // 3. Roman numeral sub-part comparison: (iv) before (v), (ix) before (x)
    const romanA = ROMAN_MAP[pa.sub];
    const romanB = ROMAN_MAP[pb.sub];
    if (romanA !== undefined && romanB !== undefined) {
        return romanA - romanB;
    }

    // 4. Fallback alphabetical sub-part comparison ((a) vs (b))
    return pa.sub.localeCompare(pb.sub);
}
```

### 3.5 Academic Score Thresholds & Visual Indicators
The matrix applies strict board-level performance thresholds to color-code each question score cell:

| Performance Tier | Score Percentage | CSS Class | Visual Styling | Symbol | Criteria |
|---|---|---|---|---|---|
| **Critical Deficit** | $\le 30\%$ | `.td-score-red` | Background `#fee2e2`, Border `#fca5a5`, Text `#991b1b` | `✗` (if 0) or `!` | Concept failure; major misconceptions |
| **Developing** | $31\%\text{ to }60\%$ | `.td-score-light` | Background `#fef9c3`, Border `#fde047`, Text `#854d0e` | `!` | Partial understanding; lost step marks |
| **Mastered** | $> 60\%$ | `.td-score-white` | Background `#ffffff`, Border `#e2e8f0`, Text `#1e293b` | `✓` | Sound subject competency |
| **Unattempted** | N/A | `.td-score-empty` | Background `#f8fafc`, Border `#f1f5f9`, Text `#94a3b8` | `-` | Question omitted by candidate |

### 3.6 Toughest and Easiest Question Detection Algorithm
Inside `updateMatrixKpis(students, questions, questionIndex)`, the engine loops through all distinct questions, accumulating earned points and possible points across all active student responses:

$$\text{Accuracy}(Q) = \frac{\sum_{i=1}^{N} \text{score}_{i, Q}}{\sum_{i=1}^{N} \text{maxMarks}_{i, Q}} \times 100$$

- **Toughest Question**: Question with the absolute minimum accuracy percentage across the cohort (`minAvg`). Populates `#matrixToughestQ`.
- **Easiest Question**: Question with the absolute maximum accuracy percentage across the cohort (`maxAvg`). Populates `#matrixEasiestQ`.
- If zero responses or questions exist, both indicators fall back cleanly to `'-'`.

### 3.7 Interactive Cell Drilldown Flyout Drawer
Clicking any score cell inside `#questionMatrixTable` invokes `window.openMatrixDrawerByKey(payloadKey)`:
1. Accesses cached metadata from `window._matrixDrawerCache[payloadKey]`.
2. Slides out `#matrixCellDrawerBackdrop` with smooth CSS transition (`translateX(0)`).
3. Renders:
   - Header with exam session name, student name, question number, and question weight.
   - Score block with raw marks (`score / maxMarks`) and status badge (`✓ Full Marks`, `! Partial Marks`, or `✗ Zero Marks`).
   - Official question prompt (`#drawerQuestionText`).
   - Exact student answer / OCR handwritten transcription (`#drawerStudentAnswer`).
   - Official examiner feedback remark (`#drawerFeedback`).
   - Key improvement advice list (`#drawerImprovementsList`) displaying bulleted correction points.
4. Closes via close button (`#btnCloseMatrixDrawer`), backdrop click, or the `Escape` keyboard shortcut.

### 3.8 Matrix CSV Export Mechanics (`exportMatrixCsv`)
The matrix CSV exporter builds a spreadsheet-ready representation:
1. **Header Row**:
   `Question Number, Topic, "Student 1 (Batch)", "Student 2 (Batch)", ..., Class Average (%)`
2. **Body Rows**:
   Iterates through naturally sorted questions. Resolves the topic via `resolveQuestionTopic()`, appends each student's score, computes the row average percentage, and writes the line.
3. **Summary Footer Row**:
   Appends `"TOTAL SCORE", "All Topics"`, followed by each student's cumulative score string (`"total / max"`), ending with the grand cohort average percentage (`"grandAvg%"`).
4. **RFC-4180 Escaping**: All text cells are wrapped in double quotes with internal quotes escaped as `""`.
5. **Download Dispatch**: Encodes CSV string into a `Blob` (`type: 'text/csv;charset=utf-8;'`), generates an object URL, and triggers an anchor download named `question_performance_matrix_YYYY-MM-DD.csv`.

### 3.9 CBSE Topic Mastery & Class Weakness Analytics
When an exam session is selected, `renderTopicAnalysis()` initializes the AI curriculum module:
- If `session.topicMap` does not exist, renders a callout with button `#btnTriggerTopicAnalysis` that invokes `/api/analyze-topics`.
- **Leaf-Level Independence**: Evaluates each question as an independent card rather than averaging dissimilar questions under broad chapter headers.
- **Segmented Filter Tabs**:
  - `🔴 Critical (< 60%)`: High priority for classroom remedial intervention.
  - `🟡 Need Improvement (60%–90%)`: Moderate priority; concept refinement needed.
  - `🟢 Strong Topics (> 90%)`: Mastery demonstrated.
  - `📋 All Questions`: Complete syllabus view.
- **Layout Switcher**: Supports instant toggle between 1-column list view (`window.setTopicGridLayout(1)`) and 2-column grid view (`window.setTopicGridLayout(2)`).

---

## 4. Student Progress SVG Trendline Charting (`js/student-progress-chart.js`)

### 4.1 Purpose & Longitudinal Analysis
The Student Progress Chart tracks a single candidate across consecutive test sessions. It visualizes score evolution, subject-level trends, and trajectory deltas over time without relying on heavy external charting libraries.

```
+----------------------------------------------------------------------------------------------------+
| [📈 John Doe's Multi-Exam Progress]                               Student: [John Doe v] [Pct|Marks]|
| Filter by Subject:  [ All Subjects (5) ]  [ 📘 Economics (3) ]  [ 📙 Business Studies (2) ]        |
| Trajectory KPI:     [ Tests: 3 ]  [ Average: 76.7% ]  [ Peak: 88% ]  [ Trajectory: ▲ +18% ]        |
| Compare Tests:      [✓ Unit Test 1 (10 Sep)]  [✓ Mid Term (15 Oct)]  [✓ Pre-Board (28 Nov)]        |
|                                                                                                    |
|    100% + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  |
|          |                                             (88%)                                       |
|     75% + - - - - - - - - - - - - - - - - - - - - - - - [O] - - - - - - - - - - - - - - - - - - -  |
|          |                           (72%)             /                                           |
|     50% + - - - - - - - - - - - - - - [O] - - - - - - / - - - - - - - - - - - - - - - - - - - - -  |
|          |           (70%)            /              |                                             |
|     25% + - - - - - - [O] - - - - - -/ - - - - - - - | - - - - - - - - - - - - - - - - - - - - - -  |
|          |             |            |                |                                             |
|      0% + - - - - - - -|- - - - - - |- - - - - - - - |- - - - - - - - - - - - - - - - - - - - - -  |
|                     Test 1        Test 2           Test 3                                          |
|                     (Base)       (▲ +2%)          (▲ +16%)                                         |
+----------------------------------------------------------------------------------------------------+
```

### 4.2 Subject Theming Token Matrix
Every curriculum subject is assigned a deterministic visual identity in `SUBJECT_THEMES`:

```javascript
const SUBJECT_THEMES = {
    "Economics": { color: "#4f46e5", bg: "#eef2ff", border: "#c7d2fe", icon: "📘", barBg: "linear-gradient(180deg, #6366f1 0%, #4f46e5 100%)" },
    "Business Studies": { color: "#d97706", bg: "#fffbeb", border: "#fde68a", icon: "📙", barBg: "linear-gradient(180deg, #f59e0b 0%, #d97706 100%)" },
    "Accountancy": { color: "#0284c7", bg: "#f0f9ff", border: "#bae6fd", icon: "📊", barBg: "linear-gradient(180deg, #38bdf8 0%, #0284c7 100%)" },
    "Social Science": { color: "#059669", bg: "#ecfdf5", border: "#a7f3d0", icon: "🌍", barBg: "linear-gradient(180deg, #10b981 0%, #059669 100%)" },
    "English": { color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe", icon: "📝", barBg: "linear-gradient(180deg, #8b5cf6 0%, #7c3aed 100%)" },
    "Mathematics": { color: "#e11d48", bg: "#fff1f2", border: "#fecdd3", icon: "📐", barBg: "linear-gradient(180deg, #f43f5e 0%, #e11d48 100%)" },
    "default": { color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", icon: "📑", barBg: "linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)" }
};
```

### 4.3 Exam Title & Date Normalization (`formatExamName`)
Database records often store exam session names with raw epoch suffixes (e.g. `Economics_Unit1_1793101570263`) or unformatted date strings. `formatExamName(raw)`:
1. Strips epoch timestamp suffixes matching `/[_-]\d{10,}\b/g`.
2. Converts numeric dates (`25 10 2026`, `25.10.2026`, `25-10-2026`) into clean representations: `(25 Oct 2026)`.
3. Handles 2-digit years (`25.10.26` $\rightarrow$ `(25 Oct 2026)`).
4. Cleans nested brackets, replaces underscores with spaces, removes `"NerdTutors"` prefixes, and collapses whitespace.

### 4.4 Dynamic Filtering & Invariants
1. **Subject Filter Tabs (`#progressSubjectTabs`)**: Dynamically groups the candidate's exams by subject. Switching subjects clears `deselectedExamIds` and recalculates the cohort.
2. **Multi-Exam Comparison Chips (`#progressExamChips`)**: When $\ge 2$ exams exist, renders toggleable chips.
   - **Safety Invariant**: The handler enforces:
     ```javascript
     if (examsList.length - deselectedExamIds.size > 1) {
         deselectedExamIds.add(id);
     }
     ```
     This prevents the user from deselecting all exams, ensuring the chart is never left in an unrendered zero-bar state.
3. **KPI Trajectory Strip (`#progressKpiStrip`)**: Computes Tests count, Average %, Peak %, and the net Trajectory Delta:
   $$\Delta = \text{Score}_{\text{latest}} - \text{Score}_{\text{first}}$$
   Decorated with `▲ +X%` (green `#059669`) or `▼ -X%` (red `#dc2626`).

### 4.5 SVG Mathematical Coordinate Calculations (`drawTrend`)
Instead of rasterized canvas elements, the connecting trendline is rendered through an SVG element overlaid on the DOM columns:

```javascript
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
        // Calculate center X of column and top Y of score bar relative to plot container
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

    // Connecting dashed gradient vector
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

    // Glowing milestone node at each exam summit
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
```

### 4.6 Dynamic Scaling & Responsive Geometry
- **Y-Axis Scale**: Height is pinned to $H = 320\text{px}$.
  - In `pct` mode: Scale is fixed to $100\%$, with gridlines at $0\%$, $25\%$, $50\%$, $75\%$, and $100\%$.
  - In `marks` mode: Max scale is dynamic:
    $$\text{maxVal} = \max(\max_{e \in \text{exams}} e.\text{maxMarks}, 1)$$
    Gridlines display corresponding raw marks increments.
- **Bar Height Formula**:
  $$\text{barHeight} = \max\left(\frac{\text{val}}{\text{maxVal}} \times (H - 36), 4\right)$$
- **Responsive Projection**: Binds a window `resize` event handler that re-executes `drawTrend(plot)` whenever browser dimensions change, keeping SVG vector points aligned with DOM bar summits.

---

## 5. Dynamic Filtering Logic & Filter State Variables

### 5.1 State Machine Schemas

#### Global Application State (`appState` in `dashboard.js`)
```javascript
const appState = {
    testResults: [],          // Raw deserialized testResults from Firestore
    filteredResults: [],      // Results matching active search/batch/type/score/date filters
    charts: {},               // Chart.js instances (studentPerformance, scoreDistribution, testsPerDay)
    sortField: 'date',        // Active table sort column ('name' | 'date' | 'score')
    sortOrder: 'desc',        // Sort direction ('asc' | 'desc')
    chartMetric: 'percentage' // Active metric on comparison chart ('percentage' | 'score')
};
```

#### Matrix Module State (`matrixState` in `js/matrix-manager.js`)
```javascript
let matrixState = {
    results: [],              // Reference to appState.testResults
    sessions: [],             // Array of testSessions documents with topicMap
    questionMap: new Map(),   // Canonical question index mapping
    studentList: [],          // List of unique student objects
    questionList: [],         // Naturally sorted canonical question numbers
    activeDrawerData: null,   // Metadata payload loaded into slide-over drawer
    activeStudents: [],       // Students currently visible in filtered matrix
    activeQuestions: [],      // Questions currently visible in filtered matrix
    questionIndex: null       // Map of question numbers -> student responses
};
```

#### Progress Chart State (`js/student-progress-chart.js`)
```javascript
let cachedResults = [];       // Ingested evaluation dataset
let activeStudent = null;     // Selected student identifier string
let activeSubject = "ALL";    // Active subject filter tab
let deselectedExamIds = new Set(); // Set of exam IDs toggled off in comparison
let mode = "pct";             // "pct" (0-100%) or "marks" (0-maxMarks)
const H = 320;                // Fixed plot height constant in pixels
```

### 5.2 Cascading Filter Mechanics (Class $\rightarrow$ Subject $\rightarrow$ Session)
To prevent cross-curriculum confusion, selecting a Class strictly limits allowable Subjects and Sessions:

```
[ Class Filter: Class 10th ]
            |
            v
[ Subject Filter: Restricted to Social Science ]
            |
            v
[ Session Filter: Restricted to Class 10th Social Science sessions ]

---------------------------------------------------------------------

[ Class Filter: Class 12th ]
            |
            v
[ Subject Filter: Economics, Business Studies, Accountancy ]
            |
            v
[ Session Filter: Restricted to Class 12th selected subject sessions ]
```

Implementation in `dashboard.js`:
- `syncAnalyticsSubjectFilter()` dynamically replaces options in `#analyticsSubjectFilter`.
- `updateAnalyticsSessionDropdown()` filters `analyticsSessions` matching both active class and subject values, formatting labels with `formatExamName(s.name)` and set tags (`[Set 1]`).
- The identical cascading pattern is replicated in `js/matrix-manager.js` via `syncMatrixSubjectFilter()` and `populateMatrixSessionDropdown()`.

---

## 6. Unified CSV Export Console

### 6.1 Unified Console vs. Fragmented Exports
Earlier iterations relied on fragmented, disparate CSV download triggers that caused severe data management headaches for moderators:
- **Old Single-Test Export (`exportResult`)**: Exported an isolated single student result file (`student_123.csv`) with vertical Q&A rows, requiring manual compilation across a 40-student cohort.
- **Old Results Table Export (`exportAllResults`)**: Exported only the top 10 or current table rows without session metadata, curriculum class, or subject attributes.

The **Unified CSV Export Console (`#exportPage`)** provides an administrative export console:
- Accessible from the main sidebar (`#export`).
- Allows multi-dimensional filtering across Batch/Group (`#exportBatchFilter`), Class (`#exportClassFilter`), and Test Session (`#exportSessionFilter`).
- Generates a single consolidated CSV file containing full academic and session provenance.

### 6.2 Data Schema & Generation Logic (`executeFilteredExport`)
In `dashboard.js`, `executeFilteredExport()` compiles the filtered cohort into an RFC-4180 compliant CSV stream:

```javascript
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

    // Structured CSV headers
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
```

---

## 7. Security-Sensitive Surfaces & Phase 2 Findings

Per system requirement R3, application code must remain untouched in Phase 1. The following security-sensitive surfaces, authorization vulnerabilities, and architectural risks were uncovered during inspection and are formally cataloged for Phase 2 remediation.

### Finding 1: Unauthenticated Anonymous Firebase Auth & Missing RBAC
- **Location**: `dashboard.js` lines 94–112 (`setupAuth()`).
- **Mechanism**: The dashboard automatically calls `signInAnonymously(auth)` if no authenticated user session exists.
- **Risk**: Any user navigating to `dashboard.html` receives an anonymous Firebase user credential. Because `gate-guard.js` has been turned into a permanent no-op per user directive (Gate restrictions removed), there is zero role-based access control (RBAC). Any student or external actor can view all administrative records, cohort grades, and teacher feedback without logging in.
- **Phase 2 Remedy**: Implement Firebase Authentication with verified teacher/moderator custom claims (`role === 'moderator'`). Restrict dashboard routes to authenticated admin tokens.

### Finding 2: Unbounded Client-Side Firestore Collection Fetch (PII & Data Exposure)
- **Location**: `dashboard.js` lines 115–148 (`loadTestResults()`).
- **Mechanism**:
  ```javascript
  const resultsRef = collection(db, 'testResults');
  const q = query(resultsRef);
  const snapshot = await getDocs(q);
  ```
- **Risk**: The entire `testResults` collection is downloaded directly into the client's browser memory (`appState.testResults = []`). This exposes sensitive Personally Identifiable Information (PII) including full student names, student IDs, submission dates, raw handwriting transcriptions, examiner critiques, and total scores for the entire institution. A student inspecting the JavaScript memory (`window.appState`) or network payload can view private evaluations of every peer across all schools.
- **Phase 2 Remedy**: Enforce server-side aggregation and pagination using Firebase Cloud Functions or Next.js API routes. Restrict Firestore queries so that individual students can query only their own UID records (`where('studentId', '==', request.auth.uid)`).

### Finding 3: In-Memory Client Filtering vs. Server-Side Data Isolation
- **Location**: `dashboard.js` lines 321–380 (`applyFilters()`), `js/matrix-manager.js` lines 288–305.
- **Mechanism**: Tenant segregation (e.g. `Nerd Tutors OSEM` vs. `Nerd Tutors Nalanda`), Class separation (`Class 10th` vs `Class 12th`), and Subject filtering are performed purely in client-side JavaScript via `Array.prototype.filter()`.
- **Risk**: Cross-tenant data leakage. Even if a user selects `Nerd Tutors Nalanda`, all exam results from `Nerd Tutors OSEM` have already arrived in the browser payload.
- **Phase 2 Remedy**: Enforce multi-tenant security rules in `firestore.rules` where read permissions are partitioned by organization ID or batch claim.

### Finding 4: Client-Side Mutation of `testSessions` in Firestore (`updateDoc`)
- **Location**: `js/matrix-manager.js` lines 619–627 (`triggerTopicAnalysisForSession()`).
- **Mechanism**: The client-side matrix script directly updates Firestore documents:
  ```javascript
  await updateDoc(doc(matrixState.db, 'testSessions', session.id), {
      topicMap: analysis.topicMap,
      chaptersCovered: analysis.chaptersCovered || [],
      curriculumSummary: analysis.curriculumSummary || ''
  });
  ```
- **Risk**: Firestore client rules currently permit write operations to `testSessions` from anonymous client sessions. Any visitor could craft a client-side snippet to overwrite or wipe official marking schemes, question banks, or curriculum summaries in `testSessions`.
- **Phase 2 Remedy**: Lock `testSessions` writes exclusively to Admin SDK service roles on the backend. Client should only trigger an authenticated Cloud Function or API endpoint that performs the update after verifying caller privileges.

### Finding 5: Unprotected Serverless AI Endpoint (`/api/analyze-topics`)
- **Location**: `api/analyze-topics.js` lines 28–35.
- **Mechanism**: Accepts public `POST` requests without API tokens, HMAC signatures, or session validation (`res.setHeader("Access-Control-Allow-Origin", "*")`).
- **Risk**: An external actor can trigger infinite Vertex AI Gemini 3.8 Flash analysis requests with large custom payloads, causing Denial-of-Wallet (unbounded cloud billing charges) or Google Cloud API quota exhaustion.
- **Phase 2 Remedy**: Enforce server-side rate limiting (via Upstash Redis or Cloudflare Turnstile) and require moderator authorization headers (`Authorization: Bearer <token>`).

### Finding 6: CSV Formula Injection (Spreadsheet Exploitation)
- **Location**: `dashboard.js` lines 470–489, 508–517, 1219–1230; `js/matrix-manager.js` lines 1139–1185.
- **Mechanism**: Student names, question texts, and test names are escaped for double quotes (`replace(/"/g, '""')`), but fields beginning with formula triggers (`=`, `+`, `-`, `@`) are not sanitized.
- **Risk**: If a student registers with a name like `=CMD('calc')` or `=HYPERLINK(...)`, opening the exported CSV in Microsoft Excel or LibreOffice Calc can trigger arbitrary formula execution on the moderator's workstation.
- **Phase 2 Remedy**: Prepend a single quote (`'`) to any cell value that starts with `=`, `+`, `-`, or `@` prior to CSV serializing.

---

## 8. Verification & Component Traceability Matrix

| Component Area | Primary Source Files | Key Functions / Elements | Verification Criterion | Status |
|---|---|---|---|---|
| **View Architecture** | `dashboard.html`, `dashboard.js` | `showPage()`, `#sidebar`, `.page-section` | Clean state transitions across all 6 views without DOM collisions | ✅ Verified |
| **Matrix Normalizer** | `js/matrix-manager.js` | `normalizeQuestionNumber()` | Resolves MCQs, letters, Roman numerals, and subparts into canonical keys | ✅ Verified |
| **Natural Question Sorter** | `js/matrix-manager.js` | `naturalQuestionSort()`, `ROMAN_MAP` | Numerical ordering with Roman numeral subparts ((iv) before (v), (ix) before (x)) | ✅ Verified |
| **Academic Badge Logic** | `js/matrix-manager.js`, `dashboard.css` | `.td-score-red`, `.td-score-light`, `.td-score-white` | Strict board color-coding ($\le 30\%$ Red, $31\text{--}60\%$ Amber, $> 60\%$ White) | ✅ Verified |
| **Matrix Drilldown Flyout** | `js/matrix-manager.js` | `openMatrixDrawerByKey()`, `#matrixCellDrawerBackdrop` | Displays student written text, examiner marks, feedback, and improvement advice | ✅ Verified |
| **Matrix CSV Exporter** | `js/matrix-manager.js` | `exportMatrixCsv()` | Generates 2D cross-sectional CSV with RFC-4180 escaping and totals | ✅ Verified |
| **SVG Trendline Vector** | `js/student-progress-chart.js` | `drawTrend()`, `<polyline>`, `<marker>`, `<circle>` | Renders vector trendline with gradient stroke, arrowhead, and glowing nodes | ✅ Verified |
| **Exam Title Normalizer** | `js/student-progress-chart.js` | `formatExamName()` | Sanitizes epoch IDs, converts date formats to `(DD Mon YYYY)`, cleans brackets | ✅ Verified |
| **Dynamic Cascading Filters** | `dashboard.js`, `js/matrix-manager.js` | `syncAnalyticsSubjectFilter()`, `updateAnalyticsSessionDropdown()` | Class 10th vs 12th strictly scopes valid subjects and sessions | ✅ Verified |
| **Unified Export Console** | `dashboard.js` | `executeFilteredExport()`, `#exportPage` | Exports consolidated multi-dimensional institutional CSV with full metadata | ✅ Verified |
| **Security Findings Catalog** | Full subsystem audit | Section 7 | Comprehensive Phase 2 remediation catalog covering auth, PII, and injection vectors | ✅ Verified |
