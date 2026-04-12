// ЙЦУКЕН layout — which finger presses each character
//
// Column positions (left to right):
//   Row 2: Й(1) Ц(2) У(3) К(4) Е(5) Н(6) Г(7) Ш(8) Щ(9) З(10) Х(11) Ъ(12)
//   Row 3: Ф(1) Ы(2) В(3) А(4) П(5) Р(6) О(7) Л(8)  Д(9) Ж(10) Э(11)
//   Row 4: Я(1) Ч(2) С(3) М(4) И(5) Т(6) Ь(7) Б(8)  Ю(9) .(10)
//
// Finger assignments (positions 1–5 = left hand, 6–12 = right hand):
//   Left pinky:        1        → Й Ф Я Ё
//   Left ring:         2        → Ц Ы Ч
//   Left middle:       3        → У В С
//   Left index:        4 and 5  → К Е А П М И
//   Right index:       6 and 7  → Н Г Р О Т Ь
//   Right middle:      8        → Ш Л Б
//   Right ring:        9        → Щ Д Ю
//   Right pinky:       10–12    → З Х Ъ Ж Э + punctuation

const FINGER_MAP = {
  // ── Left pinky ─────────────────────────────────────────────
  'ё': 'левый мизинец',
  'й': 'левый мизинец',
  'ф': 'левый мизинец',
  'я': 'левый мизинец',

  // ── Left ring ──────────────────────────────────────────────
  'ц': 'левый безымянный',
  'ы': 'левый безымянный',
  'ч': 'левый безымянный',

  // ── Left middle ────────────────────────────────────────────
  'у': 'левый средний',
  'в': 'левый средний',
  'с': 'левый средний',

  // ── Left index (positions 4 and 5) ─────────────────────────
  'к': 'левый указательный',  // row 2, pos 4
  'е': 'левый указательный',  // row 2, pos 5
  'а': 'левый указательный',  // row 3, pos 4
  'п': 'левый указательный',  // row 3, pos 5
  'м': 'левый указательный',  // row 4, pos 4
  'и': 'левый указательный',  // row 4, pos 5

  // ── Right index (positions 6 and 7) ────────────────────────
  'н': 'правый указательный', // row 2, pos 6
  'г': 'правый указательный', // row 2, pos 7
  'р': 'правый указательный', // row 3, pos 6
  'о': 'правый указательный', // row 3, pos 7
  'т': 'правый указательный', // row 4, pos 6
  'ь': 'правый указательный', // row 4, pos 7

  // ── Right middle (position 8) ──────────────────────────────
  'ш': 'правый средний',      // row 2, pos 8
  'л': 'правый средний',      // row 3, pos 8
  'б': 'правый средний',      // row 4, pos 8

  // ── Right ring (position 9) ────────────────────────────────
  'щ': 'правый безымянный',   // row 2, pos 9
  'д': 'правый безымянный',   // row 3, pos 9
  'ю': 'правый безымянный',   // row 4, pos 9

  // ── Right pinky (positions 10–12) ──────────────────────────
  'з': 'правый мизинец',      // row 2, pos 10
  'х': 'правый мизинец',      // row 2, pos 11
  'ъ': 'правый мизинец',      // row 2, pos 12
  'ж': 'правый мизинец',      // row 3, pos 10
  'э': 'правый мизинец',      // row 3, pos 11

  // ── Thumbs ─────────────────────────────────────────────────
  ' ': 'большой палец',

  // ── Punctuation — number row (Shift+digit) ──────────────────
  // Positions match the letter rows: same finger, same column
  '!': 'левый безымянный',    // Shift+1, pos 2  (like ц/ы/ч)
  '"': 'левый средний',       // Shift+2, pos 3  (like у/в/с)
  '№': 'левый указательный',  // Shift+3, pos 4  (like к/а/м)
  ';': 'левый указательный',  // Shift+4, pos 5  (like е/п/и)
  '%': 'левый указательный',  // Shift+5, pos 5  (like е/п/и)
  ':': 'правый указательный', // Shift+6, pos 6  (like н/р/т)
  '?': 'правый указательный', // Shift+7, pos 7  (like г/о/ь)

  // ── Punctuation — bottom row and far right ──────────────────
  '.': 'правый мизинец',      // bottom row, pos 10 (after ю)
  ',': 'правый мизинец',      // Shift+. (same key)
  '-': 'правый мизинец',      // number row, pos 12
  '—': 'правый мизинец',      // em dash (usually Alt+-)
  '«': 'правый мизинец',
  '»': 'правый мизинец',
};

/**
 * Returns the finger name for a character.
 * @param {string} char — single character
 * @returns {string} finger name with capitalised first letter, or empty string if unknown
 */
function getFinger(char) {
  if (!char) return '';
  const name = FINGER_MAP[char.toLowerCase()] || '';
  return name ? name[0].toUpperCase() + name.slice(1) : '';
}
