// Whisper-only voice recording
let SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwnB4CCW-37LHUic54mnWrs3wHZ8ufqVk65NySRDzwZs8-20G-rhUjlNqdYLvm1QVY/exec';

let CONFIG = {};

// Load config via shared loader (falls back to defaults)
async function initConfig() {
    try {
        const cfg = await window.loadConfig();
        CONFIG = cfg || {};
        if (CONFIG.SCRIPT_URL) {
            SCRIPT_URL = CONFIG.SCRIPT_URL;
        }
        console.log('[Voice] Config loaded keys:', Object.keys(CONFIG));
        console.log('[Voice] Using SCRIPT_URL:', SCRIPT_URL);
    } catch (error) {
        console.warn('[Voice] Could not load config.js:', error);
    }
}

const MODEL_MAP = {
    tiny: 'Xenova/whisper-tiny',
    base: 'Xenova/whisper-base',
    medium: 'Xenova/whisper-medium'
};

// DOM
const recordBtn = document.getElementById('record-btn');
const timerEl = document.getElementById('record-timer');
const statusEl = document.getElementById('status-text');
const transcriptEl = document.getElementById('transcript-text');
const modelSelect = document.getElementById('model-select');
const tableContainer = document.getElementById('voice-table-container');
const manualTextArea = document.getElementById('manual-text');
const submitTextBtn = document.getElementById('submit-text-btn');
const useLLMCheckbox = document.getElementById('use-llm');

// State
let mediaRecorder = null;
let chunks = [];
let timerId = null;
let seconds = 0;
let worker = null;
let isRecording = false;
let rows = loadRowsFromStorage();

console.log('[Voice] Init, rows loaded:', rows.length);

// Manual text submission
submitTextBtn.addEventListener('click', () => {
    const text = manualTextArea.value.trim();
    if (!text) {
        setStatus('⚠️ Введите текст');
        return;
    }
    
    console.log('[Voice] Manual text:', text);
    addRowsFromText(text);
    manualTextArea.value = '';
    setStatus('✅ Текст добавлен');
});

// Timer
function startTimer() {
    seconds = 0;
    timerId = setInterval(() => {
        seconds++;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        if (timerEl) timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerId);
    if (timerEl) timerEl.textContent = '00:00';
}

function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
}

// Table
function splitSentences(text) {
    if (!text) return [];
    return (text.match(/[^.!?]+[.!?]?/g) || []).map(s => s.trim()).filter(Boolean);
}

function addRowsFromText(text) {
    const sentences = splitSentences(text);
    const payloadRows = (sentences.length ? sentences : [text]).map(sentence => ({
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        time: new Date().toLocaleString(),
        text: sentence,
        model: modelSelect ? modelSelect.value : 'manual',
        translation: '',
        errors: '',
        favorite: false
    }));

    rows = [...payloadRows, ...rows];
    saveRowsToStorage();
    console.log('[Voice] Added rows:', payloadRows, 'Total rows now:', rows.length);
    renderTable();

    console.log('[Voice] Starting LLM analysis (server-side Groq)...');
    runLLMAnalysis(payloadRows, text);
}

function renderTable() {
    console.log('[Voice] renderTable: rows count =', rows.length);
    if (rows.length === 0) {
        tableContainer.innerHTML = '<p style="color:#999;">Нет записей. Введите текст выше.</p>';
        return;
    }
    
    let html = '<table class="voice-table" style="width:100%; border-collapse: collapse; background:white;">';
    html += '<thead><tr style="background:#f0f0f0;">'
        +'<th style="border:1px solid #ccc;padding:10px;text-align:left;">★</th>'
        +'<th style="border:1px solid #ccc;padding:10px;text-align:left;">Текст</th>'
        +'<th style="border:1px solid #ccc;padding:10px;text-align:left;">Перевод</th>'
        +'<th style="border:1px solid #ccc;padding:10px;text-align:left;">Ошибки</th>'
        +'<th style="border:1px solid #ccc;padding:10px;text-align:left;">Время</th>'
        +'<th style="border:1px solid #ccc;padding:10px;text-align:left;">Модель</th>'
        +'</tr></thead>';
    html += '<tbody>';
    
    rows.forEach((row, idx) => {
        const isFav = row.favorite ? true : false;
        html += `<tr style="border-bottom:1px solid #eee;">
            <td data-label="Favorite" style="border:1px solid #ccc;padding:10px;text-align:center;cursor:pointer;" class="fav-cell" data-row="${idx}">${isFav ? '⭐' : '☆'}</td>
            <td data-label="Текст" style="border:1px solid #ccc;padding:10px;">${row.text}</td>
            <td data-label="Перевод" style="border:1px solid #ccc;padding:10px;color:#0066cc;">${row.translation || '—'}</td>
            <td data-label="Ошибки" style="border:1px solid #ccc;padding:10px;color:#cc0000;">${row.errors || '—'}</td>
            <td data-label="Время" style="border:1px solid #ccc;padding:10px;font-size:0.85em;">${row.time}</td>
            <td data-label="Модель" style="border:1px solid #ccc;padding:10px;font-size:0.9em;">${row.model}</td>
        </tr>`;
    });
    
    html += '</tbody></table>';
    tableContainer.innerHTML = html;
    
    // Добавляем обработчик клика по звёздочкам
    document.querySelectorAll('.fav-cell').forEach(cell => {
        cell.addEventListener('click', function() {
            const idx = Number(this.getAttribute('data-row'));
            rows[idx].favorite = !rows[idx].favorite;
            saveRowsToStorage();
            renderTable();
            // Отправляем обновлённую строку в Google Таблицу
            sendToSheet(rows[idx]);
        });
    });
    
    console.log('[Voice] renderTable complete');
}

