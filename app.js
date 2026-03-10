const els = {
  girdiPaneli: document.getElementById('girdiPaneli'),
  dropZone: document.getElementById('dropZone'),
  dosyaSecBtn: document.getElementById('dosyaSecBtn'),
  dosyaInput: document.getElementById('dosyaInput'),
  metinAlani: document.getElementById('metinAlani'),
  metniBaslatBtn: document.getElementById('metniBaslatBtn'),
  demoBtn: document.getElementById('demoBtn'),
  dosyaBilgisi: document.getElementById('dosyaBilgisi'),
  durumMesaji: document.getElementById('durumMesaji'),
  hizSlider: document.getElementById('hizSlider'),
  hizDegeri: document.getElementById('hizDegeri'),
  oynatBtn: document.getElementById('oynatBtn'),
  duraklatBtn: document.getElementById('duraklatBtn'),
  devamBtn: document.getElementById('devamBtn'),
  yenidenBaslatBtn: document.getElementById('yenidenBaslatBtn'),
  durumDegeri: document.getElementById('durumDegeri'),
  ilerlemeDegeri: document.getElementById('ilerlemeDegeri'),
  kelimeDegeri: document.getElementById('kelimeDegeri'),
  okuyucu: document.getElementById('okuyucu')
};

const demoMetin = `Hızlı okuma çalışmaları, dikkat yönetimi ve tekrar ile gelişir. RSVP tekniğinde kelimeler merkezi bir noktada gösterilir. Böylece göz sıçramaları azalır, odak artar ve metin akışı daha kontrollü hale gelir.`;

const state = {
  words: [],
  index: 0,
  timer: null,
  status: 'Bekliyor',
  sourceName: 'Yok',
  pdfjs: null
};

function setStatusText(message, kind = '') {
  els.durumMesaji.textContent = message;
  els.durumMesaji.className = 'status';
  if (kind) els.durumMesaji.classList.add(kind);
}

function setReaderState(text) {
  state.status = text;
  els.durumDegeri.textContent = text;
}

function normalizeText(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\t+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tokenize(text) {
  const cleaned = normalizeText(text).replace(/\n/g, ' ');
  return cleaned.split(/\s+/).map((x) => x.trim()).filter(Boolean);
}

function focusLetterHTML(word) {
  if (!word) return '—';
  const i = Math.max(0, Math.floor((word.length - 1) / 2));
  return `${word.slice(0, i)}<span class="focus-letter">${word[i]}</span>${word.slice(i + 1)}`;
}

function updateProgress() {
  const total = state.words.length;
  const current = total ? Math.min(state.index + 1, total) : 0;
  const percentage = total ? Math.round((current / total) * 100) : 0;
  els.ilerlemeDegeri.textContent = `${percentage}%`;
  els.kelimeDegeri.textContent = `${current} / ${total}`;
}

function renderCurrentWord() {
  if (!state.words.length) {
    els.okuyucu.textContent = 'Başlamak için metin yükleyin veya yapıştırın';
    return;
  }
  els.okuyucu.innerHTML = focusLetterHTML(state.words[state.index] || '');
}

function stopTimer() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function getMsPerWord() {
  return Math.round(60000 / Number(els.hizSlider.value));
}

function nextWord() {
  if (state.index < state.words.length - 1) {
    state.index += 1;
    renderCurrentWord();
    updateProgress();
    state.timer = setTimeout(nextWord, getMsPerWord());
    return;
  }

  stopTimer();
  setReaderState('Tamamlandı');
}

function startPlayback(fromBeginning = true) {
  if (!state.words.length) {
    setStatusText('Önce geçerli bir metin yükleyin veya yapıştırın.', 'error');
    return;
  }

  stopTimer();
  if (fromBeginning) state.index = 0;

  renderCurrentWord();
  updateProgress();
  setReaderState('Oynatılıyor');
  els.girdiPaneli.classList.add('hidden');
  state.timer = setTimeout(nextWord, getMsPerWord());
}

function pausePlayback() {
  if (state.status !== 'Oynatılıyor') {
    setStatusText('Duraklatmak için önce oynatmayı başlatın.', 'error');
    return;
  }
  stopTimer();
  setReaderState('Duraklatıldı');
}

function resumePlayback() {
  if (state.status !== 'Duraklatıldı') {
    setStatusText('Devam etmek için önce duraklatılmış bir okuma olmalı.', 'error');
    return;
  }

  setReaderState('Oynatılıyor');
  stopTimer();
  state.timer = setTimeout(nextWord, getMsPerWord());
}

function resetPlayback() {
  stopTimer();
  state.index = 0;
  renderCurrentWord();
  updateProgress();
  setReaderState(state.words.length ? 'Hazır' : 'Bekliyor');
  els.girdiPaneli.classList.remove('hidden');
}

function setLoadedText(text, sourceName) {
  const cleaned = normalizeText(text);
  if (!cleaned) {
    throw new Error('Metin boş görünüyor. Lütfen farklı bir içerik deneyin.');
  }

  const words = tokenize(cleaned);
  if (!words.length) {
    throw new Error('Metin kelimelere ayrılamadı.');
  }

  state.words = words;
  state.index = 0;
  state.sourceName = sourceName;
  els.dosyaBilgisi.textContent = `Yüklenen dosya: ${sourceName}`;
  els.metinAlani.value = cleaned;
  renderCurrentWord();
  updateProgress();
  setReaderState('Hazır');
  setStatusText(`Metin başarıyla yüklendi. ${words.length} kelime hazır.`, 'success');
}

async function readTxt(file) {
  return file.text();
}

async function loadPdfJs() {
  if (!state.pdfjs) {
    state.pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/+esm');
    state.pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';
  }
  return state.pdfjs;
}

async function readPdf(file) {
  try {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pageTexts = [];

    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const line = content.items.map((item) => (typeof item.str === 'string' ? item.str : '')).join(' ');
      if (line.trim()) pageTexts.push(line);
    }

    return pageTexts.join('\n');
  } catch {
    throw new Error('PDF okunamadı. Dosyanın bozuk olmadığından emin olun.');
  }
}

