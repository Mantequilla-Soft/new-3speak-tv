# Handoff: 3Speak v2 redesign

## Overview
This is a complete visual redesign of **3speak.tv** (repo `Mantequilla-Soft/new-3speak-tv`, branch `production`; React 19 + Vite + SCSS + i18next). The goal is a platform that feels like 3Speak and not like a YouTube clone. It keeps one dark-first look across every feature: tiles and docks instead of icon rows, the community and creator always visible, earnings next to the content, and one red accent plus cyan.

The design covers **every route, component and string in the app**. All 42 English locale files were checked line by line, plus the few pages that have hard-coded English.

## About the design files
The files in `designs/` are **design references made in HTML**: prototypes that show the intended look and behavior. They are **not production code to copy**. The task is to **recreate them in the existing codebase**, with its React components, SCSS and i18n, using the tokens and primitives in `code/`. Behavior, routing and data fetching stay as they are today unless a design shows a new state.

Open any `designs/*.dc.html` file in a browser; `support.js` must sit next to them. Start with `designs/3Speak App 00 Index.dc.html`. Section badges (e.g. **40b**) identify each screen. Links to `archive/` (v1) are intentionally not included.

## Fidelity
**High fidelity.** Colors, type, radii, spacing and copy are final. Recreate the main screens (02, 07, 17–29) pixel-close. The depth boards (30–49) are dense inventories of states and edge cases. Build those states at normal sizes, following `STYLE_GUIDE.md`.

## What's in this folder
| Path | What |
|---|---|
| `README.md` | this file |
| `CLAUDE.md` | rules for Claude Code; copy it into the repo root |
| `STYLE_GUIDE.md` | **the source of truth**: color, type, spacing, radius, controls, overlays, motion, copy, and *patterns for undesigned features* (§11) |
| `SCREEN_MAP.md` | every design file and section ID → description → repo files and locale namespaces |
| `ICONS.md` | the icon set (Material Symbols Rounded), sizes and the names used |
| `code/tokens.css` | all design tokens as CSS variables, light + dark, plus **legacy aliases** for the current `index.css` names so old screens move to v2 colors straight away |
| `code/_v2.scss` | SCSS mixins: `text(role)`, `mono()`, `radius-for($h)`, `control($h)`, `card`, `well`, `tint`, `thumb-placeholder`, `scroll-y` |
| `code/ui/ui.jsx` + `ui.scss` | reference React primitives (Button, Segmented, Field, ChoiceCard, Toggle, SettingRow, Card, Banner, StatusPill, StatTile, Progress, Avatar, Thumb, DockTile, EmptyState, Dialog/Sheet, ConfirmBar, Island) |
| `code/ui/Icon.jsx` | Material Symbols wrapper |
| `code/ui/UiPlayground.jsx` | every primitive on one page, both themes; mount it at `/dev/ui` |
| `designs/` | 36 design files (00 index, 02, 07, 17–49) + `support.js` |

## Getting started (in the repo)
1. Copy `code/tokens.css` to `src/styles/tokens.css` and import it at the top of `src/index.css`. Then delete the old `:root` and `[data-theme="dark"]` blocks (the aliases replace them).
2. Copy `code/_v2.scss` to `src/styles/_v2.scss` and add a Vite alias `@` → `src` if there isn't one.
3. Copy `code/ui/*` to `src/components/v2/`. Fix the import path in `ui.scss` (`@use "@/styles/v2" as v2;`).
4. `npm i material-symbols` and add `import "material-symbols/rounded.css"` in `main.jsx`. Roboto and Roboto Mono are already installed via @fontsource.
5. Add a dev-only route `/dev/ui` → `UiPlayground`, and check it against `designs/` in both themes.
6. Follow the migration order in `CLAUDE.md`, one area per PR.

