const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzCa3eRClYVd3LADqGBhOe0cs3rSJoOm0bAxmoW_BQPG4DkiSmvNWv1ARz-xS4i9GRC/exec';

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
const feedbackContainer = document.getElementById('feedback-container');
const suggestedAnswerContainer = document.getElementById('suggested-answer-container');

// Configuration will be loaded from .env file
let CONFIG = null;

let words = [], lastAction = null, currentWord = null, isTypingMode = false, isAudioAutoplay = false;

// Anki-like scheduling defaults
const DEFAULT_FACTOR = 2.5;
const LEARNING_STEPS_MINUTES = [1, 10];      // In-session quick repeats
const LAPSE_STEPS_MINUTES = [10];            // Relearning quick repeat
const MIN_INTERVAL_DAYS = 1;

// AI Provider settings
let currentAIProvider = 'groq'; // 'gemini' or 'groq'
let currentGroqModel = 'llama-3.3-70b-versatile'; // Default to most powerful

function loadSettings() {
    isTypingMode = localStorage.getItem('typingMode') === 'true';
    typingModeToggle.checked = isTypingMode;
    isAudioAutoplay = localStorage.getItem('audioAutoplay') === 'true';
    audioAutoplayToggle.checked = isAudioAutoplay;
    const savedLimit = localStorage.getItem('newCardLimit');
    if (savedLimit) {
        newCardLimitInput.value = savedLimit;
    }

    // Load AI provider settings
    const savedProvider = localStorage.getItem('aiProvider');
    if (savedProvider) {
        currentAIProvider = savedProvider;
    }
    const savedModel = localStorage.getItem('groqModel');
    if (savedModel) {
        currentGroqModel = savedModel;
    }

    updateUIMode();
    updateAIProviderUI();
}

function saveSettings() {
    localStorage.setItem('typingMode', typingModeToggle.checked);
    localStorage.setItem('audioAutoplay', audioAutoplayToggle.checked);
    localStorage.setItem('newCardLimit', newCardLimitInput.value);

    // Save AI provider settings
    localStorage.setItem('aiProvider', currentAIProvider);
    localStorage.setItem('groqModel', currentGroqModel);
}

