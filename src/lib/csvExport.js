/**
 * A table as a CSV file the browser downloads (creator stats exports).
 *
 * RFC 4180 quoting; a cell that starts like a formula (= + - @, tab, CR) gets a
 * leading apostrophe so a spreadsheet shows it as text instead of running it:
 * titles and comments are written by other people.
 */
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** columns: [{ key, label }] (or a function `value(row)` instead of key). */
export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = (rows || []).map((r) => columns.map((c) => csvCell(c.value ? c.value(r) : r[c.key])).join(','));
  return [head, ...body].join('\r\n') + '\r\n';
}

export function downloadCsv(filename, text) {
  // The byte-order mark makes Excel read the file as UTF-8 (names, emoji).
  const blob = new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
