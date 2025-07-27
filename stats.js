const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwiGFldMoE0wZLt6Il48rm0I0VV2kR4WaUcWa2drhAbS2z6XXiLOQpGxZNE-bsoEGy0/exec';

const appContainer = document.getElementById('app-container');
const tableContainer = document.getElementById('table-container');
const filterButtons = document.querySelectorAll('.filter-btn');
const englishColsInput = document.getElementById('english-cols');
const showRussianCheckbox = document.getElementById('show-russian');
const toggleUiBtn = document.getElementById('toggle-ui-btn');

let allWords = [];
let currentFilter = 'all';

async function fetchAllWords() {
    try {
        const response = await fetch(`${SCRIPT_URL}?page=stats`);
        allWords = await response.json();
        renderTable();
    } catch (error) {
        tableContainer.innerHTML = '<p>Error loading data.</p>';
        console.error(error);
    }
}

function renderTable() {
    const englishColsCount = parseInt(englishColsInput.value) || 1;
    const showRussian = showRussianCheckbox.checked;

    let filteredWords = allWords.filter(word => {
        switch (currentFilter) {
            case 'new': return word.interval <= 1;
            case 'learning': return word.interval > 1 && word.interval <= 21;
            case 'known': return word.interval > 21;
            case 'all': default: return true;
        }
    });

    if (filteredWords.length === 0) {
        tableContainer.innerHTML = '<p>No words in this category.</p>';
        return;
    }

    let tableHTML = '<table><tbody>';
    filteredWords.forEach(word => {
        tableHTML += '<tr>';
        for (let i = 0; i < englishColsCount; i++) {
            tableHTML += `<td>${word.english}</td>`;
        }
        if (showRussian) {
            tableHTML += `<td>${word.russian}</td>`;
        }
        tableHTML += '</tr>';
    });
    tableHTML += '</tbody></table>';
    tableContainer.innerHTML = tableHTML;
}

filterButtons.forEach(button => {
    button.addEventListener('click', () => {
        filterButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        currentFilter = button.dataset.filter;
        renderTable();
    });
});

toggleUiBtn.addEventListener('click', () => {
    appContainer.classList.toggle('ui-hidden');
});

englishColsInput.addEventListener('input', renderTable);
showRussianCheckbox.addEventListener('change', renderTable);
fetchAllWords();