function speak(text) { if ('speechSynthesis' in window) { const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-US'; window.speechSynthesis.speak(utterance); } }
function shuffleArray(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[array[i], array[j]] = [array[j], array[i]]; } }

function todayDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function normalizeWord(raw) {
    const word = { ...raw };
    word.state = word.state || 'new';
    word.factor = word.factor || DEFAULT_FACTOR;
    word.ivl = word.ivl || 0;
    word.reps = word.reps || 0;
    word.lapses = word.lapses || 0;
    word.stepIndex = word.stepIndex || 0;
    word.lapseStepIndex = word.lapseStepIndex || 0;
    word.due = word.due || word.dueDate || null;
    return word;
}

function compareByDue(a, b) {
    const dA = a.due ? new Date(a.due) : new Date('9999-12-31');
    const dB = b.due ? new Date(b.due) : new Date('9999-12-31');
    return dA - dB;
}

function buildQueue(allCards, newLimit) {
    const normalized = allCards.map(normalizeWord);
    const today = todayDate();

    const dueCards = normalized.filter(c => c.state !== 'new' && (!c.due || new Date(c.due) <= today)).sort(compareByDue);
    const futureCards = normalized.filter(c => c.state !== 'new' && c.due && new Date(c.due) > today).sort(compareByDue);
    const newCards = normalized.filter(c => c.state === 'new').slice(0, newLimit);

    return [...dueCards, ...newCards, ...futureCards];
}

function scheduleCard(word, quality) {
    const today = todayDate();
    const updated = { ...word };
    let immediate = false;

    const finishLearning = () => {
        updated.state = 'review';
        updated.stepIndex = 0;
        updated.ivl = Math.max(MIN_INTERVAL_DAYS, updated.ivl || 1);
        updated.due = formatDate(addDays(today, updated.ivl));
        updated.reps = (updated.reps || 0) + 1;
    };

    const finishRelearning = (baseIvl) => {
        updated.state = 'review';
        updated.lapseStepIndex = 0;
        updated.ivl = Math.max(MIN_INTERVAL_DAYS, Math.round(baseIvl * 0.5));
        updated.due = formatDate(addDays(today, updated.ivl));
        updated.reps = (updated.reps || 0) + 1;
    };

    if (updated.state === 'new' || updated.state === 'learning') {
        updated.state = 'learning';
        if (quality <= 2) {
            updated.stepIndex = 0;
            updated.due = formatDate(today);
            immediate = true;
        } else if (quality === 3) {
            // Repeat current step
            updated.due = formatDate(today);
            immediate = true;
        } else if (quality === 4) {
            updated.stepIndex += 1;
            if (updated.stepIndex < LEARNING_STEPS_MINUTES.length) {
                updated.due = formatDate(today);
                immediate = true;
            } else {
                finishLearning();
            }
        } else if (quality === 5) {
            finishLearning();
            // Slightly longer if easy
            updated.ivl = Math.max(MIN_INTERVAL_DAYS, Math.round(updated.ivl * 1.3));
            updated.due = formatDate(addDays(today, updated.ivl));
            updated.factor = (updated.factor || DEFAULT_FACTOR) + 0.05;
        }
    } else if (updated.state === 'review') {
        if (quality === 1) {
            updated.state = 'relearning';
            updated.lapseStepIndex = 0;
            updated.lapses = (updated.lapses || 0) + 1;
            updated.factor = Math.max(1.3, (updated.factor || DEFAULT_FACTOR) - 0.2);
            updated.ivl = MIN_INTERVAL_DAYS;
            updated.due = formatDate(today);
            immediate = true;
        } else if (quality === 3) {
            updated.ivl = Math.max(MIN_INTERVAL_DAYS, Math.round((updated.ivl || MIN_INTERVAL_DAYS) * 1.2));
            updated.due = formatDate(addDays(today, updated.ivl));
            updated.reps = (updated.reps || 0) + 1;
        } else if (quality === 4) {
            const factor = updated.factor || DEFAULT_FACTOR;
            updated.ivl = Math.max(MIN_INTERVAL_DAYS, Math.round((updated.ivl || MIN_INTERVAL_DAYS) * factor));
            updated.due = formatDate(addDays(today, updated.ivl));
            updated.reps = (updated.reps || 0) + 1;
        } else if (quality === 5) {
            const factor = (updated.factor || DEFAULT_FACTOR) * 1.3;
            updated.factor = (updated.factor || DEFAULT_FACTOR) + 0.05;
            updated.ivl = Math.max((updated.ivl || MIN_INTERVAL_DAYS) + 1, Math.round((updated.ivl || MIN_INTERVAL_DAYS) * factor));
            updated.due = formatDate(addDays(today, updated.ivl));
            updated.reps = (updated.reps || 0) + 1;
        }
    } else if (updated.state === 'relearning') {
        if (quality <= 2) {
            updated.lapseStepIndex = 0;
            updated.due = formatDate(today);
            immediate = true;
        } else {
            updated.lapseStepIndex += 1;
            if (updated.lapseStepIndex < LAPSE_STEPS_MINUTES.length) {
                updated.due = formatDate(today);
                immediate = true;
            } else {
                const baseIvl = updated.ivl || MIN_INTERVAL_DAYS;
                finishRelearning(baseIvl);
            }
        }
    }

    return { updated, immediate };
}

// --- ПРОВЕРКА ОТВЕТА ДЛЯ ФРА ---
function checkPhraseAnswer(userAnswer, targetEn) {
    // Нормализуем оба варианта: trim, lowercase, убираем лишние пробелы
    const normalize = (str) => str.trim().toLowerCase().replace(/\s+/g, ' ');
    
    const userNorm = normalize(userAnswer);
    const targetNorm = normalize(targetEn);
    
    const isCorrect = userNorm === targetNorm;
    
    let feedback = '';
    if (isCorrect) {
        feedback = `✅ Отлично! Ваш ответ правильный: "${userAnswer}"`;
    } else {
        feedback = `❌ Неправильно.
Ваш ответ: "${userAnswer}"
Правильный ответ: "${targetEn}"`;
    }
    
    return {
        isCorrect,
        feedback,
        suggestedCorrectAnswer: isCorrect ? null : targetEn
    };
}

// --- GROQ API FUNCTIONS ---
async function checkAnswerWithGroq(original, reference, userAnswer) {
    const prompt = `You are an English teacher. A student is learning English by translating Russian sentences.
Evaluate the student's translation.

Task:
- Russian sentence (Original): "${original}"
- Correct English translation (Reference): "${reference}"
- Student's answer: "${userAnswer}"

Is the student's answer a correct translation of the Russian sentence?
Focus on grammatical correctness and semantic meaning.

Provide your response in JSON format with three fields:
1. "isCorrect": boolean (true if the translation is acceptable, false otherwise).
2. "feedback": string (This field should contain the structured feedback in Russian, following this template:
   "Ваш ответ: '[Student's Answer]'
   Исправленный ответ: '[Suggested Correct Answer, if isCorrect is false]'
   Ошибки:
   - [Ошибка 1]
   - [Ошибка 2]
   ..."
   If "isCorrect" is true, the "Исправленный ответ" and "Ошибки" sections can be omitted, and the feedback should be encouraging.
3. "suggestedCorrectAnswer": string (If "isCorrect" is false, provide a grammatically correct and semantically accurate alternative translation in English. If "isCorrect" is true, this field should be empty or null).

Example for a correct answer:
{
  "isCorrect": true,
  "feedback": "Ваш ответ: 'Hello world!' - Отлично! Хороший вариант перевода.",
  "suggestedCorrectAnswer": null
}

Example for an incorrect answer:
{
  "isCorrect": false,
  "feedback": "Ваш ответ: 'I am go to school'
   Исправленный ответ: 'I am going to school'
   Ошибки:
   - Неверная форма глагола 'to be'.
   - Отсутствие 'going' для обозначения продолжительного действия.",
  "suggestedCorrectAnswer": "I am going to school"
}`;

    const payload = {
        model: currentGroqModel,
        messages: [
            {
                role: "user",
                content: prompt
            }
        ],
        temperature: 0.3,
        max_tokens: 1000
    };

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Groq API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        // Parse JSON response from Groq
        let cleanedContent = content.replace(/```json\n?/g, '').replace(/\n?```/g, '');

        // Try to extract JSON if it's wrapped in other text
        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleanedContent = jsonMatch[0];
        }

        // Fix: Handle newlines inside JSON strings (common issue with Llama models)
        try {
            return JSON.parse(cleanedContent);
        } catch (firstError) {
            console.log('First JSON parse failed:', firstError.message);

            // Try to fix common issues with newlines in strings
            let fixedContent = cleanedContent
                .replace(/\n/g, '\\n')  // Escape newlines
                .replace(/\r/g, '\\r')  // Escape carriage returns
                .replace(/\t/g, '\\t'); // Escape tabs

            try {
                return JSON.parse(fixedContent);
            } catch (secondError) {
                console.log('Second JSON parse failed:', secondError.message);

                // Try to manually extract values if JSON parsing completely fails
                return extractFromTextResponse(content);
            }
        }

    } catch (error) {
        console.error('Groq API error:', error);
        return {
            isCorrect: false,
            feedback: `Ошибка при обращении к Groq API: ${error.message}. Попробуйте переключиться на Gemini.`,
            suggestedCorrectAnswer: null
        };
    }
}

