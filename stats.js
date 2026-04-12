// ============================================================
// stats.js — run statistics storage and display
// Storage: localStorage. Export to .txt available on demand.
// ============================================================

const Stats = (() => {
  const LS_KEY = 'klavagonki_stats';

  let runs = [];  // all loaded run records

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

  function weekRuns(allRuns) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    cutoff.setHours(0, 0, 0, 0);
    return allRuns.filter(r => r.date && parseRuDate(r.date) >= cutoff);
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

  // ── Public API ─────────────────────────────────────────────

  async function init() {
    const btnExport = document.getElementById('btn-export-stats');
    btnExport.addEventListener('click', exportTxt);

    runs = lsRead();
    renderStats(runs);
  }

  /**
   * Saves one completed run.
   * @param {{ level: number, chars: number, seconds: number, cpm: number, errors: number }} record
   */
  async function saveRun(record) {
    const entry = {
      date:    new Date().toLocaleDateString('ru-RU'),
      time:    new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      level:   record.level,
      chars:   record.chars,
      errors:  record.errors,
      seconds: record.seconds,
      cpm:     record.cpm,
    };

    runs.push(entry);
    lsWrite(runs);
    renderStats(runs);
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

    const today      = todayStr();
    const todayRuns  = allRuns.filter(r => r.date === today);
    const weekR      = weekRuns(allRuns);
    const allCpm     = allRuns.map(r => r.cpm);
    const todCpm     = todayRuns.map(r => r.cpm);
    const weekCpm    = weekR.map(r => r.cpm);

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
      ${weekR.length ? `
      <div class="summary-group">
        <div class="summary-group-title">За неделю</div>
        <div class="summary-row">
          <div class="summary-item">
            <span class="summary-label">Средняя скорость</span>
            <span class="summary-value">${avg(weekCpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Заездов</span>
            <span class="summary-value">${weekR.length}</span>
          </div>
        </div>
      </div>` : ''}
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
        <td>${r.errors ?? '—'}</td>
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
            <th>Ошибок</th>
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

  function getWeekAvgCpm() {
    const wr = weekRuns(runs);
    if (!wr.length) return 0;
    return Math.round(wr.reduce((s, r) => s + r.cpm, 0) / wr.length);
  }

  return { init, saveRun, renderStats, formatTime, getWeekAvgCpm };
})();
