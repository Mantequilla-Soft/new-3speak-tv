# 3Speak v2 style guide

This is the source of truth for every screen. The design files show how the rules look in use. When a feature has **no design**, build it from these rules and the patterns at the end, and it will look as if it had been designed.

---

## 1. Principles
1. **3Speak, not YouTube.** Tiles, docks and sheets instead of thin icon rows and plain grey menus. The community and the creator are always visible, and earnings sit next to the content they come from.
2. **Ink on ground, one accent.** Most of a screen is text on `bg` and `surface`. Red marks the *one* primary action, money and live. Cyan marks community, info and "selected, but not the main action". There are no other hues.
3. **Fills, not borders.** Fields, wells and nested rows are filled with `bg` inside a `surface` card. A 1px `border` only outlines cards and dialogs. A 2px border only marks a choice.
4. **Flush left.** Titles, copy and button labels sit at the left. A button wider than its label keeps the label at the left padding, with a trailing arrow when it moves you forward.
5. **Nothing changes size on interaction.** Switching tabs, expanding rows or loading data never moves the layout. Scroll inside a fixed area instead.
6. **Plain words.** Copy says what happens ("Hive sends it every 30 days until 11 May"). Use sentence case. Use no exclamation marks except in a real celebration.

## 2. Color
Use the CSS variables from `code/tokens.css`. Never write a hex value in a component.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | #0a0a0a | #f9f9f9 | page ground, and fields/wells inside cards |
| `--surface` | #161616 | #ffffff | cards, panels, dialogs, sheets |
| `--surface-2` | #1f1f1f | #f1f1f1 | secondary buttons, selected segment, chips, icon wells |
| `--border` | #262626 | #ebebeb | 1px card outlines and row dividers |
| `--text` | #f1f1f1 | #111111 | primary text; also the "inverse" fill (selected chip, confirm bar, island) |
| `--muted` | #a3a3a3 | #5a5a5a | secondary text, meta, inactive tabs, placeholders |
| `--accent` | #ff5252 | #e53935 | primary action, earnings/payout numbers, live, errors, destructive |
| `--on-accent` | #ffffff | #ffffff | text on an accent fill (white in both themes since 2026-11-12, owner) |
| `--cyan` | #22d3ee | #0891b2 | community, info, links inside notices, selected choice (secondary), progress |
| `--avatar` | #2d2d2d | #dcdcdc | avatar placeholder |
| `--thumb-a/b` | #1c1c1c / #232323 | #ecebe8 / #e4e3df | striped media placeholder |

**Tints** come only from `color-mix`: 14 to 16% for pills, selected choices and danger buttons; 9 to 10% on `bg` for banners and pinned rows; 22 to 30% for a hero gradient at the top of a success card.

**Rules**
- One solid accent fill per view: the primary button. Everything else red is text, an icon or a tint.
- Money is always the accent color and always Roboto Mono.
- Text over video or images uses white on `rgba(10,10,10,.6)` scrims, in both themes.
- Status colors: success or approved = cyan · failed, error or destructive = accent · pending or draft = muted · live = solid accent pill.
- Contrast: body text is always `text` or `muted` on `bg` or `surface`. Accent text appears only at 11px bold and above, or on its own tint.

## 3. Typography
**Roboto** for everything, and **Roboto Mono** for numbers that change or get compared: money, counts in stat tiles, times, durations, timestamps, codes, keys and permlinks.

| Role | Size / weight | Use |
|---|---|---|
| display | 40+ / 900, -.02em | hero numbers (recap, earnings), page titles on marketing-like pages |
| heading-lg | 28 / 900, -.02em | page titles |
| heading | 24 / 900, -.02em | screen titles, big card titles |
| title | 18 / 700 | dialog and sheet titles |
| title-sm | 16 / 700 | card titles |
| body | 14 / 400 | descriptions, comment text, list rows |
| body-sm | 13 / 400 or 700 | dense lists, row titles in boards |
| label | 13 / 700 (12 in 28–32px controls) | buttons, chips, tabs, segmented options |
| meta | 12 / 400 | timestamps, counts, captions |
| meta-sm | 11 / 400 | hints under fields, fine print |
| eyebrow | 10 / 900, UPPERCASE, .06–.08em, muted | section labels, table headers, "WHAT COUNTS" |

