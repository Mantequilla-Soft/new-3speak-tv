// The profile Overview's 12 column grid (src/lib/profileLayoutGrid.js): how
// the ordered section list packs into rows and columns, and how swapping,
// docking, removing and drag-and-drop rewrite that list without disturbing
// the rest of the page.
import { describe, it, expect } from 'vitest'
import {
  GRID_COLUMNS,
  MIN_SPAN,
  clampSpan,
  isSideColumn,
  inFlow,
  layoutRows,
  trailerSpan,
  setColumnSpan,
  swapSection,
  dockSection,
  dropSection,
  removeSection,
} from '../../../src/lib/profileLayoutGrid.js'

// A section with a width; `stack` and other fields via `extra`.
const S = (id, span = 12, extra = {}) => ({ id, type: 'videos', span, stack: false, ...extra })
const under = (id, extra = {}) => S(id, 12, { stack: true, ...extra })
const links = (id, side, span = 12) => ({ id, type: 'links', side, span, stack: false })

// The page as ids and widths: [[ 'a:6', 'b+c:6' ], ...] ('+' joins a column's stack).
const shape = (sections) => layoutRows(sections).map((row) => row.map((c) => `${c.items.map((s) => s.id).join('+')}:${c.span}`))
const ids = (sections) => sections.map((s) => s.id)

describe('clampSpan', () => {
  it.each([
    [6, 6],
    [1, MIN_SPAN],
    [20, GRID_COLUMNS],
    [4.6, 5],
    ['7', 7],
    ['wide', GRID_COLUMNS],
    [undefined, GRID_COLUMNS],
  ])('%s -> %s', (input, expected) => {
    expect(clampSpan(input)).toBe(expected)
  })
})

describe('isSideColumn and inFlow', () => {
  it.each([
    [links('l', 'right'), true, false],
    [links('l', 'left'), true, false],
    [links('l', 'none'), false, true],
    [S('v'), false, true],
    [S('v', 12, { hidden: true }), false, false],
  ])('%o', (section, side, flow) => {
    expect(isSideColumn(section)).toBe(side)
    expect(inFlow(section)).toBe(flow)
  })
})

describe('layoutRows', () => {
  it('packs columns into rows of twelve the way CSS grid does', () => {
    expect(shape([S('a', 6), S('b', 6), S('c', 12), S('d', 8), S('e', 8)])).toEqual([
      ['a:6', 'b:6'], ['c:12'], ['d:8'], ['e:8'],
    ])
  })

  it('stacks sections under the previous one in its column', () => {
    expect(shape([S('a', 6), under('b'), S('c', 6)])).toEqual([['a+b:6', 'c:6']])
  })

  it('keeps a column whose top is hidden, and drops a column that is all hidden', () => {
    const sections = [S('a', 6, { hidden: true }), under('b'), S('c', 6, { hidden: true })]
    expect(shape(sections)).toEqual([['b:6']])
  })

  it('leaves the sticky links column out but draws links placed in the grid', () => {
    expect(shape([links('l', 'right'), S('a', 6)])).toEqual([['a:6']])
    expect(shape([links('l', 'none', 6), S('a', 6)])).toEqual([['l:6', 'a:6']])
  })

  it('treats a stacked first section as a column of its own', () => {
    expect(shape([under('a')])).toEqual([['a:12']])
  })

  it('answers no rows for no sections', () => {
    expect(layoutRows([])).toEqual([])
  })
})

describe('trailerSpan', () => {
  it.each([
    [{ size: 'sm', showInfo: false, showSnap: false }, 5],
    [{ size: 'md', showInfo: false, showSnap: false }, 7],
    [{ size: 'lg', showInfo: false, showSnap: false }, 10],
    [{ size: 'full', showInfo: false, showSnap: false }, 12],
    [{ size: 'giant', showInfo: false, showSnap: false }, 12],
    [{ size: 'sm', showInfo: true, showSnap: false }, 12],
    [{ size: 'sm', showInfo: false, showSnap: true }, 12],
  ])('%o -> %s', (trailer, expected) => {
    expect(trailerSpan(trailer)).toBe(expected)
  })
})

