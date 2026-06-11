// Highlight mode behaviour table — single source of truth.
// Editing any field, renaming, reordering or appending entries here is the
// only change required to alter the highlight modes; renderer code in
// app.js and label code in stats.js read everything off this array.
//
// Fields:
//   value:  string id stored in localStorage and used as <option value>
//   label:  human-readable name shown in the dropdown and stats badge
//   num:    integer persisted on each run (run.mode). Must stay stable
//           across releases so historical run.mode values keep mapping
//           back to the correct mode.
//   normal: top-text rendering while typing without an error. One of:
//             'cursor'       cursor highlighted green, past chars coloured
//             'prefix'       past chars coloured, cursor pending
//             'underline'    current word stays pending and underlined
//             'word-end'     current word stays pending, past words coloured
//             'all-pending'  every char stays pending
//   error:  top-text rendering when there's an active mistake. Same vocab
//           plus 'cursor-red' (cursor red) and 'word-red' (whole current
//           word red). Use the same value as `normal` to mean "no extra
//           error indication".
//   bottom: lower word-box on error. One of:
//             'chars+frame'  per-char red tint + red frame
//             'frame'        red frame only
//             'none'         neither
//   finger: whether to show the finger-hint row above the exercise.
const HIGHLIGHT_MODES = [
  { value: 'finger',           label: 'Палец + символ',     num: 1,  normal: 'cursor',      error: 'cursor-red',  bottom: 'chars+frame', finger: true  },
  { value: 'full',             label: 'Текущий символ',     num: 2,  normal: 'cursor',      error: 'cursor-red',  bottom: 'chars+frame', finger: false },
  { value: 'prefix-error',     label: 'Префикс + ошибка',   num: 11, normal: 'prefix',      error: 'cursor-red',  bottom: 'chars+frame', finger: false },
  { value: 'prefix',           label: 'Набранный префикс',  num: 3,  normal: 'prefix',      error: 'prefix',      bottom: 'chars+frame', finger: false },
  { value: 'word-error',       label: 'Слово и ошибки',     num: 4,  normal: 'prefix',      error: 'word-red',    bottom: 'chars+frame', finger: false },
  { value: 'klavogonki',       label: 'придумать название', num: 9,  normal: 'underline',   error: 'word-red',    bottom: 'chars+frame', finger: false },
  { value: 'klavogonki_ru',    label: 'klavogonki.ru',      num: 10, normal: 'underline',   error: 'word-red',    bottom: 'frame',       finger: false },
  { value: 'word-error-blind', label: 'Слово и рамка',      num: 5,  normal: 'word-end',    error: 'word-red',    bottom: 'frame',       finger: false },
  { value: 'none',             label: 'Только рамка',       num: 6,  normal: 'word-end',    error: 'word-end',    bottom: 'frame',       finger: false },
  { value: 'blind',            label: 'Слепой',             num: 7,  normal: 'word-end',    error: 'word-end',    bottom: 'none',        finger: false },
  { value: 'full-blind',       label: 'Полностью слепой',   num: 8,  normal: 'all-pending', error: 'all-pending', bottom: 'none',        finger: false },
];

const HIGHLIGHT_MODE_NUM           = Object.fromEntries(HIGHLIGHT_MODES.map(m => [m.value, m.num]));
const HIGHLIGHT_MODE_NAME          = Object.fromEntries(HIGHLIGHT_MODES.map(m => [m.num, m.value]));
const HIGHLIGHT_MODE_LABEL_BY_NUM  = Object.fromEntries(HIGHLIGHT_MODES.map(m => [m.num, m.label]));
const HIGHLIGHT_MODE_BY_VALUE      = Object.fromEntries(HIGHLIGHT_MODES.map(m => [m.value, m]));
