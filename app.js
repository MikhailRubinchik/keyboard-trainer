// ============================================================
// app.js — main game logic
// ============================================================

// ── DOM elements ─────────────────────────────────────────────

const screenList     = document.getElementById('screen-list');
const screenExercise = document.getElementById('screen-exercise');

const fingerHint  = document.getElementById('finger-hint');
const textDisplay = document.getElementById('text-display');
const wordInput   = document.getElementById('word-input');
const liveTimer    = document.getElementById('live-timer');
const liveProgress = document.getElementById('live-progress');
const liveCpm      = document.getElementById('live-cpm');
const handImage   = document.getElementById('hand-image');

const resultOverlay  = document.getElementById('result-overlay');
const resultTime     = document.getElementById('result-time');
const resultCpm      = document.getElementById('result-cpm');
const resultChars    = document.getElementById('result-chars');
const resultErrors   = document.getElementById('result-errors');

const btnBack  = document.getElementById('btn-back');
const btnNext  = document.getElementById('btn-next');
const btnStart = document.getElementById('btn-start');
const exerciseLevelLabel = document.getElementById('exercise-level-label');
const wordDisplay = document.getElementById('word-display');

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

const LEVEL_COUNT      = 34;
const LS_LEVEL_KEY     = 'klavagonki_level';
const LS_SHOW_FINGER   = 'klavagonki_show_finger';
const LS_TEXT_SET      = 'klavagonki_text_set';

let showFinger = localStorage.getItem(LS_SHOW_FINGER) !== 'false';

// Initialise active text set from localStorage
(function () {
  const saved = localStorage.getItem(LS_TEXT_SET) || 'neznaika';
  setTextSet(saved);
  const sel = document.getElementById('text-set-select');
  if (sel) {
    sel.value = saved;
    sel.addEventListener('change', () => {
      setTextSet(sel.value);
      localStorage.setItem(LS_TEXT_SET, sel.value);
    });
  }
})();

function applyFingerSetting() {
  const visible = showFinger;
  fingerHint.style.display = visible ? '' : 'none';
  document.querySelector('.hand-image-row').style.display = visible ? '' : 'none';
}

function initFingerSetting() {
  const cb = document.getElementById('setting-show-finger');
  if (!cb) return;
  cb.checked = showFinger;
  cb.addEventListener('change', () => {
    showFinger = cb.checked;
    localStorage.setItem(LS_SHOW_FINGER, showFinger);
    applyFingerSetting();
  });
}

// Character count for each level (1-indexed)
const LEVEL_SIZES = [50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000, 3000];

// Min avg cpm required to move TO level n (index 0 = threshold for level 2)
// Formula: (LEVEL_SIZES[n-1] + LEVEL_SIZES[n]) / 2 / 20 — median of adjacent sizes takes ~20 min
const LEVEL_THRESHOLDS = [4, 6, 9, 11, 14, 18, 23, 28, 33, 38, 43, 48, 53, 58, 63, 68, 73, 78, 83, 88, 93, 98, 103, 108, 113, 118, 123, 128, 133, 138, 143, 148, 150];

let currentLevel   = 1;
let lastStartIndex = -1;
let levelUnlocked  = false;  // level buttons locked by default

function getRecommendedLevel(avgCpm) {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (avgCpm >= LEVEL_THRESHOLDS[i]) return i + 2;
  }
  return 1;
}

function loadLevel() {
  const saved = parseInt(localStorage.getItem(LS_LEVEL_KEY), 10);
  currentLevel = (saved >= 1 && saved <= LEVEL_COUNT) ? saved : 16;
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
    btn.addEventListener('click', () => {
      if (!levelUnlocked) return;
      onPick(i);
    });
    container.appendChild(btn);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyL' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
    if (screenList.classList.contains('active')) {
      toggleLevelLock();
    }
  }
  if (e.code === 'KeyF' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
    if (screenList.classList.contains('active')) {
      document.querySelector('.settings-row--main').classList.toggle('visible');
    }
  }
});