async function readDocx(file) {
  if (!window.mammoth) {
    throw new Error('DOCX çözücü yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.');
  }

  try {
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value || '';
  } catch {
    throw new Error('DOCX okunamadı. Dosyanın geçerli olduğundan emin olun.');
  }
}

async function handleFile(file) {
  if (!file) return;

  const extension = (file.name.split('.').pop() || '').toLowerCase();
  if (!['txt', 'pdf', 'docx'].includes(extension)) {
    throw new Error('Desteklenmeyen dosya türü. Lütfen TXT, PDF veya DOCX yükleyin.');
  }

  setStatusText(`${file.name} işleniyor...`);

  let text = '';
  if (extension === 'txt') text = await readTxt(file);
  if (extension === 'pdf') text = await readPdf(file);
  if (extension === 'docx') text = await readDocx(file);

  setLoadedText(text, file.name);
}

function handleTextStart() {
  try {
    setLoadedText(els.metinAlani.value, 'Yapıştırılan Metin');
    startPlayback(true);
  } catch (error) {
    setStatusText(error.message || 'Metin başlatılamadı.', 'error');
  }
}

els.hizSlider.addEventListener('input', () => {
  els.hizDegeri.textContent = els.hizSlider.value;

  if (state.status === 'Oynatılıyor') {
    stopTimer();
    state.timer = setTimeout(nextWord, getMsPerWord());
  }
});

els.dosyaSecBtn.addEventListener('click', () => els.dosyaInput.click());
els.dosyaInput.addEventListener('change', async (event) => {
  try {
    await handleFile(event.target.files?.[0]);
  } catch (error) {
    setStatusText(error.message || 'Dosya yüklenemedi.', 'error');
  }
});

['dragenter', 'dragover'].forEach((name) => {
  els.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropZone.classList.add('active');
  });
});

['dragleave', 'drop'].forEach((name) => {
  els.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('active');
  });
});

els.dropZone.addEventListener('drop', async (event) => {
  try {
    await handleFile(event.dataTransfer?.files?.[0]);
  } catch (error) {
    setStatusText(error.message || 'Sürüklenen dosya okunamadı.', 'error');
  }
});

els.metniBaslatBtn.addEventListener('click', handleTextStart);
els.demoBtn.addEventListener('click', () => {
  try {
    setLoadedText(demoMetin, 'Demo Metni');
    startPlayback(true);
  } catch (error) {
    setStatusText(error.message || 'Demo metni yüklenemedi.', 'error');
  }
});

els.oynatBtn.addEventListener('click', () => startPlayback(true));
els.duraklatBtn.addEventListener('click', pausePlayback);
els.devamBtn.addEventListener('click', resumePlayback);
els.yenidenBaslatBtn.addEventListener('click', resetPlayback);

renderCurrentWord();
updateProgress();
