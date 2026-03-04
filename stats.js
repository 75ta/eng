const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwx8W8rZuxhpPA_LjscRzB2PattBDl3yRcCMpCNIIKK6ym3V9b42rsAATP8DSfqxVeF/exec';

const appContainer = document.getElementById('app-container');
const tableContainer = document.getElementById('table-container');
const filterButtons = document.querySelectorAll('.filter-btn');
const englishColsInput = document.getElementById('english-cols');
const showRussianCheckbox = document.getElementById('show-russian');
const toggleUiBtn = document.getElementById('toggle-ui-btn');
const tagsFilterContainer = document.getElementById('tags-filter-container');
const showHistoryCheckbox = document.getElementById('show-history');

let allWords = [], activeTags = new Set();

function getFilteredWords() {
    const progressFilter = document.querySelector('.filter-btn.active[data-filter]')?.dataset.filter || 'all';
    return allWords.filter(word => {
        const progressMatch = (progressFilter === 'all') ||
            (progressFilter === 'new' && word.interval <= 1) ||
            (progressFilter === 'learning' && word.interval > 1 && word.interval <= 21) ||
            (progressFilter === 'known' && word.interval > 21);
        const tagsFromWord = word.tags.split(',').map(t => t.trim());
        const tagMatch = (activeTags.size === 0) || tagsFromWord.some(t => activeTags.has(t));
        return progressMatch && tagMatch;
    });
}