async function fetchWords() {
    sessionStatsEl.textContent = 'Loading...';
    try {
        const allDataResponse = await fetch(`${SCRIPT_URL}?page=dashboard`);
        const allData = await allDataResponse.json();
        console.log('Dashboard data:', allData);
        const limit = newCardLimitInput.value;
        const dueResponse = await fetch(`${SCRIPT_URL}?limit=${limit}`);
        const dueData = await dueResponse.json();
        console.log('Due data:', dueData);
        const newLimit = parseInt(newCardLimitInput.value || '20', 10);
        words = buildQueue(dueData.cards || [], newLimit);
        console.log('Queue built:', words.length, 'cards');
        if (words.length > 0) {
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
    console.log("displayNextCard: Called.");
    if (!cardContainer) {
        console.error("displayNextCard: cardContainer is null. Cannot proceed.");
        return; // Предотвращаем дальнейшие ошибки
    }
    undoBtn.classList.add('hidden');
    feedbackContainer.classList.add('hidden');
    
    if (words.length === 0) {
        sessionStatsEl.textContent = 'Session complete!';
        wordEl.textContent = '🎉';
        translationEl.textContent = '';
        cardContainer.classList.add('hidden');
        confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } });
        return;
    }
    
    currentWord = words.shift();
    cardContainer.classList.remove('is-flipped');
    answerInput.value = '';
    
    // Проверяем тип карточки: фраза, предложение или обычное слово
    if (currentWord.type === 'phrase') {
        renderPhraseCard(currentWord);
    } else if (currentWord.type === 'sentence') {
        renderSentenceCard(currentWord);
    } else {
        renderWordCard(currentWord);
    }
    
    updateUIMode();
}