function sendToSheet(row) {
    const payload = {
        action: 'addVoiceRow',
        id: row.id,
        timestamp: row.time,
        transcript: row.text,
        translation: row.translation || '',
        errors: row.errors || '',
        favorite: row.favorite || false,
        model: row.model
    };

    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    }).then(r => r.json()).then(data => {
        console.log('[Voice] Sheet response:', data);
        // Если сервер вернул новый id, сохраняем его в строке
        if (data && data.id && !row.id) {
            row.id = data.id;
            saveRowsToStorage();
        }
    }).catch(e => {
        console.error('[Voice] Sheet error:', e);
    });
}

async function runLLMAnalysis(targetRows, originalText) {
    setStatus('🤖 Анализ (сервер)...');
    console.log('[Voice] Sending text to GAS for Groq analysis');

    const payload = {
        action: 'analyzeVoiceRows',
        text: originalText,
        model: 'llama-3.3-70b-versatile'
    };

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Voice] GAS analyze error:', errorText);
            throw new Error(`GAS analyzeVoiceRows HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.status !== 'ok' || !Array.isArray(data.items)) {
            throw new Error(data.message || 'Invalid analyze response');
        }

        targetRows.forEach((row, idx) => {
            const item = data.items[idx];
            if (item) {
                row.translation = item.translation || row.translation;
                row.errors = item.errors || row.errors;
                // Отправляем обновлённую строку в Google Таблицу
                sendToSheet(row);
            }
        });

        saveRowsToStorage();
        renderTable();
        setStatus('✅ Анализ готов');
    } catch (err) {
        console.error('[Voice] Analyze error:', err);
        setStatus('❌ Ошибка анализа');
    } finally {
        // recordBtn.disabled = false;
    }
}

// Storage functions
function saveRowsToStorage() {
    try {
        localStorage.setItem('voiceRows', JSON.stringify(rows.slice(0, 100)));
        console.log('[Voice] Saved', rows.length, 'rows to localStorage');
    } catch (e) {
        console.error('[Voice] Storage error:', e);
    }
}

function loadRowsFromStorage() {
    try {
        const stored = localStorage.getItem('voiceRows');
        const parsed = stored ? JSON.parse(stored) : [];
        console.log('[Voice] Loaded', parsed.length, 'rows from localStorage');
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error('[Voice] Storage load error:', e);
        return [];
    }
}

// Initialize
function testScriptUrl() {
    console.log('[Voice] Testing SCRIPT_URL:', SCRIPT_URL);
    fetch(SCRIPT_URL + '?test=1', { method: 'GET', mode: 'cors' })
        .then(async r => {
            console.log('[Voice] Test response status:', r.status, r.statusText);
            try {
                const text = await r.text();
                console.log('[Voice] Test response text:', text);
            } catch (e) {
                console.log('[Voice] Could not read response text:', e);
            }
        })
        .catch(e => {
            console.error('[Voice] Test fetch error:', e);
        });
}

(async () => {
    await initConfig();
    // Quick connectivity test to the Apps Script URL
    testScriptUrl();
    rows = loadRowsFromStorage(); // Reload after config
    renderTable();
    // initWorker();
    console.log('[Voice] Setup complete');
})();
