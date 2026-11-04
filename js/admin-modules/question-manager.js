// ============================================
// QUESTION MANAGER
// Question CRUD, MCQ field toggling, edit/preview modals,
// filtering, bulk actions, exports, statistics + charts,
// delete-with-undo, draft autosave and keyboard shortcuts.
// ============================================

import { auth, db } from '../../firebase-config.js';
import {
    collection,
    addDoc,
    getDocs,
    doc,
    deleteDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import { VALID_CATEGORIES, elements } from './shared-state.js';
import { showToast, showConfirmModal, setupConfirmModal, closeConfirmModal, switchTab } from './admin-utils.js';
import { setupAnswerEvaluation } from './answer-evaluator.js';

// Module state
let allQuestions = [];
let currentEditId = null;
let selectedQuestions = new Set();
let deletedQuestionBackup = null;
let undoTimeout = null;
let draftSaveTimeout = null;
let chartInstances = {};

// Toggle MCQ fields based on question type
export function toggleMcqFields(type, prefix = '') {
    const fieldsId = prefix ? 'editMcqFields' : 'mcqFields';
    const modelAnswerContainerId = prefix ? 'editModelAnswerContainer' : 'modelAnswerContainer';
    const marksId = prefix ? 'editMarks' : 'marks';

    const mcqFields = document.getElementById(fieldsId);
    const modelAnswerContainer = document.getElementById(modelAnswerContainerId);
    const marksInput = document.getElementById(marksId);

    if (type === 'mcq') {
        // Show MCQ fields, hide model answer
        if (mcqFields) mcqFields.style.display = 'block';
        if (modelAnswerContainer) modelAnswerContainer.style.display = 'none';

        // Set required on MCQ fields
        ['optionA', 'optionB', 'optionC', 'optionD', 'correctAnswer'].forEach(id => {
            const el = document.getElementById(prefix ? 'edit' + id.charAt(0).toUpperCase() + id.slice(1) : id);
            el?.setAttribute('required', '');
        });

        // Remove required from model answer
        const modelAnswer = document.getElementById(prefix ? 'editModelAnswer' : 'modelAnswer');
        modelAnswer?.removeAttribute('required');

        // Set marks to 1 for MCQ
        if (marksInput) {
            marksInput.value = 1;
            marksInput.setAttribute('disabled', 'true');
        }
    } else {
        // Show model answer, hide MCQ fields
        if (mcqFields) mcqFields.style.display = 'none';
        if (modelAnswerContainer) modelAnswerContainer.style.display = 'block';

        // Remove required from MCQ fields
        ['optionA', 'optionB', 'optionC', 'optionD', 'correctAnswer'].forEach(id => {
            const el = document.getElementById(prefix ? 'edit' + id.charAt(0).toUpperCase() + id.slice(1) : id);
            el?.removeAttribute('required');
        });

        // Set required on model answer
        const modelAnswer = document.getElementById(prefix ? 'editModelAnswer' : 'modelAnswer');
        modelAnswer?.setAttribute('required', '');

        // Re-enable marks
        if (marksInput) {
            marksInput.removeAttribute('disabled');
        }
    }
}

// Setup MCQ field toggles
export function setupMcqFields() {
    const questionType = document.getElementById('questionType');
    const editQuestionType = document.getElementById('editQuestionType');

    questionType?.addEventListener('change', (e) => {
        toggleMcqFields(e.target.value);
    });

    editQuestionType?.addEventListener('change', (e) => {
        toggleMcqFields(e.target.value, 'edit');
    });

    // Initialize state
    toggleMcqFields(questionType?.value || 'text');
}

// Add Question
export async function addQuestion() {
    const questionType = document.getElementById('questionType').value;

    let questionData = {
        type: questionType,
        text: document.getElementById('questionText').value,
        category: document.getElementById('category').value,
        marks: parseInt(document.getElementById('marks').value) || 1,
        difficulty: document.getElementById('difficulty').value,
        status: document.getElementById('status').value,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email
    };

    // Add MCQ-specific or Text-specific fields
    if (questionType === 'mcq') {
        questionData.options = {
            A: document.getElementById('optionA').value,
            B: document.getElementById('optionB').value,
            C: document.getElementById('optionC').value,
            D: document.getElementById('optionD').value
        };
        questionData.correctAnswer = document.getElementById('correctAnswer').value;
        questionData.marks = 1; // MCQs are always 1 mark
    } else {
        questionData.modelAnswer = document.getElementById('modelAnswer').value;
    }

    try {
        await addDoc(collection(db, 'questions'), questionData);
        showToast('Question added successfully!', 'success');
        elements.questionForm.reset();
        toggleMcqFields('text'); // Reset MCQ fields
        // Clear draft after successful submit
        localStorage.removeItem('questionDraft');
        document.getElementById('draftIndicator')?.classList.remove('show');
        loadQuestions();
        loadStatistics();
    } catch (error) {
        showToast('Failed to add question: ' + error.message, 'error');
    }
}

// Load Questions
export async function loadQuestions() {
    if (!elements.questionsList) return;

    try {
        const querySnapshot = await getDocs(collection(db, 'questions'));
        allQuestions = [];

        querySnapshot.forEach((docSnap) => {
            allQuestions.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });

        displayQuestions(allQuestions);
    } catch (error) {
        console.error('Error loading questions:', error);
        elements.questionsList.innerHTML = '<p>Error loading questions</p>';
    }
}

// Display questions
export function displayQuestions(questions) {
    let html = '';

    questions.forEach((data) => {
        const difficultyClass = data.difficulty?.toLowerCase() || 'medium';
        const status = data.status || 'active';
        const isSelected = selectedQuestions.has(data.id);
        const questionType = data.type || 'text';
        const typeBadge = questionType === 'mcq'
            ? '<span class="badge" style="background: #e8f5e9; color: #2e7d32;">MCQ</span>'
            : '<span class="badge" style="background: #e3f2fd; color: #1565c0;">Text</span>';

        // Build MCQ options preview if applicable
        let mcqPreview = '';
        if (questionType === 'mcq' && data.options) {
            mcqPreview = `
                <div class="mcq-preview" style="margin-top: 1rem; padding: 0.75rem; background: #f8f9fa; border-radius: 8px; font-size: 0.9rem;">
                    <div style="${data.correctAnswer === 'A' ? 'color: #2e7d32; font-weight: bold;' : 'color: #666;'}">A) ${data.options.A || ''}</div>
                    <div style="${data.correctAnswer === 'B' ? 'color: #2e7d32; font-weight: bold;' : 'color: #666;'}">B) ${data.options.B || ''}</div>
                    <div style="${data.correctAnswer === 'C' ? 'color: #2e7d32; font-weight: bold;' : 'color: #666;'}">C) ${data.options.C || ''}</div>
                    <div style="${data.correctAnswer === 'D' ? 'color: #2e7d32; font-weight: bold;' : 'color: #666;'}">D) ${data.options.D || ''}</div>
                </div>
            `;
        }

        html += `
                <div class="question-card ${isSelected ? 'selected' : ''}" data-id="${data.id}">
                    <div class="question-header">
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <input type="checkbox" class="question-checkbox" data-id="${data.id}" ${isSelected ? 'checked' : ''}>
                            <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                            <div class="question-meta">
                                <span class="status-dot ${status}"></span>
                                ${typeBadge}
                                <span class="badge badge-category">${data.category || 'N/A'}</span>
                                <span class="badge badge-marks">${data.marks || 0} marks</span>
                                <span class="badge badge-difficulty ${difficultyClass}">${data.difficulty || 'Medium'}</span>
                            </div>
                        </div>
                        <div class="question-actions">
                            <button class="btn-icon preview" data-id="${data.id}" title="Preview">👁️</button>
                            <button class="btn-icon duplicate" data-id="${data.id}" title="Duplicate">📋</button>
                            <button class="btn-icon edit" data-id="${data.id}" title="Edit">✏️</button>
                            <button class="btn-icon delete" data-id="${data.id}" title="Delete">🗑️</button>
                        </div>
                    </div>
                    <p class="question-text">${data.text || 'No question text'}</p>
                    ${mcqPreview}
                    <div class="question-footer">
                        <span>Created by: ${data.createdBy || 'Unknown'}</span>
                        <span style="display: flex; align-items: center; gap: 0.25rem;">
                            <span class="status-dot ${status}" style="width: 8px; height: 8px;"></span>
                            ${status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                    </div>
                </div>
            `;
    });

    elements.questionsList.innerHTML = html || '<p style="text-align: center; color: #666; padding: 2rem;">No questions found</p>';

    // Setup drag and drop
    if (typeof Sortable !== 'undefined') {
        new Sortable(elements.questionsList, {
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'dragging',
            onEnd: function (evt) {
                showToast('Question order updated', 'success');
            }
        });
    }

    // Attach checkbox handlers
    document.querySelectorAll('.question-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const id = e.target.dataset.id;
            const card = e.target.closest('.question-card');
            if (e.target.checked) {
                selectedQuestions.add(id);
                card.classList.add('selected');
            } else {
                selectedQuestions.delete(id);
                card.classList.remove('selected');
            }
            updateBulkActionsBar();
        });
    });

    // Attach preview handlers
    document.querySelectorAll('.btn-icon.preview').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            openPreviewModal(id);
        });
    });

    // Attach duplicate handlers
    document.querySelectorAll('.btn-icon.duplicate').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            duplicateQuestion(id);
        });
    });

    // Attach edit handlers
    document.querySelectorAll('.btn-icon.edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            openEditModal(id);
        });
    });

    // Attach delete handlers
    document.querySelectorAll('.btn-icon.delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (!id) return;
            showConfirmModal(
                '🗑️',
                'Delete Question?',
                'This action can be undone within 5 seconds.',
                'danger',
                async () => {
                    await deleteQuestionWithUndo(id);
                }
            );
        });
    });
}