function renderSentenceCard(sentence) {
    // Для sentence типа показываем первые буквы слов + русский перевод
    const promptText = sentence.prompt_en || sentence.english;
    const translationText = sentence.translation_ru || sentence.russian;
    
    // Фронт карточки: первые буквы слов + перевод
    wordEl.innerHTML = `
        <div style="margin-bottom: 12px; font-size: 1.2em;">${promptText}</div>
        <div style="font-size: 0.9em; color: #666;">${translationText}</div>
    `;
    
    // Обратная сторона: полное предложение + перевод
    const fullSentence = sentence.target_en || sentence.english;
    translationEl.innerHTML = `
        <div class="sentence-answer" style="padding: 10px; background: #e8f5e9; border-radius: 4px;">
            <div style="margin-bottom: 12px; font-size: 1.2em;"><strong>${fullSentence}</strong></div>
            <div style="font-size: 0.9em; color: #666;">${translationText}</div>
        </div>
    `;
}

function renderWordCard(word) {
    // Обычная карточка для слов
    wordEl.textContent = word.english;
    translationEl.textContent = word.russian;
}

function renderPhraseCard(phrase) {
    // Маскируем: первая буква только у первого слова, остальные полностью в звёздочки
    const maskTarget = (text) => text.split(/\s+/).map((w, idx) => {
        if (!w) return '';
        if (idx === 0) return w[0] + '*'.repeat(Math.max(0, w.length - 1));
        return '*'.repeat(w.length);
    }).join(' ');
    const maskedTarget = phrase.target_en ? maskTarget(phrase.target_en) : '';
    const maskedSentence = phrase.target_en ? phrase.english.replace(
        new RegExp(`\\b${phrase.target_en}\\b`, 'gi'),
        maskedTarget
    ) : (phrase.prompt_en || phrase.english);
    
    // Фронт карточки: предложение с маской + подсказка в блюре
    const hintText = phrase.hint_ru || phrase.russian;
    wordEl.innerHTML = `
        <div style="margin-bottom: 12px;">${maskedSentence}</div>
        <div class="phrase-hint" id="phrase-hint-front" style="filter: blur(5px); cursor: pointer; padding: 10px; background: #f0f0f0; border-radius: 4px; display: inline-block;">
            ${hintText}
        </div>
    `;
    
    // Обратная сторона: полное предложение с bold + перевод
        const englishWithBold = phrase.english.replace(
            new RegExp(`\\b${phrase.target_en}\\b`, 'gi'),
        `<strong>${phrase.target_en}</strong>`
    );
    translationEl.innerHTML = `
        <div class="phrase-answer" id="phrase-answer" style="display: none; padding: 10px; background: #e8f5e9; border-radius: 4px;">
            <div style="margin-bottom: 12px;">${englishWithBold}</div>
            <div style="font-size: 0.9em; color: #666;">${phrase.translation_ru}</div>
        </div>
    `;
    
    // Добавляем обработчик клика на блюр на фронте
    setTimeout(() => {
        const hintEl = document.getElementById('phrase-hint-front');
        if (hintEl) {
            hintEl.addEventListener('click', (e) => {
                e.stopPropagation();
                hintEl.style.filter = 'blur(0)';
                hintEl.style.cursor = 'default';
            }, { once: true });
        }
    }, 0);
}
async function sendData(payload) {
    const options = {
        method: 'POST',
        body: JSON.stringify(payload)
    };
    if (payload.action === 'updateWord' || payload.action === 'updateStatus' || payload.action === 'updatePhraseRating') {
        options.mode = 'no-cors';
    }

    try {
        const response = await fetch(SCRIPT_URL, options);
        if (payload.action === 'checkAnswer' || payload.action === 'logDetailedAnswer') {
            return await response.json();
        }
        return { status: "success" };
    } catch (e) {
        console.error("Failed to send data:", e);
        if (payload.action === 'checkAnswer') {
            return { isCorrect: false, feedback: "Ошибка сети. Не удалось проверить ответ." };
        }
        return { status: "error", message: e.message };
    }
}

function logAnswer(userAnswer) {
    if (!currentWord || !isTypingMode || userAnswer.trim() === '') return;
    sendData({
        action: 'logAnswer',
        wordId: currentWord.id,
        userAnswer: userAnswer.trim()
    });
}

