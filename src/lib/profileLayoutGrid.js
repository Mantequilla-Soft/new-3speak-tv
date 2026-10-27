// The Overview's 12-column grid: rows, columns and drag-and-drop placement for
// profile layouts (./profileLayout.js). No imports, so it can be tested alone.
//
// The layout is one ordered list. Structure comes from two fields:
//   span   width of a column in grid columns (read from the column's first
//          section; sections stacked under it share that width)
//   stack  true = this section sits UNDER the previous one, in its column
// Columns are packed into rows of GRID_COLUMNS the way CSS grid packs them.
// Hidden sections keep their place in that structure (a column whose top
// section is hidden is still the same column), they just aren't drawn.

export const GRID_COLUMNS = 12;
export const MIN_SPAN = 3;

export function clampSpan(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(GRID_COLUMNS, Math.max(MIN_SPAN, v)) : GRID_COLUMNS;
}

// The links page is either a sticky column beside the grid (side left/right)
// or a section in it (side 'none') like any other.
export const isSideColumn = (s) => s.type === 'links' && s.side !== 'none';
export const inFlow = (s) => !s.hidden && !isSideColumn(s);

// Every column, hidden sections included: [{ span, items }].
function allColumns(sections) {
  const cols = [];
  sections.filter((s) => !isSideColumn(s)).forEach((s) => {
    if (s.stack && cols.length) cols[cols.length - 1].items.push(s);
    else cols.push({ span: s.span, items: [s] });
  });
  return cols;
}

/**
 * What the page shows: rows of columns, each column the visible sections
 * stacked in it. [[{ span, items: [section…] }…]…]
 */
export function layoutRows(sections) {
  const rows = [];
  let row = [];
  let used = 0;
  allColumns(sections).forEach((col) => {
    const items = col.items.filter((s) => !s.hidden);
    if (!items.length) return;
    if (row.length && used + col.span > GRID_COLUMNS) { rows.push(row); row = []; used = 0; }
    row.push({ span: col.span, items });
    used += col.span;
  });
  if (row.length) rows.push(row);
  return rows;
}

const rowOf = (rows, id) => rows.find((r) => r.some((c) => c.items.some((s) => s.id === id))) || [];
const colOf = (rows, id) => rowOf(rows, id).find((c) => c.items.some((s) => s.id === id)) || null;

// A trailer with nothing beside it is just the player, so its section takes
// about the player's width (the profile's content column is ~1100px wide).
const TRAILER_SPAN = { sm: 5, md: 7, lg: 10, full: 12 };
export const trailerSpan = (s) => (!s.showInfo && !s.showSnap ? TRAILER_SPAN[s.size] || GRID_COLUMNS : GRID_COLUMNS);

/** The width of `id`'s whole column (the column's first section holds it). */
export function setColumnSpan(sections, id, span) {
  const col = allColumns(sections).find((c) => c.items.some((s) => s.id === id));
  if (!col) return sections;
  const ids = new Set(col.items.map((s) => s.id));
  return sections.map((s) => (ids.has(s.id) ? { ...s, span } : s));
}

/**
 * Swap `id` with the visible section before (dir -1) or after (+1) it. They
 * swap PLACES: each takes over the other's column and stacking, so the
 * structure of the page stays as it was.
 */
export function swapSection(sections, id, dir) {
  const flow = sections.filter(inFlow);
  const i = flow.findIndex((s) => s.id === id);
  const other = flow[i + dir];
  if (!other) return sections;
  const a = sections.findIndex((s) => s.id === id);
  const b = sections.findIndex((s) => s.id === other.id);
  const next = sections.slice();
  const place = (s, of) => ({ ...s, span: of.span, stack: of.stack });
  next[a] = place(sections[b], sections[a]);
  next[b] = place(sections[a], sections[b]);
  return next;
}

// Take `activeId` out of the layout without disturbing anything else:
//  - from the top of a column with sections under it: the next one becomes
//    the column's top (and keeps the width);
//  - the last section of a column: the column goes, and its width goes to a
//    neighbour when two or more columns stay in that row (so it stays filled).
//    A column left ALONE keeps its width: a trailer the creator narrowed
//    shouldn't spring back to full width because the videos moved away.
function detach(sections, activeId) {
  const i = sections.findIndex((s) => s.id === activeId);
  const active = sections[i];
  let rest = sections.filter((s) => s.id !== activeId);
  const col = allColumns(sections).find((c) => c.items.some((s) => s.id === activeId));
  if (!col) return rest;

  if (col.items.length > 1) {
    if (col.items[0].id === activeId) {
      const heir = col.items[1].id;
      rest = rest.map((s) => (s.id === heir ? { ...s, stack: false, span: active.span } : s));
    }
    return rest;
  }

  const row = rowOf(layoutRows(sections), activeId);
  if (row.length > 2) {
    const ci = row.findIndex((c) => c.items.some((s) => s.id === activeId));
    const neighbour = row[ci > 0 ? ci - 1 : 1];
    rest = setColumnSpan(rest, neighbour.items[0].id, Math.min(GRID_COLUMNS, neighbour.span + active.span));
  }
  return rest;
}