async function fetchAllWords() {
    try {
        const response = await fetch(`${SCRIPT_URL}?page=stats`);
        allWords = await response.json();
        TtsPlayer.loadState();
        if (TtsPlayer._savedFilters) {
            TtsPlayer.restoreFilters(TtsPlayer._savedFilters);
        }
        generateTagFilters();
        if (TtsPlayer._savedFilters?.tags) {
            TtsPlayer._savedFilters.tags.forEach(tag => {
                activeTags.add(tag);
                const tagBtn = document.querySelector(`.tag-btn[data-tag="${CSS.escape(tag)}"]`);
                if (tagBtn) tagBtn.classList.add('active');
            });
        }
        renderTable();
        TtsPlayer.init();
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

    const filteredWords = getFilteredWords();

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

    if (TtsPlayer._initialized) {
        TtsPlayer.rebuildPlaylist();
    }
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

// --- TTS Player ---

const TtsPlayer = {
    playlist: [],
    index: 0,
    repetition: 0,
    isPlaying: false,
    voiceName: null,
    speed: 1.0,
    voices: [],
    _savedFilters: null,
    _initialized: false,

    els: {},

    init() {
        this.els = {
            player:      document.getElementById('tts-player'),
            play:        document.getElementById('tts-play'),
            prev:        document.getElementById('tts-prev'),
            next:        document.getElementById('tts-next'),
            progress:    document.getElementById('tts-progress'),
            text:        document.getElementById('tts-sentence-text'),
            voice:       document.getElementById('tts-voice'),
            speed:       document.getElementById('tts-speed'),
            chapter:     document.getElementById('tts-chapter'),
        };

        this.els.speed.value = String(this.speed);
        this.setupVoices();
        this.bindEvents();
        this.rebuildPlaylist();
        this._initialized = true;
    },

    loadState() {
        try {
            const raw = localStorage.getItem('ttsPlayerState');
            if (!raw) return;
            const s = JSON.parse(raw);
            this.index = s.sentenceIndex || 0;
            this.repetition = s.repetition || 0;
            this.voiceName = s.voiceName || null;
            this.speed = s.speed || 1.0;
            this._savedFilters = s.filters || null;
        } catch(e) { /* ignore */ }
    },

    saveState() {
        const progressFilter = document.querySelector('.filter-btn.active[data-filter]')?.dataset.filter || 'all';
        const state = {
            sentenceIndex: this.index,
            repetition: this.repetition,
            voiceName: this.voiceName,
            speed: this.speed,
            filters: {
                progress: progressFilter,
                tags: [...activeTags],
                englishCols: parseInt(englishColsInput.value) || 1,
            }
        };
        localStorage.setItem('ttsPlayerState', JSON.stringify(state));
    },

    restoreFilters(saved) {
        if (!saved) return;
        const btn = document.querySelector(`.filter-btn[data-filter="${saved.progress}"]`);
        if (btn) {
            document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
        if (saved.englishCols) englishColsInput.value = saved.englishCols;
    },

    setupVoices() {
        const load = () => {
            this.voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
            this.populateVoiceDropdown();
        };
        load();
        speechSynthesis.onvoiceschanged = load;
    },

    populateVoiceDropdown() {
        const sel = this.els.voice;
        sel.innerHTML = '';
        const grouped = {};
        this.voices.forEach(v => {
            const lang = v.lang || 'en';
            if (!grouped[lang]) grouped[lang] = [];
            grouped[lang].push(v);
        });
        const langOrder = Object.keys(grouped).sort((a, b) => {
            if (a === 'en-US') return -1;
            if (b === 'en-US') return 1;
            return a.localeCompare(b);
        });
        langOrder.forEach(lang => {
            const group = document.createElement('optgroup');
            group.label = lang;
            grouped[lang].forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.name;
                opt.textContent = v.name.replace(/Microsoft /, '').replace(/ Online \(Natural\)/, ' *');
                if (v.name === this.voiceName) opt.selected = true;
                group.appendChild(opt);
            });
            sel.appendChild(group);
        });
        if (this.voiceName && !this.voices.find(v => v.name === this.voiceName)) {
            this.voiceName = this.voices[0]?.name || null;
        }
        if (!this.voiceName && this.voices.length) {
            this.voiceName = this.voices[0].name;
        }
    },

    rebuildPlaylist() {
        const oldId = this.playlist[this.index]?.id;
        this.playlist = getFilteredWords();

        if (oldId != null) {
            const newIdx = this.playlist.findIndex(w => w.id === oldId);
            if (newIdx >= 0) {
                this.index = newIdx;
            } else {
                this.index = Math.min(this.index, Math.max(0, this.playlist.length - 1));
                this.repetition = 0;
            }
        } else {
            this.index = Math.min(this.index, Math.max(0, this.playlist.length - 1));
        }

        this.updateUI();
        this.saveState();
    },

    play() {
        if (this.playlist.length === 0) return;
        this.isPlaying = true;
        this.speakCurrent();
    },

    pause() {
        this.isPlaying = false;
        speechSynthesis.cancel();
        this.updateUI();
        this.saveState();
    },

    speakCurrent() {
        if (this.playlist.length === 0) return;
        speechSynthesis.cancel();

        const word = this.playlist[this.index];
        const utterance = new SpeechSynthesisUtterance(word.english);
        utterance.lang = 'en-US';
        utterance.rate = this.speed;

        const voice = this.voices.find(v => v.name === this.voiceName);
        if (voice) utterance.voice = voice;

        utterance.onend = () => {
            if (!this.isPlaying) return;
            const maxReps = parseInt(englishColsInput.value) || 1;
            this.repetition++;
            if (this.repetition >= maxReps) {
                this.repetition = 0;
                this.index++;
                if (this.index >= this.playlist.length) {
                    this.index = 0;
                    this.isPlaying = false;
                    this.updateUI();
                    this.saveState();
                    return;
                }
            }
            this.updateUI();
            this.saveState();
            setTimeout(() => this.speakCurrent(), 400);
        };

        utterance.onerror = (e) => {
            if (e.error === 'canceled') return;
            this.isPlaying = false;
            this.updateUI();
        };

        speechSynthesis.speak(utterance);
        this.updateUI();
    },

    next() {
        if (this.playlist.length === 0) return;
        this.repetition = 0;
        this.index = (this.index + 1) % this.playlist.length;
        this.updateUI();
        this.saveState();
        if (this.isPlaying) this.speakCurrent();
    },

    prev() {
        if (this.playlist.length === 0) return;
        this.repetition = 0;
        this.index = (this.index - 1 + this.playlist.length) % this.playlist.length;
        this.updateUI();
        this.saveState();
        if (this.isPlaying) this.speakCurrent();
    },

    updateUI() {
        const maxReps = parseInt(englishColsInput.value) || 1;
        const word = this.playlist[this.index];

        this.els.play.innerHTML = this.isPlaying ? '&#9646;&#9646;' : '&#9654;';

        if (this.playlist.length === 0 || !word) {
            this.els.progress.textContent = 'No sentences';
            this.els.text.textContent = '';
            this.els.chapter.textContent = '';
            this.els.chapter.style.display = 'none';
            return;
        }

        this.els.progress.textContent =
            `${this.index + 1}/${this.playlist.length} (rep ${this.repetition + 1}/${maxReps})`;
        this.els.text.textContent = word.english;

        const firstTag = word.tags.split(',').map(t => t.trim()).find(t => t);
        this.els.chapter.textContent = firstTag || '';
        this.els.chapter.style.display = firstTag ? '' : 'none';

        const rows = document.querySelectorAll('#table-container tbody tr');
        rows.forEach((r, i) => r.classList.toggle('tts-active-row', i === this.index));
    },

    bindEvents() {
        this.els.play.addEventListener('click', () => {
            this.isPlaying ? this.pause() : this.play();
        });
        this.els.next.addEventListener('click', () => this.next());
        this.els.prev.addEventListener('click', () => this.prev());

        this.els.voice.addEventListener('change', (e) => {
            this.voiceName = e.target.value;
            this.saveState();
        });

        this.els.speed.addEventListener('change', (e) => {
            this.speed = parseFloat(e.target.value);
            this.saveState();
        });

        tableContainer.addEventListener('click', (e) => {
            const row = e.target.closest('tbody tr');
            if (!row) return;
            const rows = [...tableContainer.querySelectorAll('tbody tr')];
            const rowIndex = rows.indexOf(row);
            if (rowIndex < 0 || rowIndex >= this.playlist.length) return;
            this.index = rowIndex;
            this.repetition = 0;
            this.updateUI();
            this.saveState();
            speechSynthesis.cancel();
            const word = this.playlist[this.index];
            const utterance = new SpeechSynthesisUtterance(word.english);
            utterance.lang = 'en-US';
            utterance.rate = this.speed;
            const voice = this.voices.find(v => v.name === this.voiceName);
            if (voice) utterance.voice = voice;
            speechSynthesis.speak(utterance);
        });

    },
};

fetchAllWords();