function processAnswer(quality, ratingText) {
    if (!currentWord) return;
    lastAction = { wordBefore: { ...currentWord }, quality };

    const { updated, immediate } = scheduleCard(currentWord, quality);
    currentWord = updated;
    sendData({ action: 'updateWord', wordData: updated });

    // For immediate cards (Again/Hard), add to END of queue for re-learning in this session
    // This is Anki-like behavior: fail → see at end of session again
    if (immediate) {
        words.push(updated);
    }

    undoBtn.classList.remove('hidden');
    setTimeout(() => undoBtn.classList.add('hidden'), 4000);

    if (quality === 5 && (updated.ivl || 0) > 21) {
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
    }

    displayNextCard();
}

function updateUIMode() {
    cardContainer.classList.remove('hidden');
    sessionStatsEl.classList.remove('hidden');
    const isFlipped = cardContainer.classList.contains('is-flipped');
    
    // Для фраз и предложений всегда включаем режим ввода, независимо от настройки
    const effectiveTypingMode = isTypingMode || (currentWord && (currentWord.type === 'phrase' || currentWord.type === 'sentence'));
    
    // Логика для режима ввода
    if (effectiveTypingMode) {
        showAnswerBtn.classList.add('hidden');
        answerInput.classList.remove('hidden');
        
        if (isFlipped) {
            // Если карточка перевернута (после проверки), показываем кнопки оценки
            answerInput.classList.add('hidden');
            checkAnswerBtn.classList.add('hidden');
            answerButtons.classList.remove('hidden');
        } else {
            // Если карточка не перевернута, показываем поле ввода и кнопку "Check"
            answerButtons.classList.add('hidden');
            checkAnswerBtn.classList.remove('hidden');
            const placeholderText = currentWord && currentWord.type === 'phrase' ? 'Type the phrase...' : 
                                   currentWord && currentWord.type === 'sentence' ? 'Type the full sentence...' : 'Type the translation...';
            answerInput.placeholder = placeholderText;
        }
    } else {
        // Логика для режима без ввода (просто показ ответа)
        answerInput.classList.add('hidden');
        checkAnswerBtn.classList.add('hidden');
        if (isFlipped) {
            showAnswerBtn.classList.add('hidden');
            answerButtons.classList.remove('hidden');
        } else {
            showAnswerBtn.classList.remove('hidden');
            answerButtons.classList.add('hidden'); // Скрываем кнопки оценки, пока не показан ответ
        }
    }
}
function updateUIMode() {
    cardContainer.classList.remove('hidden');
    sessionStatsEl.classList.remove('hidden');
    const isFlipped = cardContainer.classList.contains('is-flipped');
    
    // Используем только реальную настройку typing mode (не принудительный для фраз)
    const effectiveTypingMode = isTypingMode;
    
    // Если уже перевернуто и это фраза или предложение — покажем ответ
    if (isFlipped && currentWord && (currentWord.type === 'phrase' || currentWord.type === 'sentence')) {
        const ans = document.getElementById('phrase-answer') || document.querySelector('.sentence-answer');
        if (ans) ans.style.display = 'block';
    }

    // Логика для режима ввода
    if (effectiveTypingMode) {
        showAnswerBtn.classList.add('hidden');
        answerInput.classList.remove('hidden');
        
        if (isFlipped) {
            // Если карточка перевернута (после проверки), показываем кнопки оценки
            answerInput.classList.add('hidden');
            checkAnswerBtn.classList.add('hidden');
            answerButtons.classList.remove('hidden');
        } else {
            // Если карточка не перевернута, показываем поле ввода и кнопку "Check"
            answerButtons.classList.add('hidden');
            checkAnswerBtn.classList.remove('hidden');
            answerInput.placeholder = 'Type the answer...';
        }
    } else {
        // Логика для режима без ввода (просто показ ответа)
        answerInput.classList.add('hidden');
        checkAnswerBtn.classList.add('hidden');
        if (isFlipped) {
            showAnswerBtn.classList.add('hidden');
            answerButtons.classList.remove('hidden');
        } else {
            showAnswerBtn.classList.remove('hidden');
            answerButtons.classList.add('hidden'); // Скрываем кнопки оценки, пока не показан ответ
        }
    }
}
showAnswerBtn.addEventListener('click', () => {
    cardContainer.classList.add('is-flipped');
    if (currentWord && (currentWord.type === 'phrase' || currentWord.type === 'sentence')) {
        const ans = document.getElementById('phrase-answer') || document.querySelector('.sentence-answer');
        if (ans) ans.style.display = 'block';
    }
    updateUIMode();
    const textToSpeak = (currentWord.type === 'sentence' || currentWord.type === 'phrase') && currentWord.target_en ? currentWord.target_en : currentWord.english;
    if (isAudioAutoplay) speak(textToSpeak);
});