The allowed sizes are 10 · 11 · 12 · 13 · 14 · 16 · 18 · 20 · 24 · 28 · 32 · 40 · 48 · 56 · 64 · 72, with nothing below 10. The weights are 400 · 500 · 700 · 900; don't use 600. Line height is 1.4 to 1.5 for body text and 1.1 to 1.2 for 24px and up. Use `text-wrap: pretty` on paragraphs.

## 4. Spacing and layout
- Spacing is on a 4px grid: 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 32 · 40 · 48.
- Card padding is 16 (dense boards 12–14, large panels 20). Gaps are 8–12 between cards, 6–8 inside, and 4 between segments.
- **Desktop app frame:** max content width 1280 on the boards, 1600 in the app (`--content-max`, owner 2026-11-12), page padding 24, top bar 64.
  - Watch layout: `grid-template-columns: minmax(0,1fr) 380px`, gap 20.
  - Side panels are 380 wide. Feeds use auto-fill grids with `minmax(240px,1fr)`.
- **Mobile** (< 768px): one column with 16px side padding, the bottom nav (56 + safe area), and sheets instead of dialogs. Tap targets are at least 44px.
- **Scrolling:** a panel whose content varies (tabs, lists, chat) gets a fixed height from its layout and scrolls inside with `overflow-y:auto`. Never let content set the panel's height.

## 5. Radius
- **Controls** get their radius from their height:
  - up to 28 → 8
  - 32 to 40 → 12
  - 44 to 52 → 16
  - 56 to 64 → 20
- **Surfaces:**
  - 16: list cards, tiles
  - 20: stat panels
  - 24: cards, dialog cards
  - 28: sheets, large panels and the side panel
- **Other shapes:**
  - 2: progress bars, chapter segments
  - 50%: avatars, round icon buttons
  - 48: phone frame (mockups only)

## 6. Controls
| Control | Spec |
|---|---|
| **Primary button** | accent fill, on-accent text 900, height 40–48 (56 for a page-level CTA), label flush left, trailing `arrow_forward` when it moves forward |
| **Secondary** | surface-2 fill, text 700 |
| **Ghost** | transparent, text; hover = 8% text tint |
| **Danger** | accent tint 14%, accent text |
| **Inverse** | text fill, bg text: "Go to home page", "Next short", "Reconnect" |
| **Icon button** | square, 32–40, surface-2 or ghost, icon 18 |
| **Text field** | bg fill (inside a surface card), no border at rest, 40 tall, radius 12, 14px text, placeholder muted. Focus is a 2px accent border. Error is a 2px accent border plus 11px accent text below. The label is an eyebrow above, and the hint is 11px muted below |
| **Textarea** | same as a field, min 88 tall, padding 10/12 |
| **Select** | looks like a field with a trailing `▾` or `expand_more`. It opens a sheet on mobile and a popover on desktop |
| **Segmented** | bg track, padding 4, radius 12. Options are 32 tall with radius 12 (28/8 in dense cards). Selected = surface-2 + text, others muted. An optional count is 11px at .7 opacity |
| **Chips (filters)** | 28–32 tall, surface-2. Selected = text fill with bg ink. Wrap with gap 4–6 |
| **Choice card** | full-width tile, 2px border, radius 16, padding 10/12, icon + bold title + 11px muted sub. Selected = accent (or cyan for secondary choices) border + 16% tint |
| **Toggle** | 44×26 switch, accent when on, in a SettingRow (title 14/700, sub 12 muted, control on the right) |
| **Checkbox** | `check_box` / `check_box_outline_blank` at 16–18, accent when checked |
| **Slider** | 4–6px track on surface-2, accent fill. The label and value sit on one line above (value in mono) |
| **Dock tile** | 60 tall, radius 16, icon 22 over a 10px/700 label, surface-2. Active = accent (or cyan) tint + color. Grid of 5–7 under the player |
| **Tabs (page)** | segmented track (§ above). Never underline tabs |
| **Status pill** | 20 tall, radius 7, 10px/900 uppercase. Tones are cyan, accent, muted, or a solid live pill |
| **Progress** | 4–6px bar, radius 2–3, accent, or cyan for system work like encoding or uploading |
| **Avatar** | round, sizes 20 · 24 · 28 · 32 · 40 · 44 · 52 · 72. Rings: accent = story or live, cyan = community, 2px |

States: hover = +8% text tint or brightness; pressed = scale .98; focus = 2px accent outline, offset 2; disabled = 45% opacity, no pointer.

## 7. Surfaces and overlays
- **Card:** surface, 1px border, radius 24, padding 16.
- **Well:** a bg-filled block inside a card, radius 12, padding 10/12. Use it for fields, nested rows, code and memo boxes, and stat tiles.
- **Banner:** a cyan wash (info) or accent wash (warning). Icon 18 in the tone, bold lead-in, muted rest. Use it for inline notices like "Out of resource credits…".
- **Dialog:** centered, max 440–520 wide, radius 28, shadow-sheet, title 18/700 with a close button on the right. Footer actions go primary-right with the primary often `block`.
- **Sheet (mobile):** the same component from the bottom, top radius 28, a 40×4 grab handle, max 88vh.
- **Confirm bar** (small confirmations, undo): a text-filled pill fixed at the bottom center.
- **Island toast:** a text-filled pill at the top center, 44 tall. Never use a corner toast.
- **Menus:** a surface card with radius 20–24 and padding 8, rows 36–40 with icon 18 + label. Destructive rows are in accent.
- **Empty state:** a dashed 2px border card with an icon 28, title 16/700, one muted sentence and one action.
- **Shadows** go only on floating layers (dialogs, sheets, menus, islands, floating players). Cards have no shadow.

## 8. Media
- Thumbnails are 16:9 at radius 12 (8 when small), shorts 9:16, square art 1:1 at radius 12. While loading, show the striped placeholder (`thumb-a/b`, 135°).
- Overlays on media are small scrim pills (radius 6–8, 10–11px): duration bottom-right, status top-left (LIVE, PRO, NEW, Scheduled…), and the creator chip top-left on the player.
- On cards, "playing" means a 2px accent outline. The cyan glow around the player is the ambient-light setting.

## 9. Motion
- Speeds are 120ms for hovers and presses, 200ms for dialogs and toggles, and 320ms for sheets and islands, all on `cubic-bezier(.2,.8,.2,1)`.
- Dialogs fade in and rise 8px. Sheets slide up. The island drops 12px.
- Respect `prefers-reduced-motion`.

## 10. Copy
- Use sentence case everywhere, including buttons ("Save changes", "Book this ad").
- Use "you"; refer to the creator as "@name".
- Write numbers as 9.2K · $6.49 · 1:13 · 3w. Time is relative under 7 days and dates after that ("12 May").
- Errors say what happened and what to do next ("Hash not found on the profile yet. Make sure the change is saved publicly, then try again.").
- **All strings come from `src/locales/en/*.json`** (i18next). The designs use those exact strings, so search the locale files before writing new copy. New keys go in the matching namespace.

---

## 11. Patterns for features without a design
Find the closest pattern below, build it from the primitives in `code/ui/ui.jsx`, and keep to sections 1–10.

| You are building… | Use |
|---|---|
| A form or flow with 2+ steps | Dialog or sheet with a 4px step bar on top (accent = done or current, surface-2 = next) and labels under it. Back is secondary and Next/Submit is primary. See 40c, 47b, 49b |
| Picking one of 2–5 short options | Segmented |
| Picking one of several described options | Choice cards (stacked) |
| On/off settings | SettingRow + Toggle, grouped in a card with dividers |
| Signing with a Hive wallet | The "Sign with" list of choice cards (Keychain, HiveAuth, HiveSigner, PeakVault) + the "paste active key" fallback. See 40a, 42a |
| Anything that costs money | An amount well in Roboto Mono, then "Available: …" meta, then a primary button labelled with the amount ("Pay 4.20 HBD"). Show HIVE and HBD equivalents in muted text |
| A long list in a panel | Fixed-height panel with an inner scroll and a sticky summary row on top (count + total). See 02 voters |
| Dashboard / stats | Stat tiles (bg wells) in a 3–5 column grid, then charts in cards. Chart lines are accent (primary series) and cyan (comparison), on a bg well |
| Status of async work | Progress bar + a step list (check = done in muted, `progress_activity` = current in cyan, `radio_button_unchecked` = next). See 41b, 43b |
| Success | Card with a 170° gradient from 22% cyan (or accent) to surface, a 16px bold title, a muted sentence and one forward action |
| Failure | Accent 10% wash card: a bold one-liner, then what was and wasn't affected ("Nothing was created and no fee was taken.") |
| Admin-only UI | A 2px dashed border card titled "Admin view" with the line "Only 3Speak admins see this panel." |
| Tables | Eyebrow header row on a 2px border, rows 36–44 with 1px dividers, numbers right-aligned in mono |
| Mobile variant of any desktop panel | Stack the panels. Desktop side panels become horizontal scrolling chip tabs above one fixed scroll area. Dialogs become sheets |
