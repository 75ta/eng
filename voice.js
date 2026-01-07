// Whisper-only voice recording
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz9_8oqDfUQvRWbFrc_79V4hpj9Llh1ox0Kz5UlUI2DtFYQVOj3OnjxRyPbyLLtcZQ/exec';

let CONFIG = {};

// Load config from .env
async function initConfig() {
    try {
        const response = await fetch('./.env');
        if (response.ok) {
            const envText = await response.text();
            envText.split('\n').forEach(line => {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                    CONFIG[key.trim()] = value.trim();
                }
            });
            console.log('[Voice] Config loaded:', Object.keys(CONFIG));
        }
    } catch (error) {
        console.warn('[Voice] Could not load .env file:', error);
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
        errors: ''
    }));

    rows = [...payloadRows, ...rows];
    saveRowsToStorage();
    console.log('[Voice] Added rows:', payloadRows, 'Total rows now:', rows.length);
    renderTable();

    payloadRows.forEach(sendToSheet);

    console.log('[Voice] useLLMCheckbox:', useLLMCheckbox, 'checked:', useLLMCheckbox?.checked);
    if (useLLMCheckbox && useLLMCheckbox.checked) {
        console.log('[Voice] Starting LLM analysis...');
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
    html += '<thead><tr style="background:#f0f0f0;"><th style="border:1px solid #ccc;padding:10px;text-align:left;">Время</th><th style="border:1px solid #ccc;padding:10px;text-align:left;">Текст</th><th style="border:1px solid #ccc;padding:10px;text-align:left;">Перевод</th><th style="border:1px solid #ccc;padding:10px;text-align:left;">Ошибки</th><th style="border:1px solid #ccc;padding:10px;text-align:left;">Модель</th></tr></thead>';
    html += '<tbody>';
    
    rows.forEach(row => {
        html += `<tr style="border-bottom:1px solid #eee;">
            <td data-label="Время" style="border:1px solid #ccc;padding:10px;font-size:0.85em;">${row.time}</td>
            <td data-label="Текст" style="border:1px solid #ccc;padding:10px;">${row.text}</td>
            <td data-label="Перевод" style="border:1px solid #ccc;padding:10px;color:#0066cc;">${row.translation || '—'}</td>
            <td data-label="Ошибки" style="border:1px solid #ccc;padding:10px;color:#cc0000;">${row.errors || '—'}</td>
            <td data-label="Модель" style="border:1px solid #ccc;padding:10px;font-size:0.9em;">${row.model}</td>
        </tr>`;
    });
    
    html += '</tbody></table>';
    tableContainer.innerHTML = html;
    console.log('[Voice] renderTable complete');
}

function sendToSheet(row) {
    const payload = {
        action: 'addVoiceRow',
        timestamp: row.time,
        transcript: row.text,
        translation: row.translation || '',
        errors: row.errors || '',
        model: row.model
    };
    
    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(r => r.json()).then(data => {
        console.log('[Voice] Sheet response:', data);
    }).catch(e => {
        console.error('[Voice] Sheet error:', e);
    });
}

async function runLLMAnalysis(targetRows, originalText) {
    console.log('[Voice] runLLMAnalysis called, CONFIG.GROQ_API_KEY:', CONFIG.GROQ_API_KEY ? 'exists' : 'missing');
    
    if (!CONFIG.GROQ_API_KEY) {
        setStatus('⚠️ GROQ_API_KEY не установлен в .env');
        console.error('[Voice] GROQ_API_KEY not found in CONFIG');
        return;
    }

    setStatus('🤖 Анализ Groq...');
    console.log('[Voice] Sending to Groq, text:', originalText);

    const prompt = `You are an English teacher. Analyze the provided English text sentence by sentence.

IMPORTANT: For each sentence, you MUST provide ALL three fields:
1. "original": The exact original English sentence
2. "translation": Russian translation (ALWAYS required, even if there are errors)
3. "errors": If there are grammar/spelling errors, write the CORRECTED sentence first, then add " ||| Errors: " followed by the list of errors. If no errors, use empty string ""

Return ONLY a valid JSON array with no additional text or formatting.

Format (with errors):
[
  {
    "original": "He are cat",
    "translation": "Он кот",
    "errors": "He is a cat ||| Errors: Wrong verb form 'are' (should be 'is'), Missing article 'a' before 'cat'"
  }
]

Format (no errors):
[
  {
    "original": "She likes apples",
    "translation": "Она любит яблоки",
    "errors": ""
  }
]

Text to analyze:
"${originalText}"`;

    const payload = {
        model: 'llama-3.3-70b-versatile',
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
        console.log('[Voice] Fetching from Groq API...');
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log('[Voice] Groq response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Voice] Groq error response:', errorText);
            throw new Error(`Groq API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        console.log('[Voice] Groq response content:', content);

        // Robust Parsing (adapted from script.js)
        let cleanedContent = content.replace(/```json\n?/g, '').replace(/\n?```/g, '');
        
        // Try to find JSON array
        const jsonMatch = cleanedContent.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) {
            cleanedContent = jsonMatch[0];
        }

        let parsed = [];
        try {
            parsed = JSON.parse(cleanedContent);
        } catch (firstError) {
            console.log('[Voice] First JSON parse failed:', firstError.message);
            // Try to fix common issues with newlines in strings
            let fixedContent = cleanedContent
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t');
            try {
                parsed = JSON.parse(fixedContent);
            } catch (secondError) {
                console.error('[Voice] Second JSON parse failed:', secondError.message);
                throw new Error('Failed to parse JSON response');
            }
        }

        if (Array.isArray(parsed)) {
            targetRows.forEach((row, idx) => {
                // Try to find matching sentence or just use index
                const item = parsed[idx]; // Simple index matching for now
                if (item) {
                    row.translation = item.translation || row.translation;
                    row.errors = item.errors || row.errors;
                }
            });
        }
        
        saveRowsToStorage();
        renderTable();
        setStatus('✅ Анализ готов');
    } catch (err) {
        console.error('[Voice] Groq error:', err);
        setStatus('⚠️ Groq ошибка: ' + err.message);
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