async function checkAnswerWithAI() {
    const userAnswer = answerInput.value.trim();
    if (userAnswer === '') return;

    checkAnswerBtn.disabled = true;
    checkAnswerBtn.textContent = 'Checking...';

    let result;

    // Если это фраза или предложение — простая проверка вместо ИИ
    if (currentWord.type === 'phrase' || currentWord.type === 'sentence') {
        const targetText = currentWord.target_en || currentWord.english;
        result = checkPhraseAnswer(userAnswer, targetText);
    } else {
        // Для обычных слов используем ИИ
        console.log(`Using ${currentAIProvider} API with model: ${currentGroqModel}`);

        if (currentAIProvider === 'groq') {
            result = await checkAnswerWithGroq(currentWord.russian, currentWord.english, userAnswer);
        } else {
            // For Gemini, use Google Apps Script
            console.log('Using Gemini via Google Apps Script');
            const payload = {
                action: 'checkAnswer',
                original: currentWord.russian,
                reference: currentWord.english,
                userAnswer: userAnswer,
                aiProvider: currentAIProvider,
                groqModel: currentGroqModel
            };
            result = await sendData(payload);
            console.log('Gemini result from Google Apps Script:', result);
        }
    }

    // Логируем ответ пользователя и фидбэк в новую колонку
    await sendData({
        action: 'logDetailedAnswer',
        wordId: currentWord.id,
        userAnswer: userAnswer,
        feedback: result.feedback,
        isCorrect: result.isCorrect
    });
    // Логируем ответ пользователя в старую колонку AnswerHistory
    logAnswer(userAnswer);

    cardContainer.classList.add('is-flipped');
    const textToSpeak = (currentWord.type === 'sentence' || currentWord.type === 'phrase') && currentWord.target_en ? currentWord.target_en : currentWord.english;
    if (isAudioAutoplay) speak(textToSpeak);

    if (!result || typeof result.isCorrect === 'undefined') {
        feedbackContainer.textContent = "Ошибка: получен неверный ответ от сервера.";
        feedbackContainer.style.color = 'var(--red)';
        checkAnswerBtn.disabled = false;
        checkAnswerBtn.textContent = 'Check';
        return;
    }

    // Добавляем предложенный правильный ответ прямо в фидбэк
    let fullFeedback = result.feedback;
    if (!result.isCorrect && result.suggestedCorrectAnswer) {
        fullFeedback += `\n\n**Предложенный правильный ответ:** ${result.suggestedCorrectAnswer}`;
    }

    // Debug logging
    console.log('Full feedback to display:', fullFeedback);
    console.log('Result object:', result);

    feedbackContainer.classList.remove('hidden');
    feedbackContainer.innerHTML = fullFeedback.replace(/\n/g, '<br>'); // Заменяем переносы строк на HTML

    if (result.isCorrect) {
        feedbackContainer.style.color = 'var(--green)';
        document.body.style.backgroundColor = '#f0fff0';
    } else {
        feedbackContainer.style.color = 'var(--red)';
        document.body.style.backgroundColor = '#fff0f0';
    }

    // Всегда показываем кнопки Again/Hard/Easy после получения фидбэка
    updateUIMode();

    setTimeout(() => document.body.style.backgroundColor = '#f0f2f5', 800);
    checkAnswerBtn.disabled = false;
    checkAnswerBtn.textContent = 'Check';
}

checkAnswerBtn.addEventListener('click', checkAnswerWithAI);

