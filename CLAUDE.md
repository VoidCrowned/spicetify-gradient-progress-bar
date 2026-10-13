# CLAUDE.md — Gradient Progress Bar

A Spicetify extension that recolours Spotify's **song progress bar** with one solid colour or a multi-stop gradient. It must coexist cleanly with themes and other extensions, because it's published to the Spicetify Marketplace — not just used on the author's setup.

Everything under *Verified facts* was confirmed from the live DOM (Spotify 1.3.3.264; rendering re-verified on **1.3.4.258** by the self-test, #25) and from the source of the theme and extension it runs alongside. Don't re-derive it and don't "improve" on it by guessing. If something depends on the live Spotify DOM and can't be known from this repo, **give the maintainer a devtools console snippet to verify it** instead of assuming.

## Working mode — autonomous, test per build

The maintainer has little time at the PC and wants to **bug-test finished builds, not review steps**. So:

- **Work through a whole milestone (or a large batch of issues) without stopping.** Don't ask for confirmation between issues, and don't hand over per-step verification lists.
- **Decide ambiguities yourself.** Pick the option most consistent with this file and the issues, note the decision in the relevant issue as a comment (`Decision: … because …`), and carry on. Only ask when a decision is irreversible or contradicts this file.
- **Commit and push to `main` as you go** (one commit per issue, `Closes #n`). Never leave finished work only on the local machine.
- **Live-DOM checks go into the self-test (#23), not into chat.** Anything you would otherwise ask the maintainer to run in devtools becomes a check inside `__gpb.selfTest()`. If something genuinely can't be automated, add it to the visual checklist in #14.
- **One hand-off per build.** When a batch is done: push, then post a single comment on #14 titled `Test build <short-sha>` with (1) what changed, (2) "run `await __gpb.selfTest()` and paste the output", (3) the short visual checklist — only things a human must look at. Then stop and wait.
- **Bug reports come back as issues or a pasted self-test result.** Fix everything from one report in one batch, push, post the next `Test build` comment.
- **Things only the maintainer can do** (screenshots for `preview.png`, adding the repo topic, Marketplace submission): collect them into the `Test build` comment as a short "Needs you" list rather than asking separately.

## Project management

- Work is tracked as **GitHub issues**, grouped by milestone: `v0.1.0 — MVP` and `Future`. `ROADMAP.md` mirrors them — when you close, add or re-scope an issue, update `ROADMAP.md` in the same change.
- Reference issues in commits (`Closes #6`), one logical change per commit where practical.
- Ideas that come up during work but aren't in scope: open an issue in the `Future` milestone rather than implementing them.
- Labels: `enhancement`, `ui`, `rendering`, `compatibility`, `packaging`, `testing`, `documentation`, `bug`.

## Files

| File | Purpose |
|---|---|
| `gradientProgressBar.js` | The extension. Single plain-JS file, no build step, no dependencies. |
| `manifest.json` | Marketplace manifest (#13). |
| `README.md` | User-facing docs, install, compatibility, testing checklist. |
| `ROADMAP.md` | Milestones → issues. Keep in sync. |
| `preview.png` | Marketplace screenshot (#13). |

## Conventions

- **Plain JavaScript**, one IIFE, `"use strict"`. No TypeScript, bundler or npm dependencies.
- Small named functions: `loadSettings`, `saveSettings` (debounced), `buildCss`, `applyCss`, `resolveStop` (UI swatches only), `openModal`, `renderStops`.
- Every id and class prefixed **`gpb-`**. Storage key `gpb:settings`. Console output prefixed **`[gpb]`**.
- UI strings and docs in **British English** ("colour").
- Top-of-file comment block: name, version, author, repo link, and a short *Compatibility rules* section restating the hard rules below.

## Verified facts — Spotify DOM

Song progress bar structure:

```
[data-testid="playback-progressbar"]          ← wrapper, hashed class; STABLE scope hook
└─ .progress-bar  [data-testid="progress-bar"] ← owns the CSS variables
   └─ .x-progressBar-progressBarBg [data-testid="progress-bar-background"]
      ├─ .x-progressBar-sliderArea             ← track (no fill inside)
      ├─ .x-progressBar-sliderArea             ← contains the fill
      │  └─ .x-progressBar-fillColor           ← THE FILL
      └─ [data-testid="progress-bar-handle"]   ← the knob (hashed class)
```

1.3.4.258 adds a visually-hidden `label > input` (range input, accessibility) before `.progress-bar`, and an extra hashed `div` as the first child of `.x-progressBar-progressBarBg`. Neither affects our selectors.

Spotify's own rules (relevant parts):

```css
.progress-bar {
  --bg-color: rgba(var(--spice-rgb-text), .30);
  --fg-color: var(--spice-text);
  --is-active-fg-color: var(--spice-button);
  --progress-bar-transform: 0%;   /* live playback position, e.g. "94.06%" */
  --progress-bar-height: 4px;
  --progress-bar-radius: calc(var(--progress-bar-height) / 2);
}
.x-progressBar-fillColor {
  background-color: var(--fg-color);
  width: 100%;
  transform: translateX(calc(0% - (100% - var(--progress-bar-transform))));
}
[handle] { background-color: var(--fg-color, var(--spice-text)); left: var(--progress-bar-transform); }
```

- The fill is a **full-width element translated left**; its visible part is the rightmost `--progress-bar-transform` percent.
- **The volume slider is the identical component** (same classes, same wrapper class) but without the `playback-progressbar` test id. Every rule must be scoped so it never affects the volume bar.

## Verified facts — coexistence

### Hazy theme ([Astromations/Hazy](https://github.com/Astromations/Hazy)) — #11

- Touches the bar only via variables, single-class selectors, no `!important`:
  `.progress-bar { --bg-color: rgba(255, 555, 255, 0.2); --fg-color: var(--spice-button); --is-active-fg-color: var(--spice-button-active); }` plus a box-shadow on `.x-progressBar-sliderArea`. (`555` is a typo; Chromium clamps it.)
- `--spice-button` is set **at runtime** as an inline style on `:root` by `hazy.js` on every `songchange`: the album-art colour, or the user's fixed "Custom color". Never read theme colours from a theme's `color.ini` — only the live computed value, or better, `var(--spice-button)` in CSS.
- Hazy calls `document.getElementById("color-input")` and styles generic classes globally (`.slider`, `.toggle`, `.toggleWrapper`, `select`). Never use those ids/classes.

### playback-bar-waveform ([Konsl/spicetify-extensions](https://github.com/Konsl/spicetify-extensions)) — #12

Turns the bar into a 24 px audio waveform using **Web Animations API held animations** (`element.animate([...], { fill: "forwards" })`). These beat all normal CSS and are invisible to stylesheet/`style`-attribute inspection — find them with `element.getAnimations()`.

| Element | Change | How |
|---|---|---|
| `.playback-bar` | height → 24 px | animation |
| `.progress-bar` | `--progress-bar-height: 24px`, `--progress-bar-radius: 0px` (registered via `CSS.registerProperty`) | animation |
| `.x-progressBar-progressBarBg` | `background: none` | `<style>` |
| sliderArea **without** the fill | `background: var(--bg-color)` | `<style>` |
| **both** sliderAreas | `mask: url(#progress_bar_waveform_mask)` | animation |
| handle | 2 px × 24 px line, no shadow, hover timestamp tooltip | animation + `<style>` |

It never touches the fill's background, so our gradient is cut into the waveform shape by the parent's mask — this is desired. Its selector constants are a good reference list of historical Spotify class names.

### Spicetify PopupModal

`Spicetify.PopupModal` is a custom element (`generic-modal`, `_HTMLGenericModal` in spicetifyWrapper). `display()` rebuilds its innerHTML, appends our content into its `<main>` and appends itself to `<body>`; `hide()` removes it. Its **overlay click handler hides the modal when `.GenericModal` doesn't `contains(event.target)`** — so a click whose target we detach during dispatch (e.g. re-rendering the stop that owns the clicked ✕) closes the modal. **Never remove or replace the clicked element synchronously in a click handler; defer with `setTimeout(…, 0)`** (#26).

Themes may give the dialog `backdrop-filter` or `transform` (Hazy blurs it). Either makes the dialog the **containing block for `position: fixed`** descendants, so a fixed popover is positioned and clipped by the dialog. **No large popovers inside the modal** — only small ones that fit (the dot menu); anything bigger goes inline (#35). The self-test hit-tests every control with `elementFromPoint` after `scrollIntoView` to catch clipping.

## Hard rules

1. **Scope everything** with `SCOPE` (below). The volume bar must never change.
2. **Never set** `mask`, `height`, `width`, `transform`, `--progress-bar-height`, `--progress-bar-radius`, `--progress-bar-transform`, or any layout property on bar elements. Exception: Anchored mode in #15, once implemented and documented here.
3. **Don't override** `--fg-color`, `--bg-color`, `--is-active-fg-color` — themes and extensions read them.
4. **No `!important`.** Win by specificity: attribute + class ≥ 0,2,0 beats Hazy's 0,1,0. `!important` would also break the waveform's held animations.
5. **No element references from JS** for the bar. Pure CSS selectors survive React re-renders, other extensions' re-query cycles and Spotify updates.
6. **Inert by default**: with default settings the stylesheet is empty.
7. Never hard-code bar geometry; `--progress-bar-radius` is `2px` normally and `0px` under the waveform.

## Rendering — #1, #6

One `<style id="gpb-style">` in `<head>`, fully regenerated whenever settings change.

```js
const SCOPE  = ':is([data-testid="playback-progressbar"], .main-nowPlayingBar-center .playback-bar)';
const FILL   = '.x-progressBar-fillColor';
const HANDLE = ':is([data-testid="progress-bar-handle"], .progress-bar__slider, .x-progressBar-handle)';
```

**Gradient on — Compress mode** (v0.1.0 default: full gradient always spans bar start → playhead):

```css
${SCOPE} ${FILL} {
  background-image: linear-gradient(90deg, <stops>);
  background-size: var(--progress-bar-transform) 100%;
  background-position: right center;
  background-repeat: no-repeat;
}
${SCOPE} ${HANDLE} { background-color: <last stop>; }
```

**Solid:**

```css
${SCOPE} ${FILL}   { background-image: linear-gradient(<c>, <c>); }
${SCOPE} ${HANDLE} { background-color: <c>; }
```

Solid also uses `background-image` so Spotify's hover swap of `background-color` stays hidden underneath. Stops are evenly spaced. A **theme stop** is emitted as `var(--spice-button, var(--spice-text, #1db954))`, never a resolved hex (#7).

**Solid with a theme first stop is inert** (empty stylesheet), whether or not unused stops follow — the bar keeps the theme's own colour (`--fg-color`). Decided with the maintainer; it keeps the default state empty (#1).

Other modes (Anchored, Slide) and their CSS are specified in #15.

## Data model — #2

`Spicetify.LocalStorage`, key `gpb:settings`:

```json
{ "version": 1, "gradient": false, "stops": [ { "id": "s1", "kind": "theme" } ] }
```

`kind: "theme"` has no `color`; `kind: "custom"` has `"color": "#rrggbb"`. 1–8 stops. Invalid → defaults + one `[gpb]` warning. Apply CSS on every input event; persist debounced (~250 ms).

## UI behaviour — #3–#5, #7–#10

- Entry: **right-click the song progress bar** (always), plus the profile menu or a top-bar button where Spicetify can still render them (#28).
- Gradient switch off by default; **adding a 2nd stop turns it on**; **removing to 1 stop turns it off**; **disabled with 1 stop**.
- **Dots are plain `<button>`s: left-click selects, right-click opens a menu, drag reorders** (HTML5 DnD on the dot itself; a click within 300 ms of a drag is ignored, so a drag never changes the selection). No icons on the dots, no dashed ring; theme dots have a "Theme colour" tooltip.
- **Selection (#35)** — exactly one dot is selected and has the ring. The first on open and after Reset; Add and Duplicate select the new dot; removing the selected dot selects the one now at its index (clamped); removing another keeps it; right-click doesn't change it. Clicking a dot only selects it (ring moved in place, the row isn't re-rendered); Enter/Space on a focused dot selects it and moves focus to the hex field.
- **Colour picker (#32, #35)** — our own, because Chromium's native popup is browser chrome and can't be extended. An **inline panel** between the dots and *+ Add colour* that always shows the selected stop — not a popover (see *Spicetify PopupModal*). Two columns from 420 px of content (flex-wrap, 202 + 16 + 202 px), stacked below: left the saturation/value square; right the eyedropper (only if `window.EyeDropper` exists), swatch and hue bar, then R/G/B fields, the **hex row** (label `HEX:` and a fixed `10ch` monospace field, about half the column, centred together in the column in both layouts, #36; accepts `#rrggbb`/`rrggbb`/`#rgb`/`rgb`, live, invalid flagged and ignored, normalised on blur) and **Use theme colour** (disabled as *Following theme colour* on a theme stop). Drags use pointer capture, coalesced per animation frame. Editing a theme stop turns it custom. Picker edits update the dot in place and never re-render the dots row.
- **Dot menu (#33)** — a popover at the cursor: **Duplicate** (copy directly after; a theme stop stays theme; disabled at 8; 1 → 2 turns gradient on) and **Remove** (disabled with 1; down to 1 turns gradient off). Context-menu key / Shift+F10 opens it under the dot; arrows, Home/End, Enter; Tab or Escape close it (focus back on the dot); a click or focus elsewhere closes it.
- **Popover rules** (the menu is the only popover): rendered **inside the modal root** (`position: fixed`, offset-corrected if an ancestor is transformed) — never in `<body>` (#26). **Hidden, never removed**, so a clicked element is never detached during its own click. Menu actions hide it first, then act. Anything that re-renders the dots row (`renderModal`) closes it first.
- Help text between *+ Add colour* and *Reset*: "Click a colour to edit it below, right-click it to duplicate or remove it. Drag colours to reorder them." Spacing (#34): `padding-top: 20px` on the modal root under Spicetify's title bar, and the help text 28 px below *+ Add colour*; the self-test requires both gaps ≥ 16 px. Max 8 stops; preview strip; reset with no confirmation.
- Theme swatches kept live while the modal is open (MutationObserver on `:root` `style` + `songchange`), disconnected on close.
- Modal colours only from Spicetify variables.

## Lifecycle

- `window.__gpb = { version, status, selfTest }` is defined on the **first line**, before any waiting, so a stuck or failed start-up is visible via `__gpb.status()`.
- Wait only for what's required: `LocalStorage`, `PopupModal`, `Player` (warn after 10 s which ones are missing). Use `window.Spicetify?.x`, never bare `Spicetify?.x` (throws if the global doesn't exist).
- Apply the stylesheet **before** registering the entry point: the bar must work even if no menu can be added.
- Entry points: **right-click on the song progress bar always opens the settings** (one delegated `contextmenu` listener on `document`, capture phase, `closest(SCOPE)`; no Spicetify UI wrapper involved) and `__gpb.open()`. `Spicetify.Menu.Item` and `Spicetify.Topbar.Button` are tried as extras; a top-bar button only counts once its element is actually connected. **On Spotify 1.3.4.258 / Spicetify 2.45.3 both are broken**: `Menu.register()` throws `reading 'jsx'`, and Topbar buttons silently never render (Hazy's pencil is gone too) (#27, #28). Never depend on them alone.
- Wrap start-up in `try/catch`; on failure set `status().phase = "failed"` with the stack and `console.error` it.
- `status()` and the self-test report include a DOM probe with an outline of the song bar, so selector breakage after a Spotify update can be fixed from one pasted report.
- No DOM polling for the bar.

## Spotify updates

Spotify auto-updates and wipes Spicetify's patch (the maintainer's 1.3.3 → 1.3.4 update removed all extensions until `spicetify apply`/reinstall). After an update: re-verify the *Verified facts* with the DOM outline from `__gpb.status()`, update this file's version note, and fix selectors in one commit.

## Development (Windows)

```powershell
spicetify config-dir                                   # Extensions folder is inside
# copy or symlink gradientProgressBar.js into <config-dir>\Extensions
spicetify config extensions gradientProgressBar.js
spicetify apply
spicetify watch -e                                     # reload on save
```

Devtools must be enabled (`spicetify enable-devtools`). The maintainer's setup: Hazy theme with Custom color on, playback-bar-waveform enabled.

## Testing

Two layers:

1. **Self-test (#23)** — `await __gpb.selfTest()` in devtools. Drives the extension programmatically, checks computed styles on the live DOM, restores the user's settings afterwards, prints a pass/fail table and copies a JSON report to the clipboard. Everything checkable by code lives here.
2. **Visual checklist (#14)** — only what a human has to see or feel: flicker while seeking/hovering, drag-and-drop feel, colour picker opening, how it looks under the waveform and with Hazy. Keep it to ≤ 8 items.

`README.md → Testing` mirrors both. Add a self-test check (preferred) or a visual item whenever a fix addresses something neither covered.
