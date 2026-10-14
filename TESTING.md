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
- Switch, add, the 8-stop limit, dimmed unused stops, preview, drag reorder.
- Layout: *+ Add colour* and *Reset* in one row (left and right edges), help text last with no empty footer below it.
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
- The settings stay open after every picker and menu action; spacing under the title and above the help text.
- Modal clean-up: listeners and observers removed on close, no clashes with Hazy's ids and classes.
- Settings: invalid saved settings fall back to defaults with one warning; saves are debounced and survive a save–load round trip.
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
3. playback-bar-waveform on → gradient inside the waveform, playhead line in the last colour, also in *Anchored* (colours fixed in place inside the waveform); off → plain bar correct.
4. *Blocked until Spicetify's Topbar works, see [#38](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/38).* Hazy with *Custom color* on → change it and Apply → the bar and the selected Spread button's fill follow, its label stays easy to read; off → the bar follows the album-art colour across songs.
5. *Blocked until Spicetify's Topbar works, see [#38](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/38).* After using these settings, open Hazy Settings → its colour picker and Apply still work; this modal looks right under Hazy.
6. No theme (`spicetify config inject_css 0 replace_colors 0 inject_theme_js 0`, `spicetify apply`; restore with `1 1 1`) → bar and modal readable, theme stop falls back sensibly.
7. Reload Spotify → settings persist; a podcast episode and a window resize → no `[gpb]` errors in the console.
8. Reset → *Confirm reset?* (red) → a second click resets; waiting 3 s or clicking elsewhere cancels.

Add a self-test check (preferred) or a visual item whenever a fix addresses something neither layer covered yet.
