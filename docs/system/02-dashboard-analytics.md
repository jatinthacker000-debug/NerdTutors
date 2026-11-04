# NerdTutors Dashboard & Analytics Architecture Specification

**Target Document**: `docs/system/02-dashboard-analytics.md`  
**Components Analyzed**:
- `dashboard.html` (DOM Structure, Layout, Modals, Drawers)
- `dashboard.js` (App State, Chart.js Visualizations, Event Handlers, Global Filters)
- `js/matrix-manager.js` (Question Performance Matrix Engine, Canonical Normalization, Drawer Flyout, CSV Export)
- `js/student-progress-chart.js` (SVG Longitudinal Trend Engine, Subject Tabs, Exam Chips, KPI Trajectory)
- `dashboard.css` (Design Tokens, Sticky Coordinate Positioning, Matrix Color Coding, Responsive Breakpoints)
- `api/analyze-topics.js` (Gemini 3.8 Flash AI Auxiliary Topic & NCERT Mapping API)

---

## 1. Executive Summary & Architectural Overview

The NerdTutors Dashboard provides an institutional-grade, cross-sectional evaluation and longitudinal analytics suite for educators and students. Designed for strict adherence to CBSE Class 10th and 12th board standards, the dashboard unifies real-time Firestore ingestion, Google Vertex AI multimodal grading feedback, and cross-session performance metrics into four interconnected modules:

```
+--------------------------------------------------------------------------------------------------+
|                                      NERDTUTORS DASHBOARD                                        |
+--------------------------------------------------------------------------------------------------+
|                                                                                                  |
|  1. Administrative Console (dashboard.html / dashboard.js)                                       |
|     - Real-time KPI Stats (Students, Tests, Avg %, Active Today)                                 |
|     - Multi-Dimensional Filtering (Class -> Subject -> Session -> Batch -> Score -> Date)       |
|     - Chart.js Visualizations (Student Comparison, Score Distribution, 7-Day Activity)           |
|     - Student Management Grid & Filtered CSV Export Engine                                       |
|                                                                                                  |
|  2. Student Multi-Exam Progress Engine (js/student-progress-chart.js)                            |
|     - Longitudinal score progression across examinations within identical curriculum subjects   |
|     - Subject-specific aesthetic themes & dynamic multi-exam filter chips                        |
|     - Pure mathematical SVG trendline with gradient vector interpolation and arrowhead           |
|     - Real-time Trajectory KPI strip (Tests, Average, Peak, Delta +/-%)                          |
|                                                                                                  |
|  3. Question-Wise Student Performance Matrix (js/matrix-manager.js)                              |
|     - 2D Sticky Cross-Sectional Grid (Questions x Students x Class Average)                      |
|     - Canonical Question Number Normalization (Q1, Q2(a), Q5(i), Q17(a)(i))                     |
|     - Strict Board Threshold Color Coding (<=30% Red, 31%-60% Amber, >60% White)                 |
|     - Interactive Flyout Drawer displaying student handwriting transcription & AI audit feedback |
|     - Matrix CSV Export with formula-ready totals and class averages                             |
|                                                                                                  |
|  4. AI Topic Mastery & Weakness Analysis (api/analyze-topics.js / js/matrix-manager.js)          |
|     - Gemini 3.8 Flash deep-reasoning curriculum audit against official NCERT chapters           |
|     - Non-distorted leaf-level question accuracy tracking (eliminates averaging anomalies)      |
|     - Segmented Performance Tiers: Critical (<60%), Needs Improvement (60-90%), Strong (>90%)   |
|     - 1-Column vs 2-Column Responsive Layout Switcher with Collapsible Blueprints                |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Comprehensive DOM Inventory & Interface Layout

### 2.1 Navigation & Master Shell (`dashboard.html`)
- **Sidebar (`#sidebar`)**:
  - Branded gradient header (`.sidebar-header`, `.sidebar-title`).
  - Navigation menu (`.nav-menu`) with routes:
    - `#dashboard` (Dashboard Home)
    - `#students` (Student Management Grid)
    - `#results` (All Test Results Data Table)
    - `#analytics` (Analytics & Insights Charts)
    - `#matrix` (Question-Wise Performance Matrix)
    - `#export` (Filtered Data Export Console)
    - `index.html` (Back to Application Landing)
