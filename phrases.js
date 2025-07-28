const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2lP9WGeEnXf-QhLPa8Ggu6FKytoMQ8Fh-IbeSXSHsvGB7YrnDQNkVSg8kqbYiWVYs/exec';

const phrasesContainer = document.getElementById('phrases-list-container');
const tagsFilterContainer = document.getElementById('tags-filter-container');

let allPhrases = [], activeTags = new Set();

async function fetchData() {
    try {
        const response = await fetch(`${SCRIPT_URL}?page=phrases`);
        allPhrases = await response.json();
        generateTagFilters();
        renderPhrases();
    } catch (error) {
        phrasesContainer.innerHTML = '<p>Error loading phrases.</p>';
    }
}

function generateTagFilters() {
    const tags = new Set(allPhrases.flatMap(p => p.tags.split(',').map(t => t.trim()).filter(t => t)));
    tags.forEach(tag => {
        const button = document.createElement('button');
        button.className = 'filter-btn tag-btn';
        button.dataset.tag = tag;
        button.textContent = tag;
        button.addEventListener('click', () => {
            button.classList.toggle('active');
            if (activeTags.has(tag)) activeTags.delete(tag); else activeTags.add(tag);
            renderPhrases();
        });
        tagsFilterContainer.appendChild(button);
    });
}

// --- ОСНОВНОЕ ИЗМЕНЕНИЕ ЗДЕСЬ ---
function renderPhrases() {
    // 1. Сначала группируем все фразы по их заголовкам
    const groups = [];
    let currentGroup = null;

    allPhrases.forEach(phrase => {
        if (phrase.phrase.startsWith('#')) {
            currentGroup = { header: phrase, phrases: [] };
            groups.push(currentGroup);
        } else {
            if (!currentGroup) {
                // Если фразы идут до первого заголовка, создаем группу "без заголовка"
                currentGroup = { header: null, phrases: [] };
                groups.push(currentGroup);
            }
            currentGroup.phrases.push(phrase);
        }
    });

    phrasesContainer.innerHTML = ''; // Очищаем контейнер

    // 2. Теперь проходимся по каждой группе отдельно
    groups.forEach(group => {
        // 3. Фильтруем фразы ВНУТРИ группы
        const filteredPhrases = group.phrases.filter(phrase => {
            if (activeTags.size === 0) return true;
            const phraseTags = phrase.tags.split(',').map(t => t.trim());
            return phraseTags.some(t => activeTags.has(t));
        });

        // 4. Если в группе после фильтрации остались фразы, показываем ее
        if (filteredPhrases.length > 0) {
            // Сначала показываем заголовок (если он есть)
            if (group.header) {
                const header = document.createElement('h3');
                header.className = 'phrase-header';
                header.textContent = group.header.phrase.substring(1).trim();
                phrasesContainer.appendChild(header);
            }

            // 5. Сортируем отфильтрованные фразы ВНУТРИ группы по рейтингу
            filteredPhrases.sort((a, b) => (b.rating || 0) - (a.rating || 0));

            // 6. Рендерим отсортированные фразы
            filteredPhrases.forEach(phrase => {
                const card = document.createElement('div');
                card.className = 'phrase-card';
                
                const mainContent = document.createElement('div');
                mainContent.className = 'phrase-main-content';
                mainContent.innerHTML = `<p class="phrase-text">${phrase.phrase}</p>` +
                    `<div class="tags-container">` +
                    phrase.tags.split(',').map(t => t.trim() ? `<span class="tag-label">${t.trim()}</span>` : '').join('') +
                    `</div>`;

                const controlsHTML = `<div class="phrase-controls">
                    <button class="card-icon-btn audio-btn" data-text="${phrase.phrase}">🔊</button>
                    <div class="rating-stars" data-id="${phrase.id}">
                        ${[1, 2, 3, 4, 5].map(i => `<span class="star ${i <= phrase.rating ? 'active' : ''}" data-value="${i}">★</span>`).join('')}
                    </div>
                </div>`;
                
                card.appendChild(mainContent);
                card.innerHTML += controlsHTML;
                phrasesContainer.appendChild(card);
            });
        }
    });

    if (phrasesContainer.innerHTML === '') {
        phrasesContainer.innerHTML = '<p>No phrases match your criteria.</p>';
    }
}


phrasesContainer.addEventListener('click', e => {
    if (e.target.closest('.audio-btn')) {
        const text = e.target.closest('.audio-btn').dataset.text;
        if (text && 'speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'en-US';
            window.speechSynthesis.speak(utterance);
        }
    } else if (e.target.classList.contains('star')) {
        const ratingContainer = e.target.parentElement;
        const newRating = e.target.dataset.value;
        const phraseId = ratingContainer.dataset.id;
        updateRating(phraseId, newRating);
    }
});

async function updateRating(id, rating) {
    const phrase = allPhrases.find(p => p.id == id);
    if (phrase) phrase.rating = rating;
    renderPhrases(); // Просто перерисовываем все с уже обновленными данными
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ action: 'updatePhraseRating', id, rating })
        });
    } catch (error) {
        console.error("Failed to update rating:", error);
    }
}

fetchData();