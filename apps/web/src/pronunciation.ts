const SAMANTHA_KEYWORD = 'samantha';

export type PronunciationPlayResult =
  | { status: 'played_audio' }
  | {
      status: 'played_tts';
      matchedPreference: boolean;
      usedVoice: { voice_uri: string; voice_name: string; lang: string } | null;
    }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

function voiceSort(a: SpeechSynthesisVoice, b: SpeechSynthesisVoice): number {
  return `${a.name} ${a.lang}`.localeCompare(`${b.name} ${b.lang}`);
}

function isEnUsVoice(voice: SpeechSynthesisVoice): boolean {
  const normalizedLang = voice.lang.toLowerCase().replace('_', '-');
  return normalizedLang === 'en-us' || normalizedLang.startsWith('en-us-');
}

function isSamanthaVoice(voice: SpeechSynthesisVoice): boolean {
  if (!isEnUsVoice(voice)) {
    return false;
  }
  const signature = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  return signature.includes(SAMANTHA_KEYWORD);
}

export function canUseSpeechSynthesis(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  );
}

function getSamanthaVoices(): SpeechSynthesisVoice[] {
  if (!canUseSpeechSynthesis()) {
    return [];
  }
  return window.speechSynthesis.getVoices().filter(isSamanthaVoice).sort(voiceSort);
}

function pickVoice(voices: SpeechSynthesisVoice[]): {
  voice: SpeechSynthesisVoice | null;
  matchedPreference: boolean;
} {
  if (!voices.length) {
    return { voice: null, matchedPreference: false };
  }

  const fallback = voices.find((voice) => voice.default) || voices[0];

  return { voice: fallback ?? null, matchedPreference: true };
}

export async function playPronunciation(params: {
  text: string;
  audioUrl?: string | null;
}): Promise<PronunciationPlayResult> {
  const { text, audioUrl } = params;

  if (audioUrl) {
    try {
      const audio = new Audio(audioUrl);
      await audio.play();
      return { status: 'played_audio' };
    } catch {
      return { status: 'error', message: 'Unable to play audio recording.' };
    }
  }

  if (!canUseSpeechSynthesis()) {
    return { status: 'unsupported' };
  }

  const speechSynthesisApi = window.speechSynthesis;
  const voicePool = getSamanthaVoices();
  if (!voicePool.length) {
    return { status: 'unsupported' };
  }
  const { voice, matchedPreference } = pickVoice(voicePool);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang ?? 'en-US';
  if (voice) {
    utterance.voice = voice;
  }

  speechSynthesisApi.cancel();
  speechSynthesisApi.speak(utterance);

  return {
    status: 'played_tts',
    matchedPreference,
    usedVoice: voice
      ? {
          voice_uri: voice.voiceURI,
          voice_name: voice.name,
          lang: voice.lang,
        }
      : null,
  };
}