- **Header (`.header`)**:
  - Mobile Menu Toggle (`#mobileMenuBtn`, `#menuIcon`) supporting desktop collapse (`body.sidebar-collapsed`) and mobile overlay (`#mobileMenuOverlay`).
  - Dynamic Page Title (`.page-title`).
  - Action Controls: Refresh (`#refreshBtn`), CSV Export (`#exportBtn`).
- **Loading State (`#loadingState`)**: Centered spinner (`.loading-spinner`) and informative text indicator (`.loading-text`).

---

### 2.2 Dashboard Home (`#dashboardPage`)
- **KPI Stats Grid (`.stats-grid`)**:
  1. Primary Card: `#totalStudents` + `#studentsTrend` (Unique student IDs).
  2. Success Card: `#totalTests` + `#testsTrend` (Total submitted test instances).
  3. Warning Card: `#avgScore` + `#scoreTrend` (Cohort average percentage).
  4. Danger Card: `#recentActivity` (Evaluations completed today).
- **Recent Results Preview (`.content-section`)**:
  - Header with `#viewAllBtn` routing directly to `#resultsPage`.
  - Data table displaying Student Name, Date, Score, and Type (`#recentResultsBody`).

---

### 2.3 Student Management (`#studentsPage`)
- **Filters Bar (`.filters-bar`)**:
  - Search Input: `#studentSearchInput` (searches by student name).
  - Sort Filter: `#studentSortFilter` (`name`, `tests`, `score`, `recent`).
- **Students Grid (`#studentsGrid`)**: Cards displaying student initials avatar, student ID, tests count, average score, and timestamp of latest test.

---

### 2.4 All Test Results Table (`#resultsPage`)
- **Filters Bar (`.filters-bar`)**:
  - Search Box: `#searchInput`.
  - Batch Filter: `#batchFilter` (`all`, `Both`, `Nerd Tutors OSEM`, `Nerd Tutors Nalanda`, `Others`).
  - Test Type Filter: `#testTypeFilter` (`all`, `mcq`, `text`).
  - Score Filter: `#scoreFilter` (`all`, `high` >=80%, `medium` 50-79%, `low` <50%).
  - Date Filter: `#dateFilter` (`all`, `today`, `week`, `month`).
- **Data Table (`.data-table-container`)**:
  - Sortable headers (`.sortable[data-sort="name|date|score"]`).
  - Table Body: `#resultsTableBody`.
  - Empty State: `#emptyState`.
  - Row Actions: `window.viewDetails(resultId)`, `window.exportResult(resultId)`.

---

### 2.5 Analytics & Comparative Insights (`#analyticsPage`)
- **Header Action**: `#btnGoToMatrix` (Quick shortcut navigating directly to the Question Matrix).
- **Cascading Filter Bar**:
  - Class Filter: `#analyticsClassFilter` (`all`, `Class 10th`, `Class 12th`).
  - Subject Filter: `#analyticsSubjectFilter` (dynamically synced to Class).
  - Session Filter: `#analyticsSessionFilter` (dynamically populated with sessions matching class and subject).
- **Student Marks Comparison Card**:
  - Toggle Metric Button: `#btnToggleChartMetric` (switches Y-axis between Percentage `%` and Raw Marks Obtained).
  - Canvas: `#studentPerformanceChart`.
- **Cohort Analytics Row (`.analytics-stats`)**:
  - Doughnut Chart: Score Distribution (`#scoreDistributionChart`).
  - Bar Chart: Tests Per Day over last 7 days (`#testsPerDayChart`).
- **Tabular Breakdowns**:
  - Performance by Test Type: `#typeBreakdownBody` (MCQ vs TEXT vs OCR statistics).
  - Leaderboard: `#leaderboardBody` (Top 5 performers with 🥇, 🥈, 🥉 medals).
  - Detailed Results Data Table: `#detailedResultsBody`.

---

### 2.6 Filtered CSV Data Export Console (`#exportPage`)
- Dedicated form container with Batch Filter (`#exportBatchFilter`), Class Filter (`#exportClassFilter`), and Session Filter (`#exportSessionFilter`).
- Execute Button: `#btnExecuteExport` generating an institution-wide CSV file.