## Design tokens (summary; full list in code/tokens.css)
- **Color (dark / light):**
  - bg #0a0a0a / #f9f9f9 · surface #161616 / #ffffff · surface-2 #1f1f1f / #f1f1f1 · border #262626 / #ebebeb
  - text #f1f1f1 / #111111 · muted #a3a3a3 / #5a5a5a
  - accent #ff5252 / #e53935 (on-accent #0a0a0a / #ffffff) · cyan #22d3ee / #0891b2
  - avatar #2d2d2d / #dcdcdc · thumbnail stripes #1c1c1c+#232323 / #ecebe8+#e4e3df
- **Type:** Roboto, plus Roboto Mono for numbers. Sizes 10 11 12 13 14 16 18 20 24 28 32 40 48 56 64 72; weights 400 500 700 900; eyebrow = 10/900 uppercase .08em.
- **Spacing:** 4 6 8 10 12 14 16 20 24 32 40 48.
- **Radius:** controls follow their height (up to 28 → 8, 32–40 → 12, 44–52 → 16, 56–64 → 20); cards 24, sheets 28, bars 2, avatars 50%.
- **Control heights:** 24 28 32 36 40 44 48 56 64.
- **Shadow:** only on floating layers, `0 20px 60px rgba(0,0,0,.2/.5)` and `0 24px 60px rgba(0,0,0,.35/.6)` for sheets.
- **Motion:** 120 / 200 / 320ms, `cubic-bezier(.2,.8,.2,1)`.

## Screens
See `SCREEN_MAP.md` for every section. Key layouts:
- **Watch (02):**
  - Desktop grid `minmax(0,1fr) 380px`, gap 20, inside 1280 max width.
  - The player is 16:9 with radius 28 and a cyan ambient glow. Its overlays are a creator chip with Follow, the chapter bar, and controls.
  - Below the player: a community strip, the title (24/900), a meta line (12 muted), a dock of 7 tiles (60 tall), chapter cards, the description card, and a Supporters | Voters card. The voters list shows weight, value and a total, in a fixed 200px body that scrolls.
  - The side panel is a Discussion | Transcript segmented track over a fixed-height scroll area, with the composer pinned at the bottom.
  - Mobile is one column. The panels become a horizontal chip-tab row above one fixed scroll area, with the composer at the bottom.
- **Dialogs (07, 17):** one Dialog component, centered at 440–520 wide on desktop and a bottom sheet on mobile. Small confirmations use a bottom ConfirmBar and toasts use a top Island.
- **Home / Channel / Community (20):** sectioned feeds of Card3 tiles in auto-fill grids, with the community and creator context strips.
- Everything else follows the same building blocks. The depth boards list every state each feature needs.

## Interactions and behavior
- **Tabs** never change the panel's size; content scrolls inside a fixed height.
- **Hover** adds an 8% text tint (or brightness for filled buttons). **Pressed** is scale .98. **Focus** is a 2px accent outline, offset 2. **Disabled** is 45% opacity.
- **Loading:** striped thumbnail placeholders, progress bars (accent for the user's own action, cyan for system work), and step lists with `progress_activity` for the current step.
- **Errors:** inline accent 11px under the field, plus an accent wash banner for page-level problems. The copy says what happened and what to do next, and it already exists in the locale files.
- **Sheets** slide up in 320ms, and **dialogs** fade in and rise 8px in 200ms. Honor reduced motion.
- **Responsive:** < 768px is mobile (sheets, bottom nav, 16px gutters, tap targets of at least 44). 768–1279 collapses side panels below the main column. 1280 and up is the full layout.

## State
There is no new global state. Per-screen UI state stays local (selected tab, open sheet, the selected choice in a form). Tab selection may live in the URL query (`?tab=voters`) so it can be linked.

## Assets
- Icons are Material Symbols Rounded (see ICONS.md).
- Fonts are Roboto and Roboto Mono, already installed.
- Imagery in the designs is placeholders (striped blocks) and represents real thumbnails and avatars from the API.
- The logo mark is in the repo (`server/og-outro/3s-mark.png`).

## When Claude Code meets something not in the designs
Use **STYLE_GUIDE.md §11** to pick the matching pattern, build it from the primitives, and keep to the tokens. Never add a color, size or radius that isn't on a scale.
