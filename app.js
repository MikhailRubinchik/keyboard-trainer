// ============================================================
// app.js — main game logic
// ============================================================

// ── DOM elements ─────────────────────────────────────────────

const screenList     = document.getElementById('screen-list');
const screenExercise = document.getElementById('screen-exercise');

const fingerHint  = document.getElementById('finger-hint');
const textDisplay = document.getElementById('text-display');
const wordInput   = document.getElementById('word-input');
const liveTimer   = document.getElementById('live-timer');
const handImage   = document.getElementById('hand-image');

const resultOverlay = document.getElementById('result-overlay');
const resultTime    = document.getElementById('result-time');
const resultCpm     = document.getElementById('result-cpm');
const resultChars   = document.getElementById('result-chars');

const btnBack  = document.getElementById('btn-back');
const btnNext  = document.getElementById('btn-next');
const btnStart = document.getElementById('btn-start');
const exerciseLevelLabel = document.getElementById('exercise-level-label');

const FINGER_IMAGE = {
  'Левый мизинец':        '_1.png',
  'Левый безымянный':     '_2.png',
  'Левый средний':        '_3.png',
  'Левый указательный':   '_4.png',
  'Левый большой палец':  '_5.png',
  'Правый большой палец': '_6.png',
  'Правый указательный':  '_7.png',
  'Правый средний':       '_8.png',
  'Правый безымянный':    '_9.png',
  'Правый мизинец':       '__10.png',
};

// ── Levels ───────────────────────────────────────────────────

const LEVEL_COUNT  = 10;
const LS_LEVEL_KEY = 'klavagonki_level';

let currentLevel   = 1;
let lastStartIndex = -1;

function loadLevel() {
  const saved = parseInt(localStorage.getItem(LS_LEVEL_KEY), 10);
  currentLevel = (saved >= 1 && saved <= LEVEL_COUNT) ? saved : 1;
}

function saveLevel(n) {
  currentLevel = n;
  localStorage.setItem(LS_LEVEL_KEY, n);
  updateLevelButtonsActive();
}

/**
 * Renders LEVEL_COUNT numbered buttons inside the element with the given id.
 * onPick(n) is called when a button is clicked.
 */
function renderLevelButtons(containerId, onPick) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (let i = 1; i <= LEVEL_COUNT; i++) {
    const btn = document.createElement('button');
    btn.className = 'level-btn-item';
    btn.textContent = i;
    btn.dataset.level = i;
    btn.addEventListener('click', () => onPick(i));
    container.appendChild(btn);
  }
}

function updateLevelButtonsActive() {
  document.querySelectorAll('.level-btn-item').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.level) === currentLevel);
  });
}

// ── Current run state ────────────────────────────────────────

let chars      = [];
let charStates = [];
let cursor     = 0;
let wordStart  = 0;
let wordSoFar  = '';
let junkBuffer = '';

let lineStartChars = [];  // char index where each line starts
let lineOffsetTops = [];  // offsetTop of first span in each line

let startTime      = null;
let timerInterval  = null;
let elapsedSeconds = 0;

// ── Screens ───────────────────────────────────────────────────

function showScreen(name) {
  screenList.classList.toggle('active', name === 'list');
  screenExercise.classList.toggle('active', name === 'exercise');
}

// ── Start exercise ────────────────────────────────────────────

function startExercise(level) {
  const result = getRandomExercise(level, lastStartIndex);
  lastStartIndex = result.startIndex;

  chars      = [...result.text];
  charStates = new Array(chars.length).fill('pending');
  cursor     = 0;
  wordStart  = 0;
  wordSoFar  = '';
  junkBuffer = '';
  startTime  = null;
  elapsedSeconds = 0;

  exerciseLevelLabel.textContent = `Уровень ${level}`;
  liveTimer.textContent = '0:00';

  renderText();
  updateFingerHint();

  wordInput.value = '';
  wordInput.disabled = false;
  wordInput.classList.remove('input-error');

  resultOverlay.classList.add('hidden');
  showScreen('exercise');
  wordInput.focus();
}

// ── Text rendering ────────────────────────────────────────────

function renderText() {
  // Reset before new exercise
  textDisplay.style.height = '';
  textDisplay.scrollTop = 0;
  lineStartChars = [];
  lineOffsetTops = [];

  textDisplay.innerHTML = '';
  chars.forEach(ch => {
    const span = document.createElement('span');
    span.textContent = ch;
    textDisplay.appendChild(span);
  });
  updateDisplay();

  // Wait for layout, then detect line positions and set height
  requestAnimationFrame(() => {
    detectLines();
    updateScroll();
  });
}

function updateDisplay() {
  const spans = textDisplay.querySelectorAll('span');
  spans.forEach((span, i) => {
    span.className = '';
    if (i === cursor) {
      span.classList.add('char--current');
    } else if (i < cursor) {
      span.classList.add('char--correct');
    } else {
      span.classList.add('char--pending');
    }
  });
  updateScroll();
}

// ── 3-line sliding window ─────────────────────────────────────

function detectLines() {
  const spans = [...textDisplay.querySelectorAll('span')];
  lineStartChars = [];
  lineOffsetTops = [];

  let prevTop = -1;
  spans.forEach((span, i) => {
    const top = span.offsetTop;
    if (top !== prevTop) {
      lineStartChars.push(i);
      lineOffsetTops.push(top);
      prevTop = top;
    }
  });

  if (lineOffsetTops.length >= 2) {
    const lineHeight = lineOffsetTops[1] - lineOffsetTops[0];
    const padding    = lineOffsetTops[0];
    textDisplay.style.height = (2 * padding + 3 * lineHeight) + 'px';
  }
}

