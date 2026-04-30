import { describe, expect, it } from 'bun:test';
import { pickBestVoice, splitIntoClauses } from './voice.ts';

function v(name: string, lang: string, localService = true): SpeechSynthesisVoice {
  return {
    name,
    lang,
    localService,
    default: false,
    voiceURI: name,
  } as SpeechSynthesisVoice;
}

describe('pickBestVoice', () => {
  it('returns null when no voices are available', () => {
    expect(pickBestVoice({ voices: [] })).toBeNull();
  });

  it('picks Microsoft Aria first on Windows', () => {
    const voices = [
      v('Microsoft Mark - English', 'en-US'),
      v('Microsoft Aria Online (Natural)', 'en-US'),
      v('Microsoft Zira', 'en-US'),
    ];
    const pick = pickBestVoice({ os: 'windows', lang: 'en-US', voices });
    expect(pick?.name).toMatch(/Aria/);
  });

  it('falls back to Zira on older Windows', () => {
    const voices = [v('Microsoft Mark', 'en-US'), v('Microsoft Zira', 'en-US')];
    const pick = pickBestVoice({ os: 'windows', lang: 'en-US', voices });
    expect(pick?.name).toBe('Microsoft Zira');
  });

  it('picks Samantha (Enhanced) first on macOS', () => {
    const voices = [
      v('Samantha', 'en-US'),
      v('Samantha (Enhanced)', 'en-US'),
      v('Daniel (Enhanced)', 'en-GB'),
    ];
    const pick = pickBestVoice({ os: 'mac', lang: 'en-US', voices });
    expect(pick?.name).toBe('Samantha (Enhanced)');
  });

  it('respects locale: picks a German voice when lang=de-DE', () => {
    const voices = [
      v('Microsoft Aria Online (Natural)', 'en-US'),
      v('Microsoft Katja Online (Natural)', 'de-DE'),
    ];
    const pick = pickBestVoice({ os: 'windows', lang: 'de-DE', voices });
    expect(pick?.lang).toBe('de-DE');
  });

  it('prefers local-service voices over network ones at the locale-only fallback', () => {
    const voices = [v('Google US English', 'en-US', false), v('Some Local Voice', 'en-US', true)];
    const pick = pickBestVoice({ os: 'other', lang: 'en-US', voices });
    expect(pick?.name).toBe('Some Local Voice');
  });

  it('returns first non-Google voice when no locale match', () => {
    const voices = [v('Google US English', 'en-US', false), v('LocalGuy', 'fr-FR', true)];
    const pick = pickBestVoice({ os: 'other', voices });
    expect(pick?.name).toBe('LocalGuy');
  });
});

describe('splitIntoClauses', () => {
  it('splits on sentence-ending punctuation', () => {
    expect(splitIntoClauses('Hello. World. Bye.')).toEqual(['Hello.', 'World.', 'Bye.']);
  });

  it('preserves question + exclamation marks', () => {
    expect(splitIntoClauses('Are you okay? I am here!')).toEqual(['Are you okay?', 'I am here!']);
  });

  it('keeps abbreviations together', () => {
    // "Dr." is a 2-letter token then ".", so the split should glue.
    const out = splitIntoClauses('Dr. Smith arrived. He is ready.');
    expect(out.length).toBe(2);
    expect(out[0]).toMatch(/Dr\. Smith arrived\./);
  });

  it('handles single-clause input', () => {
    expect(splitIntoClauses('No punctuation here')).toEqual(['No punctuation here']);
  });

  it('returns the trimmed original on empty/whitespace splits', () => {
    expect(splitIntoClauses('')).toEqual([]);
    expect(splitIntoClauses('   ')).toEqual([]);
  });
});
