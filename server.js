const path = require('path');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const OpenAI = require('openai');
const config = require('./config');
const { refineTranscriptText, transcribeAudioChunk } = require('./stt-pipeline');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const port = config.port || 3000;
const openai = new OpenAI({ apiKey: config.openaiApiKey });

const deeplLangMap = {
    ar: 'AR',
    bg: 'BG',
    cs: 'CS',
    da: 'DA',
    de: 'DE',
    el: 'EL',
    en: 'EN',
    es: 'ES',
    et: 'ET',
    fi: 'FI',
    fr: 'FR',
    hu: 'HU',
    it: 'IT',
    ja: 'JA',
    ko: 'KO',
    lt: 'LT',
    lv: 'LV',
    nb: 'NB',
    nl: 'NL',
    pl: 'PL',
    pt: 'PT-PT',
    ro: 'RO',
    ru: 'RU',
    sk: 'SK',
    sl: 'SL',
    sv: 'SV',
    tr: 'TR',
    uk: 'UK',
    zh: 'ZH'
};

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/api/health', (req, res) => {
    res.json({ ok: true });
});

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Audio file is required.' });
        }

        if (!config.openaiApiKey) {
            return res.status(500).json({ error: 'openaiApiKey is not configured in config.js.' });
        }

        const sourceLang = (req.body.sourceLang || 'en').toLowerCase();
        const language = sourceLang.slice(0, 2);
        const previousText = String(req.body.previousText || '').trim();
        const speechScore = req.body.speechScore !== undefined ? Number(req.body.speechScore) : undefined;

        const result = await transcribeAudioChunk(openai, config, {
            buffer: req.file.buffer,
            mimeType: req.file.mimetype || 'audio/wav',
            filename: req.file.originalname || 'chunk.wav',
            language,
            previousText,
            speechScore
        });

        res.json({
            text: result.text || '',
            skipped: Boolean(result.skipped),
            reason: result.reason || null
        });
    } catch (error) {
        console.error('Transcription error:', error);
        res.status(500).json({ error: 'Transcription failed.' });
    }
});

app.post('/api/refine-text', async (req, res) => {
    try {
        if (!config.openaiApiKey) {
            return res.status(500).json({ error: 'openaiApiKey is not configured in config.js.' });
        }

        const text = String(req.body.text || '').trim();
        const sourceLang = String(req.body.sourceLang || '').toLowerCase();

        if (!text) {
            return res.status(400).json({ error: 'Text is required.' });
        }

        const refined = await refineTranscriptText(openai, config, text, sourceLang);
        res.json({ text: refined });
    } catch (error) {
        console.error('Refine text error:', error);
        res.status(500).json({ error: 'Text refinement failed.' });
    }
});

app.post('/api/tts', async (req, res) => {
    try {
        if (!config.openaiApiKey) {
            return res.status(500).json({ error: 'openaiApiKey is not configured in config.js.' });
        }

        const text = String(req.body.text || '').trim();
        if (!text) {
            return res.status(400).json({ error: 'Text is required.' });
        }

        const speech = await openai.audio.speech.create({
            model: config.ttsModel || 'tts-1',
            voice: config.ttsVoice || 'alloy',
            input: text,
            response_format: 'mp3'
        });

        const buffer = Buffer.from(await speech.arrayBuffer());
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="speech.mp3"');
        res.send(buffer);
    } catch (error) {
        console.error('TTS error:', error);
        res.status(500).json({ error: 'Speech generation failed.' });
    }
});

app.post('/api/translate', async (req, res) => {
    try {
        if (!config.deeplApiKey) {
            return res.status(500).json({ error: 'deeplApiKey is not configured in config.js.' });
        }

        const text = String(req.body.text || '').trim();
        const sourceLang = String(req.body.sourceLang || '').toLowerCase();
        const targetLang = String(req.body.targetLang || '').toLowerCase();

        if (!text) {
            return res.status(400).json({ error: 'Text is required.' });
        }

        const source = deeplLangMap[sourceLang] || sourceLang.toUpperCase();
        const target = deeplLangMap[targetLang] || targetLang.toUpperCase();

        const body = new URLSearchParams();
        body.set('text', text);
        body.set('source_lang', source);
        body.set('target_lang', target);

        const response = await fetch('https://api-free.deepl.com/v2/translate', {
            method: 'POST',
            headers: {
                Authorization: `DeepL-Auth-Key ${config.deeplApiKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body
        });

        if (!response.ok) {
            const details = await response.text();
            console.error('DeepL error:', details);
            return res.status(500).json({ error: 'DeepL translation failed.' });
        }

        const payload = await response.json();
        const translated = payload?.translations?.[0]?.text || '';
        res.json({ text: translated });
    } catch (error) {
        console.error('Translation error:', error);
        res.status(500).json({ error: 'Translation failed.' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});
