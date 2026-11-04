/* hechecik — Sesi Yazıya Dök (Whisper) arka plan işçisi
   transformers.js + Whisper, tamamen tarayıcıda (WASM, tek iş parçacığı).
   SharedArrayBuffer GEREKMEZ → GitHub Pages'te çalışır.
   Model ilk kullanımda Hugging Face'ten iner, tarayıcı önbelleğinde saklanır. */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

env.allowLocalModels = false;   // modeli her zaman HF'den (veya önbellekten) al
env.useBrowserCache = true;     // indirilen model Cache Storage'da kalır → 2. kullanımda internet gerekmez

const SR = 16000;               // Whisper 16 kHz mono ister
let asr = null, currentModel = '';

/* Sesi en fazla 28 sn'lik pencerelere böl; kesimi 20–28 sn arasındaki en sessiz noktaya yap
   (kelime ortasından bölmemek için). */
function windows(a) {
  const out = [], N = a.length, frame = Math.floor(0.02 * SR);
  let s = 0;
  while (s < N) {
    let e = Math.min(N, s + 28 * SR);
    if (e < N) {
      let best = e, bestE = Infinity;
      for (let p = s + 20 * SR; p + frame <= e; p += frame) {
        let en = 0; for (let i = p; i < p + frame; i++) en += a[i] * a[i];
        if (en < bestE) { bestE = en; best = p + (frame >> 1); }
      }
      e = best;
    }
    out.push([s, e]); s = e;
  }
  return out;
}
/* Ardışık tekrarları sadeleştir: aynı 1–4 kelimelik öbek 3'ten fazla arka arkaya gelirse tek kez bırak */
function dedupe(t) {
  for (let n = 1; n <= 4; n++) {
    const re = new RegExp('((?:\\S+\\s+){' + (n - 1) + '}\\S+)(?:\\s+\\1){3,}', 'giu');
    t = t.replace(re, '$1 …');
  }
  return t;
}
function rms(a, s, e) { let x = 0; for (let i = s; i < e; i++) x += a[i] * a[i]; return Math.sqrt(x / Math.max(1, e - s)); }

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type !== 'transcribe') return;
  try {
    if (!asr || currentModel !== m.model) {
      self.postMessage({ type: 'status', text: 'Model yükleniyor...' });
      asr = await pipeline('automatic-speech-recognition', m.model, {
        dtype: 'q8', device: 'wasm',
        progress_callback: (p) => self.postMessage({ type: 'load', p })
      });
      currentModel = m.model;
    }
    const audio = m.audio, w = windows(audio);
    self.postMessage({ type: 'start', n: w.length, duration: audio.length / SR });
    for (let i = 0; i < w.length; i++) {
      const [s, e] = w[i], off = s / SR, len = (e - s) / SR;
      if (rms(audio, s, e) < 0.003) {            // sessiz bölüm: Whisper burada uydurma metin üretebilir → atla
        self.postMessage({ type: 'segment', i, n: w.length, chunks: [] }); continue;
      }
      // Tekrar döngüsü koruması (Whisper'ın "bir bir bir..." hatası)
      const opts = { return_timestamps: true, task: 'transcribe', no_repeat_ngram_size: 4, repetition_penalty: 1.15, max_new_tokens: 220 };
      if (m.language) opts.language = m.language;
      const r = await asr(audio.subarray(s, e), opts);
      const raw = (r.chunks && r.chunks.length) ? r.chunks : [{ timestamp: [0, len], text: r.text || '' }];
      const chunks = raw.map(c => {
        const t0 = c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0;
        const t1 = c.timestamp && c.timestamp[1] != null ? c.timestamp[1] : len;
        return { start: off + Math.min(t0, len), end: off + Math.min(Math.max(t1, t0), len), text: dedupe((c.text || '').trim()) };
      }).filter(c => c.text);
      self.postMessage({ type: 'segment', i, n: w.length, chunks });
    }
    self.postMessage({ type: 'done' });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