---

### 2.7 Question-Wise Student Performance Matrix (`#matrixPage`)
- **Header Controls**:
  - `#matrixRefreshBtn`: Re-evaluates active memory against Firestore.
  - `#matrixPrintBtn`: Enforces zero-margin `@page` print stylesheet.
  - `#matrixExportBtn`: Generates full 2D matrix CSV with question numbers, topics, student marks, and class averages.
- **Filter Bar**:
  - `#matrixClassFilter`: Class 10th vs Class 12th.
  - `#matrixSubjectFilter`: Dynamic subject options based on class.
  - `#matrixSessionFilter`: Test session picker.
  - `#matrixBatchFilter`: Batch/Group filter (`all`, `Both`, `Nerd Tutors OSEM`, `Nerd Tutors Nalanda`, `Others`).
  - `#matrixStudentSearch`: Live search filtering student columns.
  - `#matrixQuestionTypeFilter`: Question filter (`all`, `mistakes` only showing questions where at least one student lost marks, `full` only showing questions where all students scored 100%).
- **KPI Summary Cards**:
  - `#matrixStudentsCount`: Number of active students displayed.
  - `#matrixQuestionsCount`: Number of distinct question items mapped.
  - `#matrixToughestQ` & `#matrixToughestQSub`: Lowest class accuracy question.
  - `#matrixEasiestQ` & `#matrixEasiestQSub`: Highest class accuracy question.
- **Topic Analysis Section**: `#matrixTopicAnalysisSection` (Dynamic AI diagnostic container).
- **Matrix Scroll Table**:
  - Container: `#matrixTableWrapper` > `#matrixScrollContainer`.
  - Elements: `#questionMatrixTable`, `#matrixTableHead`, `#matrixTableBody`, `#matrixTableFoot`.
  - Empty State: `#matrixEmptyState`.
- **Student Progress Chart Integration**: Embedded directly below the matrix in `#studentProgressChartSection`.

---

### 2.8 Modals & Slide-Over Drawers
- **Student Detail Modal (`#detailModal`)**:
  - Triggered by `#resultsTableBody` "View" button.
  - Fields: `#modalStudentName`, `#modalStudentId`, `#modalScore`, `#modalPercentage`, `#modalDate`.
  - Breakdown: `#modalAnswersList` (question prompt, student answer, earned/max marks with progress bar, AI feedback, suggestions for improvement).
  - Close button: `#closeModal` (also supports ESC key and backdrop click).
- **Matrix Cell Detail Flyout Drawer (`#matrixCellDrawerBackdrop`)**:
  - Triggered by clicking any score cell inside `#questionMatrixTable`.
  - Header: `#drawerSessionLabel`, `#drawerStudentName`, `#drawerQuestionNumber`, Close Button (`#btnCloseMatrixDrawer`).
  - Body Cards:
    - Score & Badge: `#drawerScoreValue`, `#drawerScoreBadge` (Full Marks / Partial Marks / Zero Marks).
    - Question Prompt: `#drawerQuestionText`.
    - Student Answer / OCR Transcription: `#drawerStudentAnswer`.
    - Examiner Feedback: `#drawerFeedback`.
    - Improvement Advice: `#drawerImprovementsBox`, `#drawerImprovementsList`.

---

## 3. Student Multi-Exam Progress Engine (`js/student-progress-chart.js`)

The Student Progress Chart is a longitudinal performance engine designed to track a single student's performance across multiple examinations over time.

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

### 3.1 Subject Theming System
Every subject is assigned a deterministic color palette and icon via `SUBJECT_THEMES`:
- **Economics**: Indigo (`#4f46e5`, gradient `linear-gradient(180deg, #6366f1 0%, #4f46e5 100%)`, icon `📘`).
- **Business Studies**: Amber (`#d97706`, gradient `linear-gradient(180deg, #f59e0b 0%, #d97706 100%)`, icon `📙`).
- **Accountancy**: Sky Blue (`#0284c7`, gradient `linear-gradient(180deg, #38bdf8 0%, #0284c7 100%)`, icon `📊`).
- **Social Science**: Emerald (`#059669`, gradient `linear-gradient(180deg, #10b981 0%, #059669 100%)`, icon `🌍`).
- **English**: Violet (`#7c3aed`, icon `📝`).
- **Mathematics**: Rose (`#e11d48`, icon `📐`).