describe('setColumnSpan', () => {
  it('sets the width on every section of the column', () => {
    const out = setColumnSpan([S('a', 6), under('b'), S('c', 6)], 'b', 4)
    expect(out.map((s) => s.span)).toEqual([4, 4, 6])
  })

  it('returns the same list for an unknown id', () => {
    const sections = [S('a')]
    expect(setColumnSpan(sections, 'nope', 4)).toBe(sections)
  })
})

describe('swapSection', () => {
  it('swaps places: each takes over the other column width and stacking', () => {
    const out = swapSection([S('a', 4), S('b', 8), under('c')], 'a', 1)
    expect(out.map((s) => [s.id, s.span, s.stack])).toEqual([['b', 4, false], ['a', 8, false], ['c', 12, true]])
    expect(shape(out)).toEqual([['b:4', 'a+c:8']])
  })

  it('skips hidden sections and the side column when finding the neighbour', () => {
    const out = swapSection([S('a', 6), S('h', 12, { hidden: true }), links('l', 'right'), S('b', 6)], 'b', -1)
    expect(ids(out)).toEqual(['b', 'h', 'l', 'a'])
  })

  it.each([
    ['first section moved up', 'a', -1],
    ['last section moved down', 'b', 1],
  ])('leaves the list alone for the %s', (_, id, dir) => {
    const sections = [S('a'), S('b')]
    expect(swapSection(sections, id, dir)).toBe(sections)
  })
})

describe('removeSection', () => {
  it('hands the column top and its width to the next section in the stack', () => {
    const out = removeSection([S('a', 4), under('b'), S('c', 8)], 'a')
    expect(out.map((s) => [s.id, s.span, s.stack])).toEqual([['b', 4, false], ['c', 8, false]])
  })

  it('just drops a section from lower in a stack', () => {
    expect(shape(removeSection([S('a', 6), under('b'), S('c', 6)], 'b'))).toEqual([['a:6', 'c:6']])
  })

  it.each([
    ['the middle column, widening the one before it', 'b', ['a:8', 'c:4']],
    ['the first column, widening the one after it', 'a', ['b:8', 'c:4']],
  ])('in a row of three, removing %s keeps the row filled', (_, id, expected) => {
    expect(shape(removeSection([S('a', 4), S('b', 4), S('c', 4)], id))).toEqual([expected])
  })

  it('leaves a lone remaining column at the width the creator gave it', () => {
    expect(shape(removeSection([S('a', 5), S('b', 7)], 'b'))).toEqual([['a:5']])
  })

  it('removes the sticky links column without touching the grid', () => {
    const out = removeSection([links('l', 'right'), S('a', 6), S('b', 6)], 'l')
    expect(shape(out)).toEqual([['a:6', 'b:6']])
  })
})

describe('dockSection', () => {
  it('turns links placed in the grid into a sticky column on that side, in place', () => {
    const out = dockSection([S('a', 6), links('l', 'none', 6), S('b', 12)], 'l', 'left')
    expect(ids(out)).toEqual(['a', 'l', 'b'])
    expect(out[1]).toMatchObject({ side: 'left', stack: false })
    expect(shape(out)).toEqual([['a:6'], ['b:12']])
  })

  it('only docks the links page', () => {
    const sections = [S('a'), S('b')]
    expect(dockSection(sections, 'a', 'left')).toBe(sections)
    expect(dockSection(sections, 'missing', 'left')).toBe(sections)
  })
})

