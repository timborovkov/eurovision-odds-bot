'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SoundSeverity = 'normal' | 'big';

const STORAGE_KEY = 'evbot.soundOn';

export function useSoundController() {
  const [enabled, setEnabled] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === '1') setEnabled(true);
    } catch {
      // ignore
    }
  }, []);

  const persist = (next: boolean): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
  };

  const ensureContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctxRef.current = new Ctor();
    }
    if (ctxRef.current.state === 'suspended') {
      void ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      persist(next);
      if (next) ensureContext();
      return next;
    });
  }, [ensureContext]);

  const play = useCallback(
    (severity: SoundSeverity) => {
      if (!enabled) return;
      const ctx = ensureContext();
      if (!ctx) return;
      playBeep(ctx, severity);
    },
    [enabled, ensureContext],
  );

  return { enabled, toggle, play };
}

function playBeep(ctx: AudioContext, severity: SoundSeverity): void {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, now);

  const targetPeak = severity === 'big' ? 0.35 : 0.18;
  gain.gain.exponentialRampToValueAtTime(targetPeak, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (severity === 'big' ? 0.6 : 0.25));

  const tones = severity === 'big' ? [880, 1320, 880] : [660, 990];
  const step = severity === 'big' ? 0.12 : 0.1;
  tones.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(now + i * step);
    osc.stop(now + i * step + step * 0.9);
  });
}