### 3.2 Exam Name & Date Normalization (`formatExamName`)
Exam session titles often contain raw timestamp suffixes, unformatted date strings, or redundant platform prefixes. `formatExamName(raw)` cleans them into humanized titles:
1. **Timestamp Removal**: Strips epoch suffixes like `_1793101570263` using `/[_-]\d{10,}\b/g`.
2. **Date Conversion (4-digit & 2-digit years)**: Detects date patterns (`25 10 2026`, `25.10.2026`, `25-10-2026`, `25/10/26`) and transforms them into standardized month representations (e.g. `(25 Oct 2026)`).
3. **Prefix & Parentheses Cleanup**: Strips leading `NerdTutors -` prefixes, collapses double nested brackets `((...))` to single brackets, replaces underscores with spaces, and trims extra whitespace.

### 3.3 Dynamic Filter Bars & Subject Tabs
1. **Subject Filter Tabs (`#progressSubjectTabs`)**:
   - Generates an `All Subjects` pill with total test count.
   - Generates individual subject pills with theme icons and test count badges.
   - Switching subjects automatically resets `deselectedExamIds` and recalculates the cohort.
2. **Multi-Exam Comparison Chips (`#progressExamChips`)**:
   - Only appears when 2 or more exams are available for the selected subject.
   - Each chip displays a check state (`✓` when active, `+` when excluded).
   - Enforces a safety rule: `deselectedExamIds` will never allow deselecting the final remaining exam, ensuring the chart is never left empty.

### 3.4 Trajectory KPI Strip (`#progressKpiStrip`)
Calculates four performance metrics for the active selection:
1. **Tests Count**: Total examinations currently visible.
2. **Average Score**: Mean percentage score across active tests.
3. **Peak Score**: Highest percentage achieved in the selected series.
4. **Trajectory Delta**: Mathematical difference between the latest exam and the base (first) exam:
   $$\Delta = \text{Score}_{\text{latest}} - \text{Score}_{\text{first}}$$
   - Styled as `.positive` (`▲ +X%`, green `#059669`) or `.negative` (`▼ -X%`, red `#dc2626`).

### 3.5 Accurate SVG Trendline with Arrowhead (`drawTrend`)
Instead of standard canvas charts, the trendline is rendered via an inline SVG layer overlaid directly on top of DOM bar elements:
1. **DOM Geometry Projection**: Iterates through each `.col` element, extracts `col.getBoundingClientRect()` and `stack.getBoundingClientRect()`, and calculates exact $(x, y)$ coordinates relative to `#progressPlot`.
2. **Marker Arrowhead**: Declares a `<marker id="trendArrow">` pointing from $(x_1, y_1)$ to $(x_2, y_2)$ oriented with `auto-start-reverse`.
3. **Dashed Gradient Vector**: Draws a `<polyline>` with `stroke="url(#trendGradient)"`, `stroke-width="2.5"`, `stroke-dasharray="6 4"`, and `marker-end="url(#trendArrow)"`.
4. **Milestone Nodes**: Injects `<circle>` elements at each coordinate point with white fill, theme border, and a glowing CSS drop-shadow filter (`drop-shadow(0 2px 4px rgba(59, 130, 246, 0.4))`).

---

## 4. Question-Wise Student Performance Matrix (`js/matrix-manager.js`)

The Question Performance Matrix provides an item-response grid showing individual questions as rows and students as columns.

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

