
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxJ61Jm0sx78sdh4t0dQQEhcu1gxClFtOT1J591xm2dfT1maRp9YO6tyqdfFqS5nEqi/exec'; 


// Элементы на странице
const wordEl = document.getElementById('word');
const translationEl = document.getElementById('translation');
const cardContainer = document.querySelector('.card');
const showAnswerBtn = document.getElementById('show-answer-btn');
const answerButtons = document.getElementById('answer-buttons');
const correctBtn = document.getElementById('correct-btn');
const incorrectBtn = document.getElementById('incorrect-btn');
const messageArea = document.getElementById('message-area');

let words = [];
let currentWord = null;

// --- Логика алгоритма SM-2 ---
function calculateSM2(word, quality) {
    // quality: 5 для правильного ответа, 1 для неправильного
    let { repetition, interval, efactor } = word;

    if (quality < 3) { // Если ответ неправильный
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
    if (efactor < 1.3) {
        efactor = 1.3;
    }

    const newDueDate = new Date();
    newDueDate.setDate(newDueDate.getDate() + interval);

    return {
        ...word,
        repetition,
        interval,
        efactor,
        dueDate: newDueDate.toISOString().split('T')[0]
    };
}

// --- Функции для работы с приложением ---
async function fetchWords() {
    try {
        const response = await fetch(SCRIPT_URL);
        words = await response.json();
        if (words.length > 0) {
            displayNextCard();
        } else {
            messageArea.textContent = 'Отличная работа! На сегодня все слова повторены.';
            wordEl.textContent = '🎉';
            cardContainer.classList.remove('is-flipped');
            showAnswerBtn.classList.add('hidden');
        }
    } catch (error) {
        messageArea.textContent = 'Ошибка загрузки слов. Проверьте URL в script.js и доступ к таблице.';
        console.error('Ошибка:', error);
    }
}

function displayNextCard() {
    if (words.length === 0) {
        fetchWords();
        return;
    }
    
    currentWord = words.shift();
    // Теперь на передней стороне карточки будет русское слово
    wordEl.textContent = currentWord.russian;
    // А на обратной, после нажатия кнопки, — английский перевод
    translationEl.textContent = currentWord.english;
    
    cardContainer.classList.remove('is-flipped');
    showAnswerBtn.classList.remove('hidden');
    answerButtons.classList.add('hidden');
    messageArea.textContent = `Осталось слов на сегодня: ${words.length + 1}`;
}

async function updateWord(word, quality) {
    const updatedWord = calculateSM2(word, quality);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', // Важно для Apps Script
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updatedWord)
        });
        displayNextCard();
    } catch (error) {
        messageArea.textContent = 'Ошибка сохранения прогресса.';
        console.error('Ошибка при отправке:', error);
    }
}

// --- Обработчики событий ---
showAnswerBtn.addEventListener('click', () => {
    cardContainer.classList.add('is-flipped');
    showAnswerBtn.classList.add('hidden');
    answerButtons.classList.remove('hidden');
});

correctBtn.addEventListener('click', () => {
    updateWord(currentWord, 5); // 5 - "отлично помню"
});

incorrectBtn.addEventListener('click', () => {
    updateWord(currentWord, 1); // 1 - "совсем не помню"
});

// --- Запуск приложения ---
fetchWords();
