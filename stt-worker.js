/* hechecik — Sesi Yazıya Dök (Whisper) arka plan işçisi
   transformers.js + Whisper, tamamen tarayıcıda (WASM).
   Çok iş parçacıklı WASM için SharedArrayBuffer gerekir; GitHub Pages COOP/COEP
   başlığı göndermediği için SAB yoktur. Bu yüzden:
     - thread sayısı donanıma göre ayarlanır (SAB varsa çekirdek sayısı)
     - ses ÇÖZME ve yeniden örnekleme bu işçide yapılır (ana sayfa donmaz)
     - her pencere arasında ana iş parçacığına nefes aldıracak şekilde bekleme yok;
       ilerleme pencereler arasında raporlanır, böylece arayüz donuk görünmez.
   Model ilk kullanımda Hugging Face'ten iner, tarayıcı önbelleğinde saklanır. */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

env.allowLocalModels = false;   // modeli her zaman HF'den (veya önbellekten) al
env.useBrowserCache = true;     // indirilen model Cache Storage'da kalır → 2. kullanımda internet gerekmez

const SR = 16000;               // Whisper 16 kHz mono ister
const MAX_WIN = 30;             // Whisper'ın eğitildiği en uzun pencere (sn)
const MIN_WIN = 20;             // kesim için en erken nokta (sn)
let asr = null, currentModel = '', currentThreads = 0;

/* Donanıma göre iş parçacığı sayısı. SharedArrayBuffer yoksa WASM tek iş
   parçacığında çalışır — o durumda 1 vermek gerekir, aksi halde model
   başlatılamaz. */
function pickThreads() {
  const cores = (navigator && navigator.hardwareConcurrency) || 4;
  let sab = false;
  try { sab = typeof SharedArrayBuffer !== 'undefined'; } catch (e) { sab = false; }
  if (!sab) return 1;
  return Math.max(1, Math.min(8, cores - 1)); // bir çekirdeği arayüz için boş bırak
}

/* ---- Ses çözme: dosya baytlarını 16 kHz mono Float32'ye indir ----
   NOT: Worker içinde AudioContext YOKTUR. Bu yüzden:
     - WAV/PCM dosyaları saf JS ile çözülür (en sık durum, hiç bellek kopyası yok)
     - Diğer formatlar ana sayfaya geri gönderilir (orada decodeAudioData çalışır) */
function monize(ab) {
  const n = ab.length, ch = ab.numberOfChannels;
  if (ch === 1) return ab.getChannelData(0).slice(0, n);
  const out = new Float32Array(n), tmp = [];
  for (let c = 0; c < ch; c++) tmp.push(ab.getChannelData(c));
  const inv = 1 / ch;
  for (let i = 0; i < n; i++) { let v = 0; for (let c = 0; c < ch; c++) v += tmp[c][i]; out[i] = v * inv; }
  return out;
}

/* WAV/PCM'i saf JS ile çöz + doğrusal yeniden örnekleme. 1 saatlik dosyada bile
   ana sayfa hiç yük almaz (iş burada). */
