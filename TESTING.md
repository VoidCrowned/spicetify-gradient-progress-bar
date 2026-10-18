# Testing

Run both layers **before every release** and **after every Spotify update**. Spotify updates can change the DOM the extension depends on, and they remove Spicetify's patch until you run `spicetify apply` again.

1. **Self-test** ([#23](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/23)): everything that can be checked by code, in about 5 seconds.
2. **Visual checklist** ([#14](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/14), the release test pass): only what a human has to see or feel.

## Opening the devtools console

1. Enable devtools once: `spicetify enable-devtools`.
2. Open the devtools of Spotify's **main window** (not a helper or service-worker target).
3. If the console says `__gpb is not defined`, run `typeof Spicetify`:
   - `"undefined"`: the console is attached to the wrong target. Pick the main window.
   - `"object"`: run `__gpb.status()`. It shows whether start-up is still waiting, has failed (with the error), or is ready, plus a DOM probe of the song progress bar.

## Self-test

```js
await __gpb.selfTest()
```

It applies test settings through the extension's own code, checks computed styles on the live bar and drives the settings window with real pointer, mouse and keyboard events. Afterwards it **restores your settings**, prints a pass/fail table and **copies a JSON report to the clipboard**. Paste that report into an issue, or into the `Test build` comment it belongs to.

It covers:
- Exactly one copy of the extension is loaded, and where it came from (Marketplace via jsDelivr, or a local CLI install).
- Profile-menu entry (#27): registered without throwing when `Spicetify.Menu.Item` and `Spicetify.ReactJSX` exist. Whether Spicetify's `MenuItem` is usable (`menuItemUsable`) is reported in the environment block only, never as a failure.
- Top-bar button (#45): created as well as the profile-menu entry, not as a fallback; on screen or still waiting for Spicetify's top bar (#38).
- Entry icon (#44): `currentColor`, a 16 × 16 viewBox, no `id=` or `<defs>`; the top-bar icon (when the button is on screen) renders at 16 × 16 px in the button's colour; nested in Spotify's `IconComponent` as the profile menu shows it, it still renders at 16 × 16 px.
- Inert by default: empty stylesheet, bar unchanged.
- Scoping: the volume bar is never styled. No `!important`, no layout or mask properties, and the bar's theme variables are left alone.
- Solid and gradient rendering: stop order and handle colour in every mode.
- Spread modes (#15), each against the live song fill:
  - Compress sizes the gradient to the playhead and keeps Spotify's transform;
  - Anchored has `transform: none`, a `clip-path` inset and the fill's left edge on its slider area's;
  - Slide has no overrides;
  - in every mode: volume fill, bar variables, height, radius and waveform masks untouched.
- Spread lint and data: `transform: none` + `clip-path` only in Anchored's fill rule; solid output identical in all modes; mode saved and reloaded; old settings without a mode load as Compress silently; an unknown mode → defaults + one warning.
- Spread row: the selected button is filled with a runtime `--spice-button` (a dark and a light probe), opaque, its label in the higher-contrast of `--spice-text`/`--spice-main` and ≥ 4.5:1; no `--spice-rgb-button` in the settings CSS; between the Gradient row and the preview; clicks and keys (→, ←, Home, End) change the mode live; updated in place, never re-rendered; disabled with the gradient off or one colour; Reset → Compress; the settings stay open.
- Theme stop:
  - emitted as a CSS variable;
  - follows runtime `--spice-button` changes;
  - the dot and picker in the open settings follow too.
- Gradient switch with one colour (#46): enabled and off, no row tooltip; switching it on adds a copy of the colour (a theme colour stays theme), turns the gradient on, selects the new dot, keeps focus on the same switch node, enables the Spread row and leaves the settings open; switching off keeps both colours; switching on with two adds nothing.
- Switch, add, the 8-stop limit, dimmed unused stops, preview, drag reorder.
- Layout (#47): no *+ Add colour* button left; *Reset* alone in its row, centred (±1 px); help text last.
- Help text (#52): three lines in order, still the root's last child.
- −|+ stepper (#49):
  - a group *Colours* outside the dots container, right after the last dot (same line, 14 px like the dots, a dot's height); − then +, tab order dots, −, +; both halves about 34 px wide and hit-test to themselves; not a dot (no menu, not draggable, same nodes after adding);
  - at rest the middle is one line (+'s left border transparent, −'s right border the normal colour), each half 34 px between its borders, the pill 71 × 32 px; the hover rule (#50) sets the hovered half's whole outline and glyph to `--spice-text`, excludes disabled halves, and raises + over −'s edge (read through CSSOM);
  - + adds and selects a copy of the last colour and is disabled at 8 (*Up to 8 colours*); − removes the selected dot with the #35 selection rule, keeps focus, and is disabled at one colour (*At least one colour*), which turns the gradient off; a focused half that becomes disabled hands focus to the selected dot; the settings stay open.
- Delete/Backspace on a focused dot (#49): removes that dot (an unselected one keeps the selection, the selected one moves it as Remove does); focus on the dot now at that index; *Colour removed, N left* announced; at one colour nothing is removed but the key is consumed; Backspace in the hex field removes nothing; Spotify doesn't navigate.
- Two-step Reset with real clicks:
  - the first click only arms it (*Confirm reset?*, same width), the second resets;
  - waiting 3 s, Escape, clicking a dot, or closing the settings disarms it without resetting.
- Selection:
  - the first dot is selected on open and after Reset;
  - Add and Duplicate select the new dot;
  - removing the selected dot selects its neighbour;
  - clicking a dot moves the ring without rebuilding the dots, and a drag never changes it.
- Keyboard reordering with real key events: Alt+→ / Alt+End / Alt+Home move the focused dot (bar order, focus, unchanged selection, live-region announcement, modal open); nothing happens at the edges or on a plain →; Spotify doesn't navigate.
- Inline colour picker, driven with real pointer and keyboard events:
  - it sits between the dots and the action row, side by side when there's room;
  - every control is reachable (scrolled into view and hit-tested, so nothing is clipped);
  - the `HEX:` row is centred with a half-width field;
  - the square, hue bar, R/G/B and hex fields each update the colour, the dot (in place) and the bar;
  - invalid input is flagged and ignored;
  - *Use theme colour* works.
- Right-click menu:
  - opens at the cursor and is reachable;
  - Duplicate (a theme colour stays a theme colour) and Remove, and both disabled states;
  - keyboard use.
- The settings stay open after every picker, menu and preset action; spacing under the title and above the help text.
- Bottom margin (#48): with the content scrolled to the end, the space below the help text matches the side margin (within 4 px, to the dialog's edges); the detail lists each ancestor's share. The next popup opened by any extension has none of our inline padding.
- Modal clean-up: listeners and observers removed on close, no clashes with Hazy's ids and classes.
- Settings: invalid saved settings fall back to defaults with one warning; saves are debounced and survive a save–load round trip.
- Presets and share codes (#21):
  - store: save → load round-trip in `gpb:presets`; invalid entries, duplicate ids and any beyond 12 dropped with one warning; a corrupt or unknown key gives an empty list and one warning; names trimmed, ≤ 24 characters, unique (built-ins included, any case); built-ins can't be deleted, renamed or updated;
  - codes: round-trip for theme and custom stops, every mode, gradient on and off; garbage, a wrong prefix, 9 stops, a bad hex, an unknown or missing mode and `g` 2 rejected; whitespace accepted;
  - built-ins (#53): exactly Void, Sunset, Aurora, Neon and Fairy in that order, fixed colours, each encoding to and decoding from its share code; stored own presets clashing with a built-in name are renamed on load (*(2)*), ids unchanged, no warning; row 1 holds only the built-ins, row 2 the own chips and + Save (just + Save when there are none), 8 px apart;
  - layout: the Presets row between Spread and the preview, label left, Export and Import right, every chip reachable; built-ins first, own presets, + Save last; 12 px swatches painted with `fillImage()`;
  - two-step apply with real clicks (#51): the first click arms (*Apply?*, width ±1 px) and previews the preset in the strip, with *Previewing "Fairy" — …* in the status line, while the settings, `#gpb-style`, the dots and the picker stay unchanged; still armed after 3.5 s; a click on another chip moves the arm and the preview; Escape and a click elsewhere revert the strip and the status line; the second click applies (built-ins keep the mode, own presets restore everything) on the same chip node, and the strip follows; two clicks also from a preset or the defaults; a click on the active chip does nothing; disarming shows a running Undo again; the active chip has `aria-pressed` and a `--spice-button` border;
  - Undo after apply, import and delete restores exactly; a new action replaces it; later edits drop it; it expires after 10 s;
  - + Save: an inline field prefilled *Preset 1*; Escape cancels; Enter saves, stores and shows the new chip, active and focused; disabled at 12; the chip menu (Rename, Update to current colours, Delete; none on built-ins), also with Shift+F10; Rename with a clash gets *(2)*;
  - Import: a valid code in the field previews in the strip (*Previewing code — Apply to use it*) without changing anything, clearing the field or Escape reverts it; an invalid code is flagged and changes nothing; a valid one applies and offers Undo; Export (#54): with stubbed sources, Spicetify's `ClipboardAPI` is used first, `writeText` without it, `execCommand("copy")` from a hidden, selected textarea inside the modal root (removed again, focus back) when both fail, and only when all three fail the selected read-only field with the copy hint; on success the button itself reads *Copied* with the check icon (width ±1 px), "Share code copied" is announced, and *Export* is back after 2 s; with the real clipboard the code must get through one of the tiers (named in the detail column) without the field;
  - Export and Import (#52): outlined pills (computed border ≥ 1 px, not transparent), a 14 px icon first, bold labels *Export* / *Import* and their titles, no *Copy code* left anywhere; the hover rule (border → `--spice-text`) read through CSSOM;
  - the settings stay open after every chip, menu, Save, Import, Export and Undo action, and the clicked chip, menu item or button is never detached.
- Bar size, radius and waveform masks unchanged.

## After a release

Check `__gpb.version` in the console. The Marketplace loads the extension via jsDelivr `@main`. `purge-jsdelivr.yml` clears the cache on every push and release, and `cdn-heal.yml` runs every 3 h and purges again whenever the CDN's `VERSION` differs from `main`'s. **If the CDN lags after a release, don't purge by hand repeatedly**: repeated purges get throttled, and the scheduled heal fixes it. Only if it's urgent, run it once manually after jsDelivr is reachable again: `gh workflow run purge-jsdelivr.yml`. GitHub switches the heal off after 60 days without repository activity; every push and release switches it back on.

## Visual checklist

What needs a human (≤ 8 items):

1. Hover, click-seek and drag the bar, solid and gradient, in each Spread mode → no colour flicker. At roughly 5 %, 50 % and 95 %: *Compress* shows the whole gradient; *Anchored* reveals colours that stay in place; *Slide* slides the gradient in from the left. The playhead end looks the same in all three.
2. The picker is fully visible, with nothing cut off, also under Hazy.
   - Clicking a dot moves the ring and the picker follows.
   - Dragging in the square and hue bar feels smooth, also when you drag outside the settings.
   - The eyedropper (if shown) picks a colour from the screen without closing the settings.
   - Right-click a dot → Duplicate / Remove.
   - Drag a dot → a marker shows where it lands and the order changes.
   - Tab to a dot, press Alt+→ → it moves and keeps focus; Spotify doesn't go back or forward.
   - Hover − and + → the hovered half's outline, including the middle line, and its glyph brighten, like Reset.
3. playback-bar-waveform on → gradient inside the waveform, playhead line in the last colour, also in *Anchored* (colours fixed in place inside the waveform); off → plain bar correct.
4. *Blocked until Spicetify's Topbar works, see [#38](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/38).* Hazy with *Custom color* on → change it and Apply → the bar and the selected Spread button's fill follow, its label stays easy to read; off → the bar follows the album-art colour across songs.
5. *Blocked until Spicetify's Topbar works, see [#38](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/38).* After using these settings, open Hazy Settings → its colour picker and Apply still work; this modal looks right under Hazy.
6. No theme (`spicetify config inject_css 0 replace_colors 0 inject_theme_js 0`, `spicetify apply`; restore with `1 1 1`) → bar and modal readable, theme stop falls back sensibly.
7. Reload Spotify → settings persist; the profile menu opens, and our entry shows with its icon when `__gpb.status().menu.menuItemUsable` is true and is absent when it's false; the brush button shows in the top bar wherever Spicetify's top bar works (#38); a podcast episode and a window resize → no `[gpb]` errors in the console.
8. Reset and presets: Reset → *Confirm reset?* (red) → a second click resets; waiting 3 s or clicking elsewhere cancels.
   - Click a preset: the strip in the settings window shows it and the bar stays as it is; click it again: the bar changes. Esc cancels.
   - The Presets chip row looks tidy and wraps nicely; the Undo line is easy to spot.
   - *Export* and *Import* look like buttons (outline and icon) and brighten on hover. Export → the button shows *Copied* with a check; pasting works. *Import* that code after changing things → the first state is back.

Add a self-test check (preferred) or a visual item whenever a fix addresses something neither layer covered yet.
