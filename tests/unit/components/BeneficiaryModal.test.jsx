// @vitest-environment jsdom
// Share rewards (components/modal/Beneficiary_modal): the locked platform
// shares can be raised with + or by typing, never lowered below their minimum,
// and never above what is left with the creator.
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/utils/hiveNode', () => ({ getHiveClient: () => ({ database: { getAccounts: async () => [] } }), getHiveUrl: () => 'https://api.hive.example', hiveClient: {}, ensureHealthyNode: async () => 'https://api.hive.example', demoteNode: (u) => u }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: false }) }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: Beneficiary_modal } = await import('../../../src/components/modal/Beneficiary_modal.jsx')

const saved = []
function Harness() {
  const [list, setList] = useState([
    { account: 'threespeakfund', percent: 10, locked: true, minPercent: 10 },
    { account: 'encoder.pay', percent: 1, locked: true, minPercent: 1 },
  ])
  const [remaining, setRemaining] = useState(89)
  return (
    <Beneficiary_modal
      isOpen
      close={() => {}}
      setBeneficiaries={(s) => saved.push(JSON.parse(s))}
      setBeneficiaryList={() => {}}
      setList={setList}
      list={list}
      remaingPercent={remaining}
      setRemaingPercent={setRemaining}
    />
  )
}

function mount() {
  useAppStore.setState({ user: 'badadib', authenticated: true })
  saved.length = 0
  return renderWithProviders(<Harness />)
}
const fund = () => screen.getByRole('spinbutton', { name: '@threespeakfund %' })
const youText = () => document.querySelector('.bene-ring__hole b').textContent

describe('raising a locked share', () => {
  it('says it can be raised, shows the minimum, and cannot go below it', () => {
    mount()
    expect(screen.getByText(/can be raised to give more/)).toBeInTheDocument()
    expect(screen.getByText('min 10%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lower the share of threespeakfund' })).toBeDisabled()
  })

  it('+ and − move it a point, taken from what stays with you, and saving keeps it', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Raise the share of threespeakfund' }))
    fireEvent.click(screen.getByRole('button', { name: 'Raise the share of threespeakfund' }))
    expect(fund()).toHaveValue(12)
    expect(youText()).toBe('87%')
    fireEvent.click(screen.getByRole('button', { name: 'Lower the share of threespeakfund' }))
    expect(fund()).toHaveValue(11)
    fireEvent.click(screen.getByRole('button', { name: /Save split/ }))
    expect(saved[0]).toEqual([{ account: 'threespeakfund', weight: 1100 }, { account: 'encoder.pay', weight: 100 }])
  })

  it('a typed value is applied when the field is left, not per keystroke', () => {
    mount()
    fireEvent.change(fund(), { target: { value: '1' } })
    expect(fund()).toHaveValue(1)
    expect(youText()).toBe('89%')
    fireEvent.change(fund(), { target: { value: '15' } })
    fireEvent.blur(fund())
    expect(fund()).toHaveValue(15)
    expect(youText()).toBe('84%')
  })

  it('a typed value below the minimum goes back to it', () => {
    mount()
    fireEvent.change(fund(), { target: { value: '4' } })
    fireEvent.blur(fund())
    expect(fund()).toHaveValue(10)
    expect(youText()).toBe('89%')
  })

  it('stops at what is left with you, and says so', () => {
    mount()
    fireEvent.change(fund(), { target: { value: '150' } })
    fireEvent.blur(fund())
    expect(fund()).toHaveValue(99)
    expect(youText()).toBe('0%')
    expect(screen.getByRole('alert')).toHaveTextContent('89%')
    expect(screen.getByRole('button', { name: 'Raise the share of threespeakfund' })).toBeDisabled()
  })
})
