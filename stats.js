// ============================================================
// stats.js — run statistics storage and display
// Storage: localStorage. Export to .txt available on demand.
// ============================================================

const Stats = (() => {
  const LS_KEY = 'klavagonki_stats';

  let runs = [];   // all loaded run records
  let tableMode = 'runs';  // 'runs' | 'days' | 'weeks'
  let lastInProgress = null; // last incomplete run, updated by renderStats
  let lastFilteredRuns = [];
  let filterTextSets = new Set();
  let filterModes = new Set();
  let filterExternalFeatures = new Set();
  let _seenTextSets = new Set();
  let _seenModes = new Set();
  let _seenExternalFeatures = new Set();

  const _TEXT_SET_NAMES = {1:'Незнайка',2:'Винни-Пух',3:'Знаки',4:'Волшебник',5:'Цифры',6:'Годзилла',7:'Правила'};
  const _MODE_NAMES = {1:'Палец',2:'Символ',3:'Префикс',4:'Слово',5:'Слово+рамка',6:'Рамка',7:'Слепой',8:'П.слепой',9:'придумать название',10:'klavogonki.ru',11:'Префикс+ош'};
  const _EXTERNAL_FEATURE_NAMES = {
    'laptop':               'Ноутбук',
    'laptop-stickers':      'Ноутбук + наклейки',
    'external':             'Внешняя',
    'external-stand':          'Подвеска задвинутая',
    'external-stand-extended': 'Подвеска выдвинутая',
    'external-stand-towel':    'Внешняя на подвеске + полотенце',
  };
  const _EXTERNAL_FEATURE_NUM = {
    'laptop':                  1,
    'laptop-stickers':         2,
    'external':                3,
    'external-stand-extended': 4,
    'external-stand':          5,
    'external-stand-towel':    6,
  };
  function _effectiveMode(r) { return r.mode != null ? r.mode : (r.noFinger ? 2 : 1); }
  let chartFromIso    = '';
  let chartToIso      = '';
  let chartDefaultFrom = ''; // date of run[max(0,n-50)], updated on renderStats
  let renderChartsNow = () => {}; // set after first renderStats
  let replayState = null;

  // ── Utilities ──────────────────────────────────────────────

  // ── Compact format codecs ─────────────────────────────────
  // Ctrl/Alt+Backspace (word-erase) is stored as '⌫⌫' (2 chars) in the
  // keystroke log. In compact form we encode it as a single sentinel char
  // U+2326 (⌦) so that the key string stays one-char-per-keystroke.
  const WORD_ERASE_SENTINEL = '\u2326';

  function encodeKeystrokeLog(log) {
    if (!log || !log.length) return { k: '', d: [] };
    let k = '';
    const d = [];
    for (const [key, delta] of log) {
      k += key === '⌫⌫' ? WORD_ERASE_SENTINEL : key;
      d.push(delta);
    }
    return { k, d };
  }

  function decodeKeystrokeLog(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw; // old format — pass through during migration
    const chars = [...(raw.k || '')];
    const deltas = raw.d || [];
    return chars.map((ch, i) => [ch === WORD_ERASE_SENTINEL ? '⌫⌫' : ch, deltas[i] ?? 0]);
  }

  function encodeErrorsDetail(detail) {
    if (!detail || !detail.length) return [];
    return detail.map(e => [e.word, e.charInWord, e.expected, e.attempts.join('')]);
  }

  function decodeErrorsDetail(raw) {
    if (!raw || !raw.length) return [];
    if (Array.isArray(raw[0])) // new format
      return raw.map(e => ({ word: e[0], charInWord: e[1], expected: e[2], attempts: [...e[3]] }));
    return raw; // old format — pass through during migration
  }

  function encodeBigramStats(stats) {
    if (!stats) return {};
    const out = {};
    for (const [k, v] of Object.entries(stats)) out[k] = [v.avg, v.count];
    return out;
  }

  function decodeBigramStats(raw) {
    if (!raw) return {};
    const entries = Object.entries(raw);
    if (!entries.length) return {};
    if (Array.isArray(entries[0][1])) // new format
      return Object.fromEntries(entries.map(([k, v]) => [k, { avg: v[0], count: v[1] }]));
    return raw; // old format — pass through during migration
  }

  // ── Serialization ─────────────────────────────────────────

  function parseLines(text) {
    return text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        try {
          const r = JSON.parse(l);
          return Object.assign({}, r, {
            keystrokeLog: decodeKeystrokeLog(r.keystrokeLog),
            errorsDetail: decodeErrorsDetail(r.errorsDetail),
            bigramStats:  decodeBigramStats(r.bigramStats),
          });
        } catch { return null; }
      })
      .filter(Boolean);
  }

  function serializeRuns(runArray) {
    return runArray.map(r => JSON.stringify(Object.assign({}, r, {
      keystrokeLog: encodeKeystrokeLog(r.keystrokeLog),
      errorsDetail: encodeErrorsDetail(r.errorsDetail),
      bigramStats:  encodeBigramStats(r.bigramStats),
    }))).join('\n') + '\n';
  }

  function serializeRunsForGist(runArray) {
    return runArray.map(r => JSON.stringify(Object.assign({}, r, {
      keystrokeLog:   encodeKeystrokeLog(r.keystrokeLog),
      errorsDetail:   undefined,
      bigramStats:    undefined,
      intervalMap:    undefined,
      errorPositions: undefined,
    }))).join('\n') + '\n';
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

  function last10Runs(allRuns) {
    return allRuns.slice(-5);
  }

  function calcEma(runsArr) {
    const rs = runsArr.filter(r => !r.incomplete);
    if (!rs.length) return null;
    let ema = 0;
    for (let i = 0; i < rs.length; i++) {
      const n = i + 1;
      const w = n < 50 ? 1 / n : 1 / 50;
      ema = ema + w * (rs[i].cpm - ema);
    }
    return parseFloat(ema.toFixed(1));
  }

  function getRunText(run) {
    if (run.sentenceStart >= 0 && run.sentenceCount > 0) {
      return reconstructText(run.textSet ?? 1, run.sentenceStart, run.sentenceCount);
    }
    return '';
  }

  function lsRead() {
    return parseLines(localStorage.getItem(LS_KEY) || '');
  }

  function lsWrite(runArray) {
    const content = runArray.map(r => JSON.stringify(Object.assign({}, r, {
      keystrokeLog:   encodeKeystrokeLog(r.keystrokeLog),
      errorsDetail:   undefined,
      bigramStats:    undefined,
      intervalMap:    undefined,
      errorPositions: undefined,
    }))).join('\n') + '\n';
    try {
      localStorage.setItem(LS_KEY, content);
    } catch (e) {
      const el = document.getElementById('storage-warning');
      if (el) {
        el.textContent = '🚨 Хранилище переполнено! Заезд НЕ сохранён. Срочно сообщи папе!';
        el.classList.remove('hidden');
      }
    }
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

  const GIST_TOKEN_KEY        = 'klavogonki_gist_token';
  const GIST_ID_KEY           = 'klavogonki_gist_id';
  const GIST_FILE             = 'klavogonki-stats.json';
  const GIST_ACHIEVEMENTS_FILE = 'klavogonki-achievements.json';
  const GIST_HOLIDAYS_FILE    = 'klavogonki-holidays.json';
  const HOLIDAYS_KEY          = 'klavogonki_holidays';

  function getHolidays() {
    try {
      const arr = JSON.parse(localStorage.getItem(HOLIDAYS_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function saveHolidaysLocal(arr) {
    const uniq = [...new Set(arr)].sort();
    localStorage.setItem(HOLIDAYS_KEY, JSON.stringify(uniq));
    return uniq;
  }
  function addHoliday(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    const arr = getHolidays();
    if (arr.includes(iso)) return;
    arr.push(iso);
    saveHolidaysLocal(arr);
    renderHolidaysList();
    renderStats(runs);
    pushToGist({ force: true });
  }
  function removeHoliday(iso) {
    saveHolidaysLocal(getHolidays().filter(x => x !== iso));
    renderHolidaysList();
    renderStats(runs);
    pushToGist({ force: true });
  }
  function renderHolidaysList() {
    const ul = document.getElementById('holidays-list');
    if (!ul) return;
    const arr = getHolidays();
    ul.innerHTML = arr.map(iso => {
      const [y, m, d] = iso.split('-');
      return `<li><span>${d}.${m}.${y}</span><button type="button" class="holiday-remove" data-iso="${iso}" title="Удалить">×</button></li>`;
    }).join('');
    ul.querySelectorAll('.holiday-remove').forEach(b => {
      b.addEventListener('click', () => removeHoliday(b.dataset.iso));
    });
  }

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
    if (!res.ok) {
      let detail = '';
      try {
        const json = await res.json();
        detail = json.message || '';
      } catch {}
      const hints = {
        401: 'токен недействителен или истёк',
        403: 'нет прав; нужен scope: gist',
        404: 'гист не найден или чужой токен',
        422: 'неверный запрос',
      };
      const reason = detail || hints[res.status] || '';
      throw new Error(`GitHub API ${res.status}${reason ? ` — ${reason}` : ''}`);
    }
    return res.json();
  }

  let lastPushMs = 0;
  const PUSH_THROTTLE_MS = 20_000; // не чаще раза в 20 секунд (автоматические пуши)

async function pushToGist({ force = false } = {}) {
    const { token, gistId } = getSyncConfig();
    if (!token || !gistId) return;
    const now = Date.now();
    if (!force && now - lastPushMs < PUSH_THROTTLE_MS) return;
    lastPushMs = now;
    const btn = document.getElementById('btn-push-gist');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Отправляю…'; }
    try {
      const ver = typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown';
      await gistFetch('PATCH', gistId, token, {
        description: `Клавогонки — статистика (${ver})`,
        files: {
          [GIST_FILE]:             { content: serializeRunsForGist(runs) },
          [GIST_ACHIEVEMENTS_FILE]: { content: localStorage.getItem(ACHIEVEMENTS_KEY) || '{}' },
          [GIST_HOLIDAYS_FILE]:    { content: localStorage.getItem(HOLIDAYS_KEY) || '[]' },
        },
      });
      lsWrite(runs); // apply trim to localStorage
      const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setSyncStatus('↑ ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
      setRefreshStatus(`отправлено в ${timeStr}`);
      checkStorageWarning();
    } catch (e) {
      const msg = e.message || String(e);
      setRefreshStatus('↑ ' + msg);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↑ Отправить'; }
    }
  }

  function checkStorageWarning() {
    const el = document.getElementById('storage-warning');
    if (!el) return;
    const raw = localStorage.getItem(LS_KEY) || '';
    const pct = Math.round(raw.length * 2 / (5 * 1024 * 1024) * 100);
    if (pct >= 80) {
      el.textContent = `⚠️ Хранилище заполнено на ${pct}%! Скоро данные перестанут сохраняться. Срочно сообщи папе!`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
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
      let content = file.content;
      if (file.truncated) {
        const rawRes = await fetch(file.raw_url);
        if (!rawRes.ok) throw new Error(`ошибка загрузки raw: ${rawRes.status}`);
        content = await rawRes.text();
      }
      const pulled = parseLines(content);
      // Gist is authoritative on pull: take its version of every entry so
      // mutable fields like externalFeature (which the prefix-skip used to
      // ignore) propagate. Local-only entries past pulled.length were
      // already dropped before; this preserves that behaviour.
      runs = pulled.slice();
      lsWrite(runs);
      const achFile = data.files[GIST_ACHIEVEMENTS_FILE];
      if (achFile) {
        const achContent = achFile.truncated
          ? await (await fetch(achFile.raw_url)).text()
          : achFile.content;
        try {
          JSON.parse(achContent); // validate
          localStorage.setItem(ACHIEVEMENTS_KEY, achContent);
          renderAchievements();
        } catch (_) {}
      }
      const holFile = data.files[GIST_HOLIDAYS_FILE];
      if (holFile) {
        const holContent = holFile.truncated
          ? await (await fetch(holFile.raw_url)).text()
          : holFile.content;
        try {
          const parsed = JSON.parse(holContent);
          if (Array.isArray(parsed)) {
            saveHolidaysLocal(parsed);
            renderHolidaysList();
          }
        } catch (_) {}
      }
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
      checkStorageWarning();
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
        files: {
          [GIST_FILE]:             { content: serializeRuns(runs) },
          [GIST_ACHIEVEMENTS_FILE]: { content: localStorage.getItem(ACHIEVEMENTS_KEY) || '{}' },
          [GIST_HOLIDAYS_FILE]:    { content: localStorage.getItem(HOLIDAYS_KEY) || '[]' },
        },
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

  // ── Derived field recompute (from keystrokeLog + text) ────────

  function recomputeDerivedFields(run) {
    const chars      = [...getRunText(run)];
    const errors     = {};   // pos → { expected, attempts[] }
    let cursor       = 0;
    let wordStart    = 0;
    let wordSoFar    = '';
    let junkBuffer   = '';

    const intervalMap      = {};
    const bigramRaw        = {};   // bigram → [deltaMs, ...]
    let timeAcc            = 0;
    let lastCorrectTimeAcc = null;
    let lastCorrectChar    = null;

    for (const [key, deltaMs] of run.keystrokeLog) {
      if (cursor >= chars.length) break;

      timeAcc += deltaMs;
      const tenths = Math.round(deltaMs / 100);
      if (tenths > 0) intervalMap[tenths] = (intervalMap[tenths] || 0) + 1;

      if (key === '⌫⌫') {
        const sp = junkBuffer.lastIndexOf(' ');
        if (sp >= 0) {
          junkBuffer = junkBuffer.slice(0, sp);
        } else {
          junkBuffer = '';
          cursor    -= wordSoFar.length;
          wordSoFar  = '';
        }
      } else if (key === '⌫') {
        if (junkBuffer.length > 0) {
          junkBuffer = junkBuffer.slice(0, -1);
        } else if (cursor > wordStart) {
          cursor--;
          wordSoFar = wordSoFar.slice(0, -1);
        }
      } else {
        if (junkBuffer.length > 0) {
          junkBuffer += key;
          if (!errors[cursor]) errors[cursor] = { expected: chars[cursor], attempts: [] };
          errors[cursor].attempts.push(key);
        } else {
          const expected = chars[cursor];
          if (key !== expected) {
            junkBuffer += key;
            if (!errors[cursor]) errors[cursor] = { expected, attempts: [] };
            errors[cursor].attempts.push(key);
          } else {
            if (lastCorrectChar !== null) {
              const bigram = lastCorrectChar + expected;
              const delta  = timeAcc - lastCorrectTimeAcc;
              if (!bigramRaw[bigram]) bigramRaw[bigram] = [];
              bigramRaw[bigram].push(delta);
            }
            lastCorrectTimeAcc = timeAcc;
            lastCorrectChar    = expected;
            cursor++;
            if (expected === ' ') { wordStart = cursor; wordSoFar = ''; }
            else                  { wordSoFar += expected; }
          }
        }
      }
    }

    const errorsDetail = Object.entries(errors)
      .filter(([, v]) => v.attempts.length)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([pos, v]) => {
        const p = Number(pos);
        let s = p; while (s > 0 && chars[s - 1] !== ' ') s--;
        let e = p; while (e < chars.length && chars[e] !== ' ') e++;
        return { word: chars.slice(s, e).join(''), charInWord: p - s, expected: v.expected, attempts: v.attempts };
      });

    const errorPositions = {};
    for (const [pos, v] of Object.entries(errors)) {
      const unique = [...new Set(v.attempts)];
      if (unique.length) errorPositions[Number(pos)] = unique;
    }

    const bigramStats = {};
    for (const [bigram, times] of Object.entries(bigramRaw)) {
      const sum = times.reduce((s, t) => s + t, 0);
      bigramStats[bigram] = { avg: Math.round(sum / times.length), count: times.length };
    }

    return { errorsDetail, errorPositions, intervalMap, bigramStats };
  }

  // ── Achievements ───────────────────────────────────────────

  const ACHIEVEMENTS_KEY = 'diana_achievements';

  const ACHIEVEMENTS_SECTIONS = [
    {
      title: 'Майнкрафт',
      items: [
        'Строить башню до облаков в майнкрафте',
        'Найти подземный город на обычной карте',
        'Портал на обычной карте',
        'Строить годзилу в майнкрафте',
        'Найти подводный замок на обычной карте',
      ],
    },
    {
      title: 'Просмотр',
      items: [
        'Смотреть Динозавры (Netflix)',
        'Смотреть Планета динозавров (BBC)',
        'Смотреть Prehistoric Planet — сезон 1 (Apple TV+)',
        'Смотреть Prehistoric Planet — сезон 2 (Apple TV+)',
        'Смотреть Prehistoric Planet: Ice Age — сезон 3 (Apple TV+)',
        'Смотреть Алладина',
        'Смотреть все фильмы из вселенной годзилы и конга (остался конг)',
        'Смотреть все фильмы про парк юрского периода (остался последний)',
        'Прогулки с пещерным человеком',
        'Серию прогулок со всеми (остался Ал)',
        'Прогулки с динозаврами (1999)',
        'Баллада о Большом Але (2000)',
        'В стране гигантов (2002)',
        'Прогулки с морскими чудовищами (2003)',
        'Прогулки с чудовищами (2005)',
        'Прогулки с монстрами: Жизнь до динозавров (2005)',
        'Прогулки с динозаврами 3D (2013)',
        'Прогулки с динозаврами (ремейк 2025)',
        'Погонщики динозавров',
      ],
    },
    {
      title: 'Клавогонки',
      items: [
        'Дойти до рекорда в 100 — режим 2 «Текущий символ»',
        'Дойти до средней в 100 — режим 2 «Текущий символ»',
        'Дойти до рекорда в 100 с наклейками',
        'Дойти до средней в 100 с наклейками',
        'Дойти до рекорда в 100 с подвеской',
        'Дойти до средней в 100 с подвеской',
        'Дойти до рекорда в 100 — режим 3 «Набранный префикс»',
        'Дойти до средней в 100 — режим 3 «Набранный префикс»',
        'Дойти до рекорда в 100 — режим 4 «Слово и ошибки»',
        'Дойти до средней в 100 — режим 4 «Слово и ошибки»',
        'Дойти до рекорда в 100 — режим 5 «Слово и рамка»',
        'Дойти до средней в 100 — режим 5 «Слово и рамка»',
        'Дойти до рекорда в 100 — режим 6 «Только рамка»',
        'Дойти до средней в 100 — режим 6 «Только рамка»',
        'Дойти до рекорда в 100 — режим 7 «Слепой»',
        'Дойти до средней в 100 — режим 7 «Слепой»',
        'Дойти до рекорда в 100 — режим 8 «Полностью слепой»',
        'Дойти до средней в 100 — режим 8 «Полностью слепой»',
        'Дойти до рекорда в 100 на Винни-Пухе',
        'Дойти до средней в 100 на Винни-Пухе',
        'Пройти в клавогонках упражнение из соло на 100',
        'Пройти в клавогонках упражнение из соло с 9 ошибками',
        'Дойти до рекорда в 100 с много знаков препинания',
        'Дойти до средней в 100 с много знаков препинания',
      ],
    },
    {
      title: 'Читать',
      items: [
        'Дочитать Незнайку в Солнечном городе',
        'Дочитать Незнайку на Луне',
        'Дочитать Незнайку на Луне 2',
      ],
    },
    {
      title: 'Накопления',
      items: [
        'Накопить на Т-Rex',
        'Накопить на вкладе 50',
        'Накопить на вкладе 100',
        'Накопить на вкладе 150',
        'Накопить на вкладе 200',
        'Накопить на вкладе 250',
      ],
    },
  ];

  function renderAchievements() {
    const list    = document.getElementById('achievements-list');
    if (!list) return;
    const checked = JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY) || '{}');
    list.innerHTML = '';

    ACHIEVEMENTS_SECTIONS.forEach(section => {
      const header = document.createElement('li');
      header.className = 'achievement-section-header';
      header.textContent = section.title;
      list.appendChild(header);

      const sorted = [...section.items].sort((a, b) => (checked[b] ? 1 : 0) - (checked[a] ? 1 : 0));

      sorted.forEach(text => {
        const li = document.createElement('li');
        li.draggable = true;
        if (checked[text]) li.classList.add('done');

        const box = document.createElement('span');
        box.className = 'achievement-check';
        if (checked[text]) box.textContent = '✓';

        const label = document.createElement('span');
        label.textContent = text;

        li.appendChild(box);
        li.appendChild(label);

        li.addEventListener('click', () => {
          if (!getSyncConfig().token) return;
          const ch = JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY) || '{}');
          ch[text] = !ch[text];
          localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(ch));
          renderAchievements();
        });

        list.appendChild(li);
      });
    });
  }

  function initAchievements() {
    const btn   = document.getElementById('btn-achievements');
    const panel = document.getElementById('achievements-panel');
    renderAchievements();
    btn.addEventListener('click', () => panel.classList.toggle('hidden'));
  }

  // ── Public API ─────────────────────────────────────────────

  async function init() {
    initAchievements();
    const btnExport = document.getElementById('btn-export-stats');
    btnExport.addEventListener('click', exportTxt);

    const chartsEl2 = document.getElementById('stats-charts');
    const btnWide = document.getElementById('btn-chart-wide');
    let chartsWide = localStorage.getItem('klavagonki_charts_wide') === '1';
    if (chartsWide) { chartsEl2.classList.add('charts-wide'); btnWide.classList.add('active'); }
    btnWide.addEventListener('click', () => {
      chartsWide = !chartsWide;
      chartsEl2.classList.toggle('charts-wide', chartsWide);
      btnWide.classList.toggle('active', chartsWide);
      localStorage.setItem('klavagonki_charts_wide', chartsWide ? '1' : '0');
    });

    const btnRuns  = document.getElementById('btn-view-runs');
    const btnDays  = document.getElementById('btn-view-days');
    const btnWeeks = document.getElementById('btn-view-weeks');
    function setViewMode(mode) {
      tableMode = mode;
      btnRuns .classList.toggle('active', mode === 'runs');
      btnDays .classList.toggle('active', mode === 'days');
      if (btnWeeks) btnWeeks.classList.toggle('active', mode === 'weeks');
      chartFromIso = ''; chartToIso = '';
      renderTable(lastFilteredRuns, lastInProgress);
      renderChartsNow();
    }
    btnRuns.addEventListener('click',  () => setViewMode('runs'));
    btnDays.addEventListener('click',  () => setViewMode('days'));
    if (btnWeeks) btnWeeks.addEventListener('click', () => setViewMode('weeks'));

    const overlay = document.getElementById('error-detail-overlay');
    document.getElementById('btn-close-detail').addEventListener('click', () => {
      overlay.classList.add('hidden');
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });

    const speedOverlay = document.getElementById('speed-chart-overlay');
    document.getElementById('btn-close-speed-chart').addEventListener('click', () => {
      speedOverlay.classList.add('hidden');
    });
    speedOverlay.addEventListener('click', (e) => {
      if (e.target === speedOverlay) speedOverlay.classList.add('hidden');
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

    const holInput = document.getElementById('setting-add-holiday');
    const holRow = holInput?.closest('.text-set-row');
    const cfgForHol = getSyncConfig();
    const dadView = cfgForHol.gistId && !cfgForHol.token;
    if (holRow && dadView) holRow.style.display = 'none';
    if (holInput && !dadView) {
      holInput.addEventListener('change', () => {
        if (holInput.value) {
          addHoliday(holInput.value);
          holInput.value = '';
        }
      });
    }
    if (!dadView) renderHolidaysList();

    const btnRefresh = document.getElementById('btn-refresh-gist');
    const btnPush    = document.getElementById('btn-push-gist');
    const cfg0 = getSyncConfig();
    if (cfg0.gistId && !cfg0.token) btnRefresh.classList.remove('hidden');
    if (cfg0.gistId &&  cfg0.token) btnPush.classList.remove('hidden');
    btnRefresh.addEventListener('click', () => pullFromGist());
    btnPush.addEventListener('click', () => pushToGist({ force: true }));


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


    // One-time migration: if localStorage still has old-format keystrokeLog
    // (array-of-arrays), re-serialize everything in compact format and push.
    const rawLs = localStorage.getItem(LS_KEY) || '';
    if (rawLs.includes('"keystrokeLog":[[')) {
      lsWrite(runs);
      pushToGist({ force: true });
    }

    // One-time backfill: runs 102–116 (1-indexed) were typed on a laptop with stickers.
    const MIG_KEY = 'klavagonki_migrations';
    const done = JSON.parse(localStorage.getItem(MIG_KEY) || '[]');
    if (!done.includes('runs-102-116-stickers')) {
      let changed = false;
      for (let i = 101; i <= 115 && i < runs.length; i++) {
        if (!runs[i].externalFeature) {
          runs[i].externalFeature = 'laptop-stickers';
          changed = true;
        }
      }
      if (changed) {
        lsWrite(runs);
        pushToGist({ force: true });
      }
      done.push('runs-102-116-stickers');
      localStorage.setItem(MIG_KEY, JSON.stringify(done));
    }

    // Follow-up: run #116 might have been saved before the earlier migration ran,
    // with the new default externalFeature='laptop'. Force-overwrite it.
    if (!done.includes('run-116-stickers-force')) {
      if (runs.length > 115 && runs[115].externalFeature !== 'laptop-stickers') {
        runs[115].externalFeature = 'laptop-stickers';
        lsWrite(runs);
        pushToGist({ force: true });
      }
      done.push('run-116-stickers-force');
      localStorage.setItem(MIG_KEY, JSON.stringify(done));
    }

    // One-off: 07.06.2026 3:10 PM run was tagged 'external-stand' but was
    // actually 'external-stand-towel'. Re-tag if still in the wrong state.
    if (!done.includes('run-07062026-3-10pm-towel')) {
      const bad = runs.find(r => r.date === '07.06.2026' && r.time === '3:10 PM');
      if (bad && bad.externalFeature === 'external-stand') {
        bad.externalFeature = 'external-stand-towel';
        lsWrite(runs);
        pushToGist({ force: true });
      }
      done.push('run-07062026-3-10pm-towel');
      localStorage.setItem(MIG_KEY, JSON.stringify(done));
    }

    // One-off: 09.06.2026 6:07 PM incomplete run lost its sentenceStart /
    // sentenceCount because startContinueRun didn't restore those module-level
    // globals. Recovered (sentenceStart=3, sentenceCount=17) by greedy-matching
    // its keystrokeLog against NEZNAIKA_SENTENCES.
    if (!done.includes('run-09062026-6-07pm-resume-sentences')) {
      const bad = runs.find(r => r.date === '09.06.2026' && r.time === '6:07 PM');
      if (bad && bad.incomplete && (bad.sentenceStart < 0 || !bad.sentenceCount)) {
        bad.sentenceStart = 3;
        bad.sentenceCount = 17;
        lsWrite(runs);
        pushToGist({ force: true });
      }
      done.push('run-09062026-6-07pm-resume-sentences');
      localStorage.setItem(MIG_KEY, JSON.stringify(done));
    }

    renderStats(runs);
  }

  /**
   * Saves one completed run.
   * @param {{ level: number, chars: number, seconds: number, cpm: number, errors: number }} record
   */
  async function saveRun(record) {
    const entry = {
      date:         record.date || new Date().toLocaleDateString('ru-RU'),
      time:         record.time || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      level:        record.level,
      chars:        record.chars,
      errors:       record.errors,
      seconds:      record.seconds,
      cpm:          record.cpm,
      errorsDetail:   record.errorsDetail   || [],
      intervalMap:    record.intervalMap    || {},
      bigramStats:    record.bigramStats    || {},
      errorPositions: record.errorPositions || {},
      idleSeconds:    record.idleSeconds    || 0,
      lazy:           record.lazy           || false,
      incomplete:     record.incomplete     || false,
      totalChars:     record.totalChars     || null,
      mode:           record.mode           ?? null,
      textSet:        record.textSet        ?? null,
      sentenceStart:  record.sentenceStart  ?? null,
      sentenceCount:  record.sentenceCount  ?? null,
      keystrokeLog:   record.keystrokeLog   || [],
      stars:          record.stars          ?? null,
      externalFeature: record.externalFeature ?? null,
    };

    // Replace matching incomplete entry (last checkpoint or continued run matched by date+time)
    const matchIdx = runs.findLastIndex(r => r.incomplete &&
      r.date === entry.date && (r.time ?? '') === (entry.time ?? ''));
    if (matchIdx !== -1) {
      runs.splice(matchIdx, 1);
    } else if (runs.length > 0 && runs[runs.length - 1].incomplete) {
      runs.pop();
    }

    runs.push(entry);
    lsWrite(runs);
    renderStats(runs);
    pushToGist({ force: !entry.incomplete }); // fire-and-forget; завершённые заезды пушим всегда
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
    const FREEZE_START    = new Date(2026, 4, 22); // 22 May 2026
    function parseRowDate(s) {
      const [d, m, y] = s.split('.').map(Number);
      return new Date(y, m - 1, d);
    }
    function isYellowDay(r) {
      const threshold = parseRowDate(r.date) >= NEW_RULES_START ? 2 : 5;
      const covered = r.count + Math.min(Math.max(threshold - r.count, 0), r.freezeBefore ?? 0);
      return covered >= threshold;
    }
    const holidays = new Set(getHolidays());
    const DOW_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    let freeze = 0;
    rows.forEach((row, i) => {
      const date = parseRowDate(row.date);
      const dow = date.getDay(); // 0=Sun, 6=Sat
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const isWeekendDow = (dow === 0 || dow === 6);
      const isHoliday    = holidays.has(iso);
      row.dayTag = isHoliday
        ? `<span class="day-tag day-tag--holiday">${DOW_NAMES[dow]} ★</span>`
        : isWeekendDow
        ? `<span class="day-tag day-tag--weekend">${DOW_NAMES[dow]}</span>`
        : '';

      if (date >= FREEZE_START) {
        row.freezeBefore = freeze;
        const isWeekend = isWeekendDow || isHoliday;
        const n = row.count;
        const surplus = isWeekend ? 5 : 2;
        if (n > surplus)       freeze += n - surplus;
        else if (n >= 2)       { /* maintenance — no change */ }
        else if (n === 1)      freeze = Math.max(0, freeze - 1);
        else /* n === 0 */     freeze = Math.max(0, freeze - 2);
        row.freeze = freeze;
      } else {
        row.freezeBefore = 0;
        row.freeze = 0;
      }

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
    if (!run.keystrokeLog || !run.keystrokeLog.length) return;
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
    const chars = getRunText(run).split('');
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

  function backfillCpmStars(sourceRuns) {
    const result = new Map();
    const completeCpms = [];
    for (const r of sourceRuns) {
      const cpm = (!r.incomplete && r.cpm != null && !r.lazy) ? r.cpm : null;
      if (cpm !== null) completeCpms.push(cpm);
      if (r.stars != null) {
        result.set(r, r.stars);
      } else if (cpm === null) {
        result.set(r, null);
      } else if (completeCpms.length < 3) {
        result.set(r, 3);
      } else {
        const window = completeCpms.slice(-50);
        const n = window.length;
        const sx  = (n - 1) * n / 2;
        const sx2 = (n - 1) * n * (2 * n - 1) / 6;
        const sy  = window.reduce((s, v) => s + v, 0);
        const sxy = window.reduce((s, v, j) => s + j * v, 0);
        const denom = n * sx2 - sx * sx || 1;
        const b = (n * sxy - sx * sy) / denom;
        const a = (sy - b * sx) / n;
        const trend = a + b * (n - 1);
        const lower = trend * 0.9;
        if (cpm >= trend)       result.set(r, 3);
        else if (cpm >= lower)  result.set(r, 2);
        else                    result.set(r, 1);
      }
    }
    return result;
  }

  function computeErrorTrendStars(sourceRuns) {
    const result = new Map();
    const completeErrs = [];
    for (const r of sourceRuns) {
      const v = (!r.incomplete && !r.lazy && r.errors != null && r.chars) ? r.errors / r.chars * 100 : null;
      if (v !== null) completeErrs.push(v);
      if (v === null) {
        result.set(r, null);
      } else if (completeErrs.length < 3) {
        result.set(r, 3);
      } else {
        const window = completeErrs.slice(-50);
        const n = window.length;
        const sx  = (n - 1) * n / 2;
        const sx2 = (n - 1) * n * (2 * n - 1) / 6;
        const sy  = window.reduce((s, x) => s + x, 0);
        const sxy = window.reduce((s, x, j) => s + j * x, 0);
        const denom = n * sx2 - sx * sx || 1;
        const b = (n * sxy - sx * sy) / denom;
        const a = (sy - b * sx) / n;
        const trend = Math.max(0, a + b * (n - 1));
        if (v < trend / 3)      result.set(r, 3);
        else if (v < trend / 2) result.set(r, 2);
        else if (v < trend)     result.set(r, 1);
        else                    result.set(r, 0);
      }
    }
    return result;
  }

  function renderTableRuns(allRuns, inProgress) {
    const cpmLabels = computeRecords(allRuns);
    const errLabels = computeErrorRecords(allRuns);
    const lvlChanges = computeLevelChanges(allRuns);
    const errStarsMap = computeErrorTrendStars(allRuns);
    const cpmStarsMap = backfillCpmStars(allRuns);
    const total = allRuns.length;
    const rows = [...allRuns].map((r, i) => ({ r, i, cl: cpmLabels[i], el: errLabels[i], lc: lvlChanges[i], es: errStarsMap.get(r), cs: cpmStarsMap.get(r) })).reverse().map(({ r, i, cl, el, lc, es, cs }) => {
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
      const runMode = r.mode != null ? r.mode : (r.noFinger ? 2 : 1);
      const modeBadge = ` <span class="run-badge run-badge--mode" title="${_MODE_NAMES[runMode] ?? 'Режим ' + runMode}">${runMode}</span>`;
      const runExt = r.externalFeature || 'laptop';
      const runExtNum = _EXTERNAL_FEATURE_NUM[runExt] ?? '?';
      const extBadge = ` <span class="run-badge run-badge--mode" title="${_EXTERNAL_FEATURE_NAMES[runExt] ?? runExt}">${runExtNum}</span>`;
      const replayBtn = r.keystrokeLog?.length
        ? ' <button class="btn-replay-run" title="Виртуальный заезд">▶</button>' : '';
      const realSpeed = (r.keystrokeLog?.length && r.seconds > 0)
        ? Math.round(r.keystrokeLog.length / (r.seconds / 60)) : null;
      const cpmTip = realSpeed != null ? ` title="Реальная скорость: ${realSpeed} зн/мин"` : '';
      return `
      <tr${r.lazy ? ' class="row--lazy"' : ''} data-run-key="${r.date}~${r.time ?? ''}">
        <td class="run-num" style="white-space:nowrap">${i + 1}${replayBtn}</td>
        <td title="${r.date}${r.time ? ' · ' + fmtAmPm(r.time) : ''}">${r.date}${modeBadge}${extBadge}</td>
        <td style="white-space:nowrap">${r.textSet ?? 1} · ${r.sentenceStart ?? '?'} · ${r.sentenceCount ?? '?'}</td>
        <td>${r.level ?? r.exercise ?? '—'}${lvlBadge}</td>
        <td>${r.chars}</td>
        <td style="white-space:nowrap">${fmtErr(r.errors, r.chars)}${errBadge}</td>
        <td${timeTip}>${formatTime(netSecs)}${lazyBadge}</td>
        <td style="white-space:nowrap"><span${cpmTip}>${r.cpm} зн/мин</span> <button class="btn-run-detail" title="Детали заезда"><svg width="12" height="10" viewBox="0 0 12 10" fill="none" style="display:inline;vertical-align:middle"><rect x="0" y="6" width="3" height="4" fill="currentColor"/><rect x="4.5" y="3" width="3" height="7" fill="currentColor"/><rect x="9" y="0" width="3" height="10" fill="currentColor"/></svg></button>${cpmBadge}</td>
        <td style="white-space:nowrap">${cs != null ? '<span style="color:#f59e0b">★</span>'.repeat(cs) + '<span style="color:#d1d5db">★</span>'.repeat(3 - cs) : ''}${es != null ? ' ' + '<span style="color:#3b82f6">★</span>'.repeat(es) + '<span style="color:#d1d5db">★</span>'.repeat(3 - es) : ''}</td>
      </tr>`;
    }).join('');

    const inProgressRow = inProgress ? (() => {
      const totalChars = inProgress.totalChars || null;
      const pct = totalChars
        ? Math.round(inProgress.chars / totalChars * 100) + '%'
        : '—';
      const continueBtn = (inProgress.chars < inProgress.totalChars)
        ? ' <button class="btn-continue-run" title="Продолжить заезд">▶▶</button>' : '';
      return `
      <tr class="row--in-progress">
        <td class="run-num">⏳${continueBtn}</td>
        <td title="${inProgress.date}${inProgress.time ? ' · ' + fmtAmPm(inProgress.time) : ''}">${inProgress.date}</td>
        <td style="white-space:nowrap">${inProgress.textSet ?? 1} · ${inProgress.sentenceStart ?? '?'} · ${inProgress.sentenceCount ?? '?'}</td>
        <td>${inProgress.level ?? '—'}</td>
        <td>${totalChars ?? inProgress.chars} (${pct})</td>
        <td>${fmtErr(inProgress.errors, inProgress.chars)}</td>
        <td>${formatTime(inProgress.seconds)}</td>
        <td>${inProgress.cpm} зн/мин <button class="btn-run-detail" title="Детали заезда"><svg width="12" height="10" viewBox="0 0 12 10" fill="none" style="display:inline;vertical-align:middle"><rect x="0" y="6" width="3" height="4" fill="currentColor"/><rect x="4.5" y="3" width="3" height="7" fill="currentColor"/><rect x="9" y="0" width="3" height="10" fill="currentColor"/></svg></button></td>
      </tr>`;
    })() : '';

    return `
      <table class="stats-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Дата</th>
            <th>Текст</th>
            <th>Уровень</th>
            <th>Символов</th>
            <th>Ошибок</th>
            <th>Длительность</th>
            <th>Скорость</th>
            <th></th>
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
      <tr data-run-key="${d.date}">
        <td class="${d.dateClass}">${d.date}${d.dayTag}</td>
        <td>${d.avgLevel}${lvlBadge ? ' ' + lvlBadge : ''}</td>
        <td class="${d.countClass}">${d.count}</td>
        <td>${d.freeze}</td>
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
            <th>Заморозка</th>
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

  function getMonday(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function isoWeekKey(date) {
    const mon = getMonday(date);
    const y = mon.getFullYear();
    const m = String(mon.getMonth() + 1).padStart(2, '0');
    const d = String(mon.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function groupByWeek(allRuns) {
    if (!allRuns.length) return [];

    const map = {};
    for (const r of allRuns) {
      const [d, m, y] = r.date.split('.').map(Number);
      const key = isoWeekKey(new Date(y, m - 1, d));
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }

    const parsedDates = Object.keys(map).map(k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); });
    const earliest = new Date(Math.min(...parsedDates));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const mondayToday = getMonday(today);

    const rows = [];
    for (let mon = new Date(earliest); mon <= mondayToday; mon.setDate(mon.getDate() + 7)) {
      const ky = mon.getFullYear(), km = String(mon.getMonth() + 1).padStart(2, '0'), kd = String(mon.getDate()).padStart(2, '0');
      const key = `${ky}-${km}-${kd}`;
      const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
      const fmt = d => d.toLocaleDateString('ru-RU');
      const weekLabel = fmt(mon);
      const weekRuns = map[key] || [];

      rows.push({
        weekKey:  key,
        label:    weekLabel,
        count:    weekRuns.length,
        avgLevel: (() => { const lvls = weekRuns.map(r => r.level).filter(v => typeof v === 'number'); return lvls.length ? avg1(lvls) : '—'; })(),
        chars:    weekRuns.reduce((s, r) => s + r.chars, 0),
        worstErrRun: (() => { const e = weekRuns.filter(r => r.errors != null); return e.length ? e.reduce((w, r) => errPct(r) > errPct(w) ? r : w, e[0]) : null; })(),
        avgErrPct:   (() => { const e = weekRuns.filter(r => r.errors != null); return e.length ? parseFloat(avg(e.map(r => errPct(r)))) : null; })(),
        seconds:  weekRuns.reduce((s, r) => s + r.seconds, 0),
        avgCpm:   weekRuns.length ? avg(weekRuns.map(r => r.cpm)) : null,
        maxCpm:   weekRuns.length ? Math.max(...weekRuns.map(r => r.cpm)) : null,
      });
    }

    let maxWeekAvg = -1, maxWeekMax = -1, minWeekAvgErr = Infinity, minWeekMaxErr = Infinity;
    rows.forEach(row => {
      if (row.avgCpm !== null) {
        const wPct = errPct(row.worstErrRun);
        row.avgLabel    = row.avgCpm  > maxWeekAvg    ? 'record' : row.avgCpm  === maxWeekAvg    ? 'repeat' : '';
        row.maxLabel    = row.maxCpm  > maxWeekMax    ? 'record' : row.maxCpm  === maxWeekMax    ? 'repeat' : '';
        row.avgErrLabel = row.avgErrPct < minWeekAvgErr ? 'record' : row.avgErrPct === minWeekAvgErr ? 'repeat' : '';
        row.maxErrLabel = wPct         < minWeekMaxErr ? 'record' : wPct         === minWeekMaxErr ? 'repeat' : '';
        if (row.avgCpm    > maxWeekAvg)    maxWeekAvg    = row.avgCpm;
        if (row.maxCpm    > maxWeekMax)    maxWeekMax    = row.maxCpm;
        if (row.avgErrPct < minWeekAvgErr) minWeekAvgErr = row.avgErrPct;
        if (wPct          < minWeekMaxErr) minWeekMaxErr = wPct;
      } else {
        row.avgLabel = row.maxLabel = row.avgErrLabel = row.maxErrLabel = '';
      }
    });

    return rows.reverse();
  }

  function renderTableWeeks(allRuns) {
    const rows = groupByWeek(allRuns).map(w => `
      <tr data-week-key="${w.weekKey}">
        <td>${w.label}</td>
        <td>${w.avgLevel}</td>
        <td>${w.count || '—'}</td>
        <td>${w.count ? w.chars : '—'}</td>
        <td>${w.worstErrRun ? fmtErr(w.worstErrRun.errors, w.worstErrRun.chars) : '—'}${dayBadge(w.maxErrLabel, '-sm')}</td>
        <td>${w.avgErrPct !== null ? w.avgErrPct.toFixed(1) + '%' : '—'}${dayBadge(w.avgErrLabel, '-sm')}</td>
        <td>${w.count ? formatTime(w.seconds) : '—'}</td>
        <td>${w.maxCpm !== null ? w.maxCpm + ' зн/мин' : '—'}${dayBadge(w.maxLabel)}</td>
        <td>${w.avgCpm !== null ? w.avgCpm + ' зн/мин' : '—'}${dayBadge(w.avgLabel)}</td>
      </tr>
    `).join('');

    return `
      <table class="stats-table">
        <thead>
          <tr>
            <th>Неделя</th>
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
    tableWrap.innerHTML = tableMode === 'days'  ? renderTableDays(allRuns)
                        : tableMode === 'weeks' ? renderTableWeeks(allRuns)
                        : renderTableRuns(allRuns, inProgress);

    if (tableMode === 'runs') {
      const reversed = [...allRuns].reverse();
      let runIdx = 0;
      tableWrap.querySelectorAll('tbody tr').forEach(tr => {
        if (tr.classList.contains('row--in-progress')) {
          if (inProgress) {
            tr.classList.add('clickable-row');
            tr.addEventListener('click', () => showRunDetail(inProgress, allRuns));
            const db2 = tr.querySelector('.btn-run-detail');
            if (db2) db2.addEventListener('click', e => { e.stopPropagation(); showSpeedChart(inProgress); });
            const cb = tr.querySelector('.btn-continue-run');
            if (cb) cb.addEventListener('click', e => { e.stopPropagation(); window.startContinueRun?.(inProgress); });
          }
          return;
        }
        const idx = runIdx++;
        tr.classList.add('clickable-row');
        tr.addEventListener('click', () => showRunDetail(reversed[idx], allRuns));
        const db = tr.querySelector('.btn-run-detail');
        if (db) db.addEventListener('click', e => { e.stopPropagation(); showSpeedChart(reversed[idx]); });
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

    if (tableMode === 'weeks') {
      const weekRows = groupByWeek(allRuns);
      tableWrap.querySelectorAll('tbody tr').forEach((tr, i) => {
        if (!weekRows[i] || weekRows[i].count === 0) return;
        tr.classList.add('clickable-row');
        tr.addEventListener('click', () => {
          const key = weekRows[i].weekKey;
          const mon = new Date(key);
          const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
          const weekRuns = allRuns.filter(r => {
            const [d, m, y] = r.date.split('.').map(Number);
            const rd = new Date(y, m - 1, d);
            return rd >= mon && rd <= sun;
          });
          showErrorModal(weekRows[i].label, buildDetailHtml(weekRuns));
        });
      });
    }

    // Sentence coverage section (runs mode only)
    if (tableMode === 'runs' && typeof SENTENCES !== 'undefined' && SENTENCES.length) {
      const TEXT_SET_NUM = { neznaika:1, winnie:2, punct:3, wizard:4, numbers:5, godzilla:6, rules:7 };
      const currentSetNum = TEXT_SET_NUM[_currentTextSetId] ?? 1;
      const n = SENTENCES.length;
      const counts = new Array(n).fill(0);
      for (const run of allRuns) {
        if ((run.textSet ?? 1) !== currentSetNum) continue;
        if (run.sentenceStart < 0 || !run.sentenceCount) continue;
        for (let i = 0; i < run.sentenceCount; i++) {
          counts[(run.sentenceStart + i) % n]++;
        }
      }
      const hist = new Map();
      for (const c of counts) hist.set(c, (hist.get(c) || 0) + 1);
      const entries = [...hist.entries()].sort((a, b) => a[0] - b[0]);
      const neverSeen = hist.get(0) || 0;
      const seen = n - neverSeen;
      const rows = entries.map(([times, cnt]) =>
        `<tr><td>${times === 0 ? 'Ни разу' : times + ' раз'}</td><td>${cnt}</td><td>${(cnt / n * 100).toFixed(1)}%</td></tr>`
      ).join('');
      const div = document.createElement('div');
      div.style.cssText = 'margin-top:24px';
      div.innerHTML = `
        <p class="freq-section-title" style="margin-bottom:6px">Покрытие предложений: ${seen} из ${n} (${(seen / n * 100).toFixed(1)}%)</p>
        <table class="stats-table"><thead><tr><th>Встречалось</th><th>Предложений</th><th>%</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
      tableWrap.appendChild(div);
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

    // Cumulative sums: prefix = same speed or faster (t ≤ current), suffix = same or slower (t ≥ current)
    let _pre = 0;
    const prefixPct = byTime.map(d => (_pre += d.pct));
    const suffixPct = new Array(byTime.length);
    let _suf = 0;
    for (let i = byTime.length - 1; i >= 0; i--) suffixPct[i] = (_suf += byTime[i].pct);

    // List: sorted by time asc
    const list = byTime
      .map(({ t, count, pct }, i) => `<div class="interval-row">
        <span class="interval-label">${(t / 10).toFixed(1)}с</span>
        <span class="interval-pct">${Math.round(pct)}% <span class="freq-total">(${count})</span></span>
        <span class="interval-pct" style="color:var(--text-dim);width:3.5rem;white-space:nowrap" title="С такой же скоростью или быстрее">≤ ${Math.round(prefixPct[i])}%</span>
        <span class="interval-pct" style="color:var(--text-dim);width:3.5rem;white-space:nowrap" title="С такой же скоростью или медленнее">≥ ${Math.round(suffixPct[i])}%</span>
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
    document.getElementById('error-detail-speed-chart').innerHTML = '';
    document.getElementById('error-detail-overlay').classList.remove('hidden');

    const svg = chartEl.querySelector('svg');
    if (svg) {
      let tip = document.getElementById('chart-tooltip');
      if (!tip) {
        tip = document.createElement('div');
        tip.id = 'chart-tooltip';
        tip.className = 'chart-tooltip';
        document.body.appendChild(tip);
      }
      svg.addEventListener('mouseover', e => {
        const el = e.target.closest('[data-tip]');
        if (!el) return;
        tip.textContent = el.dataset.tip;
        tip.classList.add('visible');
        el.setAttribute('r', '5');
      });
      svg.addEventListener('mouseout', e => {
        const el = e.target.closest('[data-tip]');
        if (!el) return;
        tip.classList.remove('visible');
        el.setAttribute('r', '3');
      });
      svg.addEventListener('mousemove', e => {
        tip.style.left = (e.clientX + 12) + 'px';
        tip.style.top  = (e.clientY - 28) + 'px';
      });
    }
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

  function buildRunSpeedSvg(run) {
    if (!run.keystrokeLog?.length) return '';
    const chars = [...getRunText(run)];
    if (!chars.length) return '';
    // Greedy reconstruction: ignore backspaces, advance cursor whenever a key
    // matches the next expected char. This stays robust against runs where
    // the user used non-keydown native edits (Delete, mouse, selection-replace)
    // which aren't recorded in keystrokeLog and would otherwise desync the
    // junkBuffer-tracking analyzer.
    let cursor = 0;
    let timeAcc = 0;
    const BUCKET_MS = 10000;
    const buckets = {};
    const correctTimes = [];
    for (const [key, deltaMs] of run.keystrokeLog) {
      if (cursor >= chars.length) break;
      timeAcc += deltaMs;
      if (key === '⌫' || key === '⌫⌫') continue;
      if (key === chars[cursor]) {
        cursor++;
        const b = Math.floor(timeAcc / BUCKET_MS);
        buckets[b] = (buckets[b] || 0) + 1;
        correctTimes.push(timeAcc);
      }
    }

    const maxBucket = Math.max(...Object.keys(buckets).map(Number));
    // Regular buckets (drop the partial last one)
    const pts = Object.entries(buckets)
      .filter(([b]) => Number(b) !== maxBucket)
      .map(([b, count]) => ({ t: (Number(b) + 0.5) * BUCKET_MS, cpm: count * 6 }))
      .sort((a, b) => a.t - b.t);
    // Last point: last 10 seconds regardless of bucket boundary
    const last10Count = correctTimes.filter(t => t >= timeAcc - BUCKET_MS).length;
    if (last10Count > 0) {
      pts.push({ t: timeAcc - BUCKET_MS / 2, cpm: last10Count * 6 });
    }

    if (pts.length < 2) return '';

    const W = 500, H = 100, padL = 28, padR = 4, padT = 4, padB = 14;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const totalMs = timeAcc;
    const maxCpm = Math.max(...pts.map(p => p.cpm));

    // Cumulative prefix-cpm: at correct char #(i+1) at time t_i, speed-so-far = (i+1)/(t_i/60000)
    const cumStartMs = 5000;
    const cumAll = [];
    for (let i = 0; i < correctTimes.length; i++) {
      const t = correctTimes[i];
      if (t < cumStartMs) continue;
      cumAll.push({ t, cpm: (i + 1) * 60000 / t });
    }
    const cumStride = Math.max(1, Math.floor(cumAll.length / 200));
    const cumPts = cumAll.filter((_, i) => i % cumStride === 0 || i === cumAll.length - 1);
    const fmtMin = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

    const xp = t => padL + t / totalMs * plotW;
    const yp = c => padT + plotH - c / maxCpm * plotH;

    const polyline = pts.map(p => `${xp(p.t).toFixed(1)},${yp(p.cpm).toFixed(1)}`).join(' ');
    const cumPolyline = cumPts
      .map(p => `${xp(p.t).toFixed(1)},${yp(Math.min(p.cpm, maxCpm)).toFixed(1)}`)
      .join(' ');
    const avgCpm = Math.round(pts.reduce((s, p) => s + p.cpm, 0) / pts.length);
    const yAvg = yp(avgCpm).toFixed(1);

    const dots = pts.map(p => {
      const x = xp(p.t).toFixed(1), y = yp(p.cpm).toFixed(1);
      const tip = `${fmtMin(p.t / 1000)} — ${p.cpm} зн/мин`.replace(/"/g, '&quot;');
      return `<circle cx="${x}" cy="${y}" r="3" fill="#3b82f6" stroke="#fff" stroke-width="1" data-tip="${tip}" style="cursor:pointer"/>`;
    }).join('');

    const totalSec = totalMs / 1000;
    const xStepSec = totalSec <= 120 ? 15 : totalSec <= 300 ? 30 : 60;
    const xTicks = Array.from({length: Math.floor(totalSec / xStepSec) + 1}, (_, i) => {
      const sec = i * xStepSec;
      if (sec > totalSec + 1) return '';
      const tx = (padL + sec / totalSec * plotW).toFixed(1);
      return `<line x1="${tx}" y1="${padT}" x2="${tx}" y2="${padT + plotH}" stroke="#e5e7eb" stroke-width="1"/>
        <line x1="${tx}" y1="${padT + plotH}" x2="${tx}" y2="${padT + plotH + 3}" stroke="#9ca3af" stroke-width="1"/>
        <text x="${tx}" y="${H - 1}" text-anchor="middle" font-size="8" fill="#9ca3af">${fmtMin(sec)}</text>`;
    }).join('');

    const yTicks = Array.from({length: 5}, (_, i) => {
      const val = Math.round(maxCpm * i / 4);
      const ty = yp(val).toFixed(1);
      return `<line x1="${padL}" y1="${ty}" x2="${W - padR}" y2="${ty}" stroke="#e5e7eb" stroke-width="1"/>
        <text x="${padL - 2}" y="${(parseFloat(ty) + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#9ca3af">${val}</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" id="run-speed-svg">
      ${yTicks}
      ${xTicks}
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#d1d5db" stroke-width="1"/>
      <line x1="${padL}" y1="${yAvg}" x2="${W - padR}" y2="${yAvg}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
      <text x="${(W - padR - 2).toFixed(1)}" y="${(parseFloat(yAvg) - 2).toFixed(1)}" text-anchor="end" font-size="8" fill="#94a3b8">ср. ${avgCpm}</text>
      ${cumPolyline ? `<polyline points="${cumPolyline}" fill="none" stroke="#0d9488" stroke-width="1" stroke-linejoin="round" opacity="0.75"/>` : ''}
      <polyline points="${polyline}" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round" opacity="0.9"/>
      ${dots}
    </svg>`;
  }

  function showSpeedChart(run) {
    const svg = buildRunSpeedSvg(run);
    if (!svg) return;
    document.getElementById('speed-chart-title').textContent =
      `${run.date}${run.time ? '  ' + run.time : ''}  —  ${run.cpm} зн/мин`;
    const body = document.getElementById('speed-chart-body');
    body.innerHTML = svg;
    document.getElementById('speed-chart-overlay').classList.remove('hidden');

    let tip = document.getElementById('chart-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'chart-tooltip';
      tip.className = 'chart-tooltip';
      document.body.appendChild(tip);
    }
    const svgEl = body.querySelector('svg');
    if (svgEl) {
      svgEl.addEventListener('mouseover', e => {
        const el = e.target.closest('[data-tip]');
        if (!el) return;
        tip.textContent = el.dataset.tip;
        tip.classList.add('visible');
        el.setAttribute('r', '5');
      });
      svgEl.addEventListener('mouseout', e => {
        const el = e.target.closest('[data-tip]');
        if (!el) return;
        tip.classList.remove('visible');
        el.setAttribute('r', '3');
      });
      svgEl.addEventListener('mousemove', e => {
        tip.style.left = (e.clientX + 12) + 'px';
        tip.style.top  = (e.clientY - 28) + 'px';
      });
    }
  }

  function buildRunCoverageHtml(run, allRuns) {
    if (run.sentenceStart < 0 || !run.sentenceCount || typeof SENTENCES === 'undefined' || !SENTENCES.length) return '';
    const n = SENTENCES.length;
    const foundIndices = [];
    for (let i = 0; i < run.sentenceCount; i++) foundIndices.push((run.sentenceStart + i) % n);
    if (!foundIndices.length) return '';

    const foundSet = new Set(foundIndices);
    const counts = new Array(n).fill(0);
    const runIdx = (allRuns || []).indexOf(run);
    const before = runIdx === -1 ? [] : (allRuns || []).slice(0, runIdx);
    const runTextSet = run.textSet ?? 1;
    for (const r of before) {
      if ((r.textSet ?? 1) !== runTextSet) continue;
      if (r.sentenceStart < 0 || !r.sentenceCount) continue;
      for (let i = 0; i < r.sentenceCount; i++) {
        const idx = (r.sentenceStart + i) % n;
        if (foundSet.has(idx)) counts[idx]++;
      }
    }

    const hist = new Map();
    for (const i of foundIndices) {
      const c = counts[i];
      hist.set(c, (hist.get(c) || 0) + 1);
    }
    const entries = [...hist.entries()].sort((a, b) => a[0] - b[0]);
    const pct = v => (v / foundIndices.length * 100).toFixed(1) + '%';
    const razForm = t => t % 10 >= 2 && t % 10 <= 4 && (t % 100 < 10 || t % 100 >= 20) ? 'раза' : 'раз';
    const rows = entries.map(([times, cnt]) =>
      `<tr><td>${times === 0 ? 'Ни разу' : times + ' ' + razForm(times)}</td><td>${cnt}</td><td>${pct(cnt)}</td></tr>`
    ).join('');
    return '<div class="freq-divider"></div>'
      + `<p class="freq-section-title">Предложений в заезде: ${foundIndices.length} из ${n} (${(foundIndices.length / n * 100).toFixed(1)}%)</p>`
      + `<table class="stats-table"><thead><tr><th>Встречалось</th><th>Предложений</th><th>%</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function showRunDetail(run, allRuns) {
    const finger = (ch) => (typeof getFinger === 'function' ? getFinger(ch) : '');
    const title  = `${run.date}  ${run.time ?? ''}  —  ${run.cpm} зн/мин`;

    const { errorsDetail, errorPositions, intervalMap, bigramStats } =
      run.keystrokeLog?.length ? recomputeDerivedFields(run) : {};

    const runText = getRunText(run);
    const stopAt = (run.incomplete && run.totalChars > run.chars)
      ? run.chars : undefined;

    const textBlock = runText
      ? '<p class="freq-section-title">Текст упражнения</p>'
      + buildTextWithErrorsHtml(runText, errorPositions || {}, stopAt)
      + '<div class="freq-divider"></div>'
      : '';

    const coverageHtml = buildRunCoverageHtml(run, allRuns);

    if (!errorsDetail) {
      showErrorModal(title, textBlock + '<p class="error-detail-empty">Данные об ошибках не сохранены (старый заезд)</p>' + coverageHtml);
      return;
    }

    if (!errorsDetail.length) {
      showErrorModal(title, textBlock + '<p class="error-detail-empty">Ошибок нет!</p>' + coverageHtml);
      return;
    }

    const perWord = errorsDetail.map(entry => {
      const wordHtml = entry.word.split('').map((ch, i) =>
        i === entry.charInWord
          ? `<span class="eword--error">${ch}</span>`
          : `<span>${ch}</span>`
      ).join('');

      const ef    = finger(entry.expected);
      const next1 = entry.word[entry.charInWord + 1];
      const next2 = entry.word[entry.charInWord + 2];
      const attemptsHtml = entry.attempts.map(a => {
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
    const freqHtml   = renderFreqHtml(buildErrorFreq([{ errorsDetail }]));
    const iHtml      = renderIntervalHtml(mergeIntervalMaps([{ intervalMap }]));
    const bigramHtml = renderBigramHtml(bigramStats || {});

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
      + bigramHtml
      + coverageHtml);

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

  function buildCharts(allRuns, fromIso, toIso, fullRuns, mode) {
    if (allRuns.length < 2) return '';

    const W = 760, H = 400;
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

    // Error trend regression — computed early because maxErrForecast is used by rightAxis
    const errNonNull0 = errs.map((v, i) => [i, v]).filter(([, v]) => v !== null);
    let errTrendVals = null;
    if (errNonNull0.length >= 2) {
      const eN     = errNonNull0.length;
      const eSumX  = errNonNull0.reduce((s, [i])    => s + i,     0);
      const eSumX2 = errNonNull0.reduce((s, [i])    => s + i * i, 0);
      const eSumY  = errNonNull0.reduce((s, [, v])  => s + v,     0);
      const eSumXY = errNonNull0.reduce((s, [i, v]) => s + i * v, 0);
      const eB = (eN * eSumXY - eSumX * eSumY) / (eN * eSumX2 - eSumX * eSumX);
      const eA = (eSumY - eB * eSumX) / eN;
      errTrendVals = Array.from({length: n + 10}, (_, i) => Math.max(0, eA + eB * i));
    }
    const maxErrForecast = errTrendVals
      ? Math.max(maxErr, ...[n, n+3, n+6, n+9].map(i => errTrendVals[i]))
      : maxErr;

    // Error scale: bottom half of chart (v=maxErrForecast → midpoint, v=0 → near bottom)
    const yScaleErr = v => padT + plotH / 2 + (1 - v / maxErrForecast) * (plotH / 2 - 4);

    // Draws a line+dots wrapped in <g>, skipping null values
    // tips: tooltip strings per run; records: 'record'|'' per run
    function lineGroup(values, maxV, color, groupId, tips, records, hidden = false, dotColors = null, yFn = null) {
      const dots = [];
      const segments = [];
      let seg = [];
      for (let i = 0; i < values.length; i++) {
        if (values[i] === null) {
          if (seg.length) { segments.push(seg); seg = []; }
        } else {
          const x = xPos(i).toFixed(1), y = (yFn ? yFn(values[i]) : yScale(values[i], maxV)).toFixed(1);
          seg.push(`${x},${y}`);
          const tip = tips ? tips[i].replace(/"/g, '&quot;') : '';
          const isRecord = records && records[i] === 'record';
          const dotColor = dotColors ? dotColors[i] : color;
          dots.push(`<circle cx="${x}" cy="${y}" r="${isRecord ? 6 : 4}" fill="${dotColor}" data-tip="${tip}" data-idx="${i}" style="cursor:pointer"/>`);
          if (isRecord) dots.push(
            `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="10" fill="#fbbf24" style="pointer-events:none">★</text>`
          );
        }
      }
      if (seg.length) segments.push(seg);
      const polylines = segments.map(s => `<polyline points="${s.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`).join('');
      return `<g id="${groupId}"${hidden ? ' style="display:none"' : ''}>${polylines}${dots.join('')}</g>`;
    }

    const globalIdxOf = fullRuns ? new Map(fullRuns.map((r, i) => [r, i])) : null;

    const tips = allRuns.map((r, i) => {
      const errStr = (r.errors != null && r.chars) ? `${r.errors} (${(r.errors / r.chars * 100).toFixed(1)}%)` : '—';
      const base = r._count
        ? (mode === 'weeks'
            ? `Нед. ${Math.round((+getMonday(new Date(r.date.split('.').reverse().join('-'))) - +getMonday(new Date((fullRuns ?? allRuns)[0].date.split('.').reverse().join('-')))) / (7 * 86400000)) + 1} · ${r.date} · ${r._count} заездов`
            : `${r.date} · ${r._count} заездов`)
          + (r.cpmMax != null ? `\nМакс.: ${r.cpmMax} зн/мин` : '')
          + `\nСредняя: ${r.cpm} зн/мин`
          + (r.cpmMin != null ? `\nМин.: ${r.cpmMin} зн/мин` : '')
          + (r.errPctMax != null ? `\nОшибок макс.: ${r.errPctMax.toFixed(1)}%` : '')
          + `\nОшибок ср.: ${errStr}`
          + (r.errPctMin != null ? `\nОшибок мин.: ${r.errPctMin.toFixed(1)}%` : '')
        : `#${(globalIdxOf?.get(r) ?? i) + 1} · ${r.date} ${r.time ?? ''}\nУровень ${r.level ?? '—'} · ${r.cpm} зн/мин\nОшибок: ${errStr} · ${formatTime(r.seconds)}`;
      return base;
    });
    const cpmRecords    = computeRecords(allRuns);
    const cpmMaxRecords = hasDayLines ? computeRecords(allRuns.map(r => ({ cpm: r.cpmMax ?? 0 }))) : null;
    const cpmMinRecords = hasDayLines ? computeRecords(allRuns.map(r => ({ cpm: r.cpmMin ?? 0 }))) : null;
    const errRecords = computeErrorRecords(allRuns);

    // Rolling up-to-5-run average using full history for context
    const cpmRolling10 = allRuns.map((run, i) => {
      const gi = globalIdxOf?.get(run) ?? i;
      const w  = Math.min(gi + 1, 5);
      const src = fullRuns ?? allRuns;
      return Math.round(src.slice(gi - w + 1, gi + 1).map(r => r.cpm).reduce((s, v) => s + v, 0) / w);
    });
    const errRolling10 = allRuns.map((run, i) => {
      const gi  = globalIdxOf?.get(run) ?? i;
      const src = fullRuns ?? allRuns;
      const sl  = src.slice(Math.max(0, gi - 4), gi + 1)
        .map(r => r.errors != null && r.chars ? r.errors / r.chars * 100 : null)
        .filter(v => v !== null);
      return sl.length ? sl.reduce((s, v) => s + v, 0) / sl.length : null;
    });
    const rolling10Records = (() => {
      const out = new Array(n).fill('');
      let maxV = -1;
      for (let i = 0; i < n; i++) {
        if (cpmRolling10[i] > maxV) { out[i] = 'record'; maxV = cpmRolling10[i]; }
        else if (cpmRolling10[i] === maxV) out[i] = 'repeat';
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
    const rolling10Tips = allRuns.map((run, i) => {
      const gi  = globalIdxOf?.get(run) ?? i;
      const w   = Math.min(gi + 1, 5);
      const src = fullRuns ?? allRuns;
      const startRun = src[gi - w + 1];
      return `Среднее ${w} заездов (${gi - w + 2}–${gi + 1}, ${fmtDateRange(startRun.date, run.date)}): ${cpmRolling10[i]} зн/мин`;
    });

    // Vertical dividers for level transitions

    // Left Y axis (CPM) ticks
    const cpmTicks = [0, Math.round(maxCpmScale / 2), Math.round(maxCpmScale)];
    const leftAxis = cpmTicks.map(t =>
      `<line x1="${padL}" y1="${yScale(t, maxCpmScale).toFixed(1)}" x2="${W - padR}" y2="${yScale(t, maxCpmScale).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
       <text x="${padL - 5}" y="${(yScale(t, maxCpmScale) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#3b82f6">${t}</text>`
    ).join('');

    // Right Y axis (error %) ticks
    const errTicks = [0, parseFloat((maxErrForecast / 2).toFixed(1)), parseFloat(maxErrForecast.toFixed(1))];
    const rightAxis = errTicks.map(t =>
      `<text x="${W - padR + 5}" y="${(yScaleErr(t) + 4).toFixed(1)}" text-anchor="start" font-size="10" fill="#ef4444">${t.toFixed(1)}%</text>`
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
      // For weeks mode: use week spacing (7 days per unit) for forecast
      const isWeeksMode = mode === 'weeks';
      const forecastUnit = isWeeksMode ? 7 * 86400000 : 86400000;
      const futureDateMs = maxDateMs + 10 * forecastUnit;
      function xPosByMs(ms) {
        return padL + (ms - minDateMs) / (futureDateMs - minDateMs) * plotWd;
      }
      const xsData = dayDateMs.map(ms => xPosByMs(ms));

      function lineGroupD(values, maxV, color, groupId, tipsArr, records, hidden, xs, dash = '') {
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
            dots.push(`<circle cx="${x}" cy="${y}" r="${isRecord ? 6 : 4}" fill="${color}" data-tip="${tip}" data-idx="${i}" style="cursor:pointer"/>`);
            if (isRecord) dots.push(`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="10" fill="#fbbf24" style="pointer-events:none">★</text>`);
          }
        }
        if (seg.length) segments.push(seg);
        const da = dash ? ` stroke-dasharray="${dash}"` : '';
        const polylines = segments.map(s => `<polyline points="${s.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"${da}/>`).join('');
        return `<g id="${groupId}"${hidden ? ' style="display:none"' : ''}>${polylines}${dots.join('')}</g>`;
      }

      const errMaxes = allRuns.map(r => r.errPctMax ?? null);
      const errMins  = allRuns.map(r => r.errPctMin  ?? null);
      const maxErrAll = Math.max(...[...errs, ...errMaxes, ...errMins].filter(v => v !== null)) || 1;

      const errMaxRecords = computeErrorRecords(allRuns.map(r => ({ errors: r.errPctMax ?? null, chars: r.errPctMax != null ? 100 : 0 })));
      const errMinRecords = computeErrorRecords(allRuns.map(r => ({ errors: r.errPctMin ?? null, chars: r.errPctMin != null ? 100 : 0 })));


      // Day trend (avg CPM only, regression on actual day offsets)
      const dayOffsets = dayDateMs.map(ms => (ms - minDateMs) / 86400000);
      const sumXDt  = dayOffsets.reduce((s, v) => s + v, 0);
      const sumX2Dt = dayOffsets.reduce((s, v) => s + v * v, 0);
      const sumYDt  = cpms.reduce((a, b) => a + b, 0);
      const sumXYDt = cpms.reduce((s, v, i) => s + dayOffsets[i] * v, 0);
      const trendBDt = (n * sumXYDt - sumXDt * sumYDt) / (n * sumX2Dt - sumXDt * sumXDt);
      const trendADt = (sumYDt - trendBDt * sumXDt) / n;

      // For weeks mode: compute absolute week number (1 = first week ever)
      const firstRunMs = fullRuns?.length
        ? +parseRuDate(fullRuns[0].date)
        : minDateMs;
      const firstMonMs = +getMonday(new Date(firstRunMs));
      const msToWeekNum = ms => Math.round((+getMonday(new Date(ms)) - firstMonMs) / (7 * 86400000)) + 1;

      // Forecast dots at +1, +4, +7, +10 units (days or weeks) from last data
      const forecastDaysMsList = [1, 4, 7, 10].map(d => maxDateMs + d * forecastUnit);
      const forecastVals = forecastDaysMsList.map(ms => trendADt + trendBDt * (ms - minDateMs) / 86400000);
      const maxCpmForecastD = Math.max(maxCpmScale, ...forecastVals);

      const ruDateFormatter = ms => {
        const d = new Date(ms);
        return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
      };
      // Short label for X-axis tick marks
      const dateFormatter = ms => isWeeksMode ? `н${msToWeekNum(ms)}` : ruDateFormatter(ms);
      // Full label for forecast dot tooltips
      const forecastLabel = ms => {
        if (isWeeksMode) {
          const mon = getMonday(new Date(ms));
          return `нед. ${msToWeekNum(ms)} (${ruDateFormatter(mon)})`;
        }
        return ruDateFormatter(ms);
      };

      const trendDotsDt = forecastDaysMsList.map((ms, k) => {
        const v = forecastVals[k];
        const x = xPosByMs(ms).toFixed(1), y = yScaleD(v, maxCpmForecastD).toFixed(1);
        const tip = `Прогноз ${forecastLabel(ms)}: ${Math.round(v)} зн/мин`.replace(/"/g, '&quot;');
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

      // X-axis labels: week numbers or dates at regular intervals + forecast points
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

      const totalCharsPerDay = allRuns.map(r => r.totalCharsDay ?? null);
      const avgCharsPerDay   = allRuns.map(r => r.chars ?? null);
      const maxCharsDay = Math.max(...[...totalCharsPerDay, ...avgCharsPerDay].filter(v => v !== null)) || 1;
      const charsTicksD = [0, Math.round(maxCharsDay / 2), Math.round(maxCharsDay)];
      const leftAxisCharsD = charsTicksD.map(t =>
        `<line x1="${padL}" y1="${yScaleD(t, maxCharsDay).toFixed(1)}" x2="${W - padRd}" y2="${yScaleD(t, maxCharsDay).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
         <text x="${padL - 5}" y="${(yScaleD(t, maxCharsDay) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#8b5cf6">${t}</text>`
      ).join('');
      const charsDayTips    = allRuns.map(r => `${r.date} · ${r._count} заездов\nБукв всего: ${r.totalCharsDay ?? '—'}`);
      const avgCharsDayTips = allRuns.map(r => `${r.date} · ${r._count} заездов\nБукв ср.: ${r.chars ?? '—'}`);
      const totalSecPerDay = allRuns.map(r => r.seconds ?? null);
      const avgSecPerDay   = allRuns.map(r => r.avgSeconds ?? null);
      const maxSecDay = Math.max(...[...totalSecPerDay, ...avgSecPerDay].filter(v => v !== null)) || 1;
      const secDayTicks = [0, Math.round(maxSecDay / 2), Math.round(maxSecDay)];
      const rightAxisCharsD = secDayTicks.map(t =>
        `<text x="${W - padRd + 5}" y="${(yScaleD(t, maxSecDay) + 4).toFixed(1)}" text-anchor="start" font-size="10" fill="#6366f1">${formatTime(t)}</text>`
      ).join('');
      const secDayTips    = allRuns.map(r => `${r.date} · ${r._count} заездов\nВремя: ${formatTime(r.seconds)}`);
      const avgSecDayTips = allRuns.map(r => `${r.date} · ${r._count} заездов\nВремя ср.: ${formatTime(r.avgSeconds)}`);


      const bordersD = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotHd}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${W - padRd}" y1="${padT}" x2="${W - padRd}" y2="${padT + plotHd}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${padL}" y1="${padT + plotHd}" x2="${W - padRd}" y2="${padT + plotHd}" stroke="#d1d5db" stroke-width="1"/>`;

      return `<div class="chart-block-inner"><div class="chart-date-range">
        <input type="date" id="chart-from" value="${fromIso}" class="chart-date-input">
        <span style="color:var(--text-dim)">—</span>
        <input type="date" id="chart-to" value="${toIso}" class="chart-date-input">
        <button id="btn-chart-last50" class="chart-all-btn">последние 50</button>
        <button id="btn-chart-all" class="chart-all-btn">весь период</button>
      </div></div>
      <div class="chart-block">
        <div class="chart-block-inner"><div class="chart-legend">
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-cpm" checked> <span style="color:#3b82f6">● ср. скорость, зн/мин</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-trend" checked> <span style="color:#06b6d4">● тренд</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-cpm-max"> <span style="color:#16a34a">● макс. скорость</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-cpm-min"> <span style="color:#f59e0b">● мин. скорость</span></label>
        </div></div>
        <svg viewBox="0 0 ${W} ${Hd}" style="width:100%;display:block" data-plot-r="${W - padRd}">
          ${leftAxisCpm}${bordersD}
          ${trendLineDt}
          ${lineGroupD(cpmMaxes, maxCpmForecastD, '#16a34a', 'chart-group-cpm-max', tips, cpmMaxRecords, true,  xsData)}
          ${lineGroupD(cpmMins,  maxCpmForecastD, '#f59e0b', 'chart-group-cpm-min', tips, cpmMinRecords, true,  xsData)}
          ${lineGroupD(cpms,     maxCpmForecastD, '#3b82f6', 'chart-group-cpm',     tips, cpmRecords,    false, xsData)}
          ${xLabelsD}
        </svg>
      </div>
      <div class="chart-block">
        <div class="chart-block-inner"><div class="chart-legend">
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-err" checked> <span style="color:#3b82f6">● ср. ошибки, %</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-err-max"> <span style="color:#16a34a">● макс. ошибки</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-err-min"> <span style="color:#f59e0b">● мин. ошибки</span></label>
        </div></div>
        <svg viewBox="0 0 ${W} ${Hd}" style="width:100%;display:block" data-plot-r="${W - padRd}">
          ${leftAxisErr}${bordersD}
          ${lineGroupD(errMaxes, maxErrAll, '#16a34a', 'chart-group-err-max', tips, errMaxRecords, true,  xsData)}
          ${lineGroupD(errMins,  maxErrAll, '#f59e0b', 'chart-group-err-min', tips, errMinRecords, true,  xsData)}
          ${lineGroupD(errs,     maxErrAll, '#3b82f6', 'chart-group-err',     tips, errRecords,    false, xsData)}
          ${xLabelsD}
        </svg>
      </div>
      <div class="chart-block">
        <div class="chart-block-inner"><div class="chart-legend">
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-chars-day"> <span style="color:#8b5cf6">● букв за день</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-avg-chars-day"> <span style="color:#8b5cf6">╌ букв ср.</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-sec-day"> <span style="color:#6366f1">● длительность</span></label>
          <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-avg-sec-day"> <span style="color:#6366f1">╌ длит. ср.</span></label>
        </div></div>
        <svg id="chart-svg-chars-day" viewBox="0 0 ${W} ${Hd}" style="width:100%;display:none" data-plot-r="${W - padRd}">
          ${leftAxisCharsD}${bordersD}
          ${lineGroupD(totalCharsPerDay, maxCharsDay, '#8b5cf6', 'chart-group-chars-day',     charsDayTips,    null, true, xsData)}
          ${lineGroupD(avgCharsPerDay,   maxCharsDay, '#8b5cf6', 'chart-group-avg-chars-day', avgCharsDayTips, null, true, xsData, '5,3')}
          ${lineGroupD(totalSecPerDay,   maxSecDay,   '#6366f1', 'chart-group-sec-day',       secDayTips,      null, true, xsData)}
          ${lineGroupD(avgSecPerDay,     maxSecDay,   '#6366f1', 'chart-group-avg-sec-day',   avgSecDayTips,   null, true, xsData, '5,3')}
          ${rightAxisCharsD}
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
    // CPM scale: maps actual data range to top half (minCpm→midpoint, maxCpm→top)
    const cpmBottom = Math.max(0, Math.floor(Math.min(...cpms) * 0.95));
    const yScaleCpm = v => padT + (1 - (v - cpmBottom) / (maxCpmForecast - cpmBottom)) * (plotH / 2);
    const cpmTicksRun = [0, cpmBottom, Math.round((cpmBottom + maxCpmForecast) / 2), Math.round(maxCpmForecast)];
    const leftAxisRun = cpmTicksRun.map(t =>
      `<line x1="${padL}" y1="${yScaleCpm(t).toFixed(1)}" x2="${W - padR}" y2="${yScaleCpm(t).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
       <text x="${padL - 5}" y="${(yScaleCpm(t) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#3b82f6">${t}</text>`
    ).join('');

    function smoothLine(vals, maxV, color, groupId, dash, extra = '', hidden = false, yFn = null) {
      const pts = vals.map((v, i) => `${xPos(i).toFixed(1)},${(yFn ? yFn(v) : yScale(v, maxV)).toFixed(1)}`);
      const da = dash ? ` stroke-dasharray="${dash}"` : '';
      const disp = hidden ? ' style="display:none"' : '';
      return `<g id="${groupId}"${disp}><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" opacity="0.8"${da}/>${extra}</g>`;
    }
    const trendDots = [n, n+3, n+6, n+9].map(i => {
      const v = trendVals[i];
      const x = xPos(i).toFixed(1), y = yScaleCpm(v).toFixed(1);
      const tip = `Прогноз #${i + 1}: ${Math.round(v)} зн/мин`.replace(/"/g, '&quot;');
      return `<circle cx="${x}" cy="${y}" r="4" fill="#06b6d4" stroke="#fff" stroke-width="1.5" data-tip="${tip}" style="cursor:pointer"/>`;
    }).join('');
    const trendNowDot = (() => {
      const v = trendVals[n - 1];
      const x = xPos(n - 1).toFixed(1), y = yScaleCpm(v).toFixed(1);
      const tip = `Тренд сейчас: ${Math.round(v)} зн/мин`.replace(/"/g, '&quot;');
      return `<circle cx="${x}" cy="${y}" r="4" fill="#06b6d4" stroke="#fff" stroke-width="1.5" data-tip="${tip}" style="cursor:pointer"/>`;
    })();
    const trendLine = smoothLine(trendVals, maxCpmForecast, '#06b6d4', 'chart-group-trend', '6,3', trendDots + trendNowDot, false, yScaleCpm);
    const lowerTrendVals = trendVals.map(v => v * 0.9);
    const lowerNowDot = (() => {
      const v = lowerTrendVals[n - 1];
      const x = xPos(n - 1).toFixed(1), y = yScaleCpm(v).toFixed(1);
      const tip = `Нижний тренд сейчас: ${Math.round(v)} зн/мин`.replace(/"/g, '&quot;');
      return `<circle cx="${x}" cy="${y}" r="4" fill="#06b6d4" stroke="#fff" stroke-width="1.5" data-tip="${tip}" style="cursor:pointer"/>`;
    })();
    const lowerTrendLine = smoothLine(lowerTrendVals, maxCpmForecast, '#06b6d4', 'chart-group-lower-trend', '3,4', lowerNowDot, false, yScaleCpm);

    // Скользящее среднее (формула Клавогонок)
    // EMA computed over full history so filtered views continue where they left off
    const _emaSource = fullRuns ?? allRuns;
    const _emaFull = [];
    let _ema = 0;
    for (let i = 0; i < _emaSource.length; i++) {
      const ni = i + 1;
      const w = ni < 50 ? 1 / ni : 1 / 50;
      _ema = _ema + w * (_emaSource[i].cpm - _ema);
      _emaFull.push(_ema);
    }
    const emaVals = allRuns.map(run => {
      const gi = globalIdxOf?.get(run) ?? allRuns.indexOf(run);
      return _emaFull[gi];
    });
    const emaTips = emaVals.map((v, i) => {
      const result = v.toFixed(1);
      const gi = globalIdxOf?.get(allRuns[i]) ?? i;
      if (gi === 0) return `#${gi + 1} · Скользящее: ${result} зн/мин\nНачальное значение`;
      const prev = _emaFull[gi - 1].toFixed(1);
      const denom = gi < 49 ? gi + 1 : 50;
      return `#${gi + 1} · Скользящее: ${result} зн/мин\n${prev} + 1/${denom} × (${allRuns[i].cpm} − ${prev}) = ${result}`;
    });

    // Error trend forecast dots (errTrendVals/maxErrForecast computed earlier)
    const errTrendDots = errTrendVals ? [n, n+3, n+6, n+9].map(i => {
      const v = errTrendVals[i];
      const x = xPos(i).toFixed(1), y = yScaleErr(v).toFixed(1);
      const tip = `Прогноз #${i + 1}: ${v.toFixed(1)}%`.replace(/"/g, '&quot;');
      return `<circle cx="${x}" cy="${y}" r="4" fill="#b91c1c" stroke="#fff" stroke-width="1.5" data-tip="${tip}" style="cursor:pointer"/>`;
    }).join('') : '';
    const midErrTrendVals = errTrendVals ? errTrendVals.map(v => v / 2) : null;
    const midErrNowDot = midErrTrendVals ? (() => {
      const v = midErrTrendVals[n - 1];
      const x = xPos(n - 1).toFixed(1), y = yScaleErr(v).toFixed(1);
      const tip = `Средний тренд ошибок сейчас: ${v.toFixed(1)}%`.replace(/"/g, '&quot;');
      return `<circle cx="${x}" cy="${y}" r="4" fill="#b91c1c" stroke="#fff" stroke-width="1.5" data-tip="${tip}" style="cursor:pointer"/>`;
    })() : '';
    const lowerErrTrendVals = errTrendVals ? errTrendVals.map(v => v / 3) : null;
    const lowerErrNowDot = lowerErrTrendVals ? (() => {
      const v = lowerErrTrendVals[n - 1];
      const x = xPos(n - 1).toFixed(1), y = yScaleErr(v).toFixed(1);
      const tip = `Нижний тренд ошибок сейчас: ${v.toFixed(1)}%`.replace(/"/g, '&quot;');
      return `<circle cx="${x}" cy="${y}" r="4" fill="#b91c1c" stroke="#fff" stroke-width="1.5" data-tip="${tip}" style="cursor:pointer"/>`;
    })() : '';

    // Error EMA (α=0.1) over full history
    const _errEmaFull = [];
    let _errEmaPrev = null;
    for (const r of _emaSource) {
      const v = r.errors != null && r.chars ? r.errors / r.chars * 100 : null;
      if (v === null) { _errEmaFull.push(null); continue; }
      _errEmaPrev = _errEmaPrev === null ? v : _errEmaPrev * 0.9 + v * 0.1;
      _errEmaFull.push(_errEmaPrev);
    }
    const errEmaVals = allRuns.map(run => {
      const gi = globalIdxOf?.get(run) ?? allRuns.indexOf(run);
      return _errEmaFull[gi];
    });
    const errEmaTips = errEmaVals.map((v, i) => {
      if (v === null) return '';
      const gi   = globalIdxOf?.get(allRuns[i]) ?? i;
      const result = v.toFixed(2);
      const prev = gi > 0 && _errEmaFull[gi - 1] !== null ? _errEmaFull[gi - 1].toFixed(2) : null;
      const cur  = errs[i]?.toFixed(2);
      return prev
        ? `#${gi + 1} · Угасающее ошибок: ${result}%\n${prev} × 0.9 + ${cur} × 0.1 = ${result}`
        : `#${gi + 1} · Угасающее ошибок: ${result}%\nНачальное значение`;
    });

    const durations = allRuns.map(r => r.chars ?? null);
    const maxDuration = Math.max(...durations.filter(v => v !== null)) || 1;
    const durTicks = [0, Math.round(maxDuration / 2), Math.round(maxDuration)];
    const leftAxisDur = durTicks.map(t =>
      `<line x1="${padL}" y1="${yScale(t, maxDuration).toFixed(1)}" x2="${W - padR}" y2="${yScale(t, maxDuration).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
       <text x="${padL - 5}" y="${(yScale(t, maxDuration) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#f97316">${t}</text>`
    ).join('');
    const durTips = allRuns.map((r, i) =>
      `#${i + 1} · ${r.date} ${r.time ?? ''}\n${r.chars} букв`
    );
    const durSec = allRuns.map(r => r.seconds ?? null);
    const maxDurSec = Math.max(...durSec.filter(v => v !== null)) || 1;
    const secTicks = [0, Math.round(maxDurSec / 2), Math.round(maxDurSec)];
    const rightAxisDur = secTicks.map(t =>
      `<text x="${W - padR + 5}" y="${(yScale(t, maxDurSec) + 4).toFixed(1)}" text-anchor="start" font-size="10" fill="#6366f1">${formatTime(t)}</text>`
    ).join('');
    const secTips = allRuns.map((r, i) =>
      `#${i + 1} · ${r.date} ${r.time ?? ''}\n${formatTime(r.seconds)}`
    );

    return `<div class="chart-block">
      <div class="chart-block-inner">
      <div class="chart-date-range">
        <input type="date" id="chart-from" value="${fromIso}" class="chart-date-input">
        <span style="color:var(--text-dim)">—</span>
        <input type="date" id="chart-to" value="${toIso}" class="chart-date-input">
        <button id="btn-chart-last50" class="chart-all-btn">последние 50</button>
        <button id="btn-chart-all" class="chart-all-btn">весь период</button>
      </div>
      <div class="chart-legend">
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-cpm" checked> <span style="color:#3b82f6">● скорость, зн/мин</span></label>
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-trend" checked> <span style="color:#06b6d4">● тренд</span></label>
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-ema"> <span style="color:#f97316">● скользящее</span></label>
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-rolling5"> <span style="color:#a855f7">● ср-5, зн/мин</span></label>
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-err" checked> <span style="color:#ef4444">● ошибки, %</span></label>
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-err-trend" checked> <span style="color:#b91c1c">╌ тренд ошибок</span></label>
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-err-ema"> <span style="color:#f97316">● скользящее ошибок</span></label>
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-err-rolling5"> <span style="color:#a855f7">● ср-5 ошибок</span></label>
      </div>
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" data-plot-r="${W - padR}">
        ${leftAxisRun}
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${W - padR}" y1="${padT}" x2="${W - padR}" y2="${padT + plotH}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${padL}" y1="${(padT + plotH / 2).toFixed(1)}" x2="${W - padR}" y2="${(padT + plotH / 2).toFixed(1)}" stroke="#d1d5db" stroke-width="1" stroke-dasharray="4,3"/>
        ${lowerTrendLine}
        ${trendLine}
        ${lineGroup(cpmRolling10, maxCpmForecast, '#a855f7', 'chart-group-rolling5', rolling10Tips, rolling10Records, true, null, yScaleCpm)}
        ${lineGroup(emaVals, maxCpmForecast, '#f97316', 'chart-group-ema', emaTips, null, true, null, yScaleCpm)}
        ${lineGroup(cpms, maxCpmForecast, '#3b82f6', 'chart-group-cpm', tips, cpmRecords, false, cpms.map((v, i) => v < trendVals[i] ? '#93c5fd' : '#3b82f6'), yScaleCpm)}
        ${lineGroup(errs, maxErrForecast, '#ef4444', 'chart-group-err', tips, errRecords, false, null, yScaleErr)}
        ${lineGroup(errEmaVals, maxErrForecast, '#f97316', 'chart-group-err-ema', errEmaTips, null, true, null, yScaleErr)}
        ${lineGroup(errRolling10, maxErrForecast, '#a855f7', 'chart-group-err-rolling5', tips, null, true, null, yScaleErr)}
        ${errTrendVals ? smoothLine(errTrendVals, maxErrForecast, '#b91c1c', 'chart-group-err-trend', '6,3', errTrendDots, false, yScaleErr) : ''}
        ${midErrTrendVals ? smoothLine(midErrTrendVals, maxErrForecast, '#b91c1c', 'chart-group-mid-err-trend', '3,4', midErrNowDot, false, yScaleErr) : ''}
        ${lowerErrTrendVals ? smoothLine(lowerErrTrendVals, maxErrForecast, '#b91c1c', 'chart-group-lower-err-trend', '2,5', lowerErrNowDot, false, yScaleErr) : ''}
        ${rightAxis}
        ${xLabels}
      </svg>
    </div>
    <div class="chart-block">
      <div class="chart-block-inner">
      <div class="chart-legend">
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-dur"> <span style="color:#f97316">● букв за заезд</span></label>
        <label class="chart-legend-item"><input type="checkbox" id="chart-toggle-dur-sec"> <span style="color:#6366f1">● длительность</span></label>
      </div>
      </div>
      <svg id="chart-svg-dur" viewBox="0 0 ${W} ${H}" style="width:100%;display:none" data-plot-r="${W - padR}">
        ${leftAxisDur}
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${W - padR}" y1="${padT}" x2="${W - padR}" y2="${padT + plotH}" stroke="#d1d5db" stroke-width="1"/>
        <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#d1d5db" stroke-width="1"/>
        ${lineGroup(durations, maxDuration, '#f97316', 'chart-group-dur', durTips, null, true)}
        ${lineGroup(durSec, maxDurSec, '#6366f1', 'chart-group-dur-sec', secTips, null, true)}
        ${rightAxisDur}
        ${xLabels}
      </svg>
    </div>`;
  }

  function applyRunFilters(allRuns) {
    return allRuns.filter(r =>
      filterTextSets.has(r.textSet ?? 1) &&
      filterModes.has(_effectiveMode(r)) &&
      filterExternalFeatures.has(r.externalFeature || 'laptop')
    );
  }

  function renderFilters(allRuns) {
    const el = document.getElementById('stats-filters');
    if (!el) return;
    const usedSets  = [...new Set(allRuns.map(r => r.textSet ?? 1))].sort((a,b) => a-b);
    const usedModes = [...new Set(allRuns.map(_effectiveMode))].sort((a,b) => a-b);
    const usedExternalFeatures = [...new Set(allRuns.map(r => r.externalFeature || 'laptop'))].sort();
    for (const s of usedSets)  if (!_seenTextSets.has(s)) { _seenTextSets.add(s); filterTextSets.add(s); }
    for (const m of usedModes) if (!_seenModes.has(m))    { _seenModes.add(m); if (m <= _currentMode) filterModes.add(m); }
    for (const f of usedExternalFeatures) if (!_seenExternalFeatures.has(f)) { _seenExternalFeatures.add(f); filterExternalFeatures.add(f); }
    const makeRow = (label, items, names, activeSet, attr) => {
      if (!items.length) return '';
      const cbs = items.map(v =>
        `<label class="stats-filter-cb"><input type="checkbox" ${attr}="${v}"${activeSet.has(v) ? ' checked' : ''}>${names[v] ?? v}</label>`
      ).join('');
      return `<div class="stats-filter-row"><span class="stats-filter-label">${label}</span>${cbs}</div>`;
    };
    el.innerHTML = makeRow('Текст:', usedSets, _TEXT_SET_NAMES, filterTextSets, 'data-filter-set') +
                   makeRow('Режим:', usedModes, _MODE_NAMES, filterModes, 'data-filter-mode') +
                   makeRow('Особенности:', usedExternalFeatures, _EXTERNAL_FEATURE_NAMES, filterExternalFeatures, 'data-filter-ext');
    el.querySelectorAll('[data-filter-set]').forEach(cb => {
      cb.addEventListener('change', () => {
        const s = +cb.dataset.filterSet;
        cb.checked ? filterTextSets.add(s) : filterTextSets.delete(s);
        renderStats(runs);
      });
    });
    el.querySelectorAll('[data-filter-mode]').forEach(cb => {
      cb.addEventListener('change', () => {
        const m = +cb.dataset.filterMode;
        cb.checked ? filterModes.add(m) : filterModes.delete(m);
        renderStats(runs);
      });
    });
    el.querySelectorAll('[data-filter-ext]').forEach(cb => {
      cb.addEventListener('change', () => {
        const f = cb.dataset.filterExt;
        cb.checked ? filterExternalFeatures.add(f) : filterExternalFeatures.delete(f);
        renderStats(runs);
      });
    });
  }

  function renderStats(allRuns) {
    const summaryEl = document.getElementById('stats-summary');
    const tableWrap = document.getElementById('stats-table-wrap');

    if (!summaryEl || !tableWrap) return;

    const lastRun    = allRuns[allRuns.length - 1];
    // A run is truly incomplete only if it hasn't reached totalChars
    const trulyIncomplete = r => r.incomplete && (!r.totalChars || r.chars < r.totalChars);
    const inProgress = lastRun && trulyIncomplete(lastRun) ? lastRun : null;
    lastInProgress = inProgress;

    allRuns = allRuns.filter(r => !trulyIncomplete(r));

    renderFilters(allRuns);
    const filteredRuns = applyRunFilters(allRuns);
    lastFilteredRuns = filteredRuns;

    const chartsEl = document.getElementById('stats-charts');

    const sizeElEarly = document.getElementById('storage-size');
    if (sizeElEarly) {
      const raw     = localStorage.getItem('klavagonki_stats') || '';
      const lsBytes = new TextEncoder().encode(raw).length;
      const lsKb    = Math.round(lsBytes / 1024);
      const lsPct   = Math.round(lsBytes / (5 * 1024 * 1024) * 100);
      const gistStr   = serializeRunsForGist(runs);
      const gistBytes = new TextEncoder().encode(gistStr).length;
      const gistKb    = Math.round(gistBytes / 1024);
      const gistPct   = Math.round(gistBytes / (10 * 1024 * 1024) * 100);
      sizeElEarly.textContent = `Локал: ${lsKb} КБ / 5 МБ (${lsPct}%) · Гист: ${gistKb} КБ / 10 МБ (${gistPct}%)`;
    }
    checkStorageWarning();

    if (!allRuns.length) {
      summaryEl.innerHTML = '<p style="color:var(--text-dim);font-size:0.9rem">Заездов пока нет.</p>';
      if (chartsEl) chartsEl.innerHTML = '';
      tableWrap.innerHTML = '';
      return;
    }

    if (!filteredRuns.length) {
      summaryEl.innerHTML = '';
      if (chartsEl) chartsEl.innerHTML = '';
      tableWrap.innerHTML = '';
      return;
    }

    if (chartsEl) {
      const complete = filteredRuns;
      const allDates = complete.map(r => ruToIso(r.date));
      const minIso = allDates[0];
      const maxIso = allDates[allDates.length - 1];

      function renderCharts(fromIso, toIso) {
        const displayed = complete.filter(r => {
          const iso = ruToIso(r.date);
          return iso >= fromIso && iso <= toIso;
        });
        const src = displayed.length >= 2 ? displayed : complete;

        // Aggregate by day or week
        function aggregateRuns(runsArr, groupKeyFn, sortKeyFn, labelFn) {
          const map = {};
          for (const r of runsArr) {
            const key = groupKeyFn(r);
            if (!map[key]) map[key] = [];
            map[key].push(r);
          }
          return Object.entries(map)
            .sort(([a], [b]) => sortKeyFn(a, b))
            .map(([key, grpRuns]) => ({
              date: labelFn(key),
              time: '',
              level: Math.round(grpRuns.reduce((s, r) => s + (r.level || 0), 0) / grpRuns.length),
              cpm:    Math.round(grpRuns.reduce((s, r) => s + r.cpm, 0) / grpRuns.length),
              cpmMax: Math.max(...grpRuns.map(r => r.cpm)),
              cpmMin: Math.min(...grpRuns.map(r => r.cpm)),
              errors: grpRuns.every(r => r.errors != null)
                ? Math.round(grpRuns.reduce((s, r) => s + r.errors, 0) / grpRuns.length)
                : null,
              chars:  Math.round(grpRuns.reduce((s, r) => s + r.chars, 0) / grpRuns.length),
              errPctMax: (() => { const v = grpRuns.filter(r => r.errors != null && r.chars); return v.length ? Math.max(...v.map(r => r.errors / r.chars * 100)) : null; })(),
              errPctMin: (() => { const v = grpRuns.filter(r => r.errors != null && r.chars); return v.length ? Math.min(...v.map(r => r.errors / r.chars * 100)) : null; })(),
              seconds: grpRuns.reduce((s, r) => s + r.seconds, 0),
              avgSeconds: Math.round(grpRuns.reduce((s, r) => s + r.seconds, 0) / grpRuns.length),
              totalCharsDay: grpRuns.reduce((s, r) => s + r.chars, 0),
              _count: grpRuns.length,
            }));
        }

        let chartRuns = src;
        if (tableMode === 'days') {
          chartRuns = aggregateRuns(src,
            r => r.date,
            (a, b) => parseRuDate(a) - parseRuDate(b),
            key => key
          );
        } else if (tableMode === 'weeks') {
          chartRuns = aggregateRuns(src,
            r => { const [d, m, y] = r.date.split('.').map(Number); return isoWeekKey(new Date(y, m - 1, d)); },
            (a, b) => (a < b ? -1 : a > b ? 1 : 0),
            key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('ru-RU'); }
          );
        }

        chartsEl.innerHTML = buildCharts(chartRuns, fromIso, toIso, tableMode === 'runs' ? complete : null, tableMode);

        const fromInput = document.getElementById('chart-from');
        const toInput   = document.getElementById('chart-to');
        if (fromInput) fromInput.addEventListener('change', () => { chartFromIso = fromInput.value; renderCharts(fromInput.value, toInput?.value || maxIso); });
        if (toInput)   toInput.addEventListener('change',   () => { chartToIso   = toInput.value;   renderCharts(fromInput?.value || minIso, toInput.value); });
        const btnLast50 = document.getElementById('btn-chart-last50');
        if (btnLast50) btnLast50.addEventListener('click', () => { chartFromIso = ''; chartToIso = ''; renderCharts(getDefaultFromIso(), maxIso); });
        const btnAll = document.getElementById('btn-chart-all');
        if (btnAll) btnAll.addEventListener('click', () => { chartFromIso = ''; chartToIso = ''; renderCharts(minIso, maxIso); });

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
          ['chart-group-trend', 'chart-group-lower-trend'].forEach(id => {
            const g = document.getElementById(id);
            if (g) g.style.display = togTrend.checked ? '' : 'none';
          });
        });
        const togErrTrend = document.getElementById('chart-toggle-err-trend');
        if (togErrTrend) togErrTrend.addEventListener('change', () => {
          ['chart-group-err-trend', 'chart-group-mid-err-trend', 'chart-group-lower-err-trend'].forEach(id => {
            const g = document.getElementById(id);
            if (g) g.style.display = togErrTrend.checked ? '' : 'none';
          });
        });
        const togErrEma = document.getElementById('chart-toggle-err-ema');
        if (togErrEma) togErrEma.addEventListener('change', () => {
          const g = document.getElementById('chart-group-err-ema');
          if (g) g.style.display = togErrEma.checked ? '' : 'none';
        });
        const togErrRolling5 = document.getElementById('chart-toggle-err-rolling5');
        if (togErrRolling5) togErrRolling5.addEventListener('change', () => {
          const g = document.getElementById('chart-group-err-rolling5');
          if (g) g.style.display = togErrRolling5.checked ? '' : 'none';
        });
        const togEma = document.getElementById('chart-toggle-ema');
        if (togEma) togEma.addEventListener('change', () => {
          const g = document.getElementById('chart-group-ema');
          if (g) g.style.display = togEma.checked ? '' : 'none';
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
        function wireGroupChart(svgId, pairs) {
          // pairs: [[checkboxId, groupId], ...]
          // SVG shown when any checkbox checked, hidden when all unchecked
          function syncSvg() {
            const svg = document.getElementById(svgId);
            if (!svg) return;
            const any = pairs.some(([id]) => document.getElementById(id)?.checked);
            svg.style.display = any ? 'block' : 'none';
          }
          pairs.forEach(([togId, grpId]) => {
            const el = document.getElementById(togId);
            if (!el) return;
            el.addEventListener('change', () => {
              const g = document.getElementById(grpId);
              if (g) g.style.display = el.checked ? '' : 'none';
              syncSvg();
            });
          });
        }
        wireGroupChart('chart-svg-chars-day', [
          ['chart-toggle-chars-day',     'chart-group-chars-day'],
          ['chart-toggle-avg-chars-day', 'chart-group-avg-chars-day'],
          ['chart-toggle-sec-day',       'chart-group-sec-day'],
          ['chart-toggle-avg-sec-day',   'chart-group-avg-sec-day'],
        ]);
        wireGroupChart('chart-svg-dur', [
          ['chart-toggle-dur',     'chart-group-dur'],
          ['chart-toggle-dur-sec', 'chart-group-dur-sec'],
        ]);

        const fromEl = document.getElementById('chart-from');
        const toEl   = document.getElementById('chart-to');
        if (fromEl) { fromEl.min = minIso; fromEl.max = maxIso; }
        if (toEl)   { toEl.min   = minIso; toEl.max   = maxIso; }
        if (fromEl) fromEl.addEventListener('change', () => { chartFromIso = fromEl.value; renderCharts(fromEl.value, toEl?.value || maxIso); });
        if (toEl)   toEl.addEventListener('change',   () => { chartToIso   = toEl.value;   renderCharts(fromEl?.value || minIso, toEl.value); });

        let tip = document.getElementById('chart-tooltip');
        if (!tip) {
          tip = document.createElement('div');
          tip.id = 'chart-tooltip';
          tip.className = 'chart-tooltip';
          document.body.appendChild(tip);
        }
        chartsEl.querySelectorAll('svg').forEach(svg => {
          const shadeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          shadeRect.setAttribute('fill', 'rgba(0,0,0,0.08)');
          shadeRect.setAttribute('pointer-events', 'none');
          shadeRect.setAttribute('opacity', '0');
          svg.prepend(shadeRect);

          const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          vLine.setAttribute('stroke', '#9ca3af');
          vLine.setAttribute('stroke-width', '1');
          vLine.setAttribute('stroke-dasharray', '4,3');
          vLine.setAttribute('pointer-events', 'none');
          vLine.setAttribute('opacity', '0');
          svg.appendChild(vLine);

          svg.querySelectorAll('circle').forEach(c => { c.dataset.r = c.getAttribute('r'); });

          svg.addEventListener('mouseover', e => {
            const el = e.target.closest('[data-tip]');
            if (!el) return;
            tip.textContent = '';
            el.dataset.tip.split('\n').forEach((line, i) => {
              if (i) tip.appendChild(document.createElement('br'));
              tip.appendChild(document.createTextNode(line));
            });
            tip.classList.add('visible');

            const cx = parseFloat(el.getAttribute('cx'));
            const cy = parseFloat(el.getAttribute('cy'));
            if (!isNaN(cy)) {
              const totalH = parseFloat(svg.getAttribute('viewBox').split(' ')[3]);
              const plotR  = parseFloat(svg.dataset.plotR || '714');
              const bottom = totalH - 26;
              const shadeY = Math.min(cy, bottom);
              shadeRect.setAttribute('x', '46');
              shadeRect.setAttribute('y', shadeY.toFixed(1));
              shadeRect.setAttribute('width', (plotR - 46).toFixed(1));
              shadeRect.setAttribute('height', Math.max(0, bottom - shadeY).toFixed(1));
              shadeRect.setAttribute('opacity', '1');

              if (!isNaN(cx)) {
                vLine.setAttribute('x1', cx.toFixed(1));
                vLine.setAttribute('x2', cx.toFixed(1));
                vLine.setAttribute('y1', '16');
                vLine.setAttribute('y2', bottom.toFixed(1));
                vLine.setAttribute('opacity', '1');
              }

              const hoveredGroup = el.closest('g');
              svg.querySelectorAll('circle').forEach(c => {
                const origR = parseFloat(c.dataset.r);
                const sameSeries = hoveredGroup && hoveredGroup.contains(c);
                c.setAttribute('r', (sameSeries && parseFloat(c.getAttribute('cy')) <= cy)
                  ? c.dataset.r
                  : (origR / 1.5).toFixed(2));
              });
              chartsEl.querySelectorAll('svg').forEach(otherSvg => {
                if (otherSvg === svg) return;
                otherSvg.querySelectorAll('circle').forEach(c => {
                  c.setAttribute('r', (parseFloat(c.dataset.r) / 1.5).toFixed(2));
                });
              });

              const svgRect = svg.getBoundingClientRect();
              const screenY = svgRect.top + (cy / totalH) * svgRect.height;
              tip.style.left = (svgRect.right + 8) + 'px';
              tip.style.top  = (screenY - tip.offsetHeight / 2) + 'px';
            }
          });
          svg.addEventListener('mouseout', e => {
            if (!e.target.closest('[data-tip]')) return;
            tip.classList.remove('visible');
            shadeRect.setAttribute('opacity', '0');
            vLine.setAttribute('opacity', '0');
            chartsEl.querySelectorAll('circle').forEach(c => c.setAttribute('r', c.dataset.r));
          });
          svg.addEventListener('click', e => {
            const el = e.target.closest('[data-idx]');
            if (!el) return;
            const idx = parseInt(el.dataset.idx, 10);
            const run = chartRuns[idx];
            if (!run) return;
            const key = run._count !== undefined
              ? run.date
              : run.date + '~' + (run.time ?? '');
            document.querySelectorAll('tr.row--chart-selected').forEach(r => r.classList.remove('row--chart-selected'));
            const row = document.querySelector(`tr[data-run-key="${key}"]`);
            if (!row) return;
            row.classList.add('row--chart-selected');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        });
      }

      function localIso(d) {
        const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
      }
      function getDefaultFromIso() {
        if (tableMode === 'days') {
          const d = parseRuDate(complete[complete.length - 1].date);
          d.setDate(d.getDate() - 49);
          return localIso(d);
        }
        if (tableMode === 'weeks') {
          const lastMon = getMonday(parseRuDate(complete[complete.length - 1].date));
          lastMon.setDate(lastMon.getDate() - 49 * 7);
          return localIso(lastMon);
        }
        // runs mode: last 50 runs
        return ruToIso(complete[Math.max(0, complete.length - 50)].date);
      }
      const defaultFromIso = getDefaultFromIso();
      chartDefaultFrom = defaultFromIso;
      renderChartsNow = () => renderCharts(chartFromIso || getDefaultFromIso(), chartToIso || maxIso);
      renderCharts(chartFromIso || defaultFromIso, chartToIso || maxIso);
    }

    const last5R  = last10Runs(filteredRuns);
    const allCpm  = filteredRuns.map(r => r.cpm);
    const last5Cpm = last5R.map(r => r.cpm);
    const emaValue = calcEma(filteredRuns);

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
            <span class="summary-value">${(allCpm.reduce((s,v)=>s+v,0)/allCpm.length).toFixed(1)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Заездов</span>
            <span class="summary-value">${filteredRuns.length}</span>
          </div>
        </div>
      </div>
      ${last5R.length > 1 ? `
      <div class="summary-group clickable-card" data-period="last10">
        <div class="summary-group-title">Последние ${last5R.length}</div>
        <div class="summary-row">
          <div class="summary-item">
            <span class="summary-label">Макс. скорость</span>
            <span class="summary-value">${max(last5Cpm)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Средняя скорость</span>
            <span class="summary-value">${(last5Cpm.reduce((s,v)=>s+v,0)/last5Cpm.length).toFixed(1)} зн/мин</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Заездов</span>
            <span class="summary-value">${last5R.length}</span>
          </div>
        </div>
      </div>` : ''}
      ${emaValue !== null ? `
      <div class="summary-group">
        <div class="summary-group-title">Скользящее среднее</div>
        <div class="summary-row">
          <div class="summary-item">
            <span class="summary-label">Скользящее среднее</span>
            <span class="summary-value">${emaValue} зн/мин</span>
          </div>
        </div>
      </div>` : ''}
    `;

    // Click summary cards to show aggregated error frequency
    summaryEl.querySelectorAll('.clickable-card').forEach(card => {
      card.addEventListener('click', () => {
        const period = card.dataset.period;
        let subset, label;
        if (period === 'all')     { subset = filteredRuns; label = 'За всё время'; }
        if (period === 'last10')  { subset = last5R;      label = `Последние ${last5R.length}`; }
        if (period === 'lastday') { subset = lastDayRuns;  label = lastDayLabel; }
        showErrorModal(label, buildDetailHtml(subset));
      });
    });

    renderTable(filteredRuns, inProgress);

  }

  function fmtAmPm(timeStr) {
    if (!timeStr) return '—';
    // Already AM/PM
    if (/[AP]M/i.test(timeStr)) return timeStr;
    // Convert HH:MM (24h) → h:MM AM/PM
    const [hStr, mStr] = timeStr.split(':');
    const h = parseInt(hStr, 10);
    if (isNaN(h)) return timeStr;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h % 12 || 12;
    return `${h12}:${mStr} ${ampm}`;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}м ${String(s).padStart(2, '0')}с` : `${s}с`;
  }

  function getTodayRunCount() {
    const today = todayStr();
    return runs.filter(r => r.date === today && !r.lazy && !r.incomplete).length;
  }

  function getRecentAvgCpm() {
    const recent = last10Runs(runs.filter(r => !r.incomplete));
    if (!recent.length) return 0;
    return Math.round(recent.reduce((s, r) => s + r.cpm, 0) / recent.length);
  }

  function calcStars(cpm) {
    if (_starsMode === 'constants') {
      if (cpm >= 105) return 3;
      if (cpm >= 95)  return 2;
      if (cpm >= 90)  return 1;
      return 0;
    }
    const complete = runs.filter(r => !r.incomplete);
    const window = chartDefaultFrom
      ? complete.filter(r => ruToIso(r.date) >= chartDefaultFrom)
      : complete;
    const cpms = (window.length >= 2 ? window : complete).map(r => r.cpm);
    const n = cpms.length;
    if (n < 2) return 3;
    const xs = cpms.map((_, i) => i);
    const sx  = xs.reduce((s, x) => s + x, 0);
    const sy  = cpms.reduce((s, y) => s + y, 0);
    const sxy = xs.reduce((s, x, i) => s + x * cpms[i], 0);
    const sx2 = xs.reduce((s, x) => s + x * x, 0);
    const denom = n * sx2 - sx * sx || 1;
    const b = (n * sxy - sx * sy) / denom;
    const a = (sy - b * sx) / n;
    const trend = a + b * (n - 1);
    const lower = trend * 0.9;
    if (cpm >= trend) return 3;
    if (cpm >= lower) return 2;
    return 1;
  }

  function getHighlightLevel() {
    const TEXT_SET_NUM = { neznaika:1, winnie:2, punct:3, wizard:4, numbers:5, godzilla:6, rules:7 };
    const curTextSet   = TEXT_SET_NUM[_currentTextSetId] ?? 1;
    const complete = runs.filter(r =>
      !r.incomplete &&
      (r.textSet ?? 1) === curTextSet &&
      (r.externalFeature || 'laptop') === _currentExternalFeature
    );
    let level = 2;
    while (level < 8) {
      const modeRuns = complete.filter(r => r.mode === level);
      if (modeRuns.length < 5) break;
      let mastered = false;
      for (let i = 0; i + 5 <= modeRuns.length; i++) {
        const avg = modeRuns.slice(i, i + 5).reduce((s, r) => s + r.cpm, 0) / 5;
        if (avg >= 100) { mastered = true; break; }
      }
      if (!mastered) break;
      level++;
    }
    return level;
  }

  let _currentTextSetId = 'neznaika';
  function setTextSetId(id) { _currentTextSetId = id; }

  let _currentMode = 1;
  function setMode(m) { _currentMode = m; }

  let _currentExternalFeature = 'laptop';
  function setExternalFeature(f) { _currentExternalFeature = f; }

  let _starsMode = 'trend';
  function setStarsMode(m) { _starsMode = m; }

  return { init, saveRun, renderStats, formatTime, getRecentAvgCpm, getRecordLabel, getTodayRunCount, calcStars, setTextSetId, setMode, setExternalFeature, setStarsMode, getHighlightLevel, getRuns: () => runs };
})();