againBtn.addEventListener('click', () => processAnswer(1, 'Again'));
hardBtn.addEventListener('click', () => processAnswer(3, 'Hard'));
easyBtn.addEventListener('click', () => processAnswer(5, 'Easy'));
suspendBtn.addEventListener('click', () => { if (!currentWord) return; sendData({ action: 'updateStatus', id: currentWord.id, status: 'suspended' }); displayNextCard(); });
audioBtn.addEventListener('click', (e) => { 
    e.stopPropagation(); 
    if (currentWord) {
        const textToSpeak = (currentWord.type === 'sentence' || currentWord.type === 'phrase') && currentWord.target_en ? currentWord.target_en : currentWord.english;
        speak(textToSpeak);
    }
});
undoBtn.addEventListener('click', () => { if (!lastAction) return; sendData({ action: 'updateWord', wordData: lastAction.wordBefore }); undoBtn.classList.add('hidden'); sessionStatsEl.textContent = 'Action reverted.'; });
typingModeToggle.addEventListener('change', (e) => { isTypingMode = e.target.checked; saveSettings(); updateUIMode(); });
audioAutoplayToggle.addEventListener('change', (e) => { isAudioAutoplay = e.target.checked; saveSettings(); });
newCardLimitInput.addEventListener('change', () => { saveSettings(); fetchWords(); });

// --- AI PROVIDER UI FUNCTIONS ---
function updateAIProviderUI() {
    const aiProviderSelect = document.getElementById('ai-provider');
    const groqModelsSelect = document.getElementById('groq-models');
    const groqModelSelect = document.getElementById('groq-model');

    if (aiProviderSelect) {
        aiProviderSelect.value = currentAIProvider;
    }

    if (groqModelSelect) {
        groqModelSelect.value = currentGroqModel;
    }

    // Show/hide Groq model selector based on provider
    if (groqModelsSelect) {
        groqModelsSelect.style.display = currentAIProvider === 'groq' ? 'flex' : 'none';
    }
}

// --- AI PROVIDER EVENT HANDLERS ---
document.addEventListener('DOMContentLoaded', function() {
    const aiProviderSelect = document.getElementById('ai-provider');
    const groqModelSelect = document.getElementById('groq-model');

    if (aiProviderSelect) {
        aiProviderSelect.addEventListener('change', function() {
            currentAIProvider = this.value;
            updateAIProviderUI();
            saveSettings();
        });
    }

    if (groqModelSelect) {
        groqModelSelect.addEventListener('change', function() {
            currentGroqModel = this.value;
            saveSettings();
        });
    }

    // Add test models button handler
    const testModelsBtn = document.getElementById('test-models-btn');
    if (testModelsBtn) {
        testModelsBtn.addEventListener('click', testAllModelsInInterface);
    }


});




// Initialize configuration and start the app
async function init() {
    CONFIG = await loadConfig();
    console.log('Configuration loaded:', CONFIG);

    // Update global variables with config values
    if (CONFIG.SCRIPT_URL) {
        // Update the SCRIPT_URL at the top of the file
        Object.defineProperty(window, 'SCRIPT_URL', {
            value: CONFIG.SCRIPT_URL,
            writable: false
        });
    }

    loadSettings();
    fetchWords();
}

// --- MODEL TESTING FUNCTIONS ---
async function testAllModelsInInterface() {
    const testBtn = document.getElementById('test-models-btn');
    if (!testBtn) return;

    testBtn.disabled = true;
    testBtn.textContent = '🧪 Testing...';

    const models = [
        { name: 'Llama 3.3 70B', id: 'llama-3.3-70b-versatile' },
        { name: 'Gemma 2 9B', id: 'gemma2-9b-it' },
        { name: 'Llama 3.1 8B', id: 'llama-3.1-8b-instant' },
        { name: 'DeepSeek R1 70B', id: 'deepseek-r1-distill-llama-70b' }
    ];

    const testResults = document.createElement('div');
    testResults.id = 'test-results';
    testResults.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.9);
        z-index: 1000;
        padding: 20px;
        box-sizing: border-box;
        overflow-y: auto;
        font-family: monospace;
        color: white;
        font-size: 14px;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Close';
    closeBtn.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        background: #dc3545;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 5px;
        cursor: pointer;
    `;

    const resultsContent = document.createElement('div');
    resultsContent.style.cssText = `
        margin-top: 60px;
        white-space: pre-wrap;
    `;

    testResults.appendChild(closeBtn);
    testResults.appendChild(resultsContent);
    document.body.appendChild(testResults);

    let output = '🧪 MODEL TESTING RESULTS\n\n';

    for (const model of models) {
        output += `=== Testing ${model.name} (${model.id}) ===\n`;

        try {
            const result = await testSingleModel(model.id);
            output += `✅ Status: ${result.status}\n`;
            output += `📝 Response: ${result.response}\n`;
            output += `📏 Length: ${result.length} chars\n`;
            output += `🔧 Parsed: ${result.parsed ? '✅' : '❌'}\n`;
            if (result.error) output += `❌ Error: ${result.error}\n`;
            output += `\n`;
        } catch (error) {
            output += `❌ Error: ${error.message}\n\n`;
        }
    }

    resultsContent.textContent = output;

    closeBtn.addEventListener('click', () => {
        document.body.removeChild(testResults);
        testBtn.disabled = false;
        testBtn.textContent = '🧪 Test Models';
    });
}

async function testSingleModel(modelId) {
    const testPayload = {
        model: modelId,
        messages: [{
            role: "user",
            content: `You are an English teacher. A student is learning English by translating Russian sentences.
