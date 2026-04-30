import { describe, expect, it } from 'bun:test';
import { __test } from './global-voice.ts';

const { stripWakeWord, parseCommand } = __test;

describe('stripWakeWord', () => {
  it('strips each canonical wake-word', () => {
    expect(stripWakeWord('Mörbius open settings')).toBe('open settings');
    expect(stripWakeWord('morbius open settings')).toBe('open settings');
    expect(stripWakeWord('Doctor go to dashboard')).toBe('go to dashboard');
    expect(stripWakeWord('Dr ABC show me the brain map')).toBe('show me the brain map');
  });
  it('strips trailing punctuation between wake-word and command', () => {
    expect(stripWakeWord('Mörbius, open settings')).toBe('open settings');
    expect(stripWakeWord('Mörbius. open settings')).toBe('open settings');
    expect(stripWakeWord('Mörbius — open settings')).toBe('open settings');
  });
  it('returns null when no wake-word', () => {
    expect(stripWakeWord('open settings')).toBeNull();
    expect(stripWakeWord('hello world')).toBeNull();
    expect(stripWakeWord('')).toBeNull();
  });
});

describe('parseCommand · navigate', () => {
  it('matches every canonical alias', () => {
    expect(parseCommand('open settings')).toEqual({
      kind: 'navigate',
      path: '/app/settings',
      label: 'settings',
    });
    expect(parseCommand('go to dashboard')).toEqual({
      kind: 'navigate',
      path: '/app',
      label: 'dashboard',
    });
    expect(parseCommand('show me the brain map')).toEqual({
      kind: 'navigate',
      path: '/app/brain',
      label: 'brain map',
    });
    expect(parseCommand('take me to consultation')).toEqual({
      kind: 'navigate',
      path: '/app/consult',
      label: 'consultation',
    });
  });
  it('strips trailing punctuation', () => {
    expect(parseCommand('open settings.')).toMatchObject({
      kind: 'navigate',
      path: '/app/settings',
    });
    expect(parseCommand('open settings!')).toMatchObject({
      kind: 'navigate',
      path: '/app/settings',
    });
  });
  it('falls back to longest matching alias for fuzzy phrasing', () => {
    expect(parseCommand('open the api keys panel')).toMatchObject({
      kind: 'navigate',
      path: '/app/api-keys',
    });
  });
});

describe('parseCommand · control', () => {
  it('matches stop / pause / cancel', () => {
    expect(parseCommand('stop')).toEqual({ kind: 'control', action: 'stop' });
    expect(parseCommand('pause')).toEqual({ kind: 'control', action: 'pause' });
    expect(parseCommand('cancel')).toEqual({ kind: 'control', action: 'cancel' });
    expect(parseCommand('shut up')).toEqual({ kind: 'control', action: 'stop' });
    expect(parseCommand('quiet')).toEqual({ kind: 'control', action: 'stop' });
  });
});

describe('parseCommand · clear', () => {
  it('matches clear chat / new consult', () => {
    expect(parseCommand('clear chat')).toEqual({ kind: 'clear' });
    expect(parseCommand('new consult')).toEqual({ kind: 'clear' });
    expect(parseCommand('reset chat')).toEqual({ kind: 'clear' });
    expect(parseCommand('start over')).toEqual({ kind: 'clear' });
  });
});

describe('parseCommand · dictate', () => {
  it('extracts the question after ask / tell me about', () => {
    expect(parseCommand('ask what is migraine')).toEqual({
      kind: 'dictate',
      text: 'what is migraine',
    });
    expect(parseCommand('tell me about diabetes')).toEqual({
      kind: 'dictate',
      text: 'diabetes',
    });
    expect(parseCommand("what's a stroke")).toEqual({ kind: 'dictate', text: 'a stroke' });
  });
});

describe('parseCommand · continuity', () => {
  it('matches resume variants', () => {
    expect(parseCommand('resume')).toEqual({ kind: 'resume' });
    expect(parseCommand('continue')).toEqual({ kind: 'resume' });
    expect(parseCommand('resume last')).toEqual({ kind: 'resume' });
    expect(parseCommand('resume consult')).toEqual({ kind: 'resume' });
    expect(parseCommand('where did i leave off')).toEqual({ kind: 'resume' });
  });
  it('matches recents variants', () => {
    expect(parseCommand('show recents')).toEqual({ kind: 'recents' });
    expect(parseCommand('open recents')).toEqual({ kind: 'recents' });
    expect(parseCommand('recent consults')).toEqual({ kind: 'recents' });
    expect(parseCommand('history')).toEqual({ kind: 'recents' });
  });
});

describe('parseCommand · neural-core route', () => {
  it('navigates to /app/neural-core via "neural core" / "neural map" alias', () => {
    expect(parseCommand('open neural core')).toMatchObject({
      kind: 'navigate',
      path: '/app/neural-core',
    });
    expect(parseCommand('show me the neural map')).toMatchObject({
      kind: 'navigate',
      path: '/app/neural-core',
    });
  });
});

describe('parseCommand · null', () => {
  it('returns null for empty or unrecognised commands', () => {
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('blah blah')).toBeNull();
    expect(parseCommand('open something we do not have')).toBeNull();
  });
});

describe('end-to-end pipeline', () => {
  it('full sentence → command', () => {
    const rest = stripWakeWord('Mörbius, open the brain map please');
    expect(rest).toBe('open the brain map please');
    expect(rest).not.toBeNull();
    expect(parseCommand(rest ?? '')).toMatchObject({ kind: 'navigate', path: '/app/brain' });
  });
});