// Open Edit Modal
export function openEditModal(questionId) {
    const question = allQuestions.find(q => q.id === questionId);
    if (!question) return;

    currentEditId = questionId;
    const questionType = question.type || 'text';

    document.getElementById('editQuestionId').value = questionId;
    document.getElementById('editQuestionType').value = questionType;
    document.getElementById('editQuestionText').value = question.text || '';
    document.getElementById('editCategory').value = question.category || '';
    document.getElementById('editMarks').value = question.marks || '';
    document.getElementById('editModelAnswer').value = question.modelAnswer || '';
    document.getElementById('editDifficulty').value = question.difficulty || 'Medium';
    document.getElementById('editStatus').value = question.status || 'active';

    // Populate MCQ fields if applicable
    if (questionType === 'mcq' && question.options) {
        document.getElementById('editOptionA').value = question.options.A || '';
        document.getElementById('editOptionB').value = question.options.B || '';
        document.getElementById('editOptionC').value = question.options.C || '';
        document.getElementById('editOptionD').value = question.options.D || '';
        document.getElementById('editCorrectAnswer').value = question.correctAnswer || '';
    } else {
        // Clear MCQ fields for text questions
        document.getElementById('editOptionA').value = '';
        document.getElementById('editOptionB').value = '';
        document.getElementById('editOptionC').value = '';
        document.getElementById('editOptionD').value = '';
        document.getElementById('editCorrectAnswer').value = '';
    }

    // Toggle field visibility
    toggleMcqFields(questionType, 'edit');

    elements.editModal.classList.add('show');
}