function updateLevelButtonsActive() {
  document.querySelectorAll('.level-btn-item').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.level) === currentLevel);
    btn.classList.toggle('locked', !levelUnlocked);
  });
}

function updateLockHint() {
  const hint = document.getElementById('level-lock-hint');
  if (!hint) return;
  hint.textContent = levelUnlocked
    ? 'Ручной режим — Shift+L для блокировки'
    : 'Уровень определён автоматически — Shift+L для изменения';
}

function toggleLevelLock() {
  levelUnlocked = !levelUnlocked;
  updateLevelButtonsActive();
  updateLockHint();
}

// ── Current run state ────────────────────────────────────────

let chars      = [];
let charStates = [];
let cursor     = 0;
let lastCheckpointCursor = 0;
let wordStart  = 0;
let wordSoFar  = '';
let junkBuffer = '';
let noFinger   = false;  // true when finger hint was disabled for this run

let lineStartChars = [];  // char index where each line starts
let lineOffsetTops = [];  // offsetTop of first span in each line

let startTime      = null;
let runStartDate   = '';   // записывается при первом нажатии клавиши
let runStartTime   = '';
let timerInterval  = null;
let elapsedSeconds = 0;
let errorCount     = 0;
let idleTimer      = null;

let samePosMistakes = 0;  // consecutive "first errors" at the same cursor position
let lastMistakePos  = -1;

let runErrors = {};  // cursorPos → { expected, attempts[] }
let lastKeyTime    = null;  // timestamp of last character keydown
let runIntervalMap = {};    // tenths-of-second → count

let lastCorrectTime = null;  // timestamp of last correct keypress
let lastCorrectChar = null;  // char typed at lastCorrectTime
let runBigramRaw    = {};    // bigram → [deltaMs, ...]

let keystrokeLog     = [];   // [[key, deltaMs], ...] full keystroke sequence
let lastKeystrokeTime = null;

let runIdleMs        = 0;     // accumulated idle time (gaps > 5s) in ms
let isAbortedRun     = false; // true when auto-stopped due to idle
let idleAbandonTimer = null;  // fires abandonRun() if no key pressed long enough

// ── Screens ───────────────────────────────────────────────────

function showScreen(name) {
  screenList.classList.toggle('active', name === 'list');
  screenExercise.classList.toggle('active', name === 'exercise');
}

// ── Start exercise ────────────────────────────────────────────

function restoreFingerSetting() {
  showFinger = localStorage.getItem(LS_SHOW_FINGER) !== 'false';
  const cb = document.getElementById('setting-show-finger');
  if (cb) { cb.disabled = false; cb.checked = showFinger; }
}

