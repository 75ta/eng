const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2lP9WGeEnXf-QhLPa8Ggu6FKytoMQ8Fh-IbeSXSHsvGB7YrnDQNkVSg8kqbYiWVYs/exec';

const wordEl = document.getElementById('word');
const translationEl = document.getElementById('translation');
const cardContainer = document.querySelector('.card');
const showAnswerBtn = document.getElementById('show-answer-btn');
const answerButtons = document.getElementById('answer-buttons');
const againBtn = document.getElementById('again-btn');
const hardBtn = document.getElementById('hard-btn');
const easyBtn = document.getElementById('easy-btn');
const sessionStatsEl = document.getElementById('session-stats');
const streakCounterEl = document.getElementById('streak-counter');
const undoBtn = document.getElementById('undo-btn');
const suspendBtn = document.getElementById('suspend-btn');
const audioBtn = document.getElementById('audio-btn');
const audioAutoplayToggle = document.getElementById('audio-autoplay-toggle');
const typingModeToggle = document.getElementById('typing-mode-toggle');
const answerInput = document.getElementById('answer-input');
const checkAnswerBtn = document.getElementById('check-answer-btn');
const newCardLimitInput = document.getElementById('new-card-limit');

let words = [], lapsePile = [], lastAction = null, currentWord = null, isTypingMode = false, isAudioAutoplay = false;

function loadSettings() {
    isTypingMode = localStorage.getItem('typingMode') === 'true';
    typingModeToggle.checked = isTypingMode;
    isAudioAutoplay = localStorage.getItem('audioAutoplay') === 'true';
    audioAutoplayToggle.checked = isAudioAutoplay;
    const savedLimit = localStorage.getItem('newCardLimit');
    if (savedLimit) {
        newCardLimitInput.value = savedLimit;
    }
    updateUIMode();
}

function saveSettings() {
    localStorage.setItem('typingMode', typingModeToggle.checked);
    localStorage.setItem('audioAutoplay', audioAutoplayToggle.checked);
    localStorage.setItem('newCardLimit', newCardLimitInput.value);
}

function speak(text) { if ('speechSynthesis' in window) { const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-US'; window.speechSynthesis.speak(utterance); } }
function shuffleArray(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[array[i], array[j]] = [array[j], array[i]]; } }
function calculateSM2(word, quality) { let { repetition, interval, efactor } = word; if (quality < 3) { repetition = 0; interval = 1; } else { repetition++; if (repetition === 1) interval = 1; else if (repetition === 2) interval = 6; else interval = Math.round(interval * efactor); } efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)); if (efactor < 1.3) efactor = 1.3; const newDueDate = new Date(); newDueDate.setDate(newDueDate.getDate() + interval); return { ...word, repetition, interval, efactor, dueDate: newDueDate.toISOString().split('T')[0] }; }

async function fetchWords() {
    sessionStatsEl.textContent = 'Loading...';
    try {
        const allDataResponse = await fetch(`${SCRIPT_URL}?page=dashboard`);
        const allData = await allDataResponse.json();
        const limit = newCardLimitInput.value;
        const dueResponse = await fetch(`${SCRIPT_URL}?limit=${limit}`);
        const dueData = await dueResponse.json();
        words = dueData.cards;
        if (words.length > 0) {
            shuffleArray(words);
            displayNextCard();
            sessionStatsEl.innerHTML = `Reviews: <span class="review-count">${dueData.reviewCount}</span>, New: <span class="new-count">${dueData.newCount}</span>, Lapses: <span id="lapse-count">0</span>`;
        } else {
            sessionStatsEl.textContent = 'Great job! All cards reviewed for today.';
            wordEl.textContent = '🎉';
            cardContainer.classList.add('hidden');
        }
        calculateStreak(allData);
    } catch (error) { sessionStatsEl.textContent = 'Failed to load cards.'; console.error('Error:', error); }
}

function calculateStreak(data) {
    if (!data || data.length === 0) { streakCounterEl.innerHTML = `🔥 0 days`; return; }
    const answeredDates = data.filter(w => w.lastAnswered).map(w => new Date(w.lastAnswered));
    const uniqueDates = [...new Set(answeredDates.map(d => d.toISOString().split('T')[0]))].sort().reverse();
    if (uniqueDates.length === 0) { streakCounterEl.innerHTML = `🔥 0 days`; return; }
    let streak = 0;
    const todayStr = new Date().toISOString().split('T')[0];
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    if (uniqueDates[0] === todayStr || uniqueDates[0] === yesterdayStr) {
        streak = 1;
        for (let i = 0; i < uniqueDates.length - 1; i++) {
            const diff = (new Date(uniqueDates[i]) - new Date(uniqueDates[i+1])) / (1000 * 60 * 60 * 24);
            if (diff === 1) streak++; else break;
        }
    }
    streakCounterEl.innerHTML = `🔥 ${streak} days`;
}