function getFirstShownLine() {
  for (let i = 0; i < lineStartChars.length; i++) {
    const lineEnd = (i + 1 < lineStartChars.length)
      ? lineStartChars[i + 1]
      : chars.length;
    if (cursor < lineEnd) return i;
  }
  return Math.max(0, lineStartChars.length - 1);
}

function updateScroll() {
  if (lineOffsetTops.length < 2) return;
  const first = getFirstShownLine();
  textDisplay.scrollTop = lineOffsetTops[first] - lineOffsetTops[0];
}

// ── Finger hint + hand image ──────────────────────────────────

function updateFingerHint() {
  if (cursor >= chars.length) {
    fingerHint.textContent = '';
    handImage.src = '';
    return;
  }

  const ch = chars[cursor];
  let name;

  if (ch === ' ') {
    const prevFinger = cursor > 0 ? getFinger(chars[cursor - 1]) : '';
    if (prevFinger.startsWith('Левый')) {
      name = 'Правый большой палец';
    } else if (prevFinger.startsWith('Правый')) {
      name = 'Левый большой палец';
    } else {
      name = 'Большой палец';
    }
  } else {
    name = getFinger(ch) || '';
  }

  fingerHint.textContent = name;
  handImage.src = FINGER_IMAGE[name] || '';
}

// ── Timer ─────────────────────────────────────────────────────

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    liveTimer.textContent = Stats.formatTime(elapsedSeconds);
  }, 250);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  if (startTime) {
    elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  }
}

// ── Main keydown handler ──────────────────────────────────────
//
// All input goes through keydown + preventDefault so we control
// the input field contents manually and can block cursor advance
// on wrong characters.

wordInput.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'Backspace') {
    e.preventDefault();
    handleBackspace();
    return;
  }

  if (e.key.length !== 1) return;

  e.preventDefault();

  if (!startTime) startTimer();

  handleChar(e.key);
});

// ── Single character handler ──────────────────────────────────
//
// A correct character is only accepted when junkBuffer is empty.
// A wrong character (or any character while junk exists) is appended
// to junkBuffer. The text cursor does not advance until all junk is
// cleared via Backspace.

function handleChar(key) {
  if (junkBuffer.length > 0) {
    junkBuffer += key;
    wordInput.value = wordSoFar + junkBuffer;
    return;
  }

  const expected = chars[cursor];

  if (key !== expected) {
    junkBuffer += key;
    wordInput.value = wordSoFar + junkBuffer;
    wordInput.classList.add('input-error');
    return;
  }

  // Correct character
  charStates[cursor] = 'correct';
  cursor++;

  if (expected === ' ') {
    wordStart = cursor;
    wordSoFar = '';
  } else {
    wordSoFar += expected;
  }

  wordInput.value = wordSoFar;
  wordInput.classList.remove('input-error');
  updateDisplay();
  updateFingerHint();

  if (cursor >= chars.length) {
    finishRun();
  }
}

// ── Backspace handler ─────────────────────────────────────────

function handleBackspace() {
  if (junkBuffer.length > 0) {
    junkBuffer = junkBuffer.slice(0, -1);
    wordInput.value = wordSoFar + junkBuffer;
    if (junkBuffer.length === 0) wordInput.classList.remove('input-error');
    return;
  }

  // No junk — retreat one correct character, but not past word start
  if (cursor <= wordStart) return;

  cursor--;
  charStates[cursor] = 'pending';
  wordSoFar = wordSoFar.slice(0, -1);
  wordInput.value = wordSoFar;
  updateDisplay();
  updateFingerHint();
}

// ── Run completion ────────────────────────────────────────────

async function finishRun() {
  stopTimer();
  wordInput.disabled = true;
  wordInput.value = '';
  updateDisplay();
  fingerHint.textContent = '';

  const totalChars = chars.length;
  const minutes    = elapsedSeconds > 0 ? elapsedSeconds / 60 : 1 / 60;
  const cpm        = Math.round(totalChars / minutes);

  resultTime.textContent  = Stats.formatTime(elapsedSeconds);
  resultCpm.textContent   = `${cpm} зн/мин`;
  resultChars.textContent = totalChars;
  resultOverlay.classList.remove('hidden');

  await Stats.saveRun({
    level:   currentLevel,
    chars:   totalChars,
    seconds: elapsedSeconds,
    cpm,
  });
}

// ── Navigation buttons ────────────────────────────────────────

btnBack.addEventListener('click', () => {
  stopTimer();
  resultOverlay.classList.add('hidden');
  wordInput.disabled = true;
  showScreen('list');
});

function doNext() {
  resultOverlay.classList.add('hidden');
  startExercise(currentLevel);
}

btnNext.addEventListener('click', doNext);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !resultOverlay.classList.contains('hidden')) {
    e.preventDefault();
    doNext();
  }
});

btnStart.addEventListener('click', () => {
  startExercise(currentLevel);
});

// ── Level hint below level buttons on home screen ─────────────

function updateLevelHint() {
  const hint = document.getElementById('level-chars-hint');
  if (hint) hint.textContent = `~${currentLevel * 100} символов`;
}

// ── Initialization ────────────────────────────────────────────

async function init() {
  loadLevel();

  // Level buttons on home screen
  renderLevelButtons('level-buttons-main', (n) => {
    saveLevel(n);
    updateLevelHint();
  });

  updateLevelButtonsActive();
  updateLevelHint();

  showScreen('list');
  await Stats.init();
}

init();
