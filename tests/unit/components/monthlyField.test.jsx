// "How often" in the tip window (MonthlyField.jsx): the label names the select,
// and the replace warning says "monthly" only for a 30-day transfer.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k, i18n: { language: 'en' } }) }))
vi.mock('../../../src/hive-api/hiveApi', () => ({ getRecurrentTransfers: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { default: MonthlyField } = await import('../../../src/components/tip-reward/MonthlyField.jsx')

let root
let el
const show = (props) => act(() => { root.render(createElement(MonthlyField, { months: 3, onChange: () => {}, recipient: 'badadib', ...props })) })

beforeEach(() => { el = document.createElement('div'); root = createRoot(el) })
afterEach(() => act(() => root.unmount()))

describe('MonthlyField', () => {
  it('ties the label to its select', () => {
    show({})
    const label = el.querySelector('label')
    expect(label.htmlFor).toBeTruthy()
    expect(el.querySelector('select').id).toBe(label.htmlFor)
  })

  it('warns about replacing monthly support for a 30-day transfer', () => {
    show({ existing: { amount: '5.000 HBD', recurrence: 720 } })
    expect(el.textContent).toContain('engagement.tip.monthly.replaces')
    expect(el.textContent).not.toContain('replacesOther')
  })

  it('warns about replacing a recurring payment for any other interval', () => {
    show({ existing: { amount: '5.000 HBD', recurrence: 168 } })
    expect(el.textContent).toContain('engagement.tip.monthly.replacesOther')
  })
})