function displayNextCard() {
    undoBtn.classList.add('hidden');
    if (words.length === 0 && lapsePile.length > 0) {
        words = [...lapsePile];
        lapsePile = [];
        shuffleArray(words);
        document.getElementById('lapse-count').textContent = 0;
    }
    if (words.length === 0) {
        sessionStatsEl.textContent = 'Session complete!';
        wordEl.textContent = '🎉';
        translationEl.textContent = '';
        cardContainer.classList.add('hidden');
        confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } });
        return;
    }
    currentWord = words.shift();
    wordEl.textContent = currentWord.russian;
    translationEl.textContent = currentWord.english;
    cardContainer.classList.remove('is-flipped');
    answerInput.value = '';
    updateUIMode();
}

async function sendData(payload) { try { await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) }); } catch (e) { console.error("Failed to send data:", e); } }

function logAnswer() {
    if (!currentWord || !isTypingMode || answerInput.value.trim() === '') return;
    sendData({
        action: 'logAnswer',
        wordId: currentWord.id,
        userAnswer: answerInput.value.trim()
    });
}

function processAnswer(quality, ratingText) {
    lastAction = { wordBefore: { ...currentWord }, quality };
    logAnswer();
    if (quality < 3) {
        lapsePile.push(currentWord);
        document.getElementById('lapse-count').textContent = lapsePile.length;
        displayNextCard();
    } else {
        const updatedWord = calculateSM2(currentWord, quality);
        sendData({ action: 'updateWord', wordData: updatedWord });
        setTimeout(displayNextCard, 200);
    }
    undoBtn.classList.remove('hidden');
    setTimeout(() => undoBtn.classList.add('hidden'), 4000);
    if (quality === 5 && currentWord.interval > 21) { confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } }); }
}

function updateUIMode() {
    cardContainer.classList.remove('hidden');
    sessionStatsEl.classList.remove('hidden');
    const isFlipped = cardContainer.classList.contains('is-flipped');
    if (isTypingMode) {
        showAnswerBtn.classList.add('hidden'); answerButtons.classList.add('hidden');
        answerInput.classList.remove('hidden'); checkAnswerBtn.classList.remove('hidden');
        if (isFlipped) { answerInput.classList.add('hidden'); checkAnswerBtn.classList.add('hidden'); answerButtons.classList.remove('hidden'); }
    } else {
        showAnswerBtn.classList.remove('hidden'); answerButtons.classList.add('hidden');
        answerInput.classList.add('hidden'); checkAnswerBtn.classList.add('hidden');
        if (isFlipped) { showAnswerBtn.classList.add('hidden'); answerButtons.classList.remove('hidden'); }
    }
}

showAnswerBtn.addEventListener('click', () => { cardContainer.classList.add('is-flipped'); updateUIMode(); if (isAudioAutoplay) speak(currentWord.english); });
checkAnswerBtn.addEventListener('click', () => {
    const isCorrect = answerInput.value.toLowerCase().trim() === currentWord.english.toLowerCase().trim();
    cardContainer.classList.add('is-flipped');
    updateUIMode();
    if (isAudioAutoplay) speak(currentWord.english);
    if (!isCorrect) { document.body.style.backgroundColor = '#fff0f0'; setTimeout(() => document.body.style.backgroundColor = '#f0f2f5', 500); }
});

againBtn.addEventListener('click', () => processAnswer(1, 'Again'));
hardBtn.addEventListener('click', () => processAnswer(3, 'Hard'));
easyBtn.addEventListener('click', () => processAnswer(5, 'Easy'));
suspendBtn.addEventListener('click', () => { if (!currentWord) return; sendData({ action: 'updateStatus', id: currentWord.id, status: 'suspended' }); displayNextCard(); });
audioBtn.addEventListener('click', (e) => { e.stopPropagation(); if (currentWord) speak(currentWord.english); });
undoBtn.addEventListener('click', () => { if (!lastAction) return; sendData({ action: 'updateWord', wordData: lastAction.wordBefore }); undoBtn.classList.add('hidden'); sessionStatsEl.textContent = 'Action reverted.'; });
typingModeToggle.addEventListener('change', (e) => { isTypingMode = e.target.checked; saveSettings(); updateUIMode(); });
audioAutoplayToggle.addEventListener('change', (e) => { isAudioAutoplay = e.target.checked; saveSettings(); });
newCardLimitInput.addEventListener('change', () => { saveSettings(); fetchWords(); });

loadSettings();
fetchWords();