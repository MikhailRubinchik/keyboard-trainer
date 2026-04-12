// ============================================================
// stats.js — run statistics storage and display
// Storage format: stats.txt file, one JSON object per line
// Fallback: localStorage when File System Access API is unavailable
// ============================================================

const Stats = (() => {
  const LS_KEY = 'klavagonki_stats';
  const USE_FSA = typeof window.showOpenFilePicker === 'function';

  let fileHandle = null;  // FileSystemFileHandle (only when USE_FSA is true)
  let runs = [];          // all loaded run records

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

  // ── File System Access API ─────────────────────────────────

  async function fsaOpenOrCreate() {
    try {
      // First try to open an existing file
      [fileHandle] = await window.showOpenFilePicker({
        id: 'klavagonki-stats',
        types: [{ description: 'Статистика', accept: { 'text/plain': ['.txt'] } }],
        multiple: false,
      });
    } catch (e) {
      if (e.name === 'AbortError') return false; // user cancelled
      // File not found — create a new one
      try {
        fileHandle = await window.showSaveFilePicker({
          id: 'klavagonki-stats',
          suggestedName: 'stats.txt',
          types: [{ description: 'Статистика', accept: { 'text/plain': ['.txt'] } }],
        });
      } catch (e2) {
        if (e2.name === 'AbortError') return false;
        console.error('Failed to create stats file:', e2);
        return false;
      }
    }
    return true;
  }

  async function fsaRead() {
    if (!fileHandle) return [];
    const file = await fileHandle.getFile();
    const text = await file.text();
    return parseLines(text);
  }

  async function fsaWrite(runArray) {
    if (!fileHandle) return;
    const writable = await fileHandle.createWritable();
    await writable.write(serializeRuns(runArray));
    await writable.close();
  }

  // ── localStorage fallback ──────────────────────────────────

  function lsRead() {
    const raw = localStorage.getItem(LS_KEY) || '';
    return parseLines(raw);
  }

  function lsWrite(runArray) {
    localStorage.setItem(LS_KEY, serializeRuns(runArray));
  }

  function lsExport() {
    const content = serializeRuns(runs);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stats.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Initialises stats: loads existing data.
   * With FSA: shows the "open file" button.
   * Without FSA: reads from localStorage immediately.
   */
  async function init() {
    const btnOpen   = document.getElementById('btn-open-stats');
    const btnExport = document.getElementById('btn-export-stats');

    if (!USE_FSA) {
      // localStorage mode: hide open button, show export
      btnOpen.classList.add('hidden');
      btnExport.classList.remove('hidden');
      btnExport.addEventListener('click', lsExport);
      runs = lsRead();
      renderStats(runs);
      return;
    }

    // File System Access API
    btnOpen.addEventListener('click', async () => {
      const ok = await fsaOpenOrCreate();
      if (!ok) return;
      runs = await fsaRead();
      renderStats(runs);
      btnOpen.textContent = '✓ Файл открыт';
      btnOpen.disabled = true;
    });

    // Pre-load from localStorage as a temporary buffer
    runs = lsRead();
    renderStats(runs);
  }

  /**
   * Saves one completed run.
   * @param {{ level: number, chars: number, seconds: number, cpm: number }} record
   */
  async function saveRun(record) {
    const entry = {
      date:    new Date().toLocaleDateString('ru-RU'),
      time:    new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      level:   record.level,
      chars:   record.chars,
      seconds: record.seconds,
      cpm:     record.cpm,
    };

    runs.push(entry);

    if (USE_FSA && fileHandle) {
      await fsaWrite(runs);
    } else {
      lsWrite(runs);
    }

    renderStats(runs);
  }

  /**
   * Loads and returns all run records.
   */
  async function loadRuns() {
    if (USE_FSA && fileHandle) {
      runs = await fsaRead();
    } else {
      runs = lsRead();
    }
    return runs;
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

  function renderStats(allRuns) {
    const summaryEl = document.getElementById('stats-summary');
    const tableWrap = document.getElementById('stats-table-wrap');

    if (!summaryEl || !tableWrap) return;

    if (!allRuns.length) {
      summaryEl.innerHTML = '<p style="color:var(--text-dim);font-size:0.9rem">Заездов пока нет.</p>';
      tableWrap.innerHTML = '';
      return;
    }

    const today    = todayStr();
    const todayRuns = allRuns.filter(r => r.date === today);
    const allCpm   = allRuns.map(r => r.cpm);
    const todCpm   = todayRuns.map(r => r.cpm);

    summaryEl.innerHTML = `
      <div class="summary-group">
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
      ${todayRuns.length ? `
      <div class="summary-group">
        <div class="summary-group-title">Сегодня</div>
        <div class="summary-row">
          <div class="summary-item">
            <span class="summary-label">Макс. скорость</span>
            <span class="summary-value">${max(todCpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Средняя скорость</span>
            <span class="summary-value">${avg(todCpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Заездов</span>
            <span class="summary-value">${todayRuns.length}</span>
          </div>
        </div>
      </div>` : ''}
    `;

    // Table — chronological, newest first
    const rows = [...allRuns].reverse().map(r => `
      <tr>
        <td>${r.date}</td>
        <td>${r.time}</td>
        <td>${r.level ?? r.exercise ?? '—'}</td>
        <td>${r.chars}</td>
        <td>${formatTime(r.seconds)}</td>
        <td>${r.cpm} зн/мин</td>
      </tr>
    `).join('');

    tableWrap.innerHTML = `
      <table class="stats-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Время</th>
            <th>Уровень</th>
            <th>Символов</th>
            <th>Длительность</th>
            <th>Скорость</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return { init, saveRun, loadRuns, renderStats, formatTime };
})();
