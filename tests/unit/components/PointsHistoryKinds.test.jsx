// @vitest-environment jsdom
// The points movements of the earn ideas (components/Wallet/PointsHistory.jsx +
// channelPoints.js POINTS_KIND): every kind has an icon from the app's icon
// font and an English label, rows read their ref (a streak's days, a first's
// type, a quest's title) and link the post, account, playlist or community
// the ref names, never an id-shaped ref.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import fs from 'node:fs'
import i18n from 'i18next'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ defaultEndpoint: () => ({ api: 'https://live.test' }) }))
const { default: PointsHistory } = await import('../../../src/components/Wallet/PointsHistory.jsx')
const { POINTS_KIND, pointsRefLink } = await import('../../../src/components/Wallet/channelPoints.js')

const NEW_KINDS = ['streak', 'week5', 'anniv', 'first5', 'vodtime', 'finish', 'listen', 'premiere', 'playlist', 'first',
  'reach', 'storystreak', 'challenge', 'collab', 'premheld', 'clip', 'tag', 'pollvote', 'reply', 'community', 'tip',
  'remixed', 'raided', 'followers', 'peak10', 'referral', 'invited', 'pwa', 'party', 'quest']

const { SUBSET_NAMES_FILE } = await import('../../../scripts/icons/scan.mjs')
const icons = new Set(JSON.parse(fs.readFileSync(SUBSET_NAMES_FILE, 'utf8')))

let items
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items, next: null }) })))
})

const row = (id, kind, ref, delta = 10) => ({ id, kind, delta, ref, at: '2026-11-26T10:00:00Z' })
const rowOf = (text) => screen.getByText(text).closest('.trx__row')

describe('points history: the earn kinds', () => {
  it('every kind has an icon in the icon font and an English label', () => {
    for (const kind of NEW_KINDS) {
      const k = POINTS_KIND[kind]
      expect(k, kind).toBeTruthy()
      expect(icons.has(k.icon), `${kind}: ${k.icon}`).toBe(true)
      if (kind !== 'first') expect(i18n.exists(`wallet.points.history.${k.key}`), kind).toBe(true)
    }
  })

  it('labels rows from their ref and links posts, accounts, playlists and communities', async () => {
    items = [
      row('1', 'streak', '7', 20),
      row('2', 'anniv', '3', 100),
      row('3', 'first', 'short', 500),
      row('4', 'finish', 'badadib/my-video', 5),
      row('5', 'tip', 'badadib', 1100),
      row('6', 'playlist', 'pl123', 20),
      row('7', 'community', 'hive-181335', 10),
      row('8', 'followers', '1000', 2000),
      row('9', 'quest', 'finish3', 300),
      row('10', 'pwa', 'badadib', 50),
      row('11', 'vodtime', 'badadib:2026-11-25', 120),
    ]
    renderWithProviders(<PointsHistory user="badadib" ttlDays={90} />)
    expect(await screen.findByText('7-day sign-in streak')).toBeInTheDocument()
    expect(screen.getByText('Year 3 on Hive')).toBeInTheDocument()
    expect(screen.getByText('Your first Short')).toBeInTheDocument()
    expect(screen.getByText('Reached 1,000 followers')).toBeInTheDocument()
    expect(screen.getByText('+2,000')).toBeInTheDocument()
    expect(screen.getByText('Weekly quest done: Watch 3 videos to the end')).toBeInTheDocument()
    expect(within(rowOf('Watched a video to the end')).getByRole('link', { name: 'Open video' }).getAttribute('href'))
      .toBe('/watch?v=badadib/my-video')
    expect(within(rowOf('Tipped @badadib')).getByRole('link', { name: 'Open profile' }).getAttribute('href')).toBe('/@badadib')
    expect(within(rowOf('Finished a playlist')).getByRole('link', { name: 'Open playlist' }).getAttribute('href')).toBe('/playlist/pl123')
    expect(within(rowOf('Joined a community')).getByRole('link', { name: 'Open community' }).getAttribute('href')).toBe('/community/hive-181335')
    // No link where the ref is not a post or an account.
    expect(within(rowOf('Installed the app')).queryByRole('link')).toBeNull()
    expect(within(rowOf('Watched videos')).queryByRole('link')).toBeNull()
  })

  it('an unknown quest or first type reads generic, never as a raw key', async () => {
    items = [row('1', 'quest', 'newquest9', 300), row('2', 'first', 'hologram', 500), row('3', 'streak', 'x', 20)]
    renderWithProviders(<PointsHistory user="badadib" ttlDays={90} />)
    expect(await screen.findByText('Weekly quest done: Weekly quest')).toBeInTheDocument()
    expect(screen.getByText('A first post')).toBeInTheDocument()
    expect(screen.getByText('Sign-in streak')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/wallet\.points/)
  })

  it('pointsRefLink only links refs that look like what the kind names', () => {
    expect(pointsRefLink({ kind: 'reach', ref: 'badadib/a-post' })).toEqual({ type: 'post', author: 'badadib', permlink: 'a-post' })
    expect(pointsRefLink({ kind: 'reach', ref: 'reach:badadib/a-post' })).toBeNull()
    expect(pointsRefLink({ kind: 'raided', ref: 'badadib' })).toEqual({ type: 'user', user: 'badadib' })
    expect(pointsRefLink({ kind: 'raided', ref: 'not an account' })).toBeNull()
    expect(pointsRefLink({ kind: 'week5', ref: 'badadib:2026-W48' })).toBeNull()
    expect(pointsRefLink({ kind: 'community', ref: 'hive-abc' })).toBeNull()
  })
})