function startExercise(level) {
  noFinger = Stats.getTodayRunCount() % 2 === 0;
  const cb = document.getElementById('setting-show-finger');
  if (noFinger) {
    showFinger = false;
    if (cb) { cb.checked = false; cb.disabled = true; }
  } else {
    showFinger = localStorage.getItem(LS_SHOW_FINGER) !== 'false';
    if (cb) { cb.disabled = false; cb.checked = showFinger; }
  }
  applyFingerSetting();
  const result = getRandomExercise(LEVEL_SIZES[level - 1], lastStartIndex);
  lastStartIndex = result.startIndex;

  chars      = [...result.text.replace(/[«»]/g, '"')];
  charStates = new Array(chars.length).fill('pending');
  cursor     = 0;
  wordStart  = 0;
  wordSoFar  = '';
  junkBuffer = '';
  startTime  = null;
  elapsedSeconds = 0;
  errorCount      = 0;
  samePosMistakes = 0;
  lastMistakePos  = -1;
  runErrors       = {};
  lastKeyTime     = null;
  runIntervalMap   = {};
  lastCorrectTime  = null;
  lastCorrectChar  = null;
  runBigramRaw     = {};
  runIdleMs        = 0;
  isAbortedRun     = false;
  lastCheckpointCursor = 0;
  keystrokeLog     = [];
  lastKeystrokeTime = null;
  clearTimeout(idleAbandonTimer);
  idleAbandonTimer = null;

  exerciseLevelLabel.textContent = `Уровень ${level}`;
  liveTimer.textContent    = '0:00';
  liveProgress.textContent = '0%';
  liveCpm.textContent      = '— зн/мин';

  renderText();
  updateFingerHint();

  wordInput.value = '';
  wordInput.disabled = false;
  updateWordDisplay();

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
      span.classList.add(junkBuffer.length > 0 ? 'char--current-error' : 'char--current-ok');
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

// ── Word display (styled char-by-char) ───────────────────────

function updateWordDisplay() {
  wordDisplay.innerHTML = '';

  if (wordInput.disabled || (wordSoFar === '' && junkBuffer === '')) {
    const ph = document.createElement('span');
    ph.className = 'wchar--placeholder';
    ph.textContent = 'печатай здесь…';
    wordDisplay.appendChild(ph);
    wordDisplay.classList.remove('has-error');
    return;
  }

  for (const ch of wordSoFar) {
    const span = document.createElement('span');
    span.textContent = ch;
    wordDisplay.appendChild(span);
  }

  for (const ch of junkBuffer) {
    const span = document.createElement('span');
    span.className = 'wchar--wrong';
    span.textContent = ch === ' ' ? '\u00A0' : ch;
    wordDisplay.appendChild(span);
  }

  wordDisplay.classList.toggle('has-error', junkBuffer.length > 0);
}

wordInput.addEventListener('focus', () => wordDisplay.classList.add('focused'));
wordInput.addEventListener('blur', () => {
  wordDisplay.classList.remove('focused');
  // Если упражнение идёт — сразу возвращаем фокус
  if (startTime && !wordInput.disabled) setTimeout(() => wordInput.focus(), 0);
});
wordDisplay.addEventListener('click', () => wordInput.focus());
document.getElementById('screen-exercise').addEventListener('click', () => {
  if (startTime && !wordInput.disabled) wordInput.focus();
});

// Prevent any click anywhere on the page from stealing focus while exercise is active.
// mousedown fires before blur, so preventDefault here stops the focus transfer.
// click events still fire (buttons/checkboxes still work normally).
document.addEventListener('mousedown', (e) => {
  if (wordInput.disabled) return;           // exercise not active
  if (e.target === wordInput) return;
  e.preventDefault();
});

// After any checkbox toggle on the exercise screen, return focus to the input.

// Prevent Tab and Escape from leaving the input during an active exercise.
document.addEventListener('keydown', (e) => {
  if (wordInput.disabled) return;
  if (e.key === 'Tab' || e.key === 'Escape') {
    e.preventDefault();
    wordInput.focus();
  }
});

// ── Finger hint + hand image ──────────────────────────────────

function updateFingerHint() {
  if (junkBuffer.length > 0) {
    fingerHint.textContent = 'Backspace';
    handImage.src = '__red_10.png';
    return;
  }

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
  const now = new Date();
  runStartDate = now.toLocaleDateString('ru-RU');
  runStartTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  timerInterval = setInterval(() => {
    elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    liveTimer.textContent    = Stats.formatTime(elapsedSeconds);
    liveProgress.textContent = chars.length ? Math.round(cursor / chars.length * 100) + '%' : '0%';
    liveCpm.textContent      = elapsedSeconds > 0
      ? Math.round(cursor / (elapsedSeconds / 60)) + ' зн/мин'
      : '— зн/мин';
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
  // Record keystroke for replay log
  if (!wordInput.disabled) {
    const now = Date.now();
    const delta = lastKeystrokeTime !== null ? now - lastKeystrokeTime : 0;
    const k = (e.ctrlKey || e.altKey) && e.key === 'Backspace' ? '⌫⌫'
            : e.key === 'Backspace' ? '⌫'
            : e.key.length === 1 ? e.key
            : null;
    if (k !== null) { keystrokeLog.push([k, delta]); lastKeystrokeTime = now; }
  }

  const wordErase = e.key === 'Backspace' && (e.ctrlKey || e.altKey) && !e.metaKey;
  if (wordErase) {
    e.preventDefault();
    resetIdleTimer();
    if (junkBuffer.length > 0) {
      // Delete last "word" in junk: back to last space, or clear all junk
      const lastSpace = junkBuffer.lastIndexOf(' ');
      junkBuffer = lastSpace >= 0 ? junkBuffer.slice(0, lastSpace) : '';
    } else {
      // Delete current correct word: back to last typed space
      const eraseLen = wordSoFar.length;
      for (let i = cursor - eraseLen; i < cursor; i++) charStates[i] = 'pending';
      cursor   -= eraseLen;
      wordSoFar = '';
    }
    updateWordDisplay();
    updateDisplay();
    updateFingerHint();
    return;
  }

  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'Backspace') {
    e.preventDefault();
    resetIdleTimer();
    handleBackspace();
    return;
  }

  if (e.key.length !== 1) return;

  e.preventDefault();
  resetIdleTimer();

  if (!startTime) startTimer();

  const now = Date.now();
  if (lastKeyTime !== null) {
    const deltaMs = now - lastKeyTime;
    const tenths  = Math.round(deltaMs / 100);
    if (tenths > 0) runIntervalMap[tenths] = (runIntervalMap[tenths] || 0) + 1;
    if (deltaMs > 3000) {
      runIdleMs += deltaMs - 3000;
      if (runIdleMs >= 180_000) { abandonRun(); return; }
    }
  }
  lastKeyTime = now;
  resetIdleAbandonTimer();

  handleChar(e.key);
});

// ── Idle reminder ────────────────────────────────────────────

function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (!startTime || wordInput.disabled) return;
  idleTimer = setTimeout(() => {
    if (!window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance('Диана, перебирай все кнопки на пальце');
    utter.lang = 'ru-RU';
    utter.onend = resetIdleTimer;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  }, 4000);
}

function clearIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = null;
}

