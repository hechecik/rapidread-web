const SPLIT_REGEX = /\s+/;

function tokenize(text) {
  return text
    .replace(/[\r\n]+/g, ' ')
    .split(SPLIT_REGEX)
    .map((word) => word.trim())
    .filter(Boolean);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function calculateFocusIndex(word, focusPercent) {
  const safeWord = word || '';
  if (!safeWord.length) return 0;

  const idx = Math.floor((safeWord.length - 1) * (focusPercent / 100));
  return clamp(idx, 0, safeWord.length - 1);
}

function createHighlightedWord(word, focusPercent) {
  if (!word) return '•';

  const focusIndex = calculateFocusIndex(word, focusPercent);
  const start = word.slice(0, focusIndex);
  const focus = word[focusIndex] ?? '';
  const end = word.slice(focusIndex + 1);

  return `${start}<span class="focus-letter">${focus}</span>${end}`;
}

export class RSVPReader {
  constructor(options) {
    this.wordEl = options.wordEl;
    this.wordIndexEl = options.wordIndexEl;
    this.wordTotalEl = options.wordTotalEl;
    this.readerStateEl = options.readerStateEl;

    this.words = [];
    this.currentIndex = 0;
    this.wpm = 300;
    this.focusPercent = 35;
    this.state = 'idle';
    this.timer = null;
  }

  loadText(text) {
    this.stopTimer();
    this.words = tokenize(text);
    this.currentIndex = 0;
    this.setState(this.words.length ? 'ready' : 'idle');
    this.renderCurrentWord();
    this.updateStats();
  }

  setSpeed(wpm) {
    this.wpm = clamp(Number(wpm) || 300, 100, 1000);

    if (this.state === 'playing') {
      this.stopTimer();
      this.scheduleNextTick();
    }
  }

  setFocusPercent(percent) {
    this.focusPercent = clamp(Number(percent) || 35, 20, 60);
    this.renderCurrentWord();
  }

  play() {
    if (!this.words.length) return;

    this.currentIndex = 0;
    this.setState('playing');
    this.renderCurrentWord();
    this.updateStats();
    this.stopTimer();
    this.scheduleNextTick();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.stopTimer();
    this.setState('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.setState('playing');
    this.stopTimer();
    this.scheduleNextTick();
  }

  restart() {
    if (!this.words.length) return;
    this.currentIndex = 0;
    this.setState('ready');
    this.renderCurrentWord();
    this.updateStats();
    this.stopTimer();
  }

  nextWord() {
    if (this.currentIndex < this.words.length - 1) {
      this.currentIndex += 1;
      this.renderCurrentWord();
      this.updateStats();
      this.scheduleNextTick();
      return;
    }

    this.stopTimer();
    this.setState('finished');
  }

  scheduleNextTick() {
    const msPerWord = Math.round(60000 / this.wpm);
    this.timer = setTimeout(() => this.nextWord(), msPerWord);
  }

  stopTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  setState(nextState) {
    this.state = nextState;
    if (this.readerStateEl) {
      this.readerStateEl.textContent = nextState;
    }
  }

  renderCurrentWord() {
    if (!this.wordEl) return;

    if (!this.words.length) {
      this.wordEl.textContent = 'Upload a document to begin';
      return;
    }

    const currentWord = this.words[this.currentIndex] || '';
    this.wordEl.innerHTML = createHighlightedWord(currentWord, this.focusPercent);
  }

  updateStats() {
    if (this.wordIndexEl) {
      this.wordIndexEl.textContent = this.words.length ? String(this.currentIndex + 1) : '0';
    }

    if (this.wordTotalEl) {
      this.wordTotalEl.textContent = String(this.words.length);
    }
  }
}
