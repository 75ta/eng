const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwiGFldMoE0wZLt6Il48rm0I0VV2kR4WaUcWa2drhAbS2z6XXiLOQpGxZNE-bsoEGy0/exec';

const wordEl = document.getElementById('word');
const translationEl = document.getElementById('translation');
const cardContainer = document.querySelector('.card');
const showAnswerBtn = document.getElementById('show-answer-btn');
const answerButtons = document.getElementById('answer-buttons');
const messageArea = document.getElementById('message-area');

// Новые ID для кнопок
const againBtn = document.getElementById('again-btn');
const hardBtn = document.getElementById('hard-btn');
const easyBtn = document.getElementById('easy-btn');


let words = [];
let currentWord = null;

function shuffleArray(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[array[i], array[j]] = [array[j], array[i]]; } }

function calculateSM2(word, quality) {
    let { repetition, interval, efactor } = word;
    if (quality < 3) {
        repetition = 0;
        interval = 1;
    } else {
        repetition += 1;
        if (repetition === 1) {
            interval = 1;
        } else if (repetition === 2) {
            interval = 6;
        } else {
            interval = Math.round(interval * efactor);
        }
    }
    efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (efactor < 1.3) efactor = 1.3;
    const newDueDate = new Date();
    newDueDate.setDate(newDueDate.getDate() + interval);
    return { ...word, repetition, interval, efactor, dueDate: newDueDate.toISOString().split('T')[0] };
}

async function fetchWords() {
    messageArea.textContent = 'Loading cards...';
    try {
        const response = await fetch(SCRIPT_URL);
        words = await response.json();
        if (words.length > 0) {
            shuffleArray(words);
            displayNextCard();
        } else {
            messageArea.textContent = 'Great job! All cards reviewed for today.';
            wordEl.textContent = '🎉';
            cardContainer.classList.remove('is-flipped');
            showAnswerBtn.classList.add('hidden');
        }
    } catch (error) {
        messageArea.textContent = 'Failed to load cards.';
        console.error('Error:', error);
    }
}

function displayNextCard() {
    if (words.length === 0) { fetchWords(); return; }
    currentWord = words.shift();
    wordEl.textContent = currentWord.russian;
    translationEl.textContent = currentWord.english;
    cardContainer.classList.remove('is-flipped');
    showAnswerBtn.classList.remove('hidden');
    answerButtons.classList.add('hidden');
    messageArea.textContent = `Cards left for today: ${words.length + 1}`;
}

async function updateWord(word, quality) {
    const updatedWord = calculateSM2(word, quality);
    try {
        await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedWord) });
        setTimeout(displayNextCard, 200);
    } catch (error) {
        messageArea.textContent = 'Failed to save progress.';
        console.error('Error sending data:', error);
    }
}

showAnswerBtn.addEventListener('click', () => { cardContainer.classList.add('is-flipped'); showAnswerBtn.classList.add('hidden'); answerButtons.classList.remove('hidden'); });

// Новые обработчики для трех кнопок
againBtn.addEventListener('click', () => updateWord(currentWord, 1)); // Quality 1: Неправильно, сброс
hardBtn.addEventListener('click', () => updateWord(currentWord, 3));  // Quality 3: Правильно, но сложно. Интервал вырастет незначительно.
easyBtn.addEventListener('click', () => updateWord(currentWord, 5));   // Quality 5: Правильно и легко. Интервал вырастет сильно.

fetchWords();