/** The links page out of the grid, as a sticky column on `side` (left/right). */
export function dockSection(sections, activeId, side) {
  const active = sections.find((s) => s.id === activeId);
  if (!active || active.type !== 'links') return sections;
  const at = sections.findIndex((s) => s.id === activeId);
  const next = detach(sections, activeId);
  next.splice(at, 0, { ...active, side, stack: false });
  return next;
}

/**
 * Drop section `activeId` on `overId`:
 *   left / right   → a new column beside the target's column, sized to the
 *                    row's free columns; a full row makes room from its widest
 *                    column (half of it, or MIN_SPAN for the links page)
 *   top / bottom   → in a row of several columns: into the target's column,
 *                    above / below it. In a row that is one full column: a new
 *                    full-width row before / after it.
 *   'row'          → `overId` is a section starting a row (or null = the end):
 *                    a new full-width row right there
 *   'free'         → `overId` ends a row: a new column in that row's free
 *                    space (the same as its right edge)
 */
export function dropSection(sections, activeId, overId, side) {
  const active = sections.find((s) => s.id === activeId);
  if (!active || activeId === overId) return sections;
  let rest = detach(sections, activeId);
  // Dropping the side column into the grid makes it a section there.
  const moved = { ...active, stack: false, ...(active.type === 'links' ? { side: 'none' } : {}) };
  const insert = (at) => {
    const next = rest.slice();
    next.splice(at < 0 ? next.length : at, 0, moved);
    return next;
  };

  if (side === 'row') {
    moved.span = GRID_COLUMNS;
    if (!overId) return insert(-1);
    // Before the whole column it starts (hidden sections at its top included).
    const startCol = allColumns(rest).find((c) => c.items.some((s) => s.id === overId));
    return insert(rest.findIndex((s) => s.id === (startCol?.items[0].id ?? overId)));
  }

  const rows = layoutRows(rest);
  const row = rowOf(rows, overId);
  const col = colOf(rows, overId);
  if (!col) return sections;
  const all = allColumns(rest).find((c) => c.items.some((s) => s.id === overId));
  const first = rest.findIndex((s) => s.id === all.items[0].id);
  const last = rest.findIndex((s) => s.id === all.items[all.items.length - 1].id);

  if (side === 'top' || side === 'bottom') {
    if (row.length === 1 && col.span === GRID_COLUMNS) {
      // A full-width row: a new row before / after it.
      moved.span = GRID_COLUMNS;
      return insert(side === 'top' ? first : last + 1);
    }
    const target = rest.findIndex((s) => s.id === overId);
    moved.span = col.span;
    if (side === 'bottom') {
      moved.stack = true;
      return insert(target + 1);
    }
    // Above the target: if it was the column's top, the newcomer takes over.
    if (target === first) {
      rest = rest.map((s) => (s.id === overId ? { ...s, stack: true } : s));
      return insert(target);
    }
    moved.stack = true;
    return insert(target);
  }

  // A new column beside the target's: left of it, or right of it / in the free space.
  const free = GRID_COLUMNS - row.reduce((n, c) => n + c.span, 0);
  if (free >= MIN_SPAN) {
    moved.span = free;
  } else {
    const widest = row.reduce((a, c) => (c.span > a.span ? c : a), row[0]);
    const want = active.type === 'links' ? MIN_SPAN : Math.floor(widest.span / 2);
    const give = want - Math.max(0, free);
    if (want >= MIN_SPAN && widest.span - give >= MIN_SPAN) {
      moved.span = want;
      rest = setColumnSpan(rest, widest.items[0].id, widest.span - give);
    } else {
      moved.span = GRID_COLUMNS;   // no room to share: own row instead
    }
  }
  return insert(side === 'left' ? first : last + 1);
}

/** Remove a section (a playlist section's bin), keeping its column together. */
export const removeSection = (sections, id) => detach(sections, id);
