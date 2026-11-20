import { useSessionStore } from "./store/session";

type SoundKind =
  | "tap" | "card" | "deal" | "shuffle" | "reveal" | "success" | "bust" | "error"
  | "win" | "loss" | "push" | "blackjack" | "chip" | "split" | "double" | "insurance" | "turn";

let audio: AudioContext | null = null;
let output: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;

function getAudioGraph(): { context: AudioContext; output: GainNode } | null {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return null;
  audio ??= new AudioContextConstructor();
  if (!output) {
    output = audio.createGain();
    output.gain.value = 0.78;
    compressor = audio.createDynamicsCompressor();
    compressor.threshold.value = -26;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;
    output.connect(compressor);
    compressor.connect(audio.destination);
  }
  if (audio.state === "suspended") void audio.resume();
  return { context: audio, output };
}

function playTone(
  context: AudioContext,
  destination: AudioNode,
  from: number,
  to: number,
  duration: number,
  level: number,
  wave: OscillatorType = "sine",
  delay = 0,
): void {
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const lowPass = context.createBiquadFilter();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(Math.max(1, from), start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
  lowPass.type = "lowpass";
  lowPass.frequency.setValueAtTime(2_200, start);
  lowPass.frequency.exponentialRampToValueAtTime(1_200, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), start + Math.min(0.025, duration * 0.28));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(lowPass);
  lowPass.connect(gain);
  gain.connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
  oscillator.addEventListener("ended", () => { oscillator.disconnect(); lowPass.disconnect(); gain.disconnect(); }, { once: true });
}

/** A filtered, short noise envelope adds a soft paper/felt texture to card sounds. */
function playCardNoise(context: AudioContext, destination: AudioNode, duration: number, level: number, highCut: number, lowCut: number, delay = 0): void {
  const start = context.currentTime + delay;
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    const progress = index / frameCount;
    const envelope = Math.min(1, progress * 10) * Math.pow(1 - progress, 2.4);
    channel[index] = (Math.random() * 2 - 1) * envelope;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(highCut, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(100, lowCut), start + duration);
  filter.Q.setValueAtTime(0.35, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, level), start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(start);
  source.stop(start + duration + 0.015);
  source.addEventListener("ended", () => { source.disconnect(); filter.disconnect(); gain.disconnect(); }, { once: true });
}

/** Tiny pitched impacts make chips and cards feel less like notification beeps. */
function playImpact(context: AudioContext, destination: AudioNode, frequency: number, level: number, delay = 0): void {
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * .68), start + .055);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(frequency * 1.3, start);
  filter.Q.setValueAtTime(5, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, level), start + .003);
  gain.gain.exponentialRampToValueAtTime(.0001, start + .075);
  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  oscillator.start(start);
  oscillator.stop(start + .085);
  oscillator.addEventListener("ended", () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); }, { once: true });
}

/**
 * Warm, restrained UI/game sounds. The audio graph uses a compressor so result
 * cues stay consistent in volume. Audio starts/resumes only after user gesture.
 * delaySeconds lets a local table announce each player's result in seat order.
 */
export function playUiSound(kind: SoundKind = "tap", delaySeconds = 0): void {
  const preferences = useSessionStore.getState().preferences;
  if (!preferences.sound || preferences.effectsVolume <= 0) return;
  const graph = getAudioGraph();
  if (!graph) return;
  const { context, output: destination } = graph;
  const volume = Math.min(1, preferences.effectsVolume / 100);
  const tone = (from: number, to: number, duration: number, level: number, wave: OscillatorType = "sine", offset = 0) =>
    playTone(context, destination, from, to, duration, level * volume, wave, delaySeconds + offset);
  const paper = (duration: number, level: number, high: number, low: number, offset = 0) =>
    playCardNoise(context, destination, duration, level * volume, high, low, delaySeconds + offset);

  try {
    switch (kind) {
      case "tap":
        tone(510, 420, 0.07, 0.019, "sine");
        playImpact(context, destination, 1_250, .008 * volume, delaySeconds);
        break;
      case "card":
        paper(0.105, 0.024, 3_100, 720);
        tone(680, 450, 0.075, 0.012, "triangle", 0.006);
        playImpact(context, destination, 760, .008 * volume, delaySeconds + .025);
        break;
      case "deal":
        paper(0.12, 0.032, 2_700, 510);
        tone(370, 270, 0.09, 0.012, "triangle", 0.012);
        playImpact(context, destination, 560, .009 * volume, delaySeconds + .032);
        break;
      case "shuffle":
        paper(0.28, 0.035, 2_100, 280);
        paper(0.31, 0.029, 1_650, 240, 0.16);
        paper(0.16, 0.018, 1_150, 220, 0.37);
        tone(150, 205, 0.4, 0.011, "triangle", 0.02);
        break;
      case "reveal":
        paper(0.09, 0.02, 3_200, 1_000);
        tone(350, 523, 0.15, 0.019, "sine", 0.012);
        tone(523, 784, 0.24, 0.016, "triangle", 0.105);
        break;
      case "chip":
        playImpact(context, destination, 1_780, .023 * volume, delaySeconds);
        playImpact(context, destination, 1_180, .016 * volume, delaySeconds + .042);
        tone(930, 690, 0.08, 0.009, "triangle", 0.006);
        break;
      case "split":
        tone(420, 520, 0.11, 0.018, "triangle");
        tone(520, 420, 0.11, 0.018, "triangle", 0.085);
        break;
      case "double":
        tone(330, 440, 0.1, 0.018, "sine");
        tone(440, 660, 0.16, 0.018, "sine", 0.075);
        break;
      case "insurance":
        tone(520, 465, 0.1, 0.015, "sine");
        tone(465, 520, 0.1, 0.013, "sine", 0.09);
        break;
      case "turn":
        tone(585, 700, 0.14, 0.018, "sine");
        break;
      case "success":
      case "win":
        tone(392, 494, 0.2, 0.025, "sine");
        tone(494, 587, 0.22, 0.022, "sine", 0.11);
        tone(587, 784, 0.28, 0.02, "triangle", 0.23);
        break;
      case "blackjack":
        tone(523, 659, 0.18, 0.022, "sine");
        tone(659, 784, 0.19, 0.02, "sine", 0.09);
        tone(784, 988, 0.22, 0.018, "triangle", 0.18);
        tone(988, 1175, 0.3, 0.014, "sine", 0.29);
        paper(0.16, 0.008, 2_700, 1_400, 0.22);
        break;
      case "push":
        tone(440, 494, 0.13, 0.017, "sine");
        tone(494, 440, 0.15, 0.015, "sine", 0.12);
        break;
      case "loss":
        tone(330, 294, 0.14, 0.019, "sine");
        tone(294, 220, 0.2, 0.016, "sine", 0.1);
        break;
      case "bust":
        tone(310, 245, 0.14, 0.022, "triangle");
        tone(245, 165, 0.24, 0.018, "sine", 0.1);
        paper(0.08, 0.006, 850, 320, 0.02);
        break;
      case "error":
        tone(260, 220, 0.11, 0.016, "sine");
        break;
    }
  } catch {
    // Optional audio must never interfere with a game action.
  }
}