function resetIdleAbandonTimer() {
  clearTimeout(idleAbandonTimer);
  if (!startTime || wordInput.disabled) return;
  // Fire when remaining idle budget (180s total, 5s free per gap) would be exhausted
  const remaining = 180_000 - runIdleMs + 3000;
  idleAbandonTimer = setTimeout(abandonRun, remaining);
}

function clearIdleAbandonTimer() {
  clearTimeout(idleAbandonTimer);
  idleAbandonTimer = null;
}

// ── Fanfare (pre-rendered WAV blob) ───────────────────────────

let _fanfareUrl = null;

(async () => {
  if (!window.OfflineAudioContext) return;
  const sr    = 22050;
  const total = 1.2;
  const oac   = new OfflineAudioContext(1, Math.ceil(sr * total), sr);

  // Each note = 4 sine harmonics to sound like a brass instrument
  function note(freq, t, dur) {
    [1, 2, 3, 4].forEach((h, i) => {
      const osc  = oac.createOscillator();
      const gain = oac.createGain();
      osc.connect(gain);
      gain.connect(oac.destination);
      osc.type = 'sine';
      osc.frequency.value = freq * h;
      const amp = [0.45, 0.22, 0.13, 0.08][i];
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(amp, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    });
  }

  // G4 → C5 → E5 → G5
  note(392, 0.00, 0.18);
  note(523, 0.20, 0.18);
  note(659, 0.40, 0.18);
  note(784, 0.60, 0.55);

  const buf  = await oac.startRendering();
  const data = buf.getChannelData(0);
  const wav  = new ArrayBuffer(44 + data.length * 2);
  const dv   = new DataView(wav);
  const str  = (s, off) => s.split('').forEach((c, i) => dv.setUint8(off + i, c.charCodeAt(0)));
  str('RIFF', 0); dv.setUint32(4, wav.byteLength - 8, true);
  str('WAVE', 8); str('fmt ', 12);
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
  dv.setUint16(32, 2, true);  dv.setUint16(34, 16, true);
  str('data', 36); dv.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  _fanfareUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
})();

function playFanfare() {
  if (!_fanfareUrl) return;
  new Audio(_fanfareUrl).play().catch(() => {});
}

// ── Error sound ───────────────────────────────────────────────

function playOy() {
  if (!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance('ой');
  utter.lang = 'ru-RU';
  utter.rate = 1.8;
  utter.volume = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

function playCheckFinger() { playOy(); }

// ── Error detail tracking ─────────────────────────────────────

function recordError(key) {
  if (!runErrors[cursor]) {
    runErrors[cursor] = { expected: chars[cursor], attempts: [] };
  }
  runErrors[cursor].attempts.push(key);
}

// ── Single character handler ──────────────────────────────────
//
// A correct character is only accepted when junkBuffer is empty.
// A wrong character (or any character while junk exists) is appended
// to junkBuffer. The text cursor does not advance until all junk is
// cleared via Backspace.

function handleChar(key) {
  if (junkBuffer.length > 0) {
    junkBuffer += key;
    errorCount++;
    recordError(key);
    updateWordDisplay();
    updateDisplay();
    updateFingerHint();
    return;
  }

  const expected = chars[cursor];

  if (key !== expected) {
    junkBuffer += key;
    errorCount++;
    recordError(key);
    // Track consecutive first-errors at the same position
    if (cursor === lastMistakePos) {
      samePosMistakes++;
    } else {
      lastMistakePos  = cursor;
      samePosMistakes = 1;
    }
    if (samePosMistakes % 3 === 0) {
      playCheckFinger();
    }
    updateWordDisplay();
    updateDisplay();
    updateFingerHint();
    return;
  }

  // Correct character — reset position streak
  samePosMistakes = 0;
  lastMistakePos  = -1;
  charStates[cursor] = 'correct';

  const correctNow = Date.now();
  if (lastCorrectTime !== null) {
    const bigram = lastCorrectChar + expected;
    const delta  = correctNow - lastCorrectTime;
    if (!runBigramRaw[bigram]) runBigramRaw[bigram] = [];
    runBigramRaw[bigram].push(delta);
  }
  lastCorrectTime = correctNow;
  lastCorrectChar = expected;

  cursor++;

  if (cursor - lastCheckpointCursor >= 10 && cursor < chars.length) {
    lastCheckpointCursor = cursor;
    const liveCpmNow = elapsedSeconds > 0 ? Math.round(cursor / (elapsedSeconds / 60)) : 0;

    const cpErrorsDetail = Object.entries(runErrors)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([posStr, info]) => {
        const pos = Number(posStr);
        if (chars[pos] === ' ') return { word: '␣', charInWord: 0, expected: ' ', attempts: info.attempts };
        let start = pos; while (start > 0 && chars[start - 1] !== ' ') start--;
        let end   = pos; while (end < chars.length && chars[end] !== ' ') end++;
        return { word: chars.slice(start, end).join(''), charInWord: pos - start, expected: info.expected, attempts: [...new Set(info.attempts)] };
      });
    const cpBigramStats = {};
    for (const [bigram, times] of Object.entries(runBigramRaw)) {
      const sum = times.reduce((s, t) => s + t, 0);
      cpBigramStats[bigram] = { avg: Math.round(sum / times.length), count: times.length };
    }
    const cpErrorPositions = {};
    for (const [pos, info] of Object.entries(runErrors)) {
      const unique = [...new Set(info.attempts)];
      if (unique.length) cpErrorPositions[Number(pos)] = unique;
    }

    Stats.saveRun({
      date:           runStartDate,
      time:           runStartTime,
      level:          currentLevel,
      chars:          cursor,
      totalChars:     chars.length,
      seconds:        elapsedSeconds,
      cpm:            liveCpmNow,
      errors:         errorCount,
      errorsDetail:   cpErrorsDetail,
      intervalMap:    runIntervalMap,
      bigramStats:    cpBigramStats,
      text:           chars.join(''),
      errorPositions: cpErrorPositions,
      noFinger:       !showFinger,
      keystrokeLog:   keystrokeLog.slice(),
      incomplete:     true,
    });
  }

  if (expected === ' ') {
    wordStart = cursor;
    wordSoFar = '';
  } else {
    wordSoFar += expected;
  }

  updateWordDisplay();
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
    updateWordDisplay();
    updateDisplay();
    updateFingerHint();
    return;
  }

  // No junk — retreat one correct character, but not past word start
  if (cursor <= wordStart) return;

  cursor--;
  charStates[cursor] = 'pending';
  wordSoFar = wordSoFar.slice(0, -1);
  updateWordDisplay();
  updateDisplay();
  updateFingerHint();
}

// ── Run completion ────────────────────────────────────────────

function abandonRun() {
  stopTimer();
  clearIdleTimer();
  clearIdleAbandonTimer();
  wordInput.disabled = true;
  isAbortedRun = true;

  document.querySelector('.result-title').textContent = 'Заезд прерван';
  const recordEl = document.getElementById('result-record-label');
  if (recordEl) { recordEl.textContent = 'Перерыв больше 3 минут — заезд не засчитан'; recordEl.className = 'result-record-label result-record-label--aborted'; }
  resultTime.textContent   = Stats.formatTime(elapsedSeconds);
  resultCpm.textContent    = '—';
  resultChars.textContent  = '—';
  resultErrors.textContent = '—';
  btnNext.textContent      = 'Понятно';
  resultOverlay.classList.remove('hidden');
}

async function finishRun() {
  stopTimer();
  clearIdleTimer();
  clearIdleAbandonTimer();
  wordInput.disabled = true;
  updateWordDisplay();
  updateDisplay();
  fingerHint.textContent = '';

  const totalChars  = chars.length;
  const minutes     = elapsedSeconds > 0 ? elapsedSeconds / 60 : 1 / 60;
  const cpm         = Math.round(totalChars / minutes);
  const recordLabel = Stats.getRecordLabel(cpm);  // check BEFORE saveRun

  const idleSeconds = Math.round(runIdleMs / 1000);
  const netSeconds  = Math.max(0, elapsedSeconds - idleSeconds);
  resultTime.textContent = Stats.formatTime(netSeconds);
  if (idleSeconds > 0) {
    resultTime.title = `Реальное: ${Stats.formatTime(elapsedSeconds)}, простой: ${Stats.formatTime(idleSeconds)}`;
  } else {
    resultTime.title = '';
  }
  resultCpm.textContent    = `${cpm} зн/мин`;
  resultChars.textContent  = totalChars;
  resultErrors.textContent = errorCount;
  const lazy        = idleSeconds >= 60;

  const recordEl = document.getElementById('result-record-label');
  if (recordEl) {
    if (lazy) {
      recordEl.textContent = `Ленивый заезд (простой ${Stats.formatTime(idleSeconds)}) — не засчитывается`;
      recordEl.className   = 'result-record-label result-record-label--lazy';
    } else {
      recordEl.textContent  = recordLabel === 'record' ? 'Рекорд!' : recordLabel === 'repeat' ? 'Повтор!' : '';
      recordEl.className    = 'result-record-label'
        + (recordLabel === 'record' ? ' result-record-label--record' : '')
        + (recordLabel === 'repeat' ? ' result-record-label--repeat' : '');
    }
  }
  playFanfare();

  resultOverlay.classList.remove('hidden');

  const errorsDetail = Object.entries(runErrors)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([posStr, info]) => {
      const pos = Number(posStr);
      if (chars[pos] === ' ') {
        return { word: '␣', charInWord: 0, expected: ' ', attempts: info.attempts };
      }
      let start = pos;
      while (start > 0 && chars[start - 1] !== ' ') start--;
      let end = pos;
      while (end < chars.length && chars[end] !== ' ') end++;
      return {
        word:       chars.slice(start, end).join(''),
        charInWord: pos - start,
        expected:   info.expected,
        attempts:   [...new Set(info.attempts)],
      };
    });

  const bigramStats = {};
  for (const [bigram, times] of Object.entries(runBigramRaw)) {
    const sum = times.reduce((s, t) => s + t, 0);
    bigramStats[bigram] = { avg: Math.round(sum / times.length), count: times.length };
  }

  const errorPositions = {};
  for (const [pos, info] of Object.entries(runErrors)) {
    const unique = [...new Set(info.attempts)];
    if (unique.length) errorPositions[Number(pos)] = unique;
  }

  await Stats.saveRun({
    date:           runStartDate,
    time:           runStartTime,
    level:          currentLevel,
    chars:          totalChars,
    seconds:        elapsedSeconds,
    cpm,
    errors:         errorCount,
    errorsDetail,
    intervalMap:    runIntervalMap,
    bigramStats,
    text:           chars.join(''),
    errorPositions,
    idleSeconds,
    lazy,
    noFinger: !showFinger,
    keystrokeLog,
  });

  const todayCount = Stats.getTodayRunCount();
  if (todayCount === 5 || todayCount === 10) {
    const text = todayCount === 5
      ? 'Задача минимум на день сделана'
      : '10 за день сделано';
    if (window.speechSynthesis) {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'ru-RU';
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
    }
  }

  updateLevelProgressHint();
}

