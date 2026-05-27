import type { SoundType } from "../store/useStore";

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** Bell chime — C major triad arpeggio */
function playChime(volume: number): void {
  const ac = ctx();
  const notes = [
    { freq: 523.25, delay: 0.0 },
    { freq: 659.25, delay: 0.08 },
    { freq: 783.99, delay: 0.16 },
  ];

  notes.forEach(({ freq, delay }) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const osc2 = ac.createOscillator();
    const gain2 = ac.createGain();

    osc.connect(gain);
    osc2.connect(gain2);
    gain.connect(ac.destination);
    gain2.connect(ac.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ac.currentTime + delay);
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(freq * 2.756, ac.currentTime + delay);

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
}

/** Classic bell — single rich tone */
function playBell(volume: number): void {
  const ac = ctx();
  const freqs = [440, 880, 1320, 1760];
  const gains = [1, 0.5, 0.25, 0.12];
  const t = ac.currentTime;

  freqs.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume * gains[i], t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.0 - i * 0.4);

    osc.start(t);
    osc.stop(t + 3.0);
  });
}

/** Deep gong — low frequency with slow fade */
function playGong(volume: number): void {
  const ac = ctx();
  const t = ac.currentTime;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const osc2 = ac.createOscillator();
  const gain2 = ac.createGain();

  osc.connect(gain);
  gain.connect(ac.destination);
  osc2.connect(gain2);
  gain2.connect(ac.destination);

  osc.type = "sine";
  osc.frequency.setValueAtTime(110, t);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 4.0);

  osc2.type = "sine";
  osc2.frequency.setValueAtTime(220, t);
  gain2.gain.setValueAtTime(0, t);
  gain2.gain.linearRampToValueAtTime(volume * 0.4, t + 0.02);
  gain2.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);

  osc.start(t);
  osc.stop(t + 4.0);
  osc2.start(t);
  osc2.stop(t + 2.5);
}

/** Digital beep — short electronic beeps */
function playDigital(volume: number): void {
  const ac = ctx();
  const beeps = [
    { freq: 880, start: 0, dur: 0.12 },
    { freq: 880, start: 0.2, dur: 0.12 },
    { freq: 1100, start: 0.4, dur: 0.25 },
  ];

  beeps.forEach(({ freq, start, dur }) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);

    osc.type = "square";
    osc.frequency.setValueAtTime(freq, ac.currentTime + start);
    gain.gain.setValueAtTime(0, ac.currentTime + start);
    gain.gain.linearRampToValueAtTime(volume * 0.5, ac.currentTime + start + 0.005);
    gain.gain.setValueAtTime(volume * 0.5, ac.currentTime + start + dur - 0.01);
    gain.gain.linearRampToValueAtTime(0, ac.currentTime + start + dur);

    osc.start(ac.currentTime + start);
    osc.stop(ac.currentTime + start + dur);
  });
}

/**
 * Play a sound based on the selected sound type.
 */
export function playSound(type: SoundType, volume = 0.45): void {
  if (type === "none") return;
  try {
    switch (type) {
      case "bell":
        playBell(volume);
        break;
      case "chime":
        playChime(volume);
        break;
      case "gong":
        playGong(volume);
        break;
      case "digital":
        playDigital(volume);
        break;
    }
  } catch {
    // AudioContext unavailable — silently skip
  }
}

/**
 * Preview a sound type (for settings).
 */
export function previewSound(type: SoundType, volume = 0.45): void {
  playSound(type, volume);
}