### 4.1 Canonical Question Number Normalization (`normalizeQuestionNumber`)
Because different OCR transcripts, marking schemes, and models output question labels in varied forms, `normalizeQuestionNumber(raw)` maps all variations to a unified key:
- **MCQs & Standard**: `"Question 1"`, `"Q.1"`, `"Q 1"`, `"Q-1"` $\rightarrow$ `"Q1"`
- **Sub-part Letters**: `"Q2a"`, `"Q2(a)"`, `"Q2.a"`, `"Q2 - a"`, `"Q2A"` $\rightarrow$ `"Q2(a)"`
- **Roman Numerals**: `"Q5i"`, `"Q5(i)"`, `"Q5.i"`, `"Q5 - i"`, `"Q5 (ii)"` $\rightarrow$ `"Q5(i)"`, `"Q5(ii)"`
- **Multi-Level Partials**: `"Q17a(i)"`, `"Q17(a)(i)"` $\rightarrow$ `"Q17(a)(i)"`
- **Numeric Subparts**: `"Q10.1"`, `"Q10(1)"` $\rightarrow$ `"Q10(1)"`

### 4.2 Natural Question Sorting with Roman Part Resolution (`naturalQuestionSort`)
Standard alphabetical sorting fails for academic numbering (placing `Q10` before `Q2` and sorting `(ix)` incorrectly). `naturalQuestionSort(a, b)`:
1. Splits strings into prefix (`Q`), integer number (`1..34`), and subpart (`(a)`, `(i)`).
2. Compares integer question numbers numerically.
3. Maps Roman numerals via `ROMAN_MAP`:
   ```javascript
   const ROMAN_MAP = {
       '(i)': 1, '(ii)': 2, '(iii)': 3, '(iv)': 4, '(v)': 5,
       '(vi)': 6, '(vii)': 7, '(viii)': 8, '(ix)': 9, '(x)': 10
   };
   ```
   Ensuring `(iv)` is sorted before `(v)`, and `(ix)` is sorted before `(x)`.

### 4.3 Academic Score Threshold Color-Coding
Every matrix cell is scored against strict board thresholds:

| Performance Tier | Score Percentage | CSS Class | Visual Styling | Symbol |
|---|---|---|---|---|
| **Critical / Deficit** | $\le 30\%$ | `.td-score-red` | Background `#fee2e2`, Border `#fca5a5`, Text `#991b1b` | `✗` (if 0) or `!` |
| **Developing / Partial** | $31\% \text{ to } 60\%$ | `.td-score-light` | Background `#fef9c3`, Border `#fde047`, Text `#854d0e` | `!` |
| **Mastered / Strong** | $> 60\%$ | `.td-score-white` | Background `#ffffff`, Border `#e2e8f0`, Text `#1e293b` | `✓` |
| **Unattempted / Absent** | N/A | `.td-score-empty` | Background `#f8fafc`, Border `#f1f5f9`, Text `#94a3b8` | `-` |

### 4.4 Sticky Two-Dimensional Coordinates
In `dashboard.css`, coordinate locks ensure fluid exploration on large test cohorts:
- `thead th`: `position: sticky; top: 0; z-index: 10;`
- `th.th-question`: `position: sticky; left: 0; z-index: 20;`
- `th.th-avg`: `position: sticky; right: 0; z-index: 20;`
- `tbody td.td-question`: `position: sticky; left: 0; z-index: 5;`
- `tbody td.td-avg`: `position: sticky; right: 0; z-index: 5;`
- `tfoot td`: `position: sticky; bottom: 0; z-index: 10;`

### 4.5 Interactive Evaluation Drawer (`window.openMatrixDrawerByKey`)
Clicking any cell accesses `window._matrixDrawerCache[payloadKey]` and opens `#matrixCellDrawerBackdrop`:
- Renders student's written response / OCR transcription.
- Displays examiner marks vs maximum marks with score badge.
- Shows AI feedback remarks and actionable improvement points (`improvements` array).

### 4.6 Matrix CSV Export Engine (`exportMatrixCsv`)
Exports the entire 2D cross-sectional table into CSV format:
- Headers: `Question Number, Topic, Student 1 (Batch), ..., Class Average (%)`
- Data rows: `Q1 (1 Marks), Topic Name, score1, score2, ..., avg%`
- Footer row: `TOTAL SCORE, All Topics, total1/max, total2/max, ..., grandAvg%`

---

## 5. CBSE Topic Mastery & Class Weakness Analytics

Integrated into the Question Matrix is an AI-powered diagnostic engine (`renderTopicAnalysis`) backed by `api/analyze-topics.js`.

