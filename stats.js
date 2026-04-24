// ============================================================
// stats.js — run statistics storage and display
// Storage: localStorage. Export to .txt available on demand.
// ============================================================

const Stats = (() => {
  const LS_KEY = 'klavagonki_stats';

  let runs = [];   // all loaded run records
  let tableMode = 'runs';  // 'runs' | 'days'
  let chartFromIso = '';
  let chartToIso   = '';
  let renderChartsNow = () => {}; // set after first renderStats
  let replayState = null;

  // ── Utilities ──────────────────────────────────────────────

  function parseLines(text) {
    return text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        try { return JSON.parse(l); }
        catch { return null; }
      })
      .filter(Boolean);
  }

  function serializeRuns(runArray) {
    return runArray.map(r => JSON.stringify(r)).join('\n') + '\n';
  }

  function todayStr() {
    return new Date().toLocaleDateString('ru-RU');
  }

  // Parse Russian date string dd.mm.yyyy → Date
  function parseRuDate(str) {
    const [d, m, y] = str.split('.').map(Number);
    return new Date(y, m - 1, d);
  }

  function ruToIso(ru) { const [d, m, y] = ru.split('.'); return `${y}-${m}-${d}`; }
  function isoToRu(iso) { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; }

  function last5Runs(allRuns) {
    return allRuns.slice(-5);
  }

  function lsRead() {
    return parseLines(localStorage.getItem(LS_KEY) || '');
  }

  function lsWrite(runArray) {
    localStorage.setItem(LS_KEY, serializeRuns(runArray));
  }

  function exportTxt() {
    const blob = new Blob([serializeRuns(runs)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stats.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Gist sync ──────────────────────────────────────────────

  const GIST_TOKEN_KEY = 'klavogonki_gist_token';
  const GIST_ID_KEY    = 'klavogonki_gist_id';
  const GIST_FILE      = 'klavogonki-stats.json';

  function getSyncConfig() {
    return {
      token:  localStorage.getItem(GIST_TOKEN_KEY) || '',
      gistId: localStorage.getItem(GIST_ID_KEY)    || '',
    };
  }

  function saveSyncConfig(token, gistId) {
    localStorage.setItem(GIST_TOKEN_KEY, token);
    localStorage.setItem(GIST_ID_KEY,    gistId);
  }

  function setSyncStatus(msg, isError) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'sync-status' + (isError ? ' sync-status--error' : '');
  }

  async function gistFetch(method, gistId, token, body) {
    const url = gistId
      ? `https://api.github.com/gists/${gistId}`
      : 'https://api.github.com/gists';
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        'Accept':        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    return res.json();
  }

  async function pushToGist() {
    const { token, gistId } = getSyncConfig();
    if (!token || !gistId) return;
    const btn = document.getElementById('btn-push-gist');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Отправляю…'; }
    try {
      const ver = typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown';
      await gistFetch('PATCH', gistId, token, {
        description: `Клавогонки — статистика (${ver})`,
        files: { [GIST_FILE]: { content: serializeRuns(runs) } },
      });
      const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setSyncStatus('↑ ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
      setRefreshStatus(`отправлено в ${timeStr}`);
    } catch (e) {
      setSyncStatus('↑ Ошибка: ' + e.message, true);
      setRefreshStatus('ошибка отправки');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↑ Отправить'; }
    }
  }

  function setRefreshStatus(msg) {
    const el = document.getElementById('refresh-status');
    if (el) el.textContent = msg;
  }

  async function pullFromGist() {
    const { gistId } = getSyncConfig();
    if (!gistId) { setSyncStatus('Укажите ID гиста', true); return; }
    setSyncStatus('Загружаю…');
    const btn = document.getElementById('btn-refresh-gist');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Загружаю…'; }
    try {
      const res  = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();
      const file = data.files[GIST_FILE];
      if (!file) throw new Error('файл не найден в гисте');
      const pulled = parseLines(file.content);
      runs = pulled;
      lsWrite(runs);
      renderStats(runs);
      saveSyncConfig('', gistId);
      document.getElementById('btn-refresh-gist')?.classList.remove('hidden');
      document.getElementById('sync-overlay')?.classList.add('hidden');
      const lastPulled = pulled[pulled.length - 1];
      const hasProgress = lastPulled?.incomplete;
      const progressNote = hasProgress ? ` · 🟡 в процессе (${lastPulled.chars} симв)` : '';
      setSyncStatus(`↓ Загружено ${pulled.length} заездов${progressNote}`);
      const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setRefreshStatus(`обновлено в ${timeStr}`);
    } catch (e) {
      setSyncStatus('↓ Ошибка: ' + e.message, true);
      setRefreshStatus('ошибка обновления');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↻ Обновить'; }
    }
  }

  async function createGist(token) {
    setSyncStatus('Создаю гист…');
    try {
      const data   = await gistFetch('POST', null, token, {
        description: 'Клавогонки — статистика',
        public:      true,
        files:       { [GIST_FILE]: { content: serializeRuns(runs) } },
      });
      const gistId = data.id;
      saveSyncConfig(token, gistId);
      const el = document.getElementById('sync-gist-id');
      if (el) el.value = gistId;
      document.getElementById('btn-refresh-gist')?.classList.remove('hidden');
      setSyncStatus('Гист создан: ' + gistId);
    } catch (e) {
      setSyncStatus('Ошибка: ' + e.message, true);
    }
  }

  // ── Public API ─────────────────────────────────────────────

  async function init() {
    const btnExport = document.getElementById('btn-export-stats');
    btnExport.addEventListener('click', exportTxt);

    const btnRuns = document.getElementById('btn-view-runs');
    const btnDays = document.getElementById('btn-view-days');
    btnRuns.addEventListener('click', () => {
      tableMode = 'runs';
      btnRuns.classList.add('active');
      btnDays.classList.remove('active');
      renderTable(runs.filter(r => !r.incomplete));
      renderChartsNow();
    });
    btnDays.addEventListener('click', () => {
      tableMode = 'days';
      btnDays.classList.add('active');
      btnRuns.classList.remove('active');
      renderTable(runs.filter(r => !r.incomplete));
      renderChartsNow();
    });

    const overlay = document.getElementById('error-detail-overlay');
    document.getElementById('btn-close-detail').addEventListener('click', () => {
      overlay.classList.add('hidden');
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });

    // Sync panel (opened by keyboard shortcut)
    const syncOverlay = document.getElementById('sync-overlay');

    function openSyncPanel(mode) {
      const tokenInput = document.getElementById('sync-token');
      const gistInput  = document.getElementById('sync-gist-id');
      const rowToken   = document.getElementById('sync-row-token');
      const rowGistId  = document.getElementById('sync-row-gist-id');
      const btnCreate  = document.getElementById('btn-create-gist');
      const btnPull    = document.getElementById('btn-pull-gist');
      const titleEl    = document.getElementById('sync-panel-title');
      const hintEl     = document.getElementById('sync-hint-text');

      const cfg = getSyncConfig();
      tokenInput.value = cfg.token;
      gistInput.value  = cfg.gistId;

      if (mode === 'daughter') {
        titleEl.textContent     = 'Настройка синхронизации';
        hintEl.innerHTML        = 'Введите токен GitHub (скоуп: <b>gist</b>) и нажмите «Создать гист». ID сохранится сам — передайте его папе.';
        rowToken.style.display  = '';
        rowGistId.style.display = cfg.gistId ? '' : 'none';
        btnCreate.style.display = '';
        btnPull.style.display   = 'none';
        tokenInput.focus();
      } else {
        titleEl.textContent     = 'Статистика дочки';
        hintEl.innerHTML        = 'Вставьте ID гиста от дочки и нажмите «Загрузить».';
        rowToken.style.display  = 'none';
        rowGistId.style.display = '';
        btnCreate.style.display = 'none';
        btnPull.style.display   = '';
        gistInput.focus();
      }

      setSyncStatus('');
      syncOverlay.classList.remove('hidden');
    }

    function closeSyncPanel() {
      syncOverlay.classList.add('hidden');
    }

    document.getElementById('btn-close-sync').addEventListener('click', closeSyncPanel);
    syncOverlay.addEventListener('click', (e) => {
      if (e.target === syncOverlay) closeSyncPanel();
    });

    const tokenInput = document.getElementById('sync-token');
    const gistInput  = document.getElementById('sync-gist-id');
    const saveConfig = () => {
      const cfg = getSyncConfig();
      saveSyncConfig(tokenInput?.value.trim() || cfg.token, gistInput?.value.trim() || '');
    };
    tokenInput?.addEventListener('blur', saveConfig);
    gistInput?.addEventListener('blur',  saveConfig);

    document.getElementById('btn-create-gist').addEventListener('click', () => {
      saveConfig();
      const t = tokenInput.value.trim();
      if (!t) { setSyncStatus('Введите токен', true); return; }
      createGist(t).then(() => {
        document.getElementById('sync-row-gist-id').style.display = '';
      });
    });
    document.getElementById('btn-pull-gist').addEventListener('click', () => {
      saveConfig();
      pullFromGist();
    });

    document.addEventListener('keydown', (e) => {
      const onHomeScreen = document.getElementById('screen-list')?.classList.contains('active');
      if (onHomeScreen && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyD') { e.preventDefault(); openSyncPanel('daughter'); }
      if (onHomeScreen && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyP') { e.preventDefault(); openSyncPanel('dad'); }
      if (e.key === 'Escape') closeSyncPanel();
    });

    const btnRefresh = document.getElementById('btn-refresh-gist');
    const btnPush    = document.getElementById('btn-push-gist');
    const cfg0 = getSyncConfig();
    if (cfg0.gistId && !cfg0.token) btnRefresh.classList.remove('hidden');
    if (cfg0.gistId &&  cfg0.token) btnPush.classList.remove('hidden');
    btnRefresh.addEventListener('click', () => pullFromGist());
    btnPush.addEventListener('click', () => pushToGist());

    // Replay overlay
    const replayOverlay = document.getElementById('replay-overlay');
    if (replayOverlay) {
      function closeReplay() {
        if (replayState?.timeoutId) clearTimeout(replayState.timeoutId);
        replayState = null;
        replayOverlay.classList.add('hidden');
      }
      document.getElementById('btn-close-replay').addEventListener('click', closeReplay);
      replayOverlay.addEventListener('click', e => { if (e.target === replayOverlay) closeReplay(); });

      document.getElementById('btn-replay-playpause').addEventListener('click', () => {
        if (!replayState) return;
        replayState.paused = !replayState.paused;
        const btn = document.getElementById('btn-replay-playpause');
        if (replayState.paused) {
          clearTimeout(replayState.timeoutId);
          btn.textContent = '▶';
        } else {
          btn.textContent = '⏸';
          scheduleNextReplayKey();
        }
      });

      document.getElementById('btn-replay-restart').addEventListener('click', () => {
        if (!replayState) return;
        document.getElementById('btn-replay-playpause').textContent = '⏸';
        startReplay(replayState.run, replayState.speed);
      });

      replayOverlay.querySelectorAll('.btn-speed').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!replayState) return;
          replayState.speed = parseFloat(btn.dataset.speed);
          replayOverlay.querySelectorAll('.btn-speed').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    }

    runs = lsRead();
    renderStats(runs);
  }

  /**
   * Saves one completed run.
   * @param {{ level: number, chars: number, seconds: number, cpm: number, errors: number }} record
   */
  async function saveRun(record) {
    const entry = {
      date:         new Date().toLocaleDateString('ru-RU'),
      time:         new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      level:        record.level,
      chars:        record.chars,
      errors:       record.errors,
      seconds:      record.seconds,
      cpm:          record.cpm,
      errorsDetail:   record.errorsDetail   || [],
      intervalMap:    record.intervalMap    || {},
      bigramStats:    record.bigramStats    || {},
      text:           record.text           || '',
      errorPositions: record.errorPositions || {},
      idleSeconds:    record.idleSeconds    || 0,
      lazy:           record.lazy           || false,
      incomplete:     record.incomplete     || false,
      totalChars:     record.totalChars     || null,
      noFinger:       record.noFinger       || false,
      keystrokeLog:   record.keystrokeLog   || [],
    };

    // Replace last entry if it was a checkpoint (incomplete)
    if (runs.length > 0 && runs[runs.length - 1].incomplete) runs.pop();

    runs.push(entry);
    lsWrite(runs);
    renderStats(runs);
    pushToGist(); // fire-and-forget
  }

  // ── Rendering ──────────────────────────────────────────────

  function avg(arr) {
    if (!arr.length) return 0;
    return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
  }

  function max(arr) {
    if (!arr.length) return 0;
    return Math.max(...arr);
  }

  function avg1(arr) {
    if (!arr.length) return '—';
    return (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1);
  }

  function groupByDay(allRuns) {
    if (!allRuns.length) return [];

    // Index runs by date string
    const map = {};
    for (const r of allRuns) {
      if (!map[r.date]) map[r.date] = [];
      map[r.date].push(r);
    }

    // Date range: earliest run → today
    const parsedDates = Object.keys(map).map(parseRuDate);
    const earliest = new Date(Math.min(...parsedDates));
    const today    = new Date();
    earliest.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    // Build one row per calendar date, oldest first
    const rows = [];
    for (let d = new Date(earliest); d <= today; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toLocaleDateString('ru-RU');
      const dayRuns = map[dateStr] || [];
      rows.push({
        date:     dateStr,
        count:    dayRuns.length,
        avgLevel: (() => { const lvls = dayRuns.map(r => r.level).filter(v => typeof v === 'number'); return lvls.length ? avg1(lvls) : '—'; })(),
        chars:    dayRuns.reduce((s, r) => s + r.chars, 0),
        worstErrRun: (() => { const e = dayRuns.filter(r => r.errors != null); return e.length ? e.reduce((w, r) => errPct(r) > errPct(w) ? r : w, e[0]) : null; })(),
        avgErrPct:   (() => { const e = dayRuns.filter(r => r.errors != null); return e.length ? parseFloat(avg(e.map(r => errPct(r)))) : null; })(),
        seconds:  dayRuns.reduce((s, r) => s + r.seconds, 0),
        avgCpm:   dayRuns.length ? avg(dayRuns.map(r => r.cpm)) : null,
        maxCpm:   dayRuns.length ? Math.max(...dayRuns.map(r => r.cpm)) : null,
      });
    }

    // Record labels — chronological: each new best = 'record', tie = 'repeat'
    let maxDayAvg    = -1;
    let maxDayMax    = -1;
    let minDayAvgErr = Infinity;
    let minDayMaxErr = Infinity;

    // Color flags + record labels — computed on oldest-first array
    const NEW_RULES_START = new Date(2026, 3, 14); // 14 April 2026
    function parseRowDate(s) {
      const [d, m, y] = s.split('.').map(Number);
      return new Date(y, m - 1, d);
    }
    function isYellowDay(r) {
      const threshold = parseRowDate(r.date) >= NEW_RULES_START ? 2 : 5;
      return r.count >= threshold;
    }
    rows.forEach((row, i) => {
      const yellow = isYellowDay(row);
      const green  = yellow && i >= 4 &&
        isYellowDay(rows[i - 1]) &&
        isYellowDay(rows[i - 2]) &&
        isYellowDay(rows[i - 3]) &&
        isYellowDay(rows[i - 4]);
      row.dateClass  = green ? 'cell--green' : yellow ? 'cell--yellow' : '';
      row.countClass = row.count >= 5 ? 'cell--green' : '';

      if (row.avgCpm !== null) {
        const wPct = errPct(row.worstErrRun);
        row.avgLabel    = row.avgCpm  > maxDayAvg    ? 'record' : row.avgCpm  === maxDayAvg    ? 'repeat' : '';
        row.maxLabel    = row.maxCpm  > maxDayMax    ? 'record' : row.maxCpm  === maxDayMax    ? 'repeat' : '';
        row.avgErrLabel = row.avgErrPct < minDayAvgErr ? 'record' : row.avgErrPct === minDayAvgErr ? 'repeat' : '';
        row.maxErrLabel = wPct         < minDayMaxErr ? 'record' : wPct         === minDayMaxErr ? 'repeat' : '';
        if (row.avgCpm     > maxDayAvg)    maxDayAvg    = row.avgCpm;
        if (row.maxCpm     > maxDayMax)    maxDayMax    = row.maxCpm;
        if (row.avgErrPct  < minDayAvgErr) minDayAvgErr = row.avgErrPct;
        if (wPct           < minDayMaxErr) minDayMaxErr = wPct;
      } else {
        row.avgLabel = row.maxLabel = row.avgErrLabel = row.maxErrLabel = '';
      }
    });

    // Detect level transitions — mark the date of the LAST run before each transition
    const levelTransitions = {};
    for (let i = 0; i < allRuns.length - 1; i++) {
      const r = allRuns[i], next = allRuns[i + 1];
      if (r.level != null && next.level != null && next.level !== r.level) {
        if (!levelTransitions[r.date]) levelTransitions[r.date] = [];
        if (!levelTransitions[r.date].includes(next.level)) levelTransitions[r.date].push(next.level);
      }
    }
    // Most recent run: mark if current saved level already differs
    if (allRuns.length > 0) {
      const last = allRuns[allRuns.length - 1];
      const currentSavedLevel = parseInt(localStorage.getItem('klavagonki_level'), 10) || null;
      if (currentSavedLevel != null && last.level != null && currentSavedLevel !== last.level) {
        if (!levelTransitions[last.date]) levelTransitions[last.date] = [];
        if (!levelTransitions[last.date].includes(currentSavedLevel)) levelTransitions[last.date].push(currentSavedLevel);
      }
    }
    rows.forEach(row => { row.levelChanges = levelTransitions[row.date] || []; });

    return rows.reverse();  // newest first for display
  }

  function computeRecords(allRuns) {
    // Returns parallel array of '' | 'record' | 'repeat' (chronological order)
    let maxCpm = -1;
    return allRuns.map(r => {
      const label = r.cpm > maxCpm ? 'record' : r.cpm === maxCpm ? 'repeat' : '';
      if (r.cpm > maxCpm) maxCpm = r.cpm;
      return label;
    });
  }

  function errPct(r) {
    return (r.chars > 0 && r.errors != null) ? r.errors / r.chars * 100 : Infinity;
  }

  function fmtErr(errors, chars) {
    if (errors == null || !chars) return '—';
    return `${errors} (${(errors / chars * 100).toFixed(1)}%)`;
  }

  function computeErrorRecords(allRuns) {
    // Lower error % = better. Marks each new chronological minimum as 'record'.
    let minPct = Infinity;
    return allRuns.map(r => {
      if (r.errors == null) return '';
      const pct = errPct(r);
      if (pct < minPct)  { minPct = pct; return 'record'; }
      if (pct === minPct) return 'repeat';
      return '';
    });
  }

  // Returns parallel array: newLevel (number) for the LAST run before a level transition, else null.
  // Also marks the most recent run if current saved level already differs from it.
  function computeLevelChanges(allRuns) {
    const currentSavedLevel = parseInt(localStorage.getItem('klavagonki_level'), 10) || null;
    return allRuns.map((r, i) => {
      if (i < allRuns.length - 1) {
        const next = allRuns[i + 1];
        if (r.level != null && next.level != null && next.level !== r.level) return next.level;
      } else {
        // Last run: check if the app has already promoted beyond it
        if (currentSavedLevel != null && r.level != null && currentSavedLevel !== r.level) return currentSavedLevel;
      }
      return null;
    });
  }

  function getRecordLabel(cpm) {
    // Call BEFORE saving the new run so `runs` still reflects history
    const complete = runs.filter(r => !r.incomplete);
    if (!complete.length) return 'record';  // first run ever is always a record
    const maxPrev = Math.max(...complete.map(r => r.cpm));
    if (cpm > maxPrev)      return 'record';
    if (cpm === maxPrev)    return 'repeat';
    return '';
  }

  // ── Replay engine ──────────────────────────────────────────

  function showReplay(run) {
    if (!run.keystrokeLog || !run.keystrokeLog.length || !run.text) return;
    const overlay = document.getElementById('replay-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    document.getElementById('replay-title').textContent =
      `${run.date}  ${run.time ?? ''}  —  ${run.cpm} зн/мин`;
    overlay.querySelectorAll('.btn-speed').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.speed) === 1);
    });
    const ppBtn = document.getElementById('btn-replay-playpause');
    if (ppBtn) ppBtn.textContent = '⏸';
    startReplay(run, 1);
  }

  function startReplay(run, speed) {
    if (replayState?.timeoutId) clearTimeout(replayState.timeoutId);
    const chars = run.text.split('');
    replayState = {
      run,
      chars,
      charStates: new Array(chars.length).fill('pending'),
      cursor: 0,
      wordStart: 0,
      wordSoFar: '',
      junkBuffer: '',
      logIdx: 0,
      speed: speed || 1,
      paused: false,
      timeoutId: null,
    };
    renderReplayText();
    renderReplayWord();
    updateReplayProgress();
    scheduleNextReplayKey();
  }

  function scheduleNextReplayKey() {
    if (!replayState || replayState.paused) return;
    const log = replayState.run.keystrokeLog;
    if (replayState.logIdx >= log.length) {
      updateReplayProgress();
      return;
    }
    const [, deltaMs] = log[replayState.logIdx];
    const delay = Math.max(5, deltaMs / replayState.speed);
    replayState.timeoutId = setTimeout(() => {
      if (!replayState || replayState.paused) return;
      const [key] = replayState.run.keystrokeLog[replayState.logIdx];
      applyReplayKey(key);
      replayState.logIdx++;
      updateReplayProgress();
      scheduleNextReplayKey();
    }, delay);
  }

  function applyReplayKey(key) {
    const s = replayState;
    if (key === '⌫⌫') {
      if (s.junkBuffer.length > 0) {
        const sp = s.junkBuffer.lastIndexOf(' ');
        s.junkBuffer = sp >= 0 ? s.junkBuffer.slice(0, sp) : '';
      } else {
        const n = s.wordSoFar.length;
        for (let i = s.cursor - n; i < s.cursor; i++) s.charStates[i] = 'pending';
        s.cursor -= n;
        s.wordSoFar = '';
      }
    } else if (key === '⌫') {
      if (s.junkBuffer.length > 0) {
        s.junkBuffer = s.junkBuffer.slice(0, -1);
      } else if (s.cursor > s.wordStart) {
        s.cursor--;
        s.charStates[s.cursor] = 'pending';
        s.wordSoFar = s.wordSoFar.slice(0, -1);
      }
    } else {
      if (s.junkBuffer.length > 0) {
        s.junkBuffer += key;
      } else {
        const expected = s.chars[s.cursor];
        if (key !== expected) {
          s.junkBuffer += key;
        } else {
          s.charStates[s.cursor] = 'correct';
          s.cursor++;
          if (expected === ' ') {
            s.wordStart = s.cursor;
            s.wordSoFar = '';
          } else {
            s.wordSoFar += expected;
          }
        }
      }
    }
    renderReplayText();
    renderReplayWord();
  }

  function renderReplayText() {
    const el = document.getElementById('replay-text-display');
    if (!el || !replayState) return;
    const { chars, charStates, cursor, junkBuffer } = replayState;
    el.innerHTML = chars.map((ch, i) => {
      const d = ch === ' ' ? '\u00A0'
              : ch.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let cls;
      if (i === cursor) {
        cls = junkBuffer.length > 0 ? 'char--current-error' : 'char--current-ok';
      } else if (charStates[i] === 'correct') {
        cls = 'char--correct';
      } else {
        cls = 'char--pending';
      }
      return `<span class="${cls}">${d}</span>`;
    }).join('');
  }

  function renderReplayWord() {
    const el = document.getElementById('replay-word-display');
    if (!el || !replayState) return;
    const { wordSoFar, junkBuffer } = replayState;
    if (!wordSoFar && !junkBuffer) {
      el.innerHTML = '<span class="wchar--placeholder">печатай здесь…</span>';
      el.classList.remove('has-error');
      return;
    }
    let html = '';
    for (const ch of wordSoFar) html += `<span>${ch}</span>`;
    for (const ch of junkBuffer)
      html += `<span class="wchar--wrong">${ch === ' ' ? '\u00A0' : ch}</span>`;
    el.innerHTML = html;
    el.classList.toggle('has-error', junkBuffer.length > 0);
  }

  function updateReplayProgress() {
    const el = document.getElementById('replay-progress');
    if (!el || !replayState) return;
    const total = replayState.run.keystrokeLog.length;
    el.textContent = `${replayState.logIdx} / ${total}`;
  }

  function renderTableRuns(allRuns, inProgress) {
    const cpmLabels = computeRecords(allRuns);
    const errLabels = computeErrorRecords(allRuns);
    const lvlChanges = computeLevelChanges(allRuns);
    const total = allRuns.length;
    const rows = [...allRuns].map((r, i) => ({ r, i, cl: cpmLabels[i], el: errLabels[i], lc: lvlChanges[i] })).reverse().map(({ r, i, cl, el, lc }) => {
      const cpmBadge = cl === 'record'
        ? ' <span class="run-badge run-badge--record">Рекорд</span>'
        : cl === 'repeat'
        ? ' <span class="run-badge run-badge--repeat">Повтор</span>'
        : '';
      const errBadge = el === 'record'
        ? ' <span class="run-badge-sm run-badge--record">Р</span>'
        : el === 'repeat'
        ? ' <span class="run-badge-sm run-badge--repeat">П</span>'
        : '';
      const idle     = r.idleSeconds || 0;
      const netSecs  = Math.max(0, r.seconds - idle);
      const lazyBadge = r.lazy ? ' <span class="run-badge run-badge--lazy">лень</span>' : '';
      const timeTip  = ` title="Реальное: ${formatTime(r.seconds)}, простой: ${formatTime(idle)}"`;


      const lvlBadge      = lc != null ? ` <span class="run-badge run-badge--level">→${lc}</span>` : '';
      const noFingerBadge = r.noFinger ? ' <span class="run-badge run-badge--nofinger" title="Без подсказки пальца">без 👆</span>' : '';
      const replayBtn = (r.keystrokeLog?.length && r.text)
        ? ' <button class="btn-replay-run" title="Виртуальный заезд">▶</button>' : '';
      return `
      <tr${r.lazy ? ' class="row--lazy"' : ''}>
        <td class="run-num">${i + 1}${replayBtn}</td>
        <td>${r.date}${noFingerBadge}</td>
        <td>${r.time}</td>
        <td>${r.level ?? r.exercise ?? '—'}${lvlBadge}</td>
        <td>${r.chars}</td>
        <td>${fmtErr(r.errors, r.chars)}${errBadge}</td>
        <td${timeTip}>${formatTime(netSecs)}${lazyBadge}</td>
        <td>${r.cpm} зн/мин${cpmBadge}</td>
      </tr>`;
    }).join('');

    const inProgressRow = inProgress ? (() => {
      const pct = inProgress.totalChars
        ? Math.round(inProgress.chars / inProgress.totalChars * 100) + '%'
        : '—';
      return `
      <tr class="row--in-progress">
        <td class="run-num">⏳</td>
        <td>${inProgress.date}</td>
        <td>${inProgress.time}</td>
        <td>${inProgress.level ?? '—'}</td>
        <td>${inProgress.chars} (${pct})</td>
        <td>${fmtErr(inProgress.errors, inProgress.chars)}</td>
        <td>${formatTime(inProgress.seconds)}</td>
        <td>${inProgress.cpm} зн/мин</td>
      </tr>`;
    })() : '';

    return `
      <table class="stats-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Дата</th>
            <th>Время</th>
            <th>Уровень</th>
            <th>Символов</th>
            <th>Ошибок</th>
            <th>Длительность</th>
            <th>Скорость</th>
          </tr>
        </thead>
        <tbody>${inProgressRow}${rows}</tbody>
      </table>
    `;
  }

  function dayBadge(label, size = '') {
    if (label === 'record') return ` <span class="run-badge${size} run-badge--record">Рекорд</span>`;
    if (label === 'repeat') return ` <span class="run-badge${size} run-badge--repeat">Повтор</span>`;
    return '';
  }

  function renderTableDays(allRuns) {
    const rows = groupByDay(allRuns).map(d => {
      const lvlBadge = d.levelChanges && d.levelChanges.length
        ? d.levelChanges.map(lv => `<span class="run-badge run-badge--level">→${lv}</span>`).join('')
        : '';
      return `
      <tr>
        <td class="${d.dateClass}">${d.date}</td>
        <td>${d.avgLevel}${lvlBadge ? ' ' + lvlBadge : ''}</td>
        <td class="${d.countClass}">${d.count}</td>
        <td>${d.count ? d.chars : '—'}</td>
        <td>${d.worstErrRun ? fmtErr(d.worstErrRun.errors, d.worstErrRun.chars) : '—'}${dayBadge(d.maxErrLabel, '-sm')}</td>
        <td>${d.avgErrPct !== null ? d.avgErrPct.toFixed(1) + '%' : '—'}${dayBadge(d.avgErrLabel, '-sm')}</td>
        <td>${d.count ? formatTime(d.seconds) : '—'}</td>
        <td>${d.maxCpm !== null ? d.maxCpm + ' зн/мин' : '—'}${dayBadge(d.maxLabel)}</td>
        <td>${d.avgCpm !== null ? d.avgCpm + ' зн/мин' : '—'}${dayBadge(d.avgLabel)}</td>
      </tr>
    `; }).join('');

    return `
      <table class="stats-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Уровень</th>
            <th>Текстов</th>
            <th>Символов</th>
            <th>Ош. макс</th>
            <th>Ош. ср.</th>
            <th>Длительность</th>
            <th>Макс.</th>
            <th>Средняя</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderTable(allRuns, inProgress) {
    const tableWrap = document.getElementById('stats-table-wrap');
    if (!tableWrap) return;
    tableWrap.innerHTML = tableMode === 'days'
      ? renderTableDays(allRuns)
      : renderTableRuns(allRuns, inProgress);

    if (tableMode === 'runs') {
      const reversed = [...allRuns].reverse();
      let runIdx = 0;
      tableWrap.querySelectorAll('tbody tr').forEach(tr => {
        if (tr.classList.contains('row--in-progress')) {
          if (inProgress) {
            tr.classList.add('clickable-row');
            tr.addEventListener('click', () => showRunDetail(inProgress));
          }
          return;
        }
        const idx = runIdx++;
        tr.classList.add('clickable-row');
        tr.addEventListener('click', () => showRunDetail(reversed[idx]));
        const rb = tr.querySelector('.btn-replay-run');
        if (rb) rb.addEventListener('click', e => { e.stopPropagation(); showReplay(reversed[idx]); });
      });
    }

    if (tableMode === 'days') {
      const dayRows = groupByDay(allRuns);
      tableWrap.querySelectorAll('tbody tr').forEach((tr, i) => {
        if (!dayRows[i] || dayRows[i].count === 0) return;
        tr.classList.add('clickable-row');
        tr.addEventListener('click', () => {
          const date = dayRows[i].date;
          const dayRuns = allRuns.filter(r => r.date === date);
          showErrorModal(date, buildDetailHtml(dayRuns));
        });
      });
    }
  }

  // ── Interval map helpers ───────────────────────────────────

  function mergeIntervalMaps(runsArray) {
    const merged = {};
    for (const run of runsArray) {
      if (!run.intervalMap) continue;
      for (const [k, v] of Object.entries(run.intervalMap)) {
        merged[k] = (merged[k] || 0) + v;
      }
    }
    return merged;
  }

  function renderIntervalHtml(map) {
    const entries = Object.entries(map);
    if (!entries.length) return '<p class="error-detail-empty">Нет данных об интервалах</p>';

    const total = Object.values(map).reduce((s, v) => s + v, 0);
    const data  = entries.map(([t, count]) => ({ t: Number(t), count, pct: count / total * 100 }));

    // Chart: bars sorted by time (shows distribution shape)
    const byTime  = [...data].sort((a, b) => a.t - b.t);
    const W = 520, H = 110;
    const padL = 30, padR = 8, padT = 10, padB = 24;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const n      = byTime.length;
    const maxPct = Math.max(...byTime.map(d => d.pct));
    const slotW  = plotW / n;
    const barW   = Math.max(2, slotW - 2);

    const bars = byTime.map((d, i) => {
      const x    = padL + i * slotW + (slotW - barW) / 2;
      const barH = maxPct > 0 ? d.pct / maxPct * plotH : 0;
      const y    = padT + plotH - barH;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, barH).toFixed(1)}" rx="2" fill="var(--accent)" opacity="0.8"/>`;
    }).join('');

    const step    = Math.max(1, Math.ceil(n / 8));
    const xLabels = byTime.map((d, i) => {
      if (i % step !== 0 && i !== n - 1) return '';
      const x = padL + i * slotW + slotW / 2;
      return `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#9ca3af">${(d.t / 10).toFixed(1)}</text>`;
    }).join('');

    const yLabel = `<text x="${padL - 3}" y="${(padT + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="#9ca3af">${maxPct.toFixed(0)}%</text>`;

    const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;margin-bottom:10px">
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#e5e7eb" stroke-width="1"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#e5e7eb" stroke-width="1"/>
      ${bars}${xLabels}${yLabel}
    </svg>`;

    // List: sorted by time asc
    const list = byTime
      .map(({ t, count, pct }) => `<div class="interval-row">
        <span class="interval-label">${(t / 10).toFixed(1)}с</span>
        <span class="interval-pct">${Math.round(pct)}% <span class="freq-total">(${count})</span></span>
      </div>`).join('');

    return svg + list;
  }

  // ── Bigram timing helpers ──────────────────────────────────

  function mergeBigramStats(runsArray) {
    const acc = {};  // bigram → { totalMs, count }
    for (const run of runsArray) {
      if (!run.bigramStats) continue;
      for (const [bigram, { avg, count }] of Object.entries(run.bigramStats)) {
        if (!acc[bigram]) acc[bigram] = { totalMs: 0, count: 0 };
        acc[bigram].totalMs += avg * count;
        acc[bigram].count   += count;
      }
    }
    const result = {};
    for (const [bigram, { totalMs, count }] of Object.entries(acc)) {
      result[bigram] = { avg: Math.round(totalMs / count), count };
    }
    return result;
  }

  function renderBigramHtml(bigramStats) {
    const entries = Object.entries(bigramStats)
      .sort(([, a], [, b]) => b.avg - a.avg)
      .slice(0, 30);

    if (!entries.length) return '<p class="error-detail-empty">Недостаточно данных о биграммах</p>';

    const maxAvg = entries[0][1].avg;
    return entries.map(([bigram, { avg, count }]) => {
      const label = bigram.replace(/ /g, '·');
      const secs  = (avg / 1000).toFixed(2);
      return `<div class="interval-row">
        <span class="interval-label">${label}</span>
        <span class="interval-pct">${secs}с&thinsp;<span class="freq-total">(${count})</span></span>
      </div>`;
    }).join('');
  }

  // ── Error frequency helpers ────────────────────────────────

  // Builds { expected → { total, attempts: { char → count } } }
  function buildErrorFreq(runsArray) {
    const freq = {};
    for (const run of runsArray) {
      if (!run.errorsDetail) continue;
      for (const entry of run.errorsDetail) {
        if (!freq[entry.expected]) freq[entry.expected] = { total: 0, attempts: {}, nextChars: new Set() };
        const ef = freq[entry.expected];
        const next1 = entry.word?.[entry.charInWord + 1];
        const next2 = entry.word?.[entry.charInWord + 2];
        for (const a of entry.attempts) {
          ef.total++;
          ef.attempts[a] = (ef.attempts[a] || 0) + 1;
          if (a === next1 || a === next2) ef.nextChars.add(a);
        }
      }
    }
    return freq;
  }

  function renderFreqHtml(freq) {
    const rows = Object.entries(freq)
      .sort(([, a], [, b]) => b.total - a.total);

    if (!rows.length) return '<p class="error-detail-empty">Ошибок нет!</p>';

    const finger = (ch) => (typeof getFinger === 'function' ? getFinger(ch) : '');

    return rows.map(([expected, info]) => {
      const keyLabel = expected === ' ' ? '␣' : expected;
      const ef = finger(expected);
      const attemptsStr = Object.entries(info.attempts)
        .sort(([, a], [, b]) => b - a)
        .map(([ch, cnt]) => {
          const af   = finger(ch);
          const same = ef && af && af === ef;
          const next = info.nextChars?.has(ch);
          const display = ch === ' ' ? '␣' : ch;
          const cls = (same ? 'attempt--same' : 'attempt--diff') + (next ? ' attempt--next' : '');
          return `<span class="${cls}">${display}</span>&nbsp;(${cnt})`;
        }).join(', ');
      return `<div class="error-entry">
        <span class="eword"><b>${keyLabel}</b> <span class="freq-total">(${info.total})</span></span>
        <span class="error-arrow">→</span>
        <span class="error-attempts">${attemptsStr}</span>
      </div>`;
    }).join('');
  }

  function buildDetailHtml(runsArray) {
    const freqHtml    = renderFreqHtml(buildErrorFreq(runsArray));
    const iHtml       = renderIntervalHtml(mergeIntervalMaps(runsArray));
    const bigramHtml  = renderBigramHtml(mergeBigramStats(runsArray));
    return freqHtml
      + '<div class="freq-divider"></div>'
      + '<p class="freq-section-title">Интервалы между нажатиями</p>'
      + iHtml
      + '<div class="freq-divider"></div>'
      + '<p class="freq-section-title">Медленные биграммы (топ-30)</p>'
      + bigramHtml;
  }

  function showErrorModal(title, html) {
    document.getElementById('error-detail-title').textContent = title;
    document.getElementById('error-detail-body').innerHTML = html;
    document.getElementById('error-detail-overlay').classList.remove('hidden');
  }

  // ── Run detail ─────────────────────────────────────────────

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildTextWithErrorsHtml(text, errorPositions, stopAt) {
    const chars = text.split('');
    const parts = chars.map((ch, i) => {
      const disp = ch === ' ' ? '\u00A0' : escHtml(ch);
      if (stopAt !== undefined && i >= stopAt) {
        return `<span class="tx-untyped">${disp}</span>`;
      }
      const errs = errorPositions[i];
      if (!errs || !errs.length) return `<span class="tx-ok">${disp}</span>`;
      const dels = errs.map(e => `<del class="tx-err">${e === ' ' ? '␣' : escHtml(e)}</del>`).join('');
      return `<span class="tx-wrong">${dels}<span class="tx-correct">${disp}</span></span>`;
    });
    if (stopAt !== undefined && stopAt <= chars.length) {
      parts.splice(stopAt, 0, '<span class="tx-stop-marker"></span>');
    }
    return '<div class="run-text-wrap">' + parts.join('') + '</div>';
  }

  function showRunDetail(run) {
    const finger = (ch) => (typeof getFinger === 'function' ? getFinger(ch) : '');
    const title  = `${run.date}  ${run.time ?? ''}  —  ${run.cpm} зн/мин`;

    // For incomplete runs where full text is stored, mark the stop position
    const stopAt = (run.incomplete && run.text && run.text.length > run.chars)
      ? run.chars : undefined;

    const textBlock = run.text
      ? '<p class="freq-section-title">Текст упражнения</p>'
      + buildTextWithErrorsHtml(run.text, run.errorPositions || {}, stopAt)
      + '<div class="freq-divider"></div>'
      : '';

    if (!run.errorsDetail) {
      showErrorModal(title, textBlock + '<p class="error-detail-empty">Данные об ошибках не сохранены (старый заезд)</p>');
      return;
    }

    if (!run.errorsDetail.length) {
      showErrorModal(title, textBlock + '<p class="error-detail-empty">Ошибок нет!</p>');
      return;
    }

    // Per-word list (unique attempts for display)
    const perWord = run.errorsDetail.map(entry => {
      const wordHtml = entry.word.split('').map((ch, i) =>
        i === entry.charInWord
          ? `<span class="eword--error">${ch}</span>`
          : `<span>${ch}</span>`
      ).join('');

      const ef    = finger(entry.expected);
      const next1 = entry.word[entry.charInWord + 1];
      const next2 = entry.word[entry.charInWord + 2];
      const unique = [...new Set(entry.attempts)];
      const attemptsHtml = unique.map(a => {
        const af   = finger(a);
        const same = ef && af && af === ef;
        const next = a === next1 || a === next2;
        const cls  = (same ? 'attempt--same' : 'attempt--diff') + (next ? ' attempt--next' : '');
        return `<span class="${cls}">${a === ' ' ? '␣' : a}</span>`;
      }).join(', ');

      return `<div class="error-entry" data-attempts="${entry.attempts.length}">
        <span class="eword">${wordHtml}</span>
        <span class="error-arrow">→</span>
        <span class="error-attempts">${attemptsHtml}</span>
      </div>`;
    }).join('');

    // Frequency summary for this run
    const freqHtml   = renderFreqHtml(buildErrorFreq([run]));
    const iHtml      = renderIntervalHtml(mergeIntervalMaps([run]));
    const bigramHtml = renderBigramHtml(run.bigramStats || {});

    showErrorModal(title, textBlock
      + '<p class="freq-section-title">Ошибки по словам <button id="btn-filter-frequent" class="filter-btn">Частые</button></p>'
      + `<div id="per-word-list">${perWord}</div>`
      + '<div class="freq-divider"></div>'
      + '<p class="freq-section-title">Сводка по клавишам</p>'
      + freqHtml
      + '<div class="freq-divider"></div>'
      + '<p class="freq-section-title">Интервалы между нажатиями</p>'
      + iHtml
      + '<div class="freq-divider"></div>'
      + '<p class="freq-section-title">Медленные биграммы (топ-30)</p>'
      + bigramHtml);

    const filterBtn = document.getElementById('btn-filter-frequent');
    if (filterBtn) {
      const container    = document.getElementById('per-word-list');
      const entries      = [...container.querySelectorAll('.error-entry[data-attempts]')];
      const originalOrder = [...entries];

      filterBtn.addEventListener('click', () => {
        const active = filterBtn.classList.toggle('filter-btn--active');
        if (active) {
          [...entries]
            .sort((a, b) => parseInt(b.dataset.attempts) - parseInt(a.dataset.attempts))
            .forEach(el => container.appendChild(el));
          entries.forEach(el => {
            el.style.display = parseInt(el.dataset.attempts) < 2 ? 'none' : '';
          });
        } else {
          originalOrder.forEach(el => { el.style.display = ''; container.appendChild(el); });
        }
      });
    }
  }

  function buildCharts(allRuns, fromIso, toIso) {
    if (allRuns.length < 2) return '';

    const W = 760, H = 240;
    const padL = 46, padR = 46, padT = 16, padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const n = allRuns.length;

    function xPos(i) { return padL + (n === 1 ? plotW / 2 : i / (n + 9) * plotW); }
    function yScale(v, maxV) { return padT + plotH - (maxV ? v / maxV * plotH : plotH / 2); }

    const cpms    = allRuns.map(r => r.cpm);
    const cpmMaxes = allRuns.map(r => r.cpmMax ?? null);
    const cpmMins  = allRuns.map(r => r.cpmMin  ?? null);
    const hasDayLines = cpmMaxes.some(v => v !== null);
    const errs = allRuns.map(r => (r.errors != null && r.chars) ? r.errors / r.chars * 100 : null);
    const maxCpm = Math.max(...cpms) || 1;
    const maxCpmScale = hasDayLines
      ? Math.max(...cpms, ...cpmMaxes.filter(v => v !== null)) || 1
      : maxCpm;
    const maxErr = Math.max(...errs.filter(v => v !== null)) || 1;

    // Draws a line+dots wrapped in <g>, skipping null values
    // tips: tooltip strings per run; records: 'record'|'' per run
    function lineGroup(values, maxV, color, groupId, tips, records, hidden = false) {
      const dots = [];
      const segments = [];
      let seg = [];
      for (let i = 0; i < values.length; i++) {
        if (values[i] === null) {
          if (seg.length) { segments.push(seg); seg = []; }
        } else {
          const x = xPos(i).toFixed(1), y = yScale(values[i], maxV).toFixed(1);
          seg.push(`${x},${y}`);
          const tip = tips ? tips[i].replace(/"/g, '&quot;') : '';
          const isRecord = records && records[i] === 'record';
          dots.push(`<circle cx="${x}" cy="${y}" r="${isRecord ? 6 : 4}" fill="${color}" data-tip="${tip}" style="cursor:pointer"/>`);
          if (isRecord) dots.push(
            `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="10" fill="#fbbf24" style="pointer-events:none">★</text>`
          );
        }
      }
      if (seg.length) segments.push(seg);
      const polylines = segments.map(s => `<polyline points="${s.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`).join('');
      return `<g id="${groupId}"${hidden ? ' style="display:none"' : ''}>${polylines}${dots.join('')}</g>`;
    }

    const tips = allRuns.map((r, i) => {
      const errStr = (r.errors != null && r.chars) ? `${r.errors} (${(r.errors / r.chars * 100).toFixed(1)}%)` : '—';
      const base = r._count
        ? `${r.date} · ${r._count} заездов`
          + (r.cpmMax != null ? `\nМакс.: ${r.cpmMax} зн/мин` : '')
          + `\nСредняя: ${r.cpm} зн/мин`
          + (r.cpmMin != null ? `\nМин.: ${r.cpmMin} зн/мин` : '')
          + (r.errPctMax != null ? `\nОшибок макс.: ${r.errPctMax.toFixed(1)}%` : '')
          + `\nОшибок ср.: ${errStr}`
          + (r.errPctMin != null ? `\nОшибок мин.: ${r.errPctMin.toFixed(1)}%` : '')
        : `#${i + 1} · ${r.date} ${r.time ?? ''}\nУровень ${r.level ?? '—'} · ${r.cpm} зн/мин\nОшибок: ${errStr} · ${formatTime(r.seconds)}`;
      return base;
    });
    const cpmRecords    = computeRecords(allRuns);
    const cpmMaxRecords = hasDayLines ? computeRecords(allRuns.map(r => ({ cpm: r.cpmMax ?? 0 }))) : null;
    const cpmMinRecords = hasDayLines ? computeRecords(allRuns.map(r => ({ cpm: r.cpmMin ?? 0 }))) : null;
    const errRecords = computeErrorRecords(allRuns);
    const lvlChanges = computeLevelChanges(allRuns);

    // Rolling 5-run average
    const cpmRolling5 = cpms.map((_, i) =>
      i >= 4 ? Math.round((cpms[i] + cpms[i-1] + cpms[i-2] + cpms[i-3] + cpms[i-4]) / 5) : null
    );
    const rolling5Records = (() => {
      const out = new Array(n).fill('');
      let maxV = -1;
      for (let i = 0; i < n; i++) {
        if (cpmRolling5[i] === null) continue;
        if (cpmRolling5[i] > maxV) { out[i] = 'record'; maxV = cpmRolling5[i]; }
        else if (cpmRolling5[i] === maxV) out[i] = 'repeat';
      }
      return out;
    })();
    function fmtDateRange(a, b) {
      const [d1, m1, y1] = a.split('.');
      const [d2, m2, y2] = b.split('.');
      if (a === b)           return a;
      if (m1 === m2 && y1 === y2) return `${d1}–${d2}.${m2}.${y2}`;
      if (y1 === y2)         return `${d1}.${m1}–${d2}.${m2}.${y2}`;
      return `${a}–${b}`;
    }
    const rolling5Tips = allRuns.map((_, i) =>
      cpmRolling5[i] !== null
        ? `Среднее 5 заездов (${i - 3}–${i + 1}, ${fmtDateRange(allRuns[i - 4].date, allRuns[i].date)}): ${cpmRolling5[i]} зн/мин`
        : ''
    );

    // Vertical dividers for level transitions
    const levelDividers = lvlChanges.map((lc, i) => {
      if (lc == null) return '';
      const x = xPos(i).toFixed(1);
      return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3,3" opacity="0.7"/>
              <text x="${(parseFloat(x) + 3).toFixed(1)}" y="${(padT + 11).toFixed(1)}" font-size="9" fill="#b45309">→${lc}</text>`;
    }).join('');

    // Left Y axis (CPM) ticks
    const cpmTicks = [0, Math.round(maxCpmScale / 2), Math.round(maxCpmScale)];
    const leftAxis = cpmTicks.map(t =>
      `<line x1="${padL}" y1="${yScale(t, maxCpmScale).toFixed(1)}" x2="${W - padR}" y2="${yScale(t, maxCpmScale).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
       <text x="${padL - 5}" y="${(yScale(t, maxCpmScale) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#3b82f6">${t}</text>`
    ).join('');

    // Right Y axis (error %) ticks
    const errTicks = [0, parseFloat((maxErr / 2).toFixed(1)), parseFloat(maxErr.toFixed(1))];
    const rightAxis = errTicks.map(t =>
      `<text x="${W - padR + 5}" y="${(yScale(t, maxErr) + 4).toFixed(1)}" text-anchor="start" font-size="10" fill="#ef4444">${t.toFixed(1)}%</text>`
    ).join('');

    // X axis labels
    const xStep = Math.max(1, Math.floor(n / 8));
    const xLabels = cpms.map((_, i) => {
      if (i === 0 || i === n - 1 || i % xStep === 0)
        return `<text x="${xPos(i).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="10" fill="#9ca3af">${i + 1}</text>`;
      return '';
    }).join('') + Array.from({length: 10}, (_, j) => {
      const i = n + j;
      if (j === 0 || j === 9 || i % xStep === 0)
        return `<text x="${xPos(i).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="10" fill="#9ca3af">${i + 1}</text>`;
      return '';
    }).join('');

    // === Day mode: two separate charts ===
    if (hasDayLines) {
      const Hd = 200, padRd = 16;
      const plotWd = W - padL - padRd, plotHd = Hd - padT - padB;
      function yScaleD(v, maxV) { return padT + plotHd - (maxV ? v / maxV * plotHd : plotHd / 2); }

      // Date-based x positioning
      const dayDateMs = allRuns.map(r => +parseRuDate(r.date));
      const minDateMs = dayDateMs[0];
      const maxDateMs = dayDateMs[dayDateMs.length - 1];
      const futureDateMs = maxDateMs + 10 * 86400000;
      function xPosByMs(ms) {
        return padL + (ms - minDateMs) / (futureDateMs - minDateMs) * plotWd;
      }
      const xsData = dayDateMs.map(ms => xPosByMs(ms));

      function lineGroupD(values, maxV, color, groupId, tipsArr, records, hidden, xs) {
        const dots = [], segments = [];
        let seg = [];
        for (let i = 0; i < values.length; i++) {
          if (values[i] === null) {
            if (seg.length) { segments.push(seg); seg = []; }
          } else {
            const x = (xs ? xs[i] : xPosByMs(dayDateMs[i])).toFixed(1), y = yScaleD(values[i], maxV).toFixed(1);
            seg.push(`${x},${y}`);
            const tip = tipsArr ? tipsArr[i].replace(/"/g, '&quot;') : '';
            const isRecord = records && records[i] === 'record';
            dots.push(`<circle cx="${x}" cy="${y}" r="${isRecord ? 6 : 4}" fill="${color}" data-tip="${tip}" style="cursor:pointer"/>`);
            if (isRecord) dots.push(`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="10" fill="#fbbf24" style="pointer-events:none">★</text>`);
          }
        }
        if (seg.length) segments.push(seg);
        const polylines = segments.map(s => `<polyline points="${s.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`).join('');
        return `<g id="${groupId}"${hidden ? ' style="display:none"' : ''}>${polylines}${dots.join('')}</g>`;
      }

      const errMaxes = allRuns.map(r => r.errPctMax ?? null);
      const errMins  = allRuns.map(r => r.errPctMin  ?? null);
      const maxErrAll = Math.max(...[...errs, ...errMaxes, ...errMins].filter(v => v !== null)) || 1;

      const errMaxRecords = computeErrorRecords(allRuns.map(r => ({ errors: r.errPctMax ?? null, chars: r.errPctMax != null ? 100 : 0 })));
      const errMinRecords = computeErrorRecords(allRuns.map(r => ({ errors: r.errPctMin ?? null, chars: r.errPctMin != null ? 100 : 0 })));

      const levelDividersD = lvlChanges.map((lc, i) => {
        if (lc == null) return '';
        const x = xsData[i].toFixed(1);
        return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotHd}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3,3" opacity="0.7"/>
                <text x="${(parseFloat(x) + 3).toFixed(1)}" y="${(padT + 11).toFixed(1)}" font-size="9" fill="#b45309">→${lc}</text>`;
      }).join('');

      // Day trend (avg CPM only, regression on actual day offsets)
      const dayOffsets = dayDateMs.map(ms => (ms - minDateMs) / 86400000);
      const sumXDt  = dayOffsets.reduce((s, v) => s + v, 0);
      const sumX2Dt = dayOffsets.reduce((s, v) => s + v * v, 0);
      const sumYDt  = cpms.reduce((a, b) => a + b, 0);
      const sumXYDt = cpms.reduce((s, v, i) => s + dayOffsets[i] * v, 0);
      const trendBDt = (n * sumXYDt - sumXDt * sumYDt) / (n * sumX2Dt - sumXDt * sumXDt);
      const trendADt = (sumYDt - trendBDt * sumXDt) / n;

      // Forecast dots at +1, +4, +7, +10 days from last data date
      const forecastDaysMsList = [1, 4, 7, 10].map(d => maxDateMs + d * 86400000);
      const forecastVals = forecastDaysMsList.map(ms => trendADt + trendBDt * (ms - minDateMs) / 86400000);
      const maxCpmForecastD = Math.max(maxCpmScale, ...forecastVals);

      const dateFormatter = ms => {
        const d = new Date(ms);
        return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
      };

      const trendDotsDt = forecastDaysMsList.map((ms, k) => {
        const v = forecastVals[k];
        const x = xPosByMs(ms).toFixed(1), y = yScaleD(v, maxCpmForecastD).toFixed(1);
        const tip = `Прогноз ${dateFormatter(ms)}: ${Math.round(v)} зн/мин`.replace(/"/g, '&quot;');
        return `<circle cx="${x}" cy="${y}" r="4" fill="#06b6d4" stroke="#fff" stroke-width="1.5" data-tip="${tip}" style="cursor:pointer"/>`;
      }).join('');

      const trendLineDt = (() => {
        const numPts = 80;
        const pts = Array.from({length: numPts}, (_, i) => {
          const ms = minDateMs + i / (numPts - 1) * (futureDateMs - minDateMs);
          const v = trendADt + trendBDt * (ms - minDateMs) / 86400000;
          return `${xPosByMs(ms).toFixed(1)},${yScaleD(v, maxCpmForecastD).toFixed(1)}`;
        });
        return `<g id="chart-group-trend"><polyline points="${pts.join(' ')}" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linejoin="round" opacity="0.8" stroke-dasharray="6,3"/>${trendDotsDt}</g>`;
      })();

      // X-axis labels: actual dates (DD.MM) at regular intervals + 4 forecast dates
      const stepD = Math.max(1, Math.floor(n / 6));
      const labelMsSet = new Set();
      for (let i = 0; i < n; i += stepD) labelMsSet.add(dayDateMs[i]);
      if (n > 0) labelMsSet.add(dayDateMs[n - 1]);
      forecastDaysMsList.forEach(ms => labelMsSet.add(ms));
      const xLabelsD = [...labelMsSet].sort((a, b) => a - b).map(ms => {
        const x = xPosByMs(ms).toFixed(1);
        return `<text x="${x}" y="${Hd - 5}" text-anchor="middle" font-size="10" fill="#9ca3af">${dateFormatter(ms)}</text>`;
      }).join('');

      const cpmTicksD = [0, Math.round(maxCpmForecastD / 2), Math.round(maxCpmForecastD)];
      const leftAxisCpm = cpmTicksD.map(t =>
        `<line x1="${padL}" y1="${yScaleD(t, maxCpmForecastD).toFixed(1)}" x2="${W - padRd}" y2="${yScaleD(t, maxCpmForecastD).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
         <text x="${padL - 5}" y="${(yScaleD(t, maxCpmForecastD) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#3b82f6">${t}</text>`
      ).join('');

      const errTicksD = [0, parseFloat((maxErrAll / 2).toFixed(1)), parseFloat(maxErrAll.toFixed(1))];
      const leftAxisErr = errTicksD.map(t =>
        `<line x1="${padL}" y1="${yScaleD(t, maxErrAll).toFixed(1)}" x2="${W - padRd}" y2="${yScaleD(t, maxErrAll).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
         <text x="${padL - 5}" y="${(yScaleD(t, maxErrAll) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#3b82f6">${t.toFixed(1)}%</text>`
      ).join('');

      const bordersD = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotHd}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${W - padRd}" y1="${padT}" x2="${W - padRd}" y2="${padT + plotHd}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${padL}" y1="${padT + plotHd}" x2="${W - padRd}" y2="${padT + plotHd}" stroke="#d1d5db" stroke-width="1"/>`;

      return `<div class="chart-date-range">
        <input type="date" id="chart-from" value="${fromIso}" class="chart-date-input">
        <span style="color:var(--text-dim)">—</span>
        <input type="date" id="chart-to" value="${toIso}" class="chart-date-input">
      </div>
      <div class="chart-block">
        <div class="chart-legend">
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-cpm" checked> <span style="color:#3b82f6">● ср. скорость, зн/мин</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-trend" checked> <span style="color:#06b6d4">● тренд</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-cpm-max"> <span style="color:#16a34a">● макс. скорость</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-cpm-min"> <span style="color:#f59e0b">● мин. скорость</span></label>
        </div>
        <svg viewBox="0 0 ${W} ${Hd}" style="width:100%;display:block">
          ${leftAxisCpm}${bordersD}${levelDividersD}
          ${trendLineDt}
          ${lineGroupD(cpmMaxes, maxCpmForecastD, '#16a34a', 'chart-group-cpm-max', tips, cpmMaxRecords, true,  xsData)}
          ${lineGroupD(cpmMins,  maxCpmForecastD, '#f59e0b', 'chart-group-cpm-min', tips, cpmMinRecords, true,  xsData)}
          ${lineGroupD(cpms,     maxCpmForecastD, '#3b82f6', 'chart-group-cpm',     tips, cpmRecords,    false, xsData)}
          ${xLabelsD}
        </svg>
      </div>
      <div class="chart-block">
        <div class="chart-legend">
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-err" checked> <span style="color:#3b82f6">● ср. ошибки, %</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-err-max"> <span style="color:#16a34a">● макс. ошибки</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-err-min"> <span style="color:#f59e0b">● мин. ошибки</span></label>
        </div>
        <svg viewBox="0 0 ${W} ${Hd}" style="width:100%;display:block">
          ${leftAxisErr}${bordersD}
          ${lineGroupD(errMaxes, maxErrAll, '#16a34a', 'chart-group-err-max', tips, errMaxRecords, true,  xsData)}
          ${lineGroupD(errMins,  maxErrAll, '#f59e0b', 'chart-group-err-min', tips, errMinRecords, true,  xsData)}
          ${lineGroupD(errs,     maxErrAll, '#3b82f6', 'chart-group-err',     tips, errRecords,    false, xsData)}
          ${xLabelsD}
        </svg>
      </div>`;
    }

    // === Non-day mode: combined chart ===
    const nn = cpms.length;
    const sumX  = nn * (nn - 1) / 2;
    const sumX2 = (nn - 1) * nn * (2 * nn - 1) / 6;
    const sumY  = cpms.reduce((a, b) => a + b, 0);
    const sumXY = cpms.reduce((s, v, i) => s + i * v, 0);
    const trendB = (nn * sumXY - sumX * sumY) / (nn * sumX2 - sumX * sumX);
    const trendA = (sumY - trendB * sumX) / nn;
    const trendVals = Array.from({length: n + 10}, (_, i) => trendA + trendB * i);

    const maxCpmForecast = Math.max(maxCpm, ...[n, n+3, n+6, n+9].map(i => trendVals[i]));
    const cpmTicksRun = [0, Math.round(maxCpmForecast / 2), Math.round(maxCpmForecast)];
    const leftAxisRun = cpmTicksRun.map(t =>
      `<line x1="${padL}" y1="${yScale(t, maxCpmForecast).toFixed(1)}" x2="${W - padR}" y2="${yScale(t, maxCpmForecast).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
       <text x="${padL - 5}" y="${(yScale(t, maxCpmForecast) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#3b82f6">${t}</text>`
    ).join('');

    function smoothLine(vals, maxV, color, groupId, dash, extra = '') {
      const pts = vals.map((v, i) => `${xPos(i).toFixed(1)},${yScale(v, maxV).toFixed(1)}`);
      const da = dash ? ` stroke-dasharray="${dash}"` : '';
      return `<g id="${groupId}"><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" opacity="0.8"${da}/>${extra}</g>`;
    }
    const trendDots = [n, n+3, n+6, n+9].map(i => {
      const v = trendVals[i];
      const x = xPos(i).toFixed(1), y = yScale(v, maxCpmForecast).toFixed(1);
      const tip = `Прогноз #${i + 1}: ${Math.round(v)} зн/мин`.replace(/"/g, '&quot;');
      return `<circle cx="${x}" cy="${y}" r="4" fill="#06b6d4" stroke="#fff" stroke-width="1.5" data-tip="${tip}" style="cursor:pointer"/>`;
    }).join('');
    const trendLine = smoothLine(trendVals, maxCpmForecast, '#06b6d4', 'chart-group-trend', '6,3', trendDots);

    return `<div class="chart-block">
      <div class="chart-date-range">
        <input type="date" id="chart-from" value="${fromIso}" class="chart-date-input">
        <span style="color:var(--text-dim)">—</span>
        <input type="date" id="chart-to" value="${toIso}" class="chart-date-input">
      </div>
      <div class="chart-legend">
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-cpm" checked> <span style="color:#3b82f6">● скорость, зн/мин</span></label>
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-trend" checked> <span style="color:#06b6d4">● тренд</span></label>
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-rolling5"> <span style="color:#a855f7">● ср-5, зн/мин</span></label>
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-err" checked> <span style="color:#ef4444">● ошибки, %</span></label>
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">
        ${leftAxisRun}
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${W - padR}" y1="${padT}" x2="${W - padR}" y2="${padT + plotH}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#d1d5db" stroke-width="1"/>
        ${levelDividers}
        ${trendLine}
        ${lineGroup(cpmRolling5, maxCpmForecast, '#a855f7', 'chart-group-rolling5', rolling5Tips, rolling5Records, true)}
        ${lineGroup(cpms, maxCpmForecast, '#3b82f6', 'chart-group-cpm', tips, cpmRecords)}
        ${lineGroup(errs, maxErr, '#ef4444', 'chart-group-err', tips, errRecords)}
        ${rightAxis}
        ${xLabels}
      </svg>
    </div>`;
  }

  function renderStats(allRuns) {
    const summaryEl = document.getElementById('stats-summary');
    const tableWrap = document.getElementById('stats-table-wrap');

    if (!summaryEl || !tableWrap) return;

    const lastRun    = allRuns[allRuns.length - 1];
    // A run is truly incomplete only if it hasn't reached totalChars
    const trulyIncomplete = r => r.incomplete && (!r.totalChars || r.chars < r.totalChars);
    const inProgress = lastRun && trulyIncomplete(lastRun) ? lastRun : null;

    allRuns = allRuns.filter(r => !trulyIncomplete(r));

    const chartsEl = document.getElementById('stats-charts');

    const sizeElEarly = document.getElementById('storage-size');
    if (sizeElEarly) {
      const raw = localStorage.getItem('klavagonki_stats') || '';
      const kb  = Math.round(raw.length * 2 / 1024);
      const pct = Math.round(raw.length * 2 / (5 * 1024 * 1024) * 100);
      sizeElEarly.textContent = `${kb} КБ / ~5 МБ (${pct}%)`;
    }

    if (!allRuns.length) {
      summaryEl.innerHTML = '<p style="color:var(--text-dim);font-size:0.9rem">Заездов пока нет.</p>';
      if (chartsEl) chartsEl.innerHTML = '';
      tableWrap.innerHTML = '';
      return;
    }

    if (chartsEl) {
      const complete = allRuns;  // already filtered by !incomplete in renderStats
      const allDates = complete.map(r => ruToIso(r.date));
      const minIso = allDates[0];
      const maxIso = allDates[allDates.length - 1];

      function renderCharts(fromIso, toIso) {
        chartFromIso = fromIso;
        chartToIso   = toIso;
        const displayed = complete.filter(r => {
          const iso = ruToIso(r.date);
          return iso >= fromIso && iso <= toIso;
        });
        const src = displayed.length >= 2 ? displayed : complete;

        // Aggregate by day when in days mode
        let chartRuns = src;
        if (tableMode === 'days') {
          const dayMap = {};
          for (const r of src) {
            if (!dayMap[r.date]) dayMap[r.date] = [];
            dayMap[r.date].push(r);
          }
          chartRuns = Object.entries(dayMap)
            .sort(([a], [b]) => parseRuDate(a) - parseRuDate(b))
            .map(([date, dayRuns]) => ({
              date,
              time: '',
              level: Math.round(dayRuns.reduce((s, r) => s + (r.level || 0), 0) / dayRuns.length),
              cpm:    Math.round(dayRuns.reduce((s, r) => s + r.cpm, 0) / dayRuns.length),
              cpmMax: Math.max(...dayRuns.map(r => r.cpm)),
              cpmMin: Math.min(...dayRuns.map(r => r.cpm)),
              errors: dayRuns.every(r => r.errors != null)
                ? Math.round(dayRuns.reduce((s, r) => s + r.errors, 0) / dayRuns.length)
                : null,
              chars:  Math.round(dayRuns.reduce((s, r) => s + r.chars, 0) / dayRuns.length),
              errPctMax: (() => {
                const v = dayRuns.filter(r => r.errors != null && r.chars);
                return v.length ? Math.max(...v.map(r => r.errors / r.chars * 100)) : null;
              })(),
              errPctMin: (() => {
                const v = dayRuns.filter(r => r.errors != null && r.chars);
                return v.length ? Math.min(...v.map(r => r.errors / r.chars * 100)) : null;
              })(),
              seconds: dayRuns.reduce((s, r) => s + r.seconds, 0),
              _count: dayRuns.length,
            }));
        }

        chartsEl.innerHTML = buildCharts(chartRuns, fromIso, toIso);

        const togCpm    = document.getElementById('chart-toggle-cpm');
        const togErr    = document.getElementById('chart-toggle-err');
        const togCpmMax = document.getElementById('chart-toggle-cpm-max');
        const togCpmMin = document.getElementById('chart-toggle-cpm-min');
        if (togCpm) togCpm.addEventListener('change', () => {
          const g = document.getElementById('chart-group-cpm');
          if (g) g.style.display = togCpm.checked ? '' : 'none';
        });
        if (togErr) togErr.addEventListener('change', () => {
          const g = document.getElementById('chart-group-err');
          if (g) g.style.display = togErr.checked ? '' : 'none';
        });
        if (togCpmMax) togCpmMax.addEventListener('change', () => {
          const g = document.getElementById('chart-group-cpm-max');
          if (g) g.style.display = togCpmMax.checked ? '' : 'none';
        });
        if (togCpmMin) togCpmMin.addEventListener('change', () => {
          const g = document.getElementById('chart-group-cpm-min');
          if (g) g.style.display = togCpmMin.checked ? '' : 'none';
        });
        const togTrend = document.getElementById('chart-toggle-trend');
        if (togTrend) togTrend.addEventListener('change', () => {
          const g = document.getElementById('chart-group-trend');
          if (g) g.style.display = togTrend.checked ? '' : 'none';
        });
        const togRolling5 = document.getElementById('chart-toggle-rolling5');
        if (togRolling5) togRolling5.addEventListener('change', () => {
          const g = document.getElementById('chart-group-rolling5');
          if (g) g.style.display = togRolling5.checked ? '' : 'none';
        });
        const togErrMax = document.getElementById('chart-toggle-err-max');
        const togErrMin = document.getElementById('chart-toggle-err-min');
        if (togErrMax) togErrMax.addEventListener('change', () => {
          const g = document.getElementById('chart-group-err-max');
          if (g) g.style.display = togErrMax.checked ? '' : 'none';
        });
        if (togErrMin) togErrMin.addEventListener('change', () => {
          const g = document.getElementById('chart-group-err-min');
          if (g) g.style.display = togErrMin.checked ? '' : 'none';
        });

        const fromEl = document.getElementById('chart-from');
        const toEl   = document.getElementById('chart-to');
        if (fromEl) { fromEl.min = minIso; fromEl.max = maxIso; }
        if (toEl)   { toEl.min   = minIso; toEl.max   = maxIso; }
        if (fromEl) fromEl.addEventListener('change', () => renderCharts(fromEl.value, toEl?.value || maxIso));
        if (toEl)   toEl.addEventListener('change',   () => renderCharts(fromEl?.value || minIso, toEl.value));

        let tip = document.getElementById('chart-tooltip');
        if (!tip) {
          tip = document.createElement('div');
          tip.id = 'chart-tooltip';
          tip.className = 'chart-tooltip';
          document.body.appendChild(tip);
        }
        chartsEl.querySelectorAll('svg').forEach(svg => {
          svg.addEventListener('mouseover', e => {
            const el = e.target.closest('[data-tip]');
            if (!el) return;
            tip.textContent = '';
            el.dataset.tip.split('\n').forEach((line, i) => {
              if (i) tip.appendChild(document.createElement('br'));
              tip.appendChild(document.createTextNode(line));
            });
            tip.classList.add('visible');
          });
          svg.addEventListener('mousemove', e => {
            tip.style.left = (e.clientX + 12) + 'px';
            tip.style.top  = (e.clientY - 48) + 'px';
          });
          svg.addEventListener('mouseout', e => {
            if (!e.target.closest('[data-tip]')) return;
            tip.classList.remove('visible');
          });
        });
      }

      renderChartsNow = () => renderCharts(chartFromIso || minIso, chartToIso || maxIso);
      renderCharts(minIso, maxIso);
    }

    const today       = todayStr();
    const lastDate    = allRuns[allRuns.length - 1]?.date;
    const lastDayRuns = lastDate ? allRuns.filter(r => r.date === lastDate) : [];
    const lastDayLabel = lastDate === today ? 'Сегодня'
      : lastDate === (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('ru-RU'); })() ? 'Вчера'
      : lastDate;
    const last5R    = last5Runs(allRuns);
    const allCpm     = allRuns.map(r => r.cpm);
    const lastDayCpm = lastDayRuns.map(r => r.cpm);
    const last5Cpm  = last5R.map(r => r.cpm);

    summaryEl.innerHTML = `
      <div class="summary-group clickable-card" data-period="all">
        <div class="summary-group-title">За всё время</div>
        <div class="summary-row">
          <div class="summary-item">
            <span class="summary-label">Макс. скорость</span>
            <span class="summary-value">${max(allCpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Средняя скорость</span>
            <span class="summary-value">${avg(allCpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Заездов</span>
            <span class="summary-value">${allRuns.length}</span>
          </div>
        </div>
      </div>
      ${last5R.length > 1 ? `
      <div class="summary-group clickable-card" data-period="last5">
        <div class="summary-group-title">Последние ${last5R.length}</div>
        <div class="summary-row">
          <div class="summary-item">
            <span class="summary-label">Макс. скорость</span>
            <span class="summary-value">${max(last5Cpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Средняя скорость</span>
            <span class="summary-value">${avg(last5Cpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Заездов</span>
            <span class="summary-value">${last5R.length}</span>
          </div>
        </div>
      </div>` : ''}
      ${lastDayRuns.length ? `
      <div class="summary-group clickable-card" data-period="lastday">
        <div class="summary-group-title">${lastDayLabel}</div>
        <div class="summary-row">
          <div class="summary-item">
            <span class="summary-label">Макс. скорость</span>
            <span class="summary-value">${max(lastDayCpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Средняя скорость</span>
            <span class="summary-value">${avg(lastDayCpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Заездов</span>
            <span class="summary-value">${lastDayRuns.length}</span>
          </div>
        </div>
      </div>` : ''}
    `;

    // Click summary cards to show aggregated error frequency
    summaryEl.querySelectorAll('.clickable-card').forEach(card => {
      card.addEventListener('click', () => {
        const period = card.dataset.period;
        let subset, label;
        if (period === 'all')     { subset = allRuns;      label = 'За всё время'; }
        if (period === 'last5')  { subset = last5R;      label = `Последние ${last5R.length}`; }
        if (period === 'lastday') { subset = lastDayRuns;  label = lastDayLabel; }
        showErrorModal(label, buildDetailHtml(subset));
      });
    });

    renderTable(allRuns, inProgress);

  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function getTodayRunCount() {
    const today = todayStr();
    return runs.filter(r => r.date === today && !r.lazy && !r.incomplete).length;
  }

  function getRecentAvgCpm() {
    const recent = last5Runs(runs.filter(r => !r.incomplete));
    if (!recent.length) return 0;
    return Math.round(recent.reduce((s, r) => s + r.cpm, 0) / recent.length);
  }

  return { init, saveRun, renderStats, formatTime, getRecentAvgCpm, getRecordLabel, getTodayRunCount };
})();
