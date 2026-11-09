// @vitest-environment jsdom
// The episode card on a Short made from an audiogram
// (components/AudiogramEpisodeLink): opens the audio page; title and cover
// from the episode's own post.
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const getPostDetails = vi.hoisted(() => vi.fn())
vi.mock('../../../src/hive-api/hiveApi', () => ({ getPostDetails }))

const { default: AudiogramEpisodeLink } = await import('../../../src/components/AudiogramEpisodeLink/AudiogramEpisodeLink.jsx')

describe('AudiogramEpisodeLink', () => {
  it('links to the episode, with its title and cover', async () => {
    getPostDetails.mockResolvedValueOnce({ title: 'My Episode', json_metadata: JSON.stringify({ image: ['https://images.hive.blog/cover.jpg'] }) })
    renderWithProviders(<AudiogramEpisodeLink author="alice" permlink="my-episode" />)
    const link = screen.getByTestId('audiogram-episode-link')
    expect(link).toHaveAttribute('href', '/audio/alice/my-episode')
    expect(link).toHaveTextContent('Full episode')
    await waitFor(() => expect(link).toHaveTextContent('My Episode'))
    expect(link.querySelector('img')).toHaveAttribute('src', 'https://images.hive.blog/cover.jpg')
    expect(getPostDetails).toHaveBeenCalledWith('alice', 'my-episode')
  })

  it('still links while (or if) the post can not be read', async () => {
    getPostDetails.mockRejectedValueOnce(new Error('node down'))
    renderWithProviders(<AudiogramEpisodeLink author="alice" permlink="x" />)
    expect(screen.getByTestId('audiogram-episode-link')).toHaveAttribute('href', '/audio/alice/x')
    expect(screen.getByTestId('audiogram-episode-link')).toHaveTextContent('@alice')
  })
})
