// ============================================================
// stats.js — run statistics storage and display
// Storage: localStorage. Export to .txt available on demand.
// ============================================================

const Stats = (() => {
  const LS_KEY = 'klavagonki_stats';

  let runs = [];   // all loaded run records
  let tableMode = 'runs';  // 'runs' | 'days'

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

  function last15Runs(allRuns) {
    return allRuns.slice(-15);
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
    try {
      await gistFetch('PATCH', gistId, token, {
        files: { [GIST_FILE]: { content: serializeRuns(runs) } },
      });
      setSyncStatus('↑ ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      setSyncStatus('↑ Ошибка: ' + e.message, true);
    }
  }

  async function pullFromGist() {
    const { gistId } = getSyncConfig();
    if (!gistId) { setSyncStatus('Укажите ID гиста', true); return; }
    setSyncStatus('Загружаю…');
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
      setSyncStatus(`↓ Загружено ${pulled.length} заездов`);
    } catch (e) {
      setSyncStatus('↓ Ошибка: ' + e.message, true);
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
      renderTable(runs);
    });
    btnDays.addEventListener('click', () => {
      tableMode = 'days';
      btnDays.classList.add('active');
      btnRuns.classList.remove('active');
      renderTable(runs);
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
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyD') { e.preventDefault(); openSyncPanel('daughter'); }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyP') { e.preventDefault(); openSyncPanel('dad'); }
      if (e.key === 'Escape') closeSyncPanel();
    });

    const btnRefresh = document.getElementById('btn-refresh-gist');
    const cfg = getSyncConfig();
    if (cfg.gistId && !cfg.token) btnRefresh.classList.remove('hidden');
    btnRefresh.addEventListener('click', () => pullFromGist());

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
    };

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
        maxErrors: dayRuns.length ? Math.max(...dayRuns.map(r => r.errors ?? 0)) : null,
        avgErrors: dayRuns.length ? avg(dayRuns.map(r => r.errors ?? 0)) : null,
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
    rows.forEach((row, i) => {
      const yellow = row.count >= 5;
      const green  = yellow && i >= 4 &&
        rows[i - 1].count >= 5 &&
        rows[i - 2].count >= 5 &&
        rows[i - 3].count >= 5 &&
        rows[i - 4].count >= 5;
      row.dateClass  = green ? 'cell--green' : yellow ? 'cell--yellow' : '';
      row.countClass = row.count >= 10 ? 'cell--green' : '';

      if (row.avgCpm !== null) {
        row.avgLabel    = row.avgCpm    > maxDayAvg    ? 'record' : row.avgCpm    === maxDayAvg    ? 'repeat' : '';
        row.maxLabel    = row.maxCpm    > maxDayMax    ? 'record' : row.maxCpm    === maxDayMax    ? 'repeat' : '';
        row.avgErrLabel = row.avgErrors < minDayAvgErr ? 'record' : row.avgErrors === minDayAvgErr ? 'repeat' : '';
        row.maxErrLabel = row.maxErrors < minDayMaxErr ? 'record' : row.maxErrors === minDayMaxErr ? 'repeat' : '';
        if (row.avgCpm    > maxDayAvg)    maxDayAvg    = row.avgCpm;
        if (row.maxCpm    > maxDayMax)    maxDayMax    = row.maxCpm;
        if (row.avgErrors < minDayAvgErr) minDayAvgErr = row.avgErrors;
        if (row.maxErrors < minDayMaxErr) minDayMaxErr = row.maxErrors;
      } else {
        row.avgLabel = row.maxLabel = row.avgErrLabel = row.maxErrLabel = '';
      }
    });

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

  function computeErrorRecords(allRuns) {
    // Fewer errors = better. Marks each new chronological minimum as 'record'.
    let minE = Infinity;
    return allRuns.map(r => {
      if (r.errors == null) return '';
      if (r.errors < minE) { minE = r.errors; return 'record'; }
      if (r.errors === minE) return 'repeat';
      return '';
    });
  }

  function getRecordLabel(cpm) {
    // Call BEFORE saving the new run so `runs` still reflects history
    if (!runs.length) return 'record';  // first run ever is always a record
    const maxPrev = Math.max(...runs.map(r => r.cpm));
    if (cpm > maxPrev)      return 'record';
    if (cpm === maxPrev)    return 'repeat';
    return '';
  }

  function renderTableRuns(allRuns) {
    const cpmLabels = computeRecords(allRuns);
    const errLabels = computeErrorRecords(allRuns);
    const rows = [...allRuns].map((r, i) => ({ r, cl: cpmLabels[i], el: errLabels[i] })).reverse().map(({ r, cl, el }) => {
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
      const lazyBadge = r.lazy ? ' <span class="run-badge run-badge--lazy">лень</span>' : '';
      return `
      <tr${r.lazy ? ' class="row--lazy"' : ''}>
        <td>${r.date}</td>
        <td>${r.time}</td>
        <td>${r.level ?? r.exercise ?? '—'}</td>
        <td>${r.chars}</td>
        <td>${r.errors ?? '—'}${errBadge}</td>
        <td>${formatTime(r.seconds)}${lazyBadge}</td>
        <td>${r.cpm} зн/мин${cpmBadge}</td>
      </tr>`;
    }).join('');

    return `
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

  function dayBadge(label, size = '') {
    if (label === 'record') return ` <span class="run-badge${size} run-badge--record">Рекорд</span>`;
    if (label === 'repeat') return ` <span class="run-badge${size} run-badge--repeat">Повтор</span>`;
    return '';
  }

  function renderTableDays(allRuns) {
    const rows = groupByDay(allRuns).map(d => `
      <tr>
        <td class="${d.dateClass}">${d.date}</td>
        <td>${d.avgLevel}</td>
        <td class="${d.countClass}">${d.count}</td>
        <td>${d.count ? d.chars : '—'}</td>
        <td>${d.maxErrors !== null ? d.maxErrors : '—'}${dayBadge(d.maxErrLabel, '-sm')}</td>
        <td>${d.avgErrors !== null ? d.avgErrors : '—'}${dayBadge(d.avgErrLabel, '-sm')}</td>
        <td>${d.count ? formatTime(d.seconds) : '—'}</td>
        <td>${d.maxCpm !== null ? d.maxCpm + ' зн/мин' : '—'}${dayBadge(d.maxLabel)}</td>
        <td>${d.avgCpm !== null ? d.avgCpm + ' зн/мин' : '—'}${dayBadge(d.avgLabel)}</td>
      </tr>
    `).join('');

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

  function renderTable(allRuns) {
    const tableWrap = document.getElementById('stats-table-wrap');
    if (!tableWrap) return;
    tableWrap.innerHTML = tableMode === 'days'
      ? renderTableDays(allRuns)
      : renderTableRuns(allRuns);

    if (tableMode === 'runs') {
      const reversed = [...allRuns].reverse();
      tableWrap.querySelectorAll('tbody tr').forEach((tr, i) => {
        tr.classList.add('clickable-row');
        tr.addEventListener('click', () => showRunDetail(reversed[i]));
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
    const CAP = 50; // tenths → 5 seconds
    const entries = Object.entries(map);
    if (!entries.length) return '<p class="error-detail-empty">Нет данных об интервалах</p>';

    // Bucket everything >= CAP into one entry
    const bucketed = {};
    for (const [k, v] of entries) {
      const t = Math.min(Number(k), CAP);
      bucketed[t] = (bucketed[t] || 0) + v;
    }

    const total = Object.values(bucketed).reduce((s, v) => s + v, 0);

    return Object.entries(bucketed)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([t, count]) => {
        const label = Number(t) >= CAP ? '≥5.0с' : (Number(t) / 10).toFixed(1) + 'с';
        const pct = Math.round(count / total * 100);
        return `<div class="interval-row">
          <span class="interval-label">${label}</span>
          <span class="interval-pct">${pct}%</span>
        </div>`;
      }).join('');
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
        if (!freq[entry.expected]) freq[entry.expected] = { total: 0, attempts: {} };
        const ef = freq[entry.expected];
        for (const a of entry.attempts) {
          ef.total++;
          ef.attempts[a] = (ef.attempts[a] || 0) + 1;
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
          const af = finger(ch);
          const same = ef && af && af === ef;
          const display = ch === ' ' ? '␣' : ch;
          return `<span class="${same ? 'attempt--same' : 'attempt--diff'}">${display}</span>&nbsp;(${cnt})`;
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

  function buildTextWithErrorsHtml(text, errorPositions) {
    return '<div class="run-text-wrap">'
      + text.split('').map((ch, i) => {
          const errs = errorPositions[i];
          const disp = ch === ' ' ? '\u00A0' : escHtml(ch);
          if (!errs || !errs.length) return `<span class="tx-ok">${disp}</span>`;
          const dels = errs.map(e => `<del class="tx-err">${e === ' ' ? '␣' : escHtml(e)}</del>`).join('');
          return `<span class="tx-wrong">${dels}<span class="tx-correct">${disp}</span></span>`;
        }).join('')
      + '</div>';
  }

  function showRunDetail(run) {
    const finger = (ch) => (typeof getFinger === 'function' ? getFinger(ch) : '');
    const title  = `${run.date}  ${run.time ?? ''}  —  ${run.cpm} зн/мин`;

    const textBlock = run.text
      ? '<p class="freq-section-title">Текст упражнения</p>'
      + buildTextWithErrorsHtml(run.text, run.errorPositions || {})
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

      const ef = finger(entry.expected);
      const unique = [...new Set(entry.attempts)];
      const attemptsHtml = unique.map(a => {
        const af = finger(a);
        const same = ef && af && af === ef;
        return `<span class="${same ? 'attempt--same' : 'attempt--diff'}">${a === ' ' ? '␣' : a}</span>`;
      }).join(', ');

      return `<div class="error-entry">
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
      + '<p class="freq-section-title">Ошибки по словам</p>'
      + perWord
      + '<div class="freq-divider"></div>'
      + '<p class="freq-section-title">Сводка по клавишам</p>'
      + freqHtml
      + '<div class="freq-divider"></div>'
      + '<p class="freq-section-title">Интервалы между нажатиями</p>'
      + iHtml
      + '<div class="freq-divider"></div>'
      + '<p class="freq-section-title">Медленные биграммы (топ-30)</p>'
      + bigramHtml);
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
    const last15R    = last15Runs(allRuns);
    const allCpm     = allRuns.map(r => r.cpm);
    const todCpm     = todayRuns.map(r => r.cpm);
    const last15Cpm  = last15R.map(r => r.cpm);

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
      ${last15R.length > 1 ? `
      <div class="summary-group clickable-card" data-period="last15">
        <div class="summary-group-title">Последние ${last15R.length}</div>
        <div class="summary-row">
          <div class="summary-item">
            <span class="summary-label">Макс. скорость</span>
            <span class="summary-value">${max(last15Cpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Средняя скорость</span>
            <span class="summary-value">${avg(last15Cpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Заездов</span>
            <span class="summary-value">${last15R.length}</span>
          </div>
        </div>
      </div>` : ''}
      ${todayRuns.length ? `
      <div class="summary-group clickable-card" data-period="today">
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

    // Click summary cards to show aggregated error frequency
    summaryEl.querySelectorAll('.clickable-card').forEach(card => {
      card.addEventListener('click', () => {
        const period = card.dataset.period;
        let subset, label;
        if (period === 'all')    { subset = allRuns;   label = 'За всё время'; }
        if (period === 'last15') { subset = last15R;   label = `Последние ${last15R.length}`; }
        if (period === 'today')  { subset = todayRuns; label = 'Сегодня'; }
        showErrorModal(label, buildDetailHtml(subset));
      });
    });

    renderTable(allRuns);
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function getTodayRunCount() {
    const today = todayStr();
    return runs.filter(r => r.date === today && !r.lazy).length;
  }

  function getRecentAvgCpm() {
    const recent = last15Runs(runs);
    if (!recent.length) return 0;
    return Math.round(recent.reduce((s, r) => s + r.cpm, 0) / recent.length);
  }

  return { init, saveRun, renderStats, formatTime, getRecentAvgCpm, getRecordLabel, getTodayRunCount };
})();
