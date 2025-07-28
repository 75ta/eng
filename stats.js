const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2lP9WGeEnXf-QhLPa8Ggu6FKytoMQ8Fh-IbeSXSHsvGB7YrnDQNkVSg8kqbYiWVYs/exec';

const appContainer = document.getElementById('app-container');
const tableContainer = document.getElementById('table-container');
const filterButtons = document.querySelectorAll('.filter-btn');
const englishColsInput = document.getElementById('english-cols');
const showRussianCheckbox = document.getElementById('show-russian');
const toggleUiBtn = document.getElementById('toggle-ui-btn');
const tagsFilterContainer = document.getElementById('tags-filter-container');
const showHistoryCheckbox = document.getElementById('show-history');

let allWords = [], activeTags = new Set();

async function fetchAllWords() {
    try {
        const response = await fetch(`${SCRIPT_URL}?page=stats`);
        allWords = await response.json();
        generateTagFilters();
        renderTable();
    } catch (error) { tableContainer.innerHTML = '<p>Error loading data.</p>'; }
}

function generateTagFilters() {
    if(!tagsFilterContainer) return;
    const tags = new Set(allWords.flatMap(w => w.tags.split(',').map(t => t.trim()).filter(t => t)));
    tags.forEach(tag => {
        const button = document.createElement('button');
        button.className = 'filter-btn tag-btn';
        button.dataset.tag = tag;
        button.textContent = tag;
        button.addEventListener('click', () => {
            button.classList.toggle('active');
            if(activeTags.has(tag)) activeTags.delete(tag); else activeTags.add(tag);
            renderTable();
        });
        tagsFilterContainer.appendChild(button);
    });
}

function renderTable() {
    const englishColsCount = parseInt(englishColsInput.value) || 1;
    const showRussian = showRussianCheckbox.checked;
    const showHistory = showHistoryCheckbox.checked;
    const progressFilter = document.querySelector('.filter-btn.active[data-filter]').dataset.filter;

    let filteredWords = allWords.filter(word => {
        const progressMatch = (progressFilter === 'all') ||
            (progressFilter === 'new' && word.interval <= 1) ||
            (progressFilter === 'learning' && word.interval > 1 && word.interval <= 21) ||
            (progressFilter === 'known' && word.interval > 21);
        const tagsFromWord = word.tags.split(',').map(t => t.trim());
        const tagMatch = (activeTags.size === 0) || tagsFromWord.some(t => activeTags.has(t));
        return progressMatch && tagMatch;
    });

    if (filteredWords.length === 0) { tableContainer.innerHTML = '<p>No words match your criteria.</p>'; return; }
    
    let tableHTML = '<table><thead><tr>';
    for (let i = 0; i < englishColsCount; i++) { tableHTML += '<th>English</th>'; }
    if (showRussian) { tableHTML += '<th>Russian</th>'; }
    if (showHistory) { tableHTML += '<th>Answer History</th>'; }
    tableHTML += '</tr></thead><tbody>';

    filteredWords.forEach(word => {
        tableHTML += '<tr>';
        for (let i = 0; i < englishColsCount; i++) tableHTML += `<td>${word.english}</td>`;
        if (showRussian) tableHTML += `<td>${word.russian}</td>`;
        if (showHistory) tableHTML += `<td><pre>${word.answerHistory || ''}</pre></td>`;
        tableHTML += '</tr>';
    });
    tableHTML += '</tbody></table>';
    tableContainer.innerHTML = tableHTML;
}

filterButtons.forEach(button => {
    if(button.dataset.filter){
        button.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            renderTable();
        });
    }
});

toggleUiBtn.addEventListener('click', () => appContainer.classList.toggle('ui-hidden'));
englishColsInput.addEventListener('input', renderTable);
showRussianCheckbox.addEventListener('change', renderTable);
showHistoryCheckbox.addEventListener('change', renderTable);

fetchAllWords();