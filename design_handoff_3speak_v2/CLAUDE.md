# CLAUDE.md: 3Speak v2 redesign rules
Copy this file into the repo root (or merge it into an existing CLAUDE.md). It tells Claude Code how to implement the v2 redesign in this codebase.

## What we are doing
We are re-skinning `new-3speak-tv` to the v2 design. Behavior, routes, data and i18n stay the same; the visual layer and some layouts change. The designs live in `design_handoff_3speak_v2/designs/*.dc.html`. Those files are **references**, not code to ship. Recreate them with React + SCSS in this repo.

## Before you touch a screen
1. Look up the screen in `design_handoff_3speak_v2/SCREEN_MAP.md` to find the design file, the section IDs and the repo files it maps to.
2. Open the design file and read its markup. It is inline-styled HTML, so every color, size and radius is right there. Ignore `support.js` and the `{{ }}` template holes. The data in each file's logic class is example data.
3. Reuse the strings already in `src/locales/en/*.json`. The designs use them verbatim. Add new keys only when a string truly doesn't exist, in the matching namespace and in all locales (`npm run i18n:check`).

## Styling rules (non-negotiable)
- Use the tokens in `src/styles/tokens.css` (from `code/tokens.css`). **No hex values in components.** For tints, use `color-mix(in srgb, var(--accent) 14%, transparent)`.
- Build from the primitives in `src/components/v2/ui.jsx` (from `code/ui/`): Button, IconButton, Chip, Segmented, Field, ChoiceCard, Toggle, SettingRow, Card, Well, Banner, StatusPill, StatTile, Progress, Avatar, Thumb, DockTile, EmptyState, Dialog, ConfirmBar, Island. Extend a primitive instead of writing one-off styles.
- Type sizes are only 10 11 12 13 14 16 18 20 24 28 32 40 48 56 64 72. Weights are only 400 500 700 900. Use the `v2.text(role)` mixin.
- A control's radius follows its height (`v2.radius-for($h)`): up to 28 → 8, 32–40 → 12, 44–52 → 16, 56–64 → 20. Cards are 24, sheets 28, avatars 50%.
- Control heights are only 24 28 32 36 40 44 48 56 64.
- Red (`--accent`) is for the primary action, money and live. Cyan (`--cyan`) is for community, info and secondary selection. No other hues.
- Labels sit flush left. Tabs are segmented tracks, never underlines. Dialogs become bottom sheets under 768px.
- Never let a tab switch or loaded data change a panel's size. Give the panel a fixed height and scroll inside it.
- Icons are Material Symbols Rounded via `src/components/v2/Icon.jsx`. Don't mix icon sets on a screen.
- Both themes: `:root` is light and `[data-theme="dark"]` is dark. Check every screen in both.

## When something is not designed
Follow `design_handoff_3speak_v2/STYLE_GUIDE.md`, section 11, "Patterns for features without a design". Pick the closest pattern, build it from the primitives, and keep to the rules above. If no pattern fits, make it look like its nearest sibling screen in SCREEN_MAP.md. Don't invent new colors, sizes, radii or components.

## Migration order (one PR each)
1. Tokens + SCSS helpers + primitives + `/dev/ui` playground route (`UiPlayground.jsx`). The legacy aliases in tokens.css keep old screens working.
2. App shell: top bar, sidebar, bottom nav, account menu, notification bell (42b).
3. Cards and feeds: Card3 and all its states (28, 43c), Home (20), Discover and Search (21).
4. Watch page (02) + player controls (19a, 48b) + comments and transcript (28, 43a).
5. Dialogs and sheets everywhere (07, 17) on the shared `Dialog`.
6. Shorts, Audio, Live (18, 27, 36, 39, 45b/c).
7. Profile, Channel, Communities (20, 37, 40).
8. Create: upload, studio, edit and import (21, 35, 44c, 49b).
9. Settings (18d, 29, 38), Wallet and tips (17, 40a).
10. Monetization: Advertise, Pro, stats (25, 31, 45a, 47).
11. Onboarding and warm-up (23, 42a, 44b, 46), info pages (26, 43c, 48c, 49a).
12. Delete the legacy aliases from tokens.css, along with any SCSS that still uses old variables.

## Done means
- The screen matches its design section in both themes, at desktop and at 390px wide.
- There are no hex values and no off-scale sizes in the diff: `grep -nE "#[0-9a-fA-F]{3,6}\b|font-size: *(9|15|17|19|22)px|font-weight: *600"` returns nothing in changed files.
- Keyboard focus is visible, dialogs trap focus and close on Esc, and tap targets are at least 44px on mobile.
- `npm run lint`, `npm test` and `npm run i18n:check` pass.
