// @vitest-environment jsdom
// The points card's "How to earn" list (components/Wallet/PointsCard.jsx +
// pointsEarn.js): grouped, with the amounts from the live server's
// GET /points/awards/config; a way to earn the server does not name is left
// out, and without the route the card lists only what the points info says.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import i18n from 'i18next'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ defaultEndpoint: () => ({ api: 'https://live.test' }) }))
const { default: PointsCard } = await import('../../../src/components/Wallet/PointsCard.jsx')
const { buildEarnGroups, awardConfig, questTitle } = await import('../../../src/components/Wallet/pointsEarn.js')

const info = {
  account: 'badadib', balance: 4250, expiresAt: '2027-02-16T00:00:00.000Z', start: 1000, ttlDays: 90,
  earn: { watchPerMin: 10, chatPerWord: 1, streamPerMin: 100, raid: 500, battle: 500, boostMax: 2000 },
}

const config = {
  login: 1, rank: 100, remix: 100, remixPerDay: 3,
  kinds: {
    streak: { amounts: { 7: 20, 30: 100 } },
    week5: { amount: 25 },
    anniv: 100,
    quest: { amount: 300 },
    pwa: { amount: 50 },
    first5: { amount: 10 },
    vodtime: { perUnit: 2, maxPerDay: 120 },
    finish: { amount: 5, perDay: 10 },
    listen: { perMinute: 2, maxPerDay: 120 },
    first: { amount: 500 },
    community: { amount: 10, maxEver: 5 },
    tip: { amount: 100, perHbd: 100, max: 2000 },
    reach: { amount: 100, minViewers: 20 },
    followers: { amounts: { 10: 100, 100: 500, 1000: 2000 } },
    referral: { amount: 1000 },
    invited: { amount: 250 },
    collab: { amount: 100 },
    party: { amount: 200 },
  },
}

let configResponse
beforeEach(() => {
  configResponse = { ok: true, json: async () => config }
  vi.stubGlobal('fetch', vi.fn(async (url) => (url.endsWith('/points/awards/config') ? configResponse : { ok: false, json: async () => ({}) })))
})
afterEach(() => vi.unstubAllGlobals())

const rate = (label) => screen.getByText(label).closest('div').querySelector('dd').textContent

describe('earn explainer', () => {
  it('lists the ways to earn by group with the amounts from the config', async () => {
    renderWithProviders(<PointsCard info={info} own />)
    expect(await screen.findByText('A sign-in streak')).toBeTruthy()
    expect(rate('A sign-in streak')).toBe('20 at day 7, 100 at day 30')
    expect(rate('Signing in on 5 days of a week')).toBe('25 a week')
    expect(rate('Your Hive anniversary')).toBe('100 a year')
    expect(rate('Installing the app')).toBe('50, once')
    expect(rate('Watching videos')).toBe('2 a minute, up to 120 a day')
    expect(rate('Listening to audio')).toBe('2 a minute, up to 120 a day')
    expect(rate('Watching a video to the end')).toBe('5 each, up to 10 a day')
    expect(rate('Joining a community')).toBe('10 each, up to 5')
    expect(rate('Tipping a creator')).toBe('100 plus 100 per HBD, up to 2,000')
    expect(rate('A video watched by 20 people in its first week')).toBe('100 each')
    expect(rate('Reaching 10, 100 and 1,000 followers')).toBe('100 / 500 / 2,000')
    expect(rate('A friend you invited posting a video')).toBe('1,000')
    expect(rate('Signing in, once a day')).toBe('1 a day')
    expect(rate('A remix or reaction of someone else\'s video')).toBe('100 each, up to 3 a day')
    // Grouped under their headings; the streaming rates sit under Live.
    const habits = screen.getByRole('region', { name: 'Habits' })
    expect(within(habits).getByText('A weekly quest')).toBeTruthy()
    const live = screen.getByRole('region', { name: 'Live' })
    expect(within(live).getByText('Watching a stream')).toBeTruthy()
    expect(within(live).getByText('A collab stream of 10 minutes or more')).toBeTruthy()
    // Not in the config: not listed.
    expect(screen.queryByText('Getting raided')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Creating' })).toBeTruthy()
    // Watching and listening say they need the viewer rewards opt-in.
    const watching = screen.getByRole('region', { name: 'Watching and listening' })
    expect(within(watching).getByText(/only with “Earn while you watch” on in Settings, and listening also needs “Count my listening too”/)).toBeTruthy()
  })

  it('without the config route the card lists what the points info says, no error', async () => {
    configResponse = { ok: false, status: 404, json: async () => ({}) }
    renderWithProviders(<PointsCard info={info} own />)
    expect(screen.getByText('Watching a stream')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('A sign-in streak')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reads an award named as a number, an object, under kinds or awards', () => {
    expect(awardConfig({ pwa: 50 }, 'pwa')).toEqual({ amount: 50 })
    expect(awardConfig({ awards: { tag: { points: 1, perDay: 20 } } }, 'tag')).toEqual({ amount: 1, perDay: 20 })
    expect(awardConfig({ kinds: { listen: { perMin: 2 } } }, 'listen')).toEqual({ perUnit: 2 })
    expect(awardConfig(null, 'pwa')).toBeNull()
    expect(awardConfig({ kinds: { pwa: 'x' } }, 'pwa')).toBeNull()
  })

  it('empty groups are left out', () => {
    const groups = buildEarnGroups(i18n.t.bind(i18n), {}, { kinds: { tag: { amount: 1, perDay: 20 } } })
    expect(groups.map((g) => g.id)).toEqual(['engaging'])
    expect(groups[0].rows[0]).toMatchObject({ key: 'tag', label: 'Tagging a video', rate: '1 each, up to 20 a day' })
  })

  it('quest titles: the named key, the id, else generic', () => {
    const t = i18n.t.bind(i18n)
    expect(questTitle(t, i18n, { id: 'x', titleKey: 'wallet.points.quests.tag5' })).toBe('Tag 5 videos')
    expect(questTitle(t, i18n, { id: 'listen30', titleKey: 'wallet.points.quests.nope' })).toBe('Listen for 30 minutes')
    expect(questTitle(t, i18n, { id: 'zzz', titleKey: 'wallet.points.title' })).toBe('Weekly quest')
    expect(questTitle(t, i18n, { id: 'zzz', titleKey: 'wallet.points.quests.zzz' })).toBe('Weekly quest')
  })
})