function decodeWav(buf) {
  const dv = new DataView(buf);
  if (dv.byteLength < 44) throw new Error('wav-kisa');
  const tag = dv.getUint32(0, true);
  if (tag !== 0x46464952 && tag !== 0x52494646) throw new Error('wav-degil'); // 'RIFF'
  let pos = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (pos + 8 <= dv.byteLength) {
    const id = dv.getUint32(pos, true), sz = dv.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 0x20746d66) { // 'fmt '
      fmt = { audioFormat: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true),
              sampleRate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === 0x61746164) { dataOff = body; dataLen = sz; break; } // 'data'
    pos = body + sz + (sz & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('wav-baslik');
  if (fmt.audioFormat !== 1 && fmt.audioFormat !== 3) throw new Error('wav-sikistirmali');
  const bits = fmt.bits, nch = fmt.channels || 1, srcRate = fmt.sampleRate || SR;
  if (dataOff + dataLen > dv.byteLength) dataLen = dv.byteLength - dataOff;
  const bytesPer = bits / 8, frames = Math.floor(dataLen / (bytesPer * nch));
  const outLen = Math.max(1, Math.floor(frames * SR / srcRate));
  const out = new Float32Array(outLen);
  const step = srcRate / SR; // > 1 → aşağı örnekleme
  const rd = (off) => {
    if (bits === 16) return dv.getInt16(off, true) / 32768;
    if (bits === 8) return (dv.getUint8(off) - 128) / 128;
    if (bits === 24) { const b0 = dv.getUint8(off), b1 = dv.getUint8(off + 1), b2 = dv.getInt8(off + 2);
      return ((b2 << 16) | (b1 << 8) | b0) / 8388608; }
    return dv.getInt32(off, true) / 2147483648;
  };
  for (let i = 0; i < outLen; i++) {
    const src = i * step, i0 = Math.floor(src), frac = src - i0;
    const i1 = Math.min(frames - 1, i0 + 1);
    let a = 0, b = 0;
    for (let c = 0; c < nch; c++) {
      a += rd(dataOff + (i0 * nch + c) * bytesPer);
      b += rd(dataOff + (i1 * nch + c) * bytesPer);
    }
    out[i] = (a + (b - a) * frac) / nch;
  }
  return out;
}

function decodeInWorker(buf) {
  // 1) WAV ise saf JS (hızlı, bellek dostu)
  try { return Promise.resolve(decodeWav(buf)); } catch (e) {
    if (/wav-degil|wav-baslik/.test(e.message)) { /* WAV değil → ana sayfaya devret */ }
    else if (/wav-sikistirmali|wav-kisa/.test(e.message)) { /* yine ana sayfaya devret */ }
  }
  // 2) Diğer formatlar: ana sayfada decodeAudioData yapılır
  const e = new Error('needs-main-thread');
  e.needsMain = true; e.buffer = buf;
  throw e;
}

/* Sesi pencerelere böl; kesimi MIN_WIN–MAX_WIN arasındaki en sessiz noktaya yap
   (kelime ortasından bölmemek için). */
function windows(a) {
  const out = [], N = a.length, frame = Math.floor(0.02 * SR);
  let s = 0;
  while (s < N) {
    let e = Math.min(N, s + MAX_WIN * SR);
    if (e < N) {
      let best = e, bestE = Infinity;
      for (let p = s + MIN_WIN * SR; p + frame <= e; p += frame) {
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
const post = (m) => self.postMessage(m);
/* NOT: transfer listesi bu Chromium sürümünde güvenilir değil
   ("Failed to convert value to 'object'"). Klonlama kullanılıyor; 1 saatlik ses
   ~230 MB kopya demek ama bu iş worker thread'inde oluyor, arayüz donmuyor. */
self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'decode') {
    // Ana sayfa dosyayı ham bayt olarak gönderir; WAV ise burada çözülür
    try {
      const audio = await decodeInWorker(m.buffer);
      post({ type: 'decoded', id: m.id, audio });
      // NOT: post(m, tr) → self.postMessage(m, tr) ; transfer listesi ikinci argüman
    } catch (err) {
      if (err && err.needsMain) post({ type: 'needmain', id: m.id });
      else post({ type: 'decodefail', id: m.id, message: String((err && err.message) || err) });
    }
    return;
  }
  if (m.type !== 'transcribe') return;
  try {
    const threads = pickThreads();
    if (!asr || currentModel !== m.model) {
      post({ type: 'status', text: 'Model yükleniyor... (' + threads + ' iş parçacığı)' });
      asr = await pipeline('automatic-speech-recognition', m.model, {
        dtype: 'q8', device: 'wasm',
        // Çok iş parçacıklı WASM başlatma: transformers.js bu seçenekleri ONNX Runtime'a geçirir
        session_options: { intra_op_num_threads: threads, inter_op_num_threads: 1, graph_optimization_level: 99 },
        progress_callback: (p) => post({ type: 'load', p })
      });
      currentModel = m.model; currentThreads = threads;
    }
    const audio = m.audio, w = windows(audio);
    post({ type: 'start', n: w.length, duration: audio.length / SR, threads: currentThreads || threads });
    const t0 = Date.now();
    for (let i = 0; i < w.length; i++) {
      const [s, e] = w[i], off = s / SR, len = (e - s) / SR;
      if (rms(audio, s, e) < 0.003) {            // sessiz bölüm: Whisper burada uydurma metin üretebilir → atla
        post({ type: 'segment', i, n: w.length, chunks: [] }); continue;
      }
      // Tekrar döngüsü koruması (Whisper'ın "bir bir bir..." hatası)
      const opts = { return_timestamps: true, task: 'transcribe', no_repeat_ngram_size: 4, repetition_penalty: 1.15, max_new_tokens: 220 };
      if (m.language) opts.language = m.language;
      const r = await asr(audio.subarray(s, e), opts);
      const raw = (r.chunks && r.chunks.length) ? r.chunks : [{ timestamp: [0, len], text: r.text || '' }];
      const chunks = raw.map(c => {
        const t0s = c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0;
        const t1s = c.timestamp && c.timestamp[1] != null ? c.timestamp[1] : len;
        return { start: off + Math.min(t0s, len), end: off + Math.min(Math.max(t1s, t0s), len), text: dedupe((c.text || '').trim()) };
      }).filter(c => c.text);
      // Gerçek hız bilgisi: geçen süre / işlenen ses süresi → arayüz tahmini daha doğru olur
      post({ type: 'segment', i, n: w.length, chunks, elapsed: (Date.now() - t0) / 1000, audioDone: Math.min(e / SR, audio.length / SR) });
    }
    post({ type: 'done', threads: currentThreads || threads });
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }
};