Evaluate the student's translation.

Task:
- Russian sentence (Original): "Я люблю программировать"
- Correct English translation (Reference): "I love programming"
- Student's answer: "I love to programming"

Is the student's answer a correct translation of the Russian sentence?
Focus on grammatical correctness and semantic meaning.

Provide your response in JSON format with three fields:
1. "isCorrect": boolean (true if the translation is acceptable, false otherwise).
2. "feedback": string (This field should contain the structured feedback in Russian, following this template:
   "Ваш ответ: '[Student's Answer]'
   Исправленный ответ: '[Suggested Correct Answer, if isCorrect is false]'
   Ошибки:
   - [Ошибка 1]
   - [Ошибка 2]
   ..."
   If "isCorrect" is true, the "Исправленный ответ" and "Ошибки" sections can be omitted, and the feedback should be encouraging.
3. "suggestedCorrectAnswer": string (If "isCorrect" is false, provide a grammatically correct and semantically accurate alternative translation in English. If "isCorrect" is true, this field should be empty or null).

Example for a correct answer:
{
  "isCorrect": true,
  "feedback": "Ваш ответ: 'Hello world!' - Отлично! Хороший вариант перевода.",
  "suggestedCorrectAnswer": null
}

Example for an incorrect answer:
{
  "isCorrect": false,
  "feedback": "Ваш ответ: 'I am go to school'
   Исправленный ответ: 'I am going to school'
   Ошибки:
   - Неверная форма глагола 'to be'.
   - Отсутствие 'going' для обозначения продолжительного действия.",
  "suggestedCorrectAnswer": "I am going to school"
}`
        }],
        temperature: 0.3,
        max_tokens: 1000
    };

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testPayload)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        // Try to parse JSON
        let cleanedContent = content.replace(/```json\n?/g, '').replace(/\n?```/g, '');
        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleanedContent = jsonMatch[0];
        }

        let parsed = false;
        let parseError = null;

        try {
            JSON.parse(cleanedContent);
            parsed = true;
        } catch (firstError) {
            try {
                let fixedContent = cleanedContent
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\r')
                    .replace(/\t/g, '\\t');
                JSON.parse(fixedContent);
                parsed = true;
            } catch (secondError) {
                parseError = secondError.message;
            }
        }

        return {
            status: '✅ Success',
            response: content.substring(0, 100) + '...',
            length: content.length,
            parsed: parsed,
            error: parseError
        };

    } catch (error) {
        return {
            status: '❌ Failed',
            response: '',
            length: 0,
            parsed: false,
            error: error.message
        };
    }
}



// --- UTILITY FUNCTIONS ---
function extractFromTextResponse(content) {
    console.log('Extracting from text response:', content);

    // Try to find JSON-like structure in the text
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.log('Failed to parse extracted JSON:', e.message);
        }
    }

    // Try to extract individual fields from text
    const isCorrectMatch = content.match(/"isCorrect"\s*:\s*(true|false)/i);
    const feedbackMatch = content.match(/"feedback"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
    const suggestedAnswerMatch = content.match(/"suggestedCorrectAnswer"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);

    if (isCorrectMatch || feedbackMatch) {
        return {
            isCorrect: isCorrectMatch ? isCorrectMatch[1] === 'true' : false,
            feedback: feedbackMatch ? feedbackMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : "Не удалось извлечь фидбэк из ответа ИИ.",
            suggestedCorrectAnswer: suggestedAnswerMatch ? suggestedAnswerMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : null
        };
    }

    // Fallback: create a basic response structure
    return {
        isCorrect: false,
        feedback: "Не удалось распознать ответ от ИИ. Попробуйте другую модель или проверьте API ключ.",
        suggestedCorrectAnswer: null
    };
}

// Start the application
init();
