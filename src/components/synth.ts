// A small polyphonic synth for trying tunings by ear. Client only.
//
// The tone has a handful of harmonics rather than being a pure sine, so
// intervals beat and just ones audibly lock. Voices are keyed by an id (a MIDI
// key, a table row…) so the same thing can't sound twice. The AudioContext is
// created on the first note, which has to come from a click or key press.

const PARTIALS = 8;
const ATTACK  = 0.012; // s
const RELEASE = 0.35;  // s
const LEVEL   = 0.16;

let ctx: AudioContext | undefined;
let out: GainNode | undefined;
let wave: PeriodicWave | undefined;
const voices = new Map<string, { osc: OscillatorNode; amp: GainNode }>();

function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(comp).connect(ctx.destination);
    const real = new Float32Array(PARTIALS + 1);
    const imag = new Float32Array(PARTIALS + 1);
    for (let k = 1; k <= PARTIALS; k++) imag[k] = 1 / Math.pow(k, 1.6);
    wave = ctx.createPeriodicWave(real, imag);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { ctx, out: out!, wave: wave! };
}

/** Call from a user gesture to let later, gesture-less notes (MIDI) sound. */
export const unlockAudio = () => void audio();

export function noteOn(id: string, hz: number, velocity = 0.8) {
  if (!(hz > 20 && hz < 20_000)) return;
  noteOff(id);
  const { ctx, out, wave } = audio();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.value = hz;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(LEVEL * velocity, t + ATTACK);
  osc.connect(amp).connect(out);
  osc.start(t);
  voices.set(id, { osc, amp });
}

export function noteOff(id: string) {
  const voice = voices.get(id);
  if (!voice || !ctx) return;
  voices.delete(id);
  const t = ctx.currentTime;
  voice.amp.gain.cancelScheduledValues(t);
  voice.amp.gain.setValueAtTime(voice.amp.gain.value, t);
  voice.amp.gain.setTargetAtTime(0, t, RELEASE / 4);
  voice.osc.stop(t + RELEASE * 2);
}

export function allOff() {
  Array.from(voices.keys()).forEach(noteOff);
}
