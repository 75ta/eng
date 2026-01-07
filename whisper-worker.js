import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.4';

const cache = new Map();

console.log('[Worker] Whisper worker initialized');

self.onmessage = async (event) => {
    console.log('[Worker] Message received:', event.data.type, 'model:', event.data.model, 'sampling_rate:', event.data.sampling_rate);
    const { type, audio, model, sampling_rate } = event.data;
    if (type !== 'transcribe') return;

    try {
        console.log('[Worker] Getting pipeline for model:', model);
        const transcriber = await getPipeline(model);
        self.postMessage({ type: 'progress', message: 'Транскрипция...' });
        console.log('[Worker] Running transcription, audio length:', audio.length, 'sampling_rate:', sampling_rate);
        const output = await transcriber(audio, {
            chunk_length_s: 30,
            stride_length_s: 5,
            sampling_rate: sampling_rate || 16000
        });
        console.log('[Worker] Transcription complete:', output);
        self.postMessage({ type: 'result', text: output.text || '', info: { language: output.language, model } });
    } catch (err) {
        console.error('[Worker] Error:', err);
        self.postMessage({ type: 'error', message: err.message });
    }
};

async function getPipeline(model) {
    if (cache.has(model)) {
        console.log('[Worker] Using cached pipeline for:', model);
        return cache.get(model);
    }
    console.log('[Worker] Loading new pipeline for:', model);
    self.postMessage({ type: 'progress', message: `Загрузка модели ${model}...` });
    const pipe = await pipeline('automatic-speech-recognition', model, { quantized: true });
    console.log('[Worker] Pipeline loaded successfully for:', model);
    cache.set(model, pipe);
    return pipe;
}
