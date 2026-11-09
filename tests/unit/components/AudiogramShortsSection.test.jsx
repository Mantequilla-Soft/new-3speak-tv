// @vitest-environment jsdom
// The audiograms of a track going out as Shorts, in the audio upload
// (components/AudioUploadModal/AudiogramShortsSection.jsx): title and text on
// the left (the text in our post editor), the 9:16 thumbnail on the right
// (opens the thumbnail editor); every one is posted (no way to drop one here).
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

// Our post editor has its own tests; a plain box stands in for it here
vi.mock('../../../src/components/studio/MarkdownComposer', () => ({
  default: ({ value, onChange, placeholder }) => <textarea data-testid="composer" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />,
}))

const { default: AudiogramShortsSection } = await import('../../../src/components/AudioUploadModal/AudiogramShortsSection.jsx')

const a1 = { url: 'https://b.example/rendered/audiogram-1.mp4', title: 'Ep 1', description: 'Hi', duration: 30 }
const a2 = { url: 'https://b.example/rendered/audiogram-2.mp4', title: '', description: '', duration: 20, thumbnailUrl: 'https://images.hive.blog/t.jpg' }

function open(audiograms = [a1, a2]) {
  const onChange = vi.fn()
  const onDesign = vi.fn()
  const utils = renderWithProviders(<AudiogramShortsSection track={{ id: 't1', audiograms }} onChange={onChange} onDesign={onDesign} />)
  return { ...utils, onChange, onDesign }
}

describe('AudiogramShortsSection', () => {
  it('nothing without audiograms', () => {
    open([])
    expect(screen.queryByTestId('audiogram-shorts')).toBeNull()
  })

  it('each Short: its title and text, its thumbnail (a frame of the video, or the one made)', () => {
    open()
    expect(screen.getByText(/Shorts with this audio \(2\)/)).toBeInTheDocument()
    expect(screen.getByLabelText('Title of Short 1')).toHaveValue('Ep 1')
    expect(screen.getByRole('group', { name: 'Text for Short 1' }).querySelector('textarea')).toHaveValue('Hi')
    expect(screen.queryByRole('button', { name: /Don't post/ })).toBeNull()
    expect(screen.getByLabelText('Thumbnail of Short 1').querySelector('video')).toHaveAttribute('src', `${a1.url}#t=1.5`)
    expect(screen.getByLabelText('Thumbnail of Short 2').querySelector('img')).toHaveAttribute('src', a2.thumbnailUrl)
    expect(screen.getByLabelText('Thumbnail of Short 2')).toHaveTextContent('Edit thumbnail')
  })

  it('edits change only that Short; the thumbnail opens the editor', async () => {
    const { user, onChange, onDesign } = open()
    fireEvent.change(screen.getByLabelText('Title of Short 2'), { target: { value: 'Teaser' } })
    expect(onChange).toHaveBeenLastCalledWith([a1, { ...a2, title: 'Teaser' }])
    fireEvent.change(screen.getByRole('group', { name: 'Text for Short 1' }).querySelector('textarea'), { target: { value: 'Listen!' } })
    expect(onChange).toHaveBeenLastCalledWith([{ ...a1, description: 'Listen!' }, a2])
    await user.click(screen.getByLabelText('Thumbnail of Short 1'))
    expect(onDesign).toHaveBeenCalledWith(a1.url)
  })
})