// Close Edit Modal
export function closeEditModal() {
    elements.editModal.classList.remove('show');
    currentEditId = null;
}

// Update Question
export async function updateQuestion() {
    if (!currentEditId) return;

    const questionType = document.getElementById('editQuestionType').value;

    let updatedData = {
        type: questionType,
        text: document.getElementById('editQuestionText').value,
        category: document.getElementById('editCategory').value,
        marks: parseInt(document.getElementById('editMarks').value) || 1,
        difficulty: document.getElementById('editDifficulty').value,
        status: document.getElementById('editStatus').value,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email
    };

    // Add MCQ-specific or Text-specific fields
    if (questionType === 'mcq') {
        updatedData.options = {
            A: document.getElementById('editOptionA').value,
            B: document.getElementById('editOptionB').value,
            C: document.getElementById('editOptionC').value,
            D: document.getElementById('editOptionD').value
        };
        updatedData.correctAnswer = document.getElementById('editCorrectAnswer').value;
        updatedData.marks = 1; // MCQs are always 1 mark
        // Clear modelAnswer for MCQ
        updatedData.modelAnswer = null;
    } else {
        updatedData.modelAnswer = document.getElementById('editModelAnswer').value;
        // Clear MCQ-specific fields for text questions
        updatedData.options = null;
        updatedData.correctAnswer = null;
    }

    try {
        await updateDoc(doc(db, 'questions', currentEditId), updatedData);
        showToast('Question updated successfully!', 'success');
        closeEditModal();
        loadQuestions();
    } catch (error) {
        showToast('Failed to update question: ' + error.message, 'error');
    }
}

