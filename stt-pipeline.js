const OpenAI = require('openai');

function buildTranscriptionPrompt(language, previousText) {
    const context = previousText
        ? `Previous transcript context (continue naturally, do not repeat):\n${previousText.slice(-600)}\n\n`
        : '';

    return `${context}Transcribe only clear human speech in ${language}.
Rules:
- Output ONLY words that are actually spoken by a human voice.
- Do NOT transcribe instrumental music, jingles, intro melodies, sound effects, or background songs without lyrics.
- Do NOT invent dialogue or phrases from music — this is a common mistake.
- If the clip is mostly music or there is no intelligible speech, return an empty string.
- Keep brand and product names in Latin form (Google, iPhone, YouTube).
- Use minimal punctuation; avoid sentence-ending periods when the phrase may continue.`;
}

async function auditTranscriptWithAudio(openai, config, audioBuffer, mimeType, candidateText, language) {
    const trimmed = (candidateText || '').trim();
    if (!trimmed || config.sttAudioVerify === false) {
        return trimmed;
    }

    try {
        const format = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp3') ? 'mp3' : 'wav';
        const base64 = audioBuffer.toString('base64');

        const response = await openai.responses.create({
            model: config.sttVerifyModel || 'gpt-4o-mini',
            input: [
                {
                    role: 'system',
                    content: [
                        {
                            type: 'input_text',
                            text: 'You are an expert audio auditor for speech-to-text. You listen to short audio clips and remove text that was hallucinated from music, jingles, or non-speech audio. You keep only words clearly spoken by a human. Return plain text only — no quotes, labels, or explanations. If nothing is clearly spoken, return an empty string.'
                        }
                    ]
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'input_audio',
                            input_audio: { data: base64, format }
                        },
                        {
                            type: 'input_text',
                            text: `Language hint: ${language}\n\nCandidate transcript (may contain music hallucinations):\n${trimmed}\n\nReturn only the words actually spoken in the audio.`
                        }
                    ]
                }
            ]
        });

        const verified = (response.output_text || '').trim();
        return verified;
    } catch (error) {
        console.error('Audio verify fallback to candidate text:', error.message);
        return trimmed;
    }
}

async function refineTranscriptText(openai, config, rawText, sourceLang) {
    if (!rawText || !rawText.trim()) {
        return '';
    }

    if (config.sttPostprocess === false) {
        return rawText.trim();
    }

    try {
        const response = await openai.responses.create({
            model: config.sttPostprocessModel || 'gpt-4.1-mini',
            input: [
                {
                    role: 'system',
                    content: [
                        {
                            type: 'input_text',
                            text: 'You are an expert transcript refiner. Normalize transcript to the requested target language while preserving meaning. Remove phrases that are likely speech-to-text hallucinations from background music, podcast intro jingles, or instrumental segments (short unrelated questions or exclamations sandwiched between real narration). Keep proper names and brands in Latin form. Improve punctuation and sentence boundaries. Fix obvious recognition mistakes only when context is clear. Do not add new facts or invent missing content.'
                        }
                    ]
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: `Normalize language to: ${sourceLang || 'auto'}\n\nTranscript:\n${rawText}`
                        }
                    ]
                }
            ]
        });

        const text = (response.output_text || '').trim();
        return text || rawText.trim();
    } catch (error) {
        console.error('Refine fallback to raw transcript:', error);
        return rawText.trim();
    }
}

async function transcribeAudioChunk(openai, config, { buffer, mimeType, filename, language, previousText, speechScore }) {
    const minScore = Number(config.minSpeechScore ?? 0.14);
    if (typeof speechScore === 'number' && speechScore < minScore) {
        return { text: '', skipped: true, reason: 'low_speech_score' };
    }

    const file = await OpenAI.toFile(buffer, filename || 'chunk.wav', {
        type: mimeType || 'audio/wav'
    });

    const transcription = await openai.audio.transcriptions.create({
        file,
        model: config.sttModel || 'gpt-4o-transcribe',
        language,
        temperature: 0,
        prompt: buildTranscriptionPrompt(language, previousText),
        response_format: 'text'
    });

    let text = (transcription || '').trim();
    if (!text) {
        return { text: '', skipped: false };
    }

    text = await auditTranscriptWithAudio(openai, config, buffer, mimeType, text, language);
    return { text, skipped: false };
}

module.exports = {
    buildTranscriptionPrompt,
    auditTranscriptWithAudio,
    refineTranscriptText,
    transcribeAudioChunk
};
