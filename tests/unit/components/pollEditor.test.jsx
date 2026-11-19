// The poll editor every composer shares (components/Polls/PollEditor): the
// small poll button, 2 to 4 options with add and remove, the end, and the
// question field a video's poll needs.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const { default: PollEditor, PollToggle } = await import('../../../src/components/Polls/PollEditor.jsx')

function Harness({ withQuestion = false }) {
  const [on, setOn] = useState(false)
  const [options, setOptions] = useState(['', ''])
  const [days, setDays] = useState(1)
  const [question, setQuestion] = useState('')
  return (
    <>
      <PollToggle on={on} onToggle={() => setOn((v) => !v)} />
      {on && <PollEditor options={options} onOptions={setOptions} days={days} onDays={setDays} {...(withQuestion ? { question, onQuestion: setQuestion } : {})} />}
      <output data-testid="state">{JSON.stringify({ options, days, question })}</output>
    </>
  )
}
const state = () => JSON.parse(screen.getByTestId('state').textContent)

describe('poll editor', () => {
  it('the poll button opens the options under the text, and closes them again', async () => {
    const { user } = renderWithProviders(<Harness />)
    const toggle = screen.getByRole('button', { name: 'Add a poll' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(screen.getByRole('group', { name: 'Poll options' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove the poll' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Remove the poll' }))
    expect(screen.queryByRole('group', { name: 'Poll options' })).toBeNull()
  })

  it('options: type, add up to 4, remove down to 2; the end in days', async () => {
    const { user } = renderWithProviders(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Add a poll' }))
    await user.type(screen.getByRole('textbox', { name: 'Option 1' }), 'Cats')
    await user.click(screen.getByRole('button', { name: 'Add option' }))
    await user.click(screen.getByRole('button', { name: 'Add option' }))
    expect(screen.queryByRole('button', { name: 'Add option' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Remove option 4' }))
    await user.click(screen.getByRole('tab', { name: '7 days' }))
    expect(state()).toMatchObject({ options: ['Cats', '', ''], days: 7 })
    expect(screen.queryByText('No end date')).toBeNull()
  })

  it('a video\'s poll asks its own question', async () => {
    const { user } = renderWithProviders(<Harness withQuestion />)
    await user.click(screen.getByRole('button', { name: 'Add a poll' }))
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'Cats or dogs?')
    expect(state().question).toBe('Cats or dogs?')
  })
})