// ── Navigation buttons ────────────────────────────────────────

btnBack.addEventListener('click', () => {
  if (startTime && !wordInput.disabled) {
    if (!confirm('Прервать упражнение и выйти?')) return;
  }
  stopTimer();
  clearIdleTimer();
  resultOverlay.classList.add('hidden');
  wordInput.disabled = true;
  restoreFingerSetting();
  showScreen('list');
});

function doNext() {
  resultOverlay.classList.add('hidden');
  if (isAbortedRun) {
    isAbortedRun = false;
    document.querySelector('.result-title').textContent = 'Заезд завершён!';
    btnNext.textContent = 'Следующий →';
    restoreFingerSetting();
    showScreen('list');
  } else {
    startExercise(currentLevel);
  }
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
  if (hint) hint.textContent = `~${LEVEL_SIZES[currentLevel - 1]} символов`;
}

// ── Level progress hint below stats summary ───────────────────

function updateLevelProgressHint() {
  const hint = document.getElementById('level-progress-hint');
  if (!hint) return;

  if (currentLevel >= LEVEL_COUNT) {
    hint.textContent = 'Максимальный уровень достигнут!';
    return;
  }

  const nextLevel = currentLevel + 1;
  const threshold = LEVEL_THRESHOLDS[currentLevel - 1];
  const recentAvg = Stats.getRecentAvgCpm();

  let firstLine;
  if (recentAvg === 0) {
    firstLine = `Для перехода на уровень ${nextLevel} нужна средняя скорость ${threshold} зн/мин`;
  } else {
    const remaining = threshold - recentAvg;
    firstLine = remaining <= 0
      ? `Средняя скорость за последние 15 заездов уже достаточна для уровня ${nextLevel}!`
      : `Для перехода на уровень ${nextLevel} нужна скорость ${threshold} зн/мин — осталось ${remaining} зн/мин`;
  }

  const further = LEVEL_THRESHOLDS.slice(currentLevel).map(t => t).join(', ');

  hint.innerHTML = `${firstLine}<br><span style="opacity:0.6;font-size:0.85em">Далее: ${further} зн/мин</span>`;
}

// ── Initialization ────────────────────────────────────────────

async function init() {
  loadLevel();
  initFingerSetting();

  // Level buttons on home screen
  renderLevelButtons('level-buttons-main', (n) => {
    saveLevel(n);
    updateLevelHint();
  });

  showScreen('list');
  await Stats.init();


  updateLevelButtonsActive();
  updateLevelHint();
  updateLockHint();
  updateLevelProgressHint();
}

init();
