let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

/**
 * Synthesizes a pleasant bell chime using the Web Audio API.
 * No external audio files required.
 */
export function playChime(volume = 0.45): void {
  try {
    const ac = ctx();

    // Major triad arpeggio: C5, E5, G5
    const notes = [
      { freq: 523.25, delay: 0.0 },
      { freq: 659.25, delay: 0.08 },
      { freq: 783.99, delay: 0.16 },
    ];

    notes.forEach(({ freq, delay }) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      // Add a slight 2nd harmonic for bell timbre
      const osc2 = ac.createOscillator();
      const gain2 = ac.createGain();

      osc.connect(gain);
      osc2.connect(gain2);
      gain.connect(ac.destination);
      gain2.connect(ac.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ac.currentTime + delay);

      osc2.type = "sine";
      osc2.frequency.setValueAtTime(freq * 2.756, ac.currentTime + delay); // non-integer harmonic = bell-like

      const t = ac.currentTime + delay;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);

      gain2.gain.setValueAtTime(0, t);
      gain2.gain.linearRampToValueAtTime(volume * 0.3, t + 0.005);
      gain2.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);

      osc.start(t);
      osc.stop(t + 2.0);
      osc2.start(t);
      osc2.stop(t + 1.5);
    });
  } catch {
    // AudioContext unavailable — silently skip
  }
}
