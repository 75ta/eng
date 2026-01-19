// Whisper-only voice recording
let SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx-_TA6MovduDpZ2qygyPrre9XCJG1t1OSPcSMuFO3tdCbkMpeSjo504DKjVqvxjErh/exec';

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

// Initialize worker
function initWorker() {
    worker = new Worker('whisper-worker.js');
    
    worker.onmessage = (e) => {
        const { status, output, error } = e.data;
        
        if (status === 'loaded') {
            console.log('[Voice] Model loaded');
            setStatus('✅ Model ready');
        } else if (status === 'progress') {
            setStatus(`📥 Loading... ${output}`);
        } else if (status === 'complete') {
            console.log('[Voice] Transcription:', output);
            transcriptEl.textContent = output.text || '';
            
            if (output.text && output.text.trim()) {
                addRowsFromText(output.text.trim());
            }
            
            setStatus('✅ Ready');
            recordBtn.disabled = false;
        } else if (status === 'error') {
            console.error('[Voice] Worker error:', error);
            setStatus('❌ Error: ' + error);
            recordBtn.disabled = false;
        }
    };
}

// Record button
recordBtn.addEventListener('click', async () => {
    if (isRecording) {
        // Stop recording
        console.log('[Voice] Stopping recording');
        isRecording = false;
        mediaRecorder.stop();
        recordBtn.textContent = '🎙️ Начать запись';
        recordBtn.style.background = '';
        stopTimer();
    } else {
        // Start recording
        console.log('[Voice] Starting recording');
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            mediaRecorder = new MediaRecorder(stream);
            chunks = [];
            
            mediaRecorder.ondataavailable = (e) => {
                chunks.push(e.data);
            };
            
            mediaRecorder.onstop = () => {
                console.log('[Voice] Recording stopped, processing...');
                stream.getTracks().forEach(track => track.stop());
                
                const audioBlob = new Blob(chunks, { type: 'audio/webm' });
                processAudio(audioBlob);
            };
            
            mediaRecorder.start();
            isRecording = true;
            recordBtn.textContent = '⏹️ Остановить';
            recordBtn.style.background = '#dc3545';
            setStatus('🎤 Запись...');
            transcriptEl.textContent = '';
            startTimer();
            
        } catch (e) {
            console.error('[Voice] Microphone error:', e);
            setStatus('❌ Нет доступа к микрофону');
        }
    }
});

// Process audio
async function processAudio(audioBlob) {
    try {
        setStatus('⏳ Обработка аудио...');
        recordBtn.disabled = true;
        
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Resample to 16kHz mono
        const offlineContext = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
        const source = offlineContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineContext.destination);
        source.start(0);
        
        const resampledBuffer = await offlineContext.startRendering();
        const audioData = resampledBuffer.getChannelData(0);
        
        console.log('[Voice] Audio processed, sending to worker');
        setStatus('🧠 Распознавание...');
        
        const model = modelSelect.value;
        worker.postMessage({
            audio: audioData,
            model: MODEL_MAP[model]
        });
        
    } catch (e) {
        console.error('[Voice] Processing error:', e);
        setStatus('❌ Ошибка обработки');
        recordBtn.disabled = false;
    }
}

// Timer
function startTimer() {
    seconds = 0;
    timerId = setInterval(() => {
        seconds++;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerId);
    timerEl.textContent = '00:00';
}

function setStatus(text) {
    statusEl.textContent = text;
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
        model: modelSelect.value,
        translation: '',
        errors: '',
        favorite: false
    }));

    rows = [...payloadRows, ...rows];
    saveRowsToStorage();
    console.log('[Voice] Added rows:', payloadRows, 'Total rows now:', rows.length);
    renderTable();

    payloadRows.forEach(sendToSheet);

    console.log('[Voice] useLLMCheckbox:', useLLMCheckbox, 'checked:', useLLMCheckbox?.checked);
    if (useLLMCheckbox && useLLMCheckbox.checked) {
        console.log('[Voice] Starting LLM analysis (server-side Groq)...');
        runLLMAnalysis(payloadRows, text);
    } else {
        console.log('[Voice] LLM analysis skipped (checkbox not checked or not found)');
    }
}

function renderTable() {
    console.log('[Voice] renderTable: rows count =', rows.length);
    if (rows.length === 0) {
        tableContainer.innerHTML = '<p style="color:#999;">Нет записей. Запишите аудио или введите текст выше.</p>';
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
        });
    });
    
    console.log('[Voice] renderTable complete');
}

function sendToSheet(row) {
    const payload = {
        action: 'addVoiceRow',
        timestamp: row.time,
        transcript: row.text,
        translation: row.translation || '',
        errors: row.errors || '',
        favorite: row.favorite || false,
        model: row.model
    };
    
    fetch(SCRIPT_URL, {
        method: 'POST',
        // Use simple CORS-safe content type to avoid preflight
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    }).then(r => r.json()).then(data => {
        console.log('[Voice] Sheet response:', data);
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
        recordBtn.disabled = false;
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
(async () => {
    await initConfig();
    rows = loadRowsFromStorage(); // Reload after config
    renderTable();
    initWorker();
    console.log('[Voice] Setup complete');
})();
