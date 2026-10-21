import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE, readScene, sceneTime, writeScene, type SceneState } from '../demo/scene';

const scene = (over: Partial<SceneState>): SceneState => ({ ...DEFAULT_SCENE, ...over });

describe('readScene', () => {
  it('gives the defaults for an empty or unrelated query', () => {
    expect(readScene('')).toEqual(DEFAULT_SCENE);
    expect(readScene('?debug&foo=1')).toEqual(DEFAULT_SCENE);
    expect(DEFAULT_SCENE).toEqual({ seed: null, time: 'loop', phase: null, cycle: null, view: 'final', glow: true });
  });

  it('reads every param', () => {
    expect(readScene('?debug&seed=42&time=fixed&phase=0.8&view=raw&glow=off')).toEqual(
      scene({ seed: 42, time: 'fixed', phase: 0.8, view: 'raw', glow: false }),
    );
    expect(readScene('?time=loop&cycle=120&phase=0.25')).toEqual(scene({ cycle: 120, phase: 0.25 }));
    expect(readScene('?time=clock')).toEqual(scene({ time: 'clock' }));
  });

  it('drops invalid values instead of throwing', () => {
    for (const q of ['?seed=-1', '?seed=1.5', '?seed=abc', '?seed=', '?seed=4294967296']) {
      expect(readScene(q).seed).toBeNull();
    }
    expect(readScene('?seed=0').seed).toBe(0);
    expect(readScene('?seed=4294967295').seed).toBe(4294967295);
    expect(readScene('?time=slider').time).toBe('loop');
    for (const q of ['?phase=1.5', '?phase=-0.1', '?phase=', '?phase=x']) expect(readScene(q).phase).toBeNull();
    for (const q of ['?cycle=0', '?cycle=86401', '?cycle=']) expect(readScene(q).cycle).toBeNull();
    expect(readScene('?view=wire').view).toBe('final');
    expect(readScene('?glow=1').glow).toBe(true);
    expect(readScene('?glow=0').glow).toBe(false);
  });

  it('treats a clock as having no phase or cycle', () => {
    expect(readScene('?time=clock&phase=0.3&cycle=60')).toEqual(scene({ time: 'clock' }));
  });

  it('reads a fixed time without a phase as phase 0', () => {
    expect(readScene('?time=fixed').phase).toBe(0);
  });
});

describe('writeScene', () => {
  it('writes only what differs from the defaults and keeps other params', () => {
    expect(writeScene('?debug', DEFAULT_SCENE)).toBe('?debug');
    expect(writeScene('', DEFAULT_SCENE)).toBe('');
    expect(writeScene('?debug&x=1', scene({ seed: 7, view: 'raw', glow: false }))).toBe(
      '?debug&x=1&seed=7&view=raw&glow=off',
    );
  });

  it('replaces earlier values of its own params', () => {
    expect(writeScene('?seed=1&debug&time=fixed&phase=0.1', scene({ seed: 2 }))).toBe('?debug&seed=2');
  });

  it('writes the time by mode', () => {
    expect(writeScene('?debug', scene({ time: 'fixed', phase: 0.8 }))).toBe('?debug&time=fixed&phase=0.8');
    expect(writeScene('?debug', scene({ cycle: 60, phase: 0.5 }))).toBe('?debug&phase=0.5&cycle=60');
    expect(writeScene('?debug', scene({ time: 'clock', phase: 0.5, cycle: 60 }))).toBe('?debug&time=clock');
    // Long fractions are rounded, so the URL stays readable.
    expect(writeScene('', scene({ time: 'fixed', phase: 1 / 3 }))).toBe('?time=fixed&phase=0.3333');
  });

  it('round-trips through readScene', () => {
    const states = [
      DEFAULT_SCENE,
      scene({ seed: 0 }),
      scene({ seed: 4294967295, time: 'fixed', phase: 0.75, view: 'raw' }),
      scene({ time: 'loop', phase: 0.125, cycle: 3600, glow: false }),
      scene({ time: 'clock' }),
    ];
    for (const s of states) expect(readScene(writeScene('?debug', s))).toEqual(s);
  });
});

describe('sceneTime', () => {
  it('maps to the library time option', () => {
    expect(sceneTime(DEFAULT_SCENE)).toEqual({ mode: 'loop', cycle: undefined, phase: undefined });
    expect(sceneTime(scene({ cycle: 60, phase: 0.2 }))).toEqual({ mode: 'loop', cycle: 60, phase: 0.2 });
    expect(sceneTime(scene({ time: 'fixed', phase: 0.8 }))).toEqual({ mode: 'fixed', phase: 0.8 });
    expect(sceneTime(scene({ time: 'clock' }))).toEqual({ mode: 'clock' });
  });
});