// Filter Questions
export function filterQuestions() {
    const searchTerm = elements.searchBox?.value.toLowerCase() || '';
    const categoryFilter = elements.filterCategory?.value || '';

    const filtered = allQuestions.filter(q => {
        const matchesSearch = q.text?.toLowerCase().includes(searchTerm) ||
            q.category?.toLowerCase().includes(searchTerm);
        const matchesCategory = !categoryFilter || q.category === categoryFilter;

        return matchesSearch && matchesCategory;
    });

    displayQuestions(filtered);
}

// Load Statistics
export async function loadStatistics() {
    if (!elements.statsGrid) return;

    try {
        const querySnapshot = await getDocs(collection(db, 'questions'));
        const totalQuestions = querySnapshot.size;

        const categoryCount = {};
        const difficultyCount = { Easy: 0, Medium: 0, Hard: 0 };
        const statusCount = { active: 0, inactive: 0 };
        const typeCount = { mcq: 0, text: 0 };
        let totalMarks = 0;

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();

            const category = data.category || 'Uncategorized';
            categoryCount[category] = (categoryCount[category] || 0) + 1;

            const difficulty = data.difficulty || 'Medium';
            difficultyCount[difficulty] = (difficultyCount[difficulty] || 0) + 1;

            const status = data.status || 'active';
            statusCount[status] = (statusCount[status] || 0) + 1;

            const type = data.type || 'text';
            typeCount[type] = (typeCount[type] || 0) + 1;

            totalMarks += data.marks || 0;
        });

        const avgMarks = totalQuestions > 0 ? (totalMarks / totalQuestions).toFixed(1) : 0;

        elements.statsGrid.innerHTML = `
                <div class="stats-grid">
                    <div class="stat-card purple">
                        <h3>Total Questions</h3>
                        <div class="stat-value">${totalQuestions}</div>
                        <div class="stat-label">In Database</div>
                    </div>

                    <div class="stat-card green">
                        <h3>Active Questions</h3>
                        <div class="stat-value">${statusCount.active}</div>
                        <div class="stat-label">${statusCount.inactive} Inactive</div>
                    </div>

                    <div class="stat-card" style="background: linear-gradient(135deg, #2e7d32 0%, #66bb6a 100%);">
                        <h3>MCQ Questions</h3>
                        <div class="stat-value">${typeCount.mcq}</div>
                        <div class="stat-label">${typeCount.text} Text Questions</div>
                    </div>

                    <div class="stat-card orange">
                        <h3>Average Marks</h3>
                        <div class="stat-value">${avgMarks}</div>
                        <div class="stat-label">Per Question</div>
                    </div>
                </div>

                <div class="stats-grid" style="margin-top: 1.5rem;">
                    <div class="stat-card" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);">
                        <h3>Easy Questions</h3>
                        <div class="stat-value">${difficultyCount.Easy}</div>
                        <div class="stat-label">${totalQuestions > 0 ? ((difficultyCount.Easy / totalQuestions) * 100).toFixed(1) : 0}% of Total</div>
                    </div>

                    <div class="stat-card" style="background: linear-gradient(135deg, #30cfd0 0%, #330867 100%);">
                        <h3>Medium Questions</h3>
                        <div class="stat-value">${difficultyCount.Medium}</div>
                        <div class="stat-label">${totalQuestions > 0 ? ((difficultyCount.Medium / totalQuestions) * 100).toFixed(1) : 0}% of Total</div>
                    </div>

                    <div class="stat-card" style="background: linear-gradient(135deg, #ff0844 0%, #ffb199 100%);">
                        <h3>Hard Questions</h3>
                        <div class="stat-value">${difficultyCount.Hard}</div>
                        <div class="stat-label">${totalQuestions > 0 ? ((difficultyCount.Hard / totalQuestions) * 100).toFixed(1) : 0}% of Total</div>
                    </div>
                </div>

                <div class="category-breakdown">
                    <h3>📊 Questions by Category</h3>
                    ${Object.entries(categoryCount)
                .sort((a, b) => b[1] - a[1])
                .map(([category, count]) => `
                            <div class="category-item">
                                <span class="category-name">${category}</span>
                                <span class="category-count">${count}</span>
                            </div>
                        `).join('')}
                </div>

                <!-- Charts Section -->
                <div class="charts-container">
                    <div class="chart-card">
                        <h4>📈 Questions by Category</h4>
                        <div class="chart-wrapper">
                            <canvas id="categoryChart"></canvas>
                        </div>
                    </div>
                    <div class="chart-card">
                        <h4>📊 Difficulty Distribution</h4>
                        <div class="chart-wrapper">
                            <canvas id="difficultyChart"></canvas>
                        </div>
                    </div>
                    <div class="chart-card">
                        <h4>🔄 Status Overview</h4>
                        <div class="chart-wrapper">
                            <canvas id="statusChart"></canvas>
                        </div>
                    </div>
                </div>
            `;

        // Render Charts
        renderCharts(categoryCount, difficultyCount, statusCount);
    } catch (error) {
        console.error('Error loading statistics:', error);
        elements.statsGrid.innerHTML = '<p>Error loading statistics</p>';
    }
}