### 5.1 Gemini 3.8 Flash Auxiliary Endpoint (`api/analyze-topics.js`)
- **Model**: `gemini-3.8-flash` via Google Cloud Vertex AI (fallback to `gemini-4-argon`).
- **Configuration**: Deterministic hard-pinning (`temperature: 0.0`, `seed: 42`, `responseMimeType: "application/json"`).
- **Prompt Directive**: Maps every question and sub-part to official NCERT chapters (e.g. *"Money and Banking"*, *"Government Budget"* rather than generic subject names), identifying specific tested topics, cognitive skills (*Remembering, Understanding, Applying, Analysing, Evaluating*), and question types (*MCQ, Numerical, Case Study, Theory*).
- **Persistence**: Results are saved directly into Firestore document `testSessions/{sessionId}` under `topicMap`, `chaptersCovered`, and `curriculumSummary`.

### 5.2 Leaf-Level Non-Distorted Topic Cards
To avoid misleading teachers by averaging high-performing and low-performing questions that share a general topic, each question is evaluated as an independent card:
- Individual accuracy calculated strictly:
  $$\text{Accuracy} = \frac{\sum \text{Score}}{\sum \text{MaxMarks}} \times 100$$
- Visual bar reflecting question accuracy.
- Metadata showing question weight, class total points earned, and response count.

### 5.3 Segmented Performance Filter Tabs & Layout Controls
- **Performance Tiers**:
  1. `🔴 Critical (< 60%)`: High priority for revision.
  2. `🟡 Need Improvement (60%–90%)`: Partial understanding.
  3. `🟢 Strong Topics (> 90%)`: Concept fully mastered.
  4. `📋 All Questions`: Complete curriculum view.
- **Dynamic Tier Counts**: Badges on filter buttons display real-time counts.
- **1-Col vs 2-Col Layout Switcher**:
  - `window.setTopicGridLayout(1)`: Sets `gridTemplateColumns = '1fr'`.
  - `window.setTopicGridLayout(2)`: Sets `gridTemplateColumns = 'repeat(auto-fill, minmax(360px, 1fr))'`.
- **Collapsible Section**: `window.toggleTopicAnalysisCollapse()` collapses the grid to preserve vertical screen space.

---

## 6. Global Filtering & Administrative Console (`dashboard.js`)

### 6.1 Cascading Class <-> Subject Synchronization
When a user switches the class filter (`analyticsClassFilter` or `matrixClassFilter`):
- `Class 10th` restricts subject options to: `All Subjects (Class 10th)`, `Social Science`.
- `Class 12th` restricts subject options to: `All Subjects (Class 12th)`, `Economics`, `Business Studies`, `Accountancy`.
- Cascades immediately into the session dropdown, filtering test sessions to only those matching the selected class and subject.

### 6.2 Analytics Chart.js Visualizations
1. **Student Marks Comparison Bar Chart (`#studentPerformanceChart`)**:
   - Compares cohort students side-by-side.
   - Controlled by `#btnToggleChartMetric` (toggles between Percentage `%` and Raw Marks Obtained).
2. **Score Distribution Doughnut Chart (`#scoreDistributionChart`)**:
   - Groups cohort into High ($\ge 80\%$), Medium ($50\text{--}79\%$), and Low ($< 50\%$).
3. **Daily Submissions Activity Chart (`#testsPerDayChart`)**:
   - Evaluates test activity over the previous 7 days using rolling date windows.

---

## 7. State Management, Event Architecture & Data Flow

```
                           +--------------------------+
                           |   Firebase Firestore     |
                           | (testResults / Sessions) |
                           +--------------------------+
                                     |      |
             onSnapshot (Real-time)  |      |  getDocs (Initial load)
                                     v      v
                           +--------------------------+
                           |     appState (Memory)    |
                           |  - testResults: []       |
                           |  - filteredResults: []   |
                           |  - chartMetric: 'pct'    |
                           +--------------------------+
                                  /            \
                                 /              \
                                v                v
         +----------------------------+   +----------------------------+
         |      matrixState           |   | student-progress-chart.js  |
         |  - questionIndex (Map)     |   |  - cachedResults: []       |
         |  - activeStudents: []      |   |  - activeStudent: 'Name'   |
         |  - activeQuestions: []     |   |  - activeSubject: 'ALL'    |
         |  - _matrixDrawerCache: {}  |   |  - deselectedExamIds: Set  |
         +----------------------------+   +----------------------------+
```

