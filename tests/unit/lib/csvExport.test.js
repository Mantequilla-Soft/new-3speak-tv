// CSV exports of creator stats (src/lib/csvExport.js): quoting, formula-looking
// cells kept as text, and the download itself.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { csvCell, toCsv, downloadCsv } from '../../../src/lib/csvExport.js'

describe('csv', () => {
  it('quotes commas, quotes and line breaks; numbers stay numbers', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(1.5)).toBe('1.5')
    expect(csvCell(NaN)).toBe('')
    expect(csvCell(null)).toBe('')
  })

  it('a cell that would run as a formula is written as text', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('@badadib')).toBe("'@badadib")
  })

  it('a header row from the labels, then one row per item, key or value()', () => {
    const out = toCsv([{ date: '2026-11-01', votes: 1.25 }], [
      { key: 'date', label: 'Date' }, { key: 'votes', label: 'Votes (HBD)' }, { label: 'Double', value: (r) => r.votes * 2 },
    ])
    expect(out).toBe('Date,Votes (HBD),Double\r\n2026-11-01,1.25,2.5\r\n')
  })

  it('downloads a UTF-8 file under the given name', async () => {
    const created = vi.fn(() => 'blob:x')
    vi.stubGlobal('URL', { ...URL, createObjectURL: created, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadCsv('earnings.csv', 'a,b\r\n')
    expect(click).toHaveBeenCalled()
    const blob = created.mock.calls[0][0]
    expect(blob.type).toBe('text/csv;charset=utf-8')
    // The byte-order mark first (text() would hide it), then the rows.
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF])
    expect(await blob.text()).toBe('a,b\r\n')
  })
})
