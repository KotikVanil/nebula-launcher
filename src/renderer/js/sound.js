// Tiny synthesized UI sounds (WebAudio, no files).
let ctx = null;
let enabled = true;
let lastHover = 0;

export function setSoundEnabled(v) { enabled = v; }

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ f = 440, f2, type = 'sine', dur = 0.08, vol = 0.05, delay = 0 }) {
  const a = ac();
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise({ dur = 0.3, vol = 0.05, from = 800, to = 3000 }) {
  const a = ac();
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, a.currentTime); f.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur);
  const g = a.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export function sfx(name) {
  if (!enabled) return;
  try {
    switch (name) {
      case 'hover': { const n = performance.now(); if (n - lastHover < 60) return; lastHover = n; tone({ f: 1800, type: 'sine', dur: 0.03, vol: 0.008 }); break; }
      case 'click': tone({ f: 620, f2: 420, type: 'triangle', dur: 0.06, vol: 0.035 }); break;
      case 'tick': tone({ f: 900, type: 'square', dur: 0.025, vol: 0.012 }); break;
      case 'tab': tone({ f: 520, f2: 760, type: 'sine', dur: 0.07, vol: 0.03 }); break;
      case 'open': tone({ f: 380, f2: 640, type: 'sine', dur: 0.12, vol: 0.03 }); break;
      case 'pop': tone({ f: 700, f2: 1000, type: 'sine', dur: 0.08, vol: 0.03 }); break;
      case 'success': [523, 659, 784].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.16, vol: 0.035, delay: i * 0.07 })); break;
      case 'error': tone({ f: 220, f2: 140, type: 'sawtooth', dur: 0.2, vol: 0.025 }); break;
      case 'launch': noise({ dur: 0.9, vol: 0.06, from: 300, to: 4000 }); [392, 523, 659, 1046].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.25, vol: 0.03, delay: 0.1 + i * 0.08 })); break;
      case 'hiss': noise({ dur: 1.4, vol: 0.12, from: 2500, to: 6000 }); break;
      case 'boom': noise({ dur: 0.8, vol: 0.25, from: 400, to: 60 }); tone({ f: 80, f2: 30, type: 'sine', dur: 0.7, vol: 0.2 }); break;
      case 'levelup': [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ f, type: 'square', dur: 0.12, vol: 0.02, delay: i * 0.06 })); break;
    }
  } catch {}
}
