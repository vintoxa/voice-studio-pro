module.exports = {
    port: 3000,
    openaiApiKey: 'YOUR_OPENAI_API_KEY',
    deeplApiKey: 'YOUR_DEEPL_API_KEY',
    sttModel: 'gpt-4o-transcribe',
    sttPostprocess: true,
    sttPostprocessModel: 'gpt-4.1-mini',
    sttAudioVerify: true,
    sttVerifyModel: 'gpt-4o-mini',
    minSpeechScore: 0.14,
    ttsModel: 'tts-1',
    ttsVoice: 'alloy'
};
