document.addEventListener('DOMContentLoaded', () => {
    const sourceLanguageSelect = document.getElementById('sourceLanguage');
    const targetLanguageSelect = document.getElementById('targetLanguage');
    const targetLanguageControl = document.getElementById('targetLanguageControl');
    const translationToggle = document.getElementById('translationToggle');
    const translationResultControl = document.getElementById('translationResultControl');
    const translatedTextArea = document.getElementById('translatedText');

    const startRecordingButton = document.getElementById('startRecording');
    const processTextAudioButton = document.getElementById('processTextAudio');
    const copyTextButton = document.getElementById('copyText');
    const downloadTextButton = document.getElementById('downloadText');
    const downloadMp3Button = document.getElementById('downloadMp3');

    const pageTextArea = document.getElementById('pageText');
    const statusElement = document.getElementById('status');
    const timbreCanvas = document.getElementById('timbreCanvas');
    const sourceModeInputs = document.querySelectorAll('input[name="captureSource"]');

    const speechRateInput = document.getElementById('speechRate');
    const speechRateValue = document.getElementById('speechRateValue');
    const charCountElement = document.getElementById('charCount');
    const wordCountElement = document.getElementById('wordCount');

    const canvasContext = timbreCanvas.getContext('2d');
    const CHUNK_INTERVAL_MS = 3500;
    const MIN_CHUNK_SIZE_BYTES = 2048;
    const MIN_SPEECH_SCORE = 0.14;
    const RAW_API_BASE = (window.VOICE_API_BASE || '').trim();
    const API_BASE = RAW_API_BASE.replace(/\/$/, '');

    const speechLocales = {
        ar: 'ar-SA', bg: 'bg-BG', cs: 'cs-CZ', da: 'da-DK', de: 'de-DE', el: 'el-GR',
        en: 'en-US', es: 'es-ES', et: 'et-EE', fi: 'fi-FI', fr: 'fr-FR', hu: 'hu-HU',
        it: 'it-IT', ja: 'ja-JP', ko: 'ko-KR', lv: 'lv-LV', lt: 'lt-LT', nl: 'nl-NL',
        nb: 'nb-NO', pl: 'pl-PL', pt: 'pt-PT', ro: 'ro-RO', ru: 'ru-RU', sk: 'sk-SK',
        sl: 'sl-SI', sv: 'sv-SE', tr: 'tr-TR', uk: 'uk-UA', zh: 'zh-CN'
    };

    let recording = false;
    let mediaStream = null;
    let mediaRecorder = null;
    let recorderSegmentTimeoutId = null;
    let transcriptionQueue = Promise.resolve();
    let currentRecorderMimeType = 'audio/webm';

    let audioContext = null;
    let analyserNode = null;
    let animationFrameId = null;

    let transcriptText = '';
    let isSpeaking = false;

    const setStatus = (text) => {
        statusElement.textContent = text;
    };

    const updateCounters = () => {
        const text = pageTextArea.value.trim();
        const words = text ? text.split(/\s+/).length : 0;
        charCountElement.textContent = `Characters: ${text.length}`;
        wordCountElement.textContent = `Words: ${words}`;
    };

    const getSelectedSourceMode = () => {
        const selected = [...sourceModeInputs].find((input) => input.checked);
        return selected ? selected.value : 'mic';
    };

    const updateSpeakButtonLabel = () => {
        if (isSpeaking) {
            processTextAudioButton.textContent = 'Stop Speak';
            processTextAudioButton.classList.add('is-speaking');
            return;
        }

        processTextAudioButton.classList.remove('is-speaking');
        processTextAudioButton.textContent = translationToggle.checked ? 'Translate + Speak' : 'Speak Text';
    };

    const applyTranslationVisibility = () => {
        const enabled = translationToggle.checked;
        targetLanguageControl.classList.toggle('hidden', !enabled);
        translationResultControl.classList.toggle('hidden', !enabled);
        if (!enabled) {
            translatedTextArea.value = '';
        }
        updateSpeakButtonLabel();
    };

    const stopSpeaking = () => {
        window.speechSynthesis.cancel();
        isSpeaking = false;
        updateSpeakButtonLabel();
    };

    const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const apiUrl = (path) => `${API_BASE}${path}`;

    const clearVisualizer = () => {
        const width = timbreCanvas.width;
        const height = timbreCanvas.height;

        canvasContext.clearRect(0, 0, width, height);
        const gradient = canvasContext.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#4e0a14');
        gradient.addColorStop(1, '#2a0208');
        canvasContext.fillStyle = gradient;
        canvasContext.fillRect(0, 0, width, height);

        canvasContext.fillStyle = 'rgba(255, 188, 198, 0.62)';
        canvasContext.font = '600 13px DM Sans, sans-serif';
        canvasContext.fillText('Voice waveform appears here during recording', 22, height / 2);
    };

    const stopVisualizer = async () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        if (audioContext) {
            await audioContext.close();
            audioContext = null;
        }

        analyserNode = null;
        clearVisualizer();
    };

    const drawVisualizer = () => {
        if (!analyserNode) {
            return;
        }

        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const render = () => {
            if (!analyserNode) {
                return;
            }

            analyserNode.getByteFrequencyData(dataArray);
            const width = timbreCanvas.width;
            const height = timbreCanvas.height;

            const gradient = canvasContext.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, '#6a0f1e');
            gradient.addColorStop(1, '#1f0105');
            canvasContext.fillStyle = gradient;
            canvasContext.fillRect(0, 0, width, height);

            const bars = 66;
            const step = Math.max(1, Math.floor(bufferLength / bars));
            const barWidth = width / bars;

            for (let i = 0; i < bars; i += 1) {
                const value = dataArray[i * step];
                const barHeight = Math.max(4, (value / 255) * (height - 20));
                const x = i * barWidth;
                const y = height - barHeight;

                const red = Math.min(255, 165 + value);
                const green = Math.max(28, 92 - Math.floor(value * 0.22));
                const blue = Math.max(28, 80 - Math.floor(value * 0.35));

                canvasContext.fillStyle = `rgb(${red}, ${green}, ${blue})`;
                canvasContext.fillRect(x + 1.4, y, barWidth - 2.8, barHeight);
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();
    };

    const startVisualizer = async (stream) => {
        await stopVisualizer();
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const sourceNode = audioContext.createMediaStreamSource(stream);

        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 2048;
        analyserNode.smoothingTimeConstant = 0.82;

        sourceNode.connect(analyserNode);
        drawVisualizer();
    };

    const stopMediaTracks = () => {
        if (!mediaStream) {
            return;
        }
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
    };

    const encodeWav = (audioBuffer) => {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const samples = audioBuffer.getChannelData(0);
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        const writeString = (offset, value) => {
            for (let i = 0; i < value.length; i += 1) {
                view.setUint8(offset + i, value.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * 2, true);
        view.setUint16(32, numChannels * 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, samples.length * 2, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i += 1) {
            const sample = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }

        return buffer;
    };

    const mixToMono = (audioBuffer) => {
        if (audioBuffer.numberOfChannels === 1) {
            return audioBuffer;
        }

        const mono = new AudioBuffer({
            length: audioBuffer.length,
            sampleRate: audioBuffer.sampleRate,
            numberOfChannels: 1
        });
        const output = mono.getChannelData(0);
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch += 1) {
            const input = audioBuffer.getChannelData(ch);
            for (let i = 0; i < output.length; i += 1) {
                output[i] += input[i] / audioBuffer.numberOfChannels;
            }
        }
        return mono;
    };

    const resampleTo16kMono = async (blob) => {
        const arrayBuffer = await blob.arrayBuffer();
        const decodeContext = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
        await decodeContext.close();

        const mono = mixToMono(decoded);
        const targetRate = 16000;
        const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(mono.duration * targetRate)), targetRate);
        const source = offline.createBufferSource();
        source.buffer = mono;
        source.connect(offline.destination);
        source.start(0);
        return offline.startRendering();
    };

    const analyzeSpeechLikelihood = (channelData) => {
        const frameSize = 512;
        const hop = 256;
        let speechFrames = 0;
        let musicFrames = 0;
        let activeFrames = 0;
        let rmsSum = 0;

        for (let start = 0; start + frameSize <= channelData.length; start += hop) {
            let energy = 0;
            let zeroCrossings = 0;
            let prev = channelData[start];

            for (let i = start; i < start + frameSize; i += 1) {
                const sample = channelData[i];
                energy += sample * sample;
                if ((sample >= 0 && prev < 0) || (sample < 0 && prev >= 0)) {
                    zeroCrossings += 1;
                }
                prev = sample;
            }

            const rms = Math.sqrt(energy / frameSize);
            rmsSum += rms;
            if (rms < 0.006) {
                continue;
            }

            activeFrames += 1;
            const zcr = zeroCrossings / frameSize;

            if (rms > 0.012 && zcr > 0.02 && zcr < 0.2) {
                speechFrames += 1;
            }

            if (rms > 0.02 && zcr < 0.035) {
                musicFrames += 1;
            }
        }

        const speechScore = activeFrames ? speechFrames / activeFrames : 0;
        const musicScore = activeFrames ? musicFrames / activeFrames : 0;
        const avgRms = channelData.length ? rmsSum / Math.ceil(channelData.length / hop) : 0;

        return {
            speechScore,
            musicScore,
            avgRms,
            shouldTranscribe: avgRms >= 0.006 && (speechScore >= MIN_SPEECH_SCORE || (speechScore >= 0.08 && musicScore < 0.75))
        };
    };

    const prepareChunkForUpload = async (blob) => {
        const audioBuffer = await resampleTo16kMono(blob);
        const metrics = analyzeSpeechLikelihood(audioBuffer.getChannelData(0));
        const wavBuffer = encodeWav(audioBuffer);
        const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

        return { wavBlob, metrics };
    };

    const mergeTranscriptChunk = (current, incoming) => {
        const next = (incoming || '').trim();
        if (!next) {
            return current;
        }
        if (!current) {
            return next;
        }

        const left = current.trimEnd();
        if (left.endsWith(next) || left.includes(next)) {
            return left;
        }

        const leftWords = left.split(/\s+/);
        const rightWords = next.split(/\s+/);
        const maxOverlap = Math.min(8, leftWords.length, rightWords.length);
        let overlap = 0;

        for (let size = maxOverlap; size > 0; size -= 1) {
            const leftTail = leftWords.slice(-size).join(' ').toLowerCase();
            const rightHead = rightWords.slice(0, size).join(' ').toLowerCase();
            if (leftTail === rightHead) {
                overlap = size;
                break;
            }
        }

        const remainder = overlap ? rightWords.slice(overlap).join(' ') : next;
        return remainder ? `${left} ${remainder}`.trim() : left;
    };

    const appendTranscript = (incoming) => {
        const clean = (incoming || '').trim();
        if (!clean) {
            return;
        }

        transcriptText = mergeTranscriptChunk(transcriptText, clean);
        pageTextArea.value = transcriptText;
        updateCounters();
    };

    const transcribeChunk = async (blob) => {
        if (!blob || blob.size === 0) {
            return;
        }

        const { wavBlob, metrics } = await prepareChunkForUpload(blob);
        if (!metrics.shouldTranscribe) {
            return;
        }

        const formData = new FormData();
        formData.append('audio', wavBlob, `chunk-${Date.now()}.wav`);
        formData.append('sourceLang', sourceLanguageSelect.value);
        formData.append('speechScore', String(metrics.speechScore.toFixed(3)));
        formData.append('previousText', transcriptText.slice(-600));

        const response = await fetch(apiUrl('/api/transcribe'), {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('API route /api/transcribe not found. Deploy backend on this domain or set window.VOICE_API_BASE to your API server URL.');
            }
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `Transcription failed (${response.status})`);
        }

        const payload = await response.json();
        if (!payload.skipped) {
            appendTranscript(payload.text);
        }
    };

    const queueTranscription = (blob) => {
        if (!blob || blob.size < MIN_CHUNK_SIZE_BYTES) {
            return;
        }

        transcriptionQueue = transcriptionQueue
            .then(() => transcribeChunk(blob))
            .catch((error) => {
                setStatus(`Transcription warning: ${error.message}`);
            });
    };

    const refineTranscript = async () => {
        const text = transcriptText.trim();
        if (!text) {
            return;
        }

        try {
            setStatus('Refining transcript…');
            const response = await fetch(apiUrl('/api/refine-text'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    sourceLang: sourceLanguageSelect.value
                })
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || `Refine failed (${response.status})`);
            }

            const payload = await response.json();
            const refined = String(payload.text || '').trim();
            if (refined) {
                transcriptText = refined;
                pageTextArea.value = refined;
                updateCounters();
                setStatus('Transcript refined.');
            }
        } catch (error) {
            setStatus(`Refine warning: ${error.message}`);
        }
    };

    const clearRecorderSegmentTimer = () => {
        if (recorderSegmentTimeoutId) {
            clearTimeout(recorderSegmentTimeoutId);
            recorderSegmentTimeoutId = null;
        }
    };

    const createRecorder = () => {
        const options = currentRecorderMimeType
            ? { mimeType: currentRecorderMimeType, audioBitsPerSecond: 128000 }
            : { audioBitsPerSecond: 128000 };

        const recorder = new MediaRecorder(mediaStream, options);

        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size >= MIN_CHUNK_SIZE_BYTES) {
                queueTranscription(event.data);
            }
        };

        recorder.onstop = () => {
            if (!recording) {
                return;
            }

            startRecorderSegment();
        };

        return recorder;
    };

    const startRecorderSegment = () => {
        clearRecorderSegmentTimer();

        mediaRecorder = createRecorder();
        mediaRecorder.start();

        recorderSegmentTimeoutId = setTimeout(() => {
            if (recording && mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        }, CHUNK_INTERVAL_MS);
    };

    const pickRecorderMimeType = () => {
        const preferred = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/ogg;codecs=opus'
        ];

        const supported = preferred.find((type) => MediaRecorder.isTypeSupported(type));
        return supported || '';
    };

    const getInputStream = async () => {
        if (getSelectedSourceMode() === 'system') {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: 48000,
                    channelCount: 2
                },
                systemAudio: 'include',
                monitorTypeSurfaces: 'include',
                selfBrowserSurface: 'exclude',
                preferCurrentTab: false
            });

            stream.getVideoTracks().forEach((track) => track.stop());

            if (!stream.getAudioTracks().length) {
                throw new Error('No system audio was shared. Select Entire screen and enable system audio.');
            }

            return stream;
        }

        return navigator.mediaDevices.getUserMedia({
            video: false,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 1
            }
        });
    };

    const startRecording = async () => {
        if (recording) {
            return;
        }

        stopSpeaking();
        transcriptText = '';
        pageTextArea.value = '';
        translatedTextArea.value = '';
        updateCounters();

        try {
            mediaStream = await getInputStream();
            await startVisualizer(mediaStream);

            currentRecorderMimeType = pickRecorderMimeType();
            startRecorderSegment();

            recording = true;
            startRecordingButton.textContent = 'Stop Recording';
            startRecordingButton.classList.add('is-recording');
            setStatus('Recording…');
        } catch (error) {
            setStatus(`Could not start recording: ${error.message}`);
            await stopVisualizer();
            stopMediaTracks();
        }
    };

    const stopRecording = async () => {
        if (!recording) {
            return;
        }

        recording = false;

        clearRecorderSegmentTimer();

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }

        mediaRecorder = null;
        stopMediaTracks();
        await stopVisualizer();

        await transcriptionQueue;
        await refineTranscript();

        startRecordingButton.textContent = 'Start Recording';
        startRecordingButton.classList.remove('is-recording');
        setStatus('Recording stopped. Transcript is ready.');
    };

    const translateText = async (text, sourceLang, targetLang) => {
        if (sourceLang === targetLang) {
            return text;
        }

        const response = await fetch(apiUrl('/api/translate'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, sourceLang, targetLang })
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('API route /api/translate not found. Deploy backend on this domain or set window.VOICE_API_BASE to your API server URL.');
            }
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `Translation failed (${response.status})`);
        }

        const payload = await response.json();
        return payload.text;
    };

    const speakText = (text, langCode) => new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = speechLocales[langCode] || langCode;
        utterance.rate = Number(speechRateInput.value);
        utterance.pitch = 1;

        const finish = (statusText) => {
            isSpeaking = false;
            updateSpeakButtonLabel();
            if (statusText) {
                setStatus(statusText);
            }
            resolve();
        };

        utterance.onstart = () => {
            isSpeaking = true;
            updateSpeakButtonLabel();
            setStatus('Speaking…');
        };
        utterance.onend = () => finish('Speech playback finished.');
        utterance.onerror = () => finish('Speech playback failed for the selected language.');

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    });

    const getTextForSpeech = async () => {
        const sourceText = pageTextArea.value.trim();
        if (!sourceText) {
            return { text: '', langCode: sourceLanguageSelect.value };
        }

        if (!translationToggle.checked) {
            return { text: sourceText, langCode: sourceLanguageSelect.value };
        }

        let translated = translatedTextArea.value.trim();
        if (!translated) {
            setStatus('Translating with DeepL…');
            translated = await translateText(sourceText, sourceLanguageSelect.value, targetLanguageSelect.value);
            translatedTextArea.value = translated;
        }

        return { text: translated, langCode: targetLanguageSelect.value };
    };

    const processTranslateAndSpeak = async () => {
        if (isSpeaking) {
            stopSpeaking();
            setStatus('Speech stopped.');
            return;
        }

        if (recording) {
            await stopRecording();
        }

        const sourceText = pageTextArea.value.trim();
        if (!sourceText) {
            setStatus('No text available. Record or type text first.');
            return;
        }

        try {
            if (!translationToggle.checked) {
                translatedTextArea.value = '';
            }

            const { text, langCode } = await getTextForSpeech();
            if (!text) {
                setStatus('No text available to speak.');
                return;
            }

            await speakText(text, langCode);
        } catch (error) {
            isSpeaking = false;
            updateSpeakButtonLabel();
            setStatus(`Translation failed: ${error.message}`);
        }
    };

    const copyText = async () => {
        const text = pageTextArea.value.trim();
        if (!text) {
            setStatus('Nothing to copy.');
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            setStatus('Text copied to clipboard.');
        } catch (error) {
            setStatus('Clipboard access failed.');
        }
    };

    const buildExportText = async () => {
        const sourceText = pageTextArea.value.trim();
        if (!sourceText) {
            return '';
        }

        if (!translationToggle.checked) {
            return sourceText;
        }

        let translated = translatedTextArea.value.trim();
        if (!translated) {
            translated = await translateText(sourceText, sourceLanguageSelect.value, targetLanguageSelect.value);
            translatedTextArea.value = translated;
        }

        return `--- Text ---\n${sourceText}\n\n--- Translation ---\n${translated}\n`;
    };

    const downloadText = async () => {
        const sourceText = pageTextArea.value.trim();
        if (!sourceText) {
            setStatus('Nothing to export.');
            return;
        }

        try {
            if (translationToggle.checked) {
                setStatus('Preparing TXT export…');
            }

            const exportText = await buildExportText();
            const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
            downloadBlob(blob, `voice-notes-${Date.now()}.txt`);
            setStatus('TXT exported.');
        } catch (error) {
            setStatus(`TXT export failed: ${error.message}`);
        }
    };

    const downloadMp3 = async () => {
        const sourceText = pageTextArea.value.trim();
        if (!sourceText) {
            setStatus('Nothing to export as MP3.');
            return;
        }

        try {
            setStatus('Generating MP3…');
            const { text } = await getTextForSpeech();
            if (!text) {
                setStatus('Nothing to export as MP3.');
                return;
            }

            const response = await fetch(apiUrl('/api/tts'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || `MP3 export failed (${response.status})`);
            }

            const blob = await response.blob();
            downloadBlob(blob, `voice-speech-${Date.now()}.mp3`);
            setStatus('MP3 downloaded.');
        } catch (error) {
            setStatus(`MP3 export failed: ${error.message}`);
        }
    };

    startRecordingButton.addEventListener('click', async () => {
        if (recording) {
            await stopRecording();
        } else {
            await startRecording();
        }
    });

    processTextAudioButton.addEventListener('click', processTranslateAndSpeak);
    copyTextButton.addEventListener('click', copyText);
    downloadTextButton.addEventListener('click', downloadText);
    downloadMp3Button.addEventListener('click', downloadMp3);

    pageTextArea.addEventListener('input', updateCounters);

    translationToggle.addEventListener('change', () => {
        applyTranslationVisibility();
        setStatus(translationToggle.checked ? 'Translation mode enabled.' : 'Translation mode disabled.');
    });

    sourceModeInputs.forEach((input) => {
        input.addEventListener('change', async () => {
            if (recording) {
                await stopRecording();
            }
            setStatus('Input source changed. Press Start Recording.');
        });
    });

    speechRateInput.addEventListener('input', () => {
        speechRateValue.textContent = `${Number(speechRateInput.value).toFixed(2)}x`;
    });

    window.addEventListener('beforeunload', () => {
        stopSpeaking();
    });

    applyTranslationVisibility();
    updateCounters();
    speechRateValue.textContent = `${Number(speechRateInput.value).toFixed(2)}x`;
    clearVisualizer();
});