describe('dropSection', () => {
  it.each([
    ['onto itself', 'a', 'a'],
    ['with an unknown section', 'zzz', 'a'],
  ])('ignores a drop %s', (_, active, over) => {
    const sections = [S('a'), S('b')]
    expect(dropSection(sections, active, over, 'left')).toBe(sections)
  })

  it('ignores a drop on a section that is not drawn', () => {
    const sections = [S('a'), S('h', 12, { hidden: true }), S('b')]
    expect(dropSection(sections, 'a', 'h', 'right')).toBe(sections)
  })

  describe("'row'", () => {
    it('with no target makes a new full row at the end', () => {
      const out = dropSection([S('a', 6), S('b', 6), S('c', 12)], 'a', null, 'row')
      expect(shape(out)).toEqual([['b:6'], ['c:12'], ['a:12']])
    })

    it('makes a new full row before the target row', () => {
      expect(shape(dropSection([S('a'), S('b'), S('c')], 'c', 'b', 'row'))).toEqual([['a:12'], ['c:12'], ['b:12']])
    })

    it('goes before a hidden column top, so the column stays together', () => {
      const out = dropSection([S('a'), S('h', 6, { hidden: true }), under('b'), S('x')], 'x', 'b', 'row')
      expect(ids(out)).toEqual(['a', 'x', 'h', 'b'])
    })
  })

  describe("'top' and 'bottom'", () => {
    it('on a full width row add a new row before or after it', () => {
      const base = [S('a'), S('b'), S('c')]
      expect(shape(dropSection(base, 'c', 'b', 'top'))).toEqual([['a:12'], ['c:12'], ['b:12']])
      expect(shape(dropSection(base, 'c', 'a', 'bottom'))).toEqual([['a:12'], ['c:12'], ['b:12']])
    })

    it('below a target in a row of columns stacks into its column', () => {
      const out = dropSection([S('a', 6), S('b', 6), S('c', 12)], 'c', 'a', 'bottom')
      expect(shape(out)).toEqual([['a+c:6', 'b:6']])
    })

    it('above a column top takes over the top of that column', () => {
      const out = dropSection([S('a', 6), S('b', 6), S('c', 12)], 'c', 'a', 'top')
      expect(shape(out)).toEqual([['c+a:6', 'b:6']])
      expect(out.find((s) => s.id === 'a').stack).toBe(true)
    })

    it('above a section lower in the stack slots in between', () => {
      const out = dropSection([S('a', 6), under('b'), S('c', 6), S('d', 12)], 'd', 'b', 'top')
      expect(shape(out)).toEqual([['a+d+b:6', 'c:6']])
    })
  })

  describe("'left', 'right' and 'free'", () => {
    it.each([
      ['right', [['a:6', 'b:6']]],
      ['free', [['a:6', 'b:6']]],
      ['left', [['b:6', 'a:6']]],
    ])('%s of a column fills the row free space', (side, expected) => {
      expect(shape(dropSection([S('a', 6), S('b', 12)], 'b', 'a', side))).toEqual(expected)
    })

    it('in a full row takes half of the widest column', () => {
      const out = dropSection([S('a', 8), S('b', 4), S('c', 12)], 'c', 'a', 'right')
      expect(shape(out)).toEqual([['a:4', 'c:4', 'b:4']])
    })

    it('gives the links page only the minimum width and puts it in the grid', () => {
      const out = dropSection([S('a', 12), links('l', 'right')], 'l', 'a', 'left')
      expect(shape(out)).toEqual([['l:3', 'a:9']])
      expect(out.find((s) => s.id === 'l').side).toBe('none')
    })

    it('falls back to a row of its own when no column can share', () => {
      const out = dropSection([S('a', 3), S('b', 3), S('c', 3), S('d', 3), S('e', 12)], 'e', 'a', 'right')
      expect(shape(out)).toEqual([['a:3'], ['e:12'], ['b:3', 'c:3', 'd:3']])
    })

    it('places the new column after a whole stacked column', () => {
      const out = dropSection([S('a', 6), under('b'), S('c', 12)], 'c', 'a', 'right')
      expect(ids(out)).toEqual(['a', 'b', 'c'])
      expect(shape(out)).toEqual([['a+b:6', 'c:6']])
    })
  })
})