// Render Charts
export function renderCharts(categoryCount, difficultyCount, statusCount) {
    // Destroy existing charts
    Object.values(chartInstances).forEach(chart => chart?.destroy());

    // Category Chart (Bar)
    const categoryCtx = document.getElementById('categoryChart')?.getContext('2d');
    if (categoryCtx) {
        const sortedCategories = Object.entries(categoryCount).sort((a, b) => b[1] - a[1]);
        chartInstances.category = new Chart(categoryCtx, {
            type: 'bar',
            data: {
                labels: sortedCategories.map(([cat]) => cat.length > 15 ? cat.substring(0, 15) + '...' : cat),
                datasets: [{
                    label: 'Questions',
                    data: sortedCategories.map(([, count]) => count),
                    backgroundColor: [
                        '#667eea', '#764ba2', '#f093fb', '#f5576c',
                        '#4facfe', '#00f2fe', '#43e97b', '#38f9d7',
                        '#fa709a', '#fee140'
                    ],
                    borderRadius: 8,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
    }

    // Difficulty Chart (Doughnut)
    const difficultyCtx = document.getElementById('difficultyChart')?.getContext('2d');
    if (difficultyCtx) {
        chartInstances.difficulty = new Chart(difficultyCtx, {
            type: 'doughnut',
            data: {
                labels: ['Easy', 'Medium', 'Hard'],
                datasets: [{
                    data: [difficultyCount.Easy, difficultyCount.Medium, difficultyCount.Hard],
                    backgroundColor: ['#43e97b', '#4facfe', '#f5576c'],
                    borderWidth: 0,
                    cutout: '60%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { padding: 20, usePointStyle: true }
                    }
                }
            }
        });
    }

    // Status Chart (Pie)
    const statusCtx = document.getElementById('statusChart')?.getContext('2d');
    if (statusCtx) {
        chartInstances.status = new Chart(statusCtx, {
            type: 'pie',
            data: {
                labels: ['Active', 'Inactive'],
                datasets: [{
                    data: [statusCount.active, statusCount.inactive],
                    backgroundColor: ['#4caf50', '#f44336'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { padding: 20, usePointStyle: true }
                    }
                }
            }
        });
    }
}

// Setup all new features
export function setupNewFeatures() {
    setupAdvancedFilters();
    setupBulkActions();
    setupExportButtons();
    setupKeyboardShortcuts();
    setupAutoSave();
    setupPreviewModal();
    setupConfirmModal();
    setupShortcutsHelp();
    setupAnswerEvaluation();
}

// Advanced Filters
function setupAdvancedFilters() {
    const btnToggle = document.getElementById('btnToggleFilters');
    const filtersPanel = document.getElementById('advancedFilters');
    const btnApply = document.getElementById('btnApplyFilters');
    const btnClear = document.getElementById('btnClearFilters');

    btnToggle?.addEventListener('click', () => {
        filtersPanel.classList.toggle('show');
    });

    btnApply?.addEventListener('click', applyAdvancedFilters);
    btnClear?.addEventListener('click', clearFilters);
}

function applyAdvancedFilters() {
    const searchTerm = elements.searchBox?.value.toLowerCase() || '';
    const categoryFilter = elements.filterCategory?.value || '';
    const statusFilter = document.getElementById('filterStatus')?.value || '';
    const difficultyFilter = document.getElementById('filterDifficulty')?.value || '';
    const minMarks = parseInt(document.getElementById('filterMinMarks')?.value) || 0;
    const maxMarks = parseInt(document.getElementById('filterMaxMarks')?.value) || 100;

    const filtered = allQuestions.filter(q => {
        const matchesSearch = !searchTerm ||
            q.text?.toLowerCase().includes(searchTerm) ||
            q.category?.toLowerCase().includes(searchTerm);
        const matchesCategory = !categoryFilter || q.category === categoryFilter;
        const matchesStatus = !statusFilter || (q.status || 'active') === statusFilter;
        const matchesDifficulty = !difficultyFilter || q.difficulty === difficultyFilter;
        const matchesMarks = (q.marks || 0) >= minMarks && (q.marks || 0) <= maxMarks;

        return matchesSearch && matchesCategory && matchesStatus && matchesDifficulty && matchesMarks;
    });

    displayQuestions(filtered);
    showToast(`Found ${filtered.length} questions`, 'success');
}

function clearFilters() {
    elements.searchBox.value = '';
    elements.filterCategory.value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterDifficulty').value = '';
    document.getElementById('filterMinMarks').value = '';
    document.getElementById('filterMaxMarks').value = '';
    displayQuestions(allQuestions);
    showToast('Filters cleared', 'success');
}

// Bulk Actions
function setupBulkActions() {
    const selectAll = document.getElementById('selectAllCheckbox');
    const bulkActivate = document.getElementById('bulkActivate');
    const bulkDeactivate = document.getElementById('bulkDeactivate');
    const bulkCategory = document.getElementById('bulkCategory');
    const bulkDelete = document.getElementById('bulkDelete');
    const bulkCancel = document.getElementById('bulkCancel');

    selectAll?.addEventListener('change', (e) => {
        if (e.target.checked) {
            allQuestions.forEach(q => selectedQuestions.add(q.id));
        } else {
            selectedQuestions.clear();
        }
        displayQuestions(allQuestions);
        updateBulkActionsBar();
    });

    bulkActivate?.addEventListener('click', () => bulkUpdateStatus('active'));
    bulkDeactivate?.addEventListener('click', () => bulkUpdateStatus('inactive'));
    bulkCategory?.addEventListener('click', showCategoryChangeModal);
    bulkDelete?.addEventListener('click', bulkDeleteQuestions);
    bulkCancel?.addEventListener('click', () => {
        selectedQuestions.clear();
        document.getElementById('selectAllCheckbox').checked = false;
        displayQuestions(allQuestions);
        updateBulkActionsBar();
    });
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bulkActionsBar');
    const count = document.getElementById('selectedCount');
    count.textContent = selectedQuestions.size;

    if (selectedQuestions.size > 0) {
        bar.classList.add('show');
    } else {
        bar.classList.remove('show');
    }
}

async function bulkUpdateStatus(status) {
    if (selectedQuestions.size === 0) return;

    showConfirmModal(
        status === 'active' ? '✅' : '⏸️',
        `Set ${selectedQuestions.size} questions to ${status}?`,
        'This will update the status of all selected questions.',
        'success',
        async () => {
            for (const id of selectedQuestions) {
                try {
                    await updateDoc(doc(db, 'questions', id), { status });
                } catch (error) {
                    console.error('Error updating:', error);
                }
            }
            selectedQuestions.clear();
            document.getElementById('selectAllCheckbox').checked = false;
            updateBulkActionsBar();
            loadQuestions();
            showToast(`Updated ${selectedQuestions.size} questions to ${status}`, 'success');
        }
    );
}

function showCategoryChangeModal() {
    const category = prompt('Enter new category:\n' + VALID_CATEGORIES.join('\n'));
    if (!category || !VALID_CATEGORIES.includes(category)) {
        if (category) showToast('Invalid category', 'error');
        return;
    }

    bulkUpdateCategory(category);
}

async function bulkUpdateCategory(category) {
    for (const id of selectedQuestions) {
        try {
            await updateDoc(doc(db, 'questions', id), { category });
        } catch (error) {
            console.error('Error updating:', error);
        }
    }
    selectedQuestions.clear();
    document.getElementById('selectAllCheckbox').checked = false;
    updateBulkActionsBar();
    loadQuestions();
    showToast(`Updated category to ${category}`, 'success');
}

async function bulkDeleteQuestions() {
    if (selectedQuestions.size === 0) return;

    showConfirmModal(
        '🗑️',
        `Delete ${selectedQuestions.size} questions?`,
        'This action cannot be undone for bulk deletes.',
        'danger',
        async () => {
            for (const id of selectedQuestions) {
                try {
                    await deleteDoc(doc(db, 'questions', id));
                } catch (error) {
                    console.error('Error deleting:', error);
                }
            }
            selectedQuestions.clear();
            document.getElementById('selectAllCheckbox').checked = false;
            updateBulkActionsBar();
            loadQuestions();
            loadStatistics();
            showToast('Questions deleted successfully', 'success');
        }
    );
}

// Export Functions
function setupExportButtons() {
    document.getElementById('btnExportExcel')?.addEventListener('click', exportToExcel);
    document.getElementById('btnExportPDF')?.addEventListener('click', exportToPDF);
}

function exportToExcel() {
    const data = allQuestions.map(q => ({
        text: q.text,
        category: q.category,
        marks: q.marks,
        modelAnswer: q.modelAnswer,
        difficulty: q.difficulty,
        status: q.status || 'active',
        createdBy: q.createdBy || 'Unknown'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Questions');

    ws['!cols'] = [
        { wch: 60 }, { wch: 25 }, { wch: 10 },
        { wch: 80 }, { wch: 12 }, { wch: 10 }, { wch: 25 }
    ];

    XLSX.writeFile(wb, `questions_export_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('Excel exported successfully!', 'success');
}

function exportToPDF() {
    if (typeof window.jspdf === 'undefined') {
        showToast('PDF library loading...', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.text('Questions Export', 14, 22);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);

    const tableData = allQuestions.map((q, i) => [
        i + 1,
        q.text?.substring(0, 50) + (q.text?.length > 50 ? '...' : ''),
        q.category || 'N/A',
        q.marks || 0,
        q.difficulty || 'Medium',
        q.status || 'active'
    ]);

    doc.autoTable({
        startY: 40,
        head: [['#', 'Question', 'Category', 'Marks', 'Difficulty', 'Status']],
        body: tableData,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 60, 114] }
    });

    doc.save(`questions_export_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast('PDF exported successfully!', 'success');
}

// Preview Modal
function setupPreviewModal() {
    document.getElementById('btnClosePreview')?.addEventListener('click', closePreviewModal);
    document.getElementById('previewModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'previewModal') closePreviewModal();
    });
}

function openPreviewModal(questionId) {
    const question = allQuestions.find(q => q.id === questionId);
    if (!question) return;

    const status = question.status || 'active';
    document.getElementById('previewMeta').innerHTML = `
            <span class="badge badge-category">${question.category || 'N/A'}</span>
            <span class="badge badge-marks">${question.marks || 0} marks</span>
            <span class="badge badge-difficulty ${(question.difficulty || 'medium').toLowerCase()}">${question.difficulty || 'Medium'}</span>
            <span class="badge" style="background: ${status === 'active' ? '#e8f5e9' : '#ffebee'}; color: ${status === 'active' ? '#2e7d32' : '#c62828'}">
                <span class="status-dot ${status}" style="width: 8px; height: 8px;"></span>
                ${status}
            </span>
        `;
    document.getElementById('previewQuestionText').textContent = question.text || 'No question text';
    document.getElementById('previewModelAnswer').textContent = question.modelAnswer || 'No model answer';

    document.getElementById('previewModal').classList.add('show');
}

function closePreviewModal() {
    document.getElementById('previewModal').classList.remove('show');
}

// Duplicate Question
export async function duplicateQuestion(questionId) {
    const question = allQuestions.find(q => q.id === questionId);
    if (!question) return;

    try {
        await addDoc(collection(db, 'questions'), {
            text: question.text + ' (Copy)',
            category: question.category,
            marks: question.marks,
            modelAnswer: question.modelAnswer,
            difficulty: question.difficulty,
            status: 'inactive',
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser?.email,
            duplicatedFrom: questionId
        });
        showToast('Question duplicated successfully!', 'success');
        loadQuestions();
    } catch (error) {
        showToast('Failed to duplicate: ' + error.message, 'error');
    }
}

// Delete with Undo
export async function deleteQuestionWithUndo(questionId) {
    const question = allQuestions.find(q => q.id === questionId);
    if (!question) return;

    deletedQuestionBackup = { ...question };

    try {
        await deleteDoc(doc(db, 'questions', questionId));
        loadQuestions();
        loadStatistics();
        showUndoToast('Question deleted');
    } catch (error) {
        showToast('Failed to delete: ' + error.message, 'error');
        deletedQuestionBackup = null;
    }
}

function showUndoToast(message) {
    const toast = document.getElementById('undoToast');
    document.getElementById('undoMessage').textContent = message;

    const timerBar = document.getElementById('undoTimerBar');
    timerBar.style.animation = 'none';
    timerBar.offsetHeight;
    timerBar.style.animation = 'shrink 5s linear forwards';

    toast.classList.add('show');

    if (undoTimeout) clearTimeout(undoTimeout);
    undoTimeout = setTimeout(() => {
        toast.classList.remove('show');
        deletedQuestionBackup = null;
    }, 5000);

    document.getElementById('undoBtn').onclick = async () => {
        if (deletedQuestionBackup) {
            try {
                const { id, ...data } = deletedQuestionBackup;
                await addDoc(collection(db, 'questions'), {
                    ...data,
                    restoredAt: serverTimestamp()
                });
                showToast('Question restored!', 'success');
                loadQuestions();
                loadStatistics();
            } catch (error) {
                showToast('Failed to restore: ' + error.message, 'error');
            }
        }
        toast.classList.remove('show');
        clearTimeout(undoTimeout);
        deletedQuestionBackup = null;
    };
}

// Auto-save Draft
function setupAutoSave() {
    const fields = ['questionText', 'category', 'marks', 'modelAnswer', 'difficulty', 'status'];

    fields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        field?.addEventListener('input', () => saveDraft());
        field?.addEventListener('change', () => saveDraft());
    });
}

function saveDraft() {
    if (draftSaveTimeout) clearTimeout(draftSaveTimeout);

    const indicator = document.getElementById('draftIndicator');
    const text = document.getElementById('draftText');
    indicator.classList.add('show', 'saving');
    text.textContent = 'Saving...';

    draftSaveTimeout = setTimeout(() => {
        const draft = {
            questionText: document.getElementById('questionText')?.value || '',
            category: document.getElementById('category')?.value || '',
            marks: document.getElementById('marks')?.value || '',
            modelAnswer: document.getElementById('modelAnswer')?.value || '',
            difficulty: document.getElementById('difficulty')?.value || '',
            status: document.getElementById('status')?.value || '',
            savedAt: Date.now()
        };

        localStorage.setItem('questionDraft', JSON.stringify(draft));

        indicator.classList.remove('saving');
        text.textContent = 'Draft saved';

        setTimeout(() => {
            if (!document.getElementById('questionText')?.value) {
                indicator.classList.remove('show');
            }
        }, 2000);
    }, 500);
}

export function loadDraft() {
    const draft = localStorage.getItem('questionDraft');
    if (!draft) return;

    try {
        const data = JSON.parse(draft);
        if (Date.now() - data.savedAt > 24 * 60 * 60 * 1000) {
            localStorage.removeItem('questionDraft');
            return;
        }

        if (data.questionText) {
            document.getElementById('questionText').value = data.questionText;
            document.getElementById('category').value = data.category;
            document.getElementById('marks').value = data.marks;
            document.getElementById('modelAnswer').value = data.modelAnswer;
            document.getElementById('difficulty').value = data.difficulty || 'Medium';
            document.getElementById('status').value = data.status || 'active';

            document.getElementById('draftIndicator').classList.add('show');
            document.getElementById('draftText').textContent = 'Draft restored';
        }
    } catch (e) {
        localStorage.removeItem('questionDraft');
    }
}


// Keyboard Shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 's':
                    e.preventDefault();
                    if (document.querySelector('.tab-panel.active#addTab')) {
                        document.getElementById('submitBtn')?.click();
                    }
                    break;
                case 'n':
                    e.preventDefault();
                    switchTab('add');
                    document.getElementById('questionText')?.focus();
                    break;
                case 'f':
                    e.preventDefault();
                    switchTab('manage');
                    elements.searchBox?.focus();
                    break;
                case 'e':
                    e.preventDefault();
                    exportToExcel();
                    break;
                case '/':
                    e.preventDefault();
                    document.getElementById('advancedFilters')?.classList.toggle('show');
                    break;
                case 'a':
                    if (document.querySelector('.tab-panel.active#manageTab')) {
                        e.preventDefault();
                        document.getElementById('selectAllCheckbox')?.click();
                    }
                    break;
            }
        }

        if (e.key === 'Escape') {
            closeEditModal();
            closePreviewModal();
            closeConfirmModal();
        }
    });
}

// Shortcuts Help Panel
function setupShortcutsHelp() {
    const btn = document.getElementById('btnShortcuts');
    const panel = document.getElementById('shortcutsHelp');

    btn?.addEventListener('click', () => {
        panel.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!panel?.contains(e.target) && e.target !== btn) {
            panel?.classList.remove('show');
        }
    });
}
