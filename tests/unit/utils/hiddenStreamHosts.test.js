// Hosts whose live streams are left out of the feeds, /live and the swipe
// between streams (utils/config FEED_EXCLUDED_HOSTS). Their own profile still
// shows them to everyone (components/Userprofilepage/ProfileStreams).
import { describe, it, expect } from 'vitest'
import { FEED_EXCLUDED_HOSTS } from '../../../src/utils/config.js'

describe('hidden stream hosts', () => {
  it('badadib and ashenadib by default', () => {
    expect([...FEED_EXCLUDED_HOSTS]).toEqual(['badadib', 'ashenadib'])
  })
})