### 7.1 State Schemas

#### Global Application State (`appState` in `dashboard.js`)
```javascript
const appState = {
    testResults: [],       // Raw testResults from Firestore
    filteredResults: [],   // Results filtered by search/batch/type/score/date
    charts: {},            // Chart.js instances (studentPerformance, scoreDistribution, testsPerDay)
    sortField: 'date',     // 'name' | 'date' | 'score'
    sortOrder: 'desc',     // 'asc' | 'desc'
    chartMetric: 'percentage' // 'percentage' | 'score'
};
```

#### Matrix Module State (`matrixState` in `js/matrix-manager.js`)
```javascript
let matrixState = {
    results: [],           // Test results passed from appState
    sessions: [],          // Active sessions with topicMaps loaded from Firestore
    questionMap: new Map(),// Canonical question index
    studentList: [],       // Unique student list
    questionList: [],      // Naturally sorted question identifiers
    activeDrawerData: null,// Data currently loaded in slide-over drawer
    activeStudents: [],    // Filtered student objects for export
    activeQuestions: [],   // Filtered question strings for export
    questionIndex: null    // Map of normalized questions -> responses
};
```

#### Progress Chart State (`js/student-progress-chart.js`)
```javascript
let cachedResults = [];          // Complete evaluation dataset
let activeStudent = null;        // Currently selected student name
let activeSubject = "ALL";       // Active subject filter tab
let deselectedExamIds = new Set();// Set of exam IDs excluded via comparison chips
let mode = "pct";                // "pct" | "marks"
```

### 7.2 Event Architecture & Cross-Module Communication
- **Real-Time Data Ingestion**: `setupRealtimeUpdates()` establishes an `onSnapshot()` listener on `collection(db, 'testResults')` limited to the 50 most recent submissions. When triggered, it reloads results and synchronizes both the matrix and progress charts.
- **Cross-Module Student Navigation**:
  - Clicking any student's header in the Matrix table triggers:
    ```javascript
    onclick="window.setStudentProgressName && window.setStudentProgressName('Student Name')"
    ```
  - Coordinates with `window.syncStudentProgressChart(studentName)`, which switches `#progressStudentSelect`, resets subject filters, and scrolls the progress chart into focus.
- **Responsive Sidebar Event**: Handles window resize events, collapses sidebar preferences into `localStorage.getItem('nt_sidebar_collapsed')`, and manages mobile backdrop interactions.

---

## 8. Summary Checklist for Documentation Readiness

| Section / Capability | Implementation Source | Docs Status |
|---|---|---|
| Complete DOM Structure & Modals | `dashboard.html` lines 18–723 | ✅ Documented |
| Longitudinal SVG Trendline & Glow Nodes | `js/student-progress-chart.js` lines 110–177 | ✅ Documented |
| Exam Title Normalization (`formatExamName`) | `js/student-progress-chart.js` lines 39–81 | ✅ Documented |
| Canonical Question Normalizer | `js/matrix-manager.js` lines 51–96 | ✅ Documented |
| Natural Question Sorting & Roman Partitions | `js/matrix-manager.js` lines 106–139 | ✅ Documented |
| Academic Matrix Score Threshold Colors | `js/matrix-manager.js` lines 460–475, `dashboard.css` | ✅ Documented |
| Slide-Over Cell Detail Flyout Drawer | `js/matrix-manager.js` lines 991–1032 | ✅ Documented |
| Matrix CSV Export Formulation | `js/matrix-manager.js` lines 1122–1198 | ✅ Documented |
| Gemini 3.8 Flash Topic Analysis API | `api/analyze-topics.js` lines 28–198 | ✅ Documented |
| Leaf-Level Topic Performance Grid & Tiers | `js/matrix-manager.js` lines 695–907 | ✅ Documented |
| Class <-> Subject Cascading Filters | `dashboard.js` lines 784–844, `js/matrix-manager.js` | ✅ Documented |
| Firestore Realtime Synchronization | `dashboard.js` lines 1263–1271 | ✅ Documented |

