import './styles.css';
import { extractTextFromFile } from './upload.js';
import { RSVPReader } from './reader.js';

const fileInput = document.getElementById('fileInput');
const fileStatus = document.getElementById('fileStatus');
const loadDemoBtn = document.getElementById('loadDemoBtn');

const speedRange = document.getElementById('speedRange');
const speedValue = document.getElementById('speedValue');
const wordPositionRange = document.getElementById('wordPositionRange');
const wordPositionValue = document.getElementById('wordPositionValue');

const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const restartBtn = document.getElementById('restartBtn');

const reader = new RSVPReader({
  wordEl: document.getElementById('rsvpWord'),
  wordIndexEl: document.getElementById('wordIndex'),
  wordTotalEl: document.getElementById('wordTotal'),
  readerStateEl: document.getElementById('readerState')
});

const demoText = `RapidRead helps you move through text one word at a time. This RSVP style can reduce eye movement and help you focus on comprehension. Adjust speed, pause when needed, and restart anytime.`;

reader.loadText('');

function setStatus(message, isError = false) {
  fileStatus.textContent = message;
  fileStatus.classList.toggle('error', isError);
}

async function loadFile(file) {
  try {
    setStatus(`Loading ${file.name}...`);
    const text = await extractTextFromFile(file);

    if (!text.trim()) {
      throw new Error('This document appears to be empty.');
    }

    reader.loadText(text);
    setStatus(`Loaded ${file.name} successfully.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse file.';
    setStatus(message, true);
  }
}

fileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  if (file) {
    await loadFile(file);
  }
});

loadDemoBtn.addEventListener('click', () => {
  reader.loadText(demoText);
  setStatus('Loaded demo text.');
});

speedRange.addEventListener('input', (event) => {
  const value = Number(event.target.value);
  speedValue.textContent = String(value);
  reader.setSpeed(value);
});

wordPositionRange.addEventListener('input', (event) => {
  const value = Number(event.target.value);
  wordPositionValue.textContent = `${value}%`;
  reader.setFocusPercent(value);
});

playBtn.addEventListener('click', () => reader.play());
pauseBtn.addEventListener('click', () => reader.pause());
resumeBtn.addEventListener('click', () => reader.resume());
restartBtn.addEventListener('click', () => reader.restart());

reader.setSpeed(Number(speedRange.value));
reader.setFocusPercent(Number(wordPositionRange.value));
