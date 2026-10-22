// Offline stand-in for @mantequilla-soft/incubation-client (see ../preload.cjs).
// The warm-up handler it builds knows no routes, so /api/incubation/* falls through
// to the server's own "Unknown incubation route".

export class IncubationClient {
  constructor(opts) {
    this.opts = opts
  }
}

export class WarmupGoals {
  constructor(opts) {
    this.opts = opts
  }
}

export function createWarmupHandler() {
  return (req, res, next) => next()
}
