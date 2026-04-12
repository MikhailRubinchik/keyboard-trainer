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
      errorsDetail: record.errorsDetail || [],
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
        errors:   dayRuns.reduce((s, r) => s + (r.errors ?? 0), 0),
        seconds:  dayRuns.reduce((s, r) => s + r.seconds, 0),
        avgCpm:   dayRuns.length ? avg(dayRuns.map(r => r.cpm)) : null,
      });
    }

    // Color flags + record labels — computed on oldest-first array
    let maxDayCpm = -1;
    rows.forEach((row, i) => {
      const yellow = row.count >= 5;
      const green  = yellow && i >= 4 &&
        rows[i - 1].count >= 5 &&
        rows[i - 2].count >= 5 &&
        rows[i - 3].count >= 5 &&
        rows[i - 4].count >= 5;
      row.dateClass  = green ? 'cell--green' : yellow ? 'cell--yellow' : '';
      row.countClass = row.count >= 10 ? 'cell--green' : '';

      if (i > 0 && row.avgCpm !== null) {
        if (row.avgCpm > maxDayCpm)       row.recordLabel = 'record';
        else if (row.avgCpm === maxDayCpm) row.recordLabel = 'repeat';
        else                               row.recordLabel = '';
      } else {
        row.recordLabel = '';
      }
      if (row.avgCpm !== null && row.avgCpm > maxDayCpm) maxDayCpm = row.avgCpm;
    });

    return rows.reverse();  // newest first for display
  }

  function computeRecords(allRuns) {
    // Returns parallel array of '' | 'record' | 'repeat' (chronological order)
    let maxCpm = -1;
    return allRuns.map((r, i) => {
      let label = '';
      if (i > 0) {
        if (r.cpm > maxCpm)        label = 'record';
        else if (r.cpm === maxCpm) label = 'repeat';
      }
      if (r.cpm > maxCpm) maxCpm = r.cpm;
      return label;
    });
  }

  function computeErrorRecords(allRuns) {
    // Fewer errors = better. Returns parallel array '' | 'record' | 'repeat'
    let minErrors = Infinity;
    return allRuns.map((r, i) => {
      const e = r.errors ?? 0;
      let label = '';
      if (i > 0) {
        if (e < minErrors)      label = 'record';
        else if (e === minErrors) label = 'repeat';
      }
      if (e < minErrors) minErrors = e;
      return label;
    });
  }

  function getRecordLabel(cpm) {
    // Call BEFORE saving the new run so `runs` still reflects history
    if (!runs.length) return '';
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
      return `
      <tr>
        <td>${r.date}</td>
        <td>${r.time}</td>
        <td>${r.level ?? r.exercise ?? '—'}</td>
        <td>${r.chars}</td>
        <td>${r.errors ?? '—'}${errBadge}</td>
        <td>${formatTime(r.seconds)}</td>
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

  function renderTableDays(allRuns) {
    const rows = groupByDay(allRuns).map(d => `
      <tr>
        <td class="${d.dateClass}">${d.date}</td>
        <td>${d.avgLevel}</td>
        <td class="${d.countClass}">${d.count}</td>
        <td>${d.count ? d.chars : '—'}</td>
        <td>${d.count ? d.errors : '—'}</td>
        <td>${d.count ? formatTime(d.seconds) : '—'}</td>
        <td>${d.avgCpm !== null ? d.avgCpm + ' зн/мин' : '—'}${d.recordLabel === 'record' ? ' <span class="run-badge run-badge--record">Рекорд</span>' : d.recordLabel === 'repeat' ? ' <span class="run-badge run-badge--repeat">Повтор</span>' : ''}</td>
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
            <th>Ошибок</th>
            <th>Длительность</th>
            <th>Скорость</th>
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
          showErrorModal(date, renderFreqHtml(buildErrorFreq(dayRuns)));
        });
      });
    }
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

  function showErrorModal(title, html) {
    document.getElementById('error-detail-title').textContent = title;
    document.getElementById('error-detail-body').innerHTML = html;
    document.getElementById('error-detail-overlay').classList.remove('hidden');
  }

  // ── Run detail ─────────────────────────────────────────────

  function showRunDetail(run) {
    const finger = (ch) => (typeof getFinger === 'function' ? getFinger(ch) : '');

    let html = '';

    if (!run.errorsDetail) {
      html = '<p class="error-detail-empty">Данные об ошибках не сохранены (старый заезд)</p>';
      showErrorModal(`${run.date}  ${run.time ?? ''}  —  ${run.cpm} зн/мин`, html);
      return;
    }

    if (!run.errorsDetail.length) {
      showErrorModal(`${run.date}  ${run.time ?? ''}  —  ${run.cpm} зн/мин`,
        '<p class="error-detail-empty">Ошибок нет!</p>');
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
    const freq = buildErrorFreq([run]);
    const freqHtml = renderFreqHtml(freq);

    html = perWord
      + '<div class="freq-divider"></div>'
      + '<p class="freq-section-title">Сводка по клавишам</p>'
      + freqHtml;

    showErrorModal(`${run.date}  ${run.time ?? ''}  —  ${run.cpm} зн/мин`, html);
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
      ${weekR.length ? `
      <div class="summary-group clickable-card" data-period="week">
        <div class="summary-group-title">За неделю</div>
        <div class="summary-row">
          <div class="summary-item">
            <span class="summary-label">Макс. скорость</span>
            <span class="summary-value">${max(weekCpm)} зн/мин</span>
          </div>
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
        if (period === 'all')   { subset = allRuns;    label = 'За всё время'; }
        if (period === 'week')  { subset = weekR;      label = 'За неделю'; }
        if (period === 'today') { subset = todayRuns;  label = 'Сегодня'; }
        showErrorModal(label, renderFreqHtml(buildErrorFreq(subset)));
      });
    });

    renderTable(allRuns);
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

  return { init, saveRun, renderStats, formatTime, getWeekAvgCpm, getRecordLabel };
})();
