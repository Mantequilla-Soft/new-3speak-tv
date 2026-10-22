# Contributing to 3Speak

Thanks for helping. Bug reports, fixes, features and translations are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Questions and quick chats: [Discord](https://discord.gg/NSFS2VGj83).
- Looking for something to pick up? Try issues labeled [`good first issue`](https://github.com/Mantequilla-Soft/new-3speak-tv/labels/good%20first%20issue) or [`help wanted`](https://github.com/Mantequilla-Soft/new-3speak-tv/labels/help%20wanted).

## Setup

You need Node.js 22 and npm. Fork the repo, then:

```bash
git clone https://github.com/<you>/new-3speak-tv.git
cd new-3speak-tv
npm install
npm run dev
```

Copy `.env.example` to `.env` first and fill in what you need. The [README](README.md#getting-started) explains the variables and scripts.

## Making a change

1. Branch off `develop`: `feat/...`, `fix/...` or `docs/...`.
2. Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`.
3. Run `npm run lint` before you push.
4. New UI text goes through i18next with a key in every language. `npm run i18n:check` tells you what is missing.
5. A change users will notice gets a short entry in `src/changelog.js` and a version bump in `src/version.js`.
6. Never commit secrets: env files stay local.
7. Open the pull request against `develop` (never `production`) and fill in the template.

Keep pull requests focused on one thing. Screenshots or a short clip help a lot for UI changes, on both desktop and mobile.

## Translations

Fixing or adding a translation is one of the most useful things you can do, and you don't need to write code. See [TRANSLATING.md](TRANSLATING.md).

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
