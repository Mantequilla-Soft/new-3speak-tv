# Tests

| Folder | What | Runner | Command |
|---|---|---|---|
| `unit/` | Logic in `src/utils`, `src/lib`, `src/i18n` and the changelog | Vitest | `npm run test:unit` |
| `server/` | The API in `server/`, started as a real process | Vitest | `npm run test:server` |
| `e2e/` | The real pages in a browser, desktop and phone | Playwright | `npm run test:e2e` |

`npm test` runs the unit and API tests (a few seconds). The browser tests take a few minutes.

## Before the first run

Node.js 22.15 or newer (the API tests use `module.registerHooks`).

```bash
npm install
npm ci --prefix server                 # for the API tests
npx playwright install chromium        # for the browser tests
```

## Unit tests

No network and no `.env`: `fetch` is stubbed with `vi.stubGlobal`, and `import.meta.env`
values are set with `vi.stubEnv`. A file that needs `window` or `localStorage` starts with
`// @vitest-environment jsdom`. Name tests after the behaviour ("a viewer row never
overwrites a creator row"), and put a file at `tests/unit/<folder>/<module>.test.js`.

## API tests

`tests/server/helpers/server.js` starts `server/index.cjs` on a free port with a minimal,
made-up environment. A preload stubs `dotenv` and the services the server calls at startup,
so the tests run offline and **never load a real `server/.env`**, even when one sits next to
them. Nothing is signed or broadcast for real.

## Browser tests

By default Playwright builds the app with the same feature switches as 3speak.tv, serves the
build on `localhost:4173`, and the pages load real data from the public 3Speak and Hive APIs.
They test a desktop screen and a Pixel 7. A test fails on any uncaught JavaScript error in the
page.

```bash
E2E_BASE_URL=https://preview.3speak.tv npm run test:e2e   # test a deployed site instead
E2E_CHROME=/path/to/chrome npm run test:e2e               # a real Chrome (plays H.264 video)
npx playwright test --ui                                   # watch them run
```

## Bugs found by tests

A test that shows a real bug stays in, written for the correct behaviour and marked
`it.skip('BUG: ...')` until the fix lands. Remove the `.skip` together with the fix.

## CI

`.github/workflows/tests.yml` runs everything on every pull request and every push to
`develop`. It is informational: a red run blocks nothing unless it is made a required check.
While `@snapie/hangouts-react` points at a local build (`file:...`), CI cannot build the
branch, so the browser tests run against preview.3speak.tv instead.
