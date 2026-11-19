// Markdown formatting of the Composer's toolbar, as pure edits: each takes the
// text and the selection and returns the new text and where the caret goes.

/** Wraps the selection in `before` / `after` (or puts them at the caret). */
export function wrap(text, start, end, before, after = before) {
  const picked = text.slice(start, end);
  const next = text.slice(0, start) + before + picked + after + text.slice(end);
  const caret = picked ? start + before.length + picked.length + after.length : start + before.length;
  return { text: next, caret };
}

/** Puts `insert` in place of the selection, the caret after it. */
export function insertAt(text, start, end, insert) {
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}

/** Starts the caret's line with `prefix` ("# ", "- ", "> "...). */
export function prefixLine(text, start, prefix) {
  const at = start > 0 ? text.lastIndexOf('\n', start - 1) + 1 : 0;
  return { text: text.slice(0, at) + prefix + text.slice(at), caret: start + prefix.length };
}

/** A markdown link around the selection (or `label` when none is picked). */
export function link(text, start, end, url, label) {
  const shown = text.slice(start, end) || label;
  return insertAt(text, start, end, `[${shown}](${url})`);
}

export const TABLE = '\n| Header 1 | Header 2 | Header 3 |\n|----------|----------|----------|\n| Cell 1   | Cell 2   | Cell 3   |\n| Cell 4   | Cell 5   | Cell 6   |\n';
