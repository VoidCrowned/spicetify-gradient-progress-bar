# Gradient Progress Bar

A [Spicetify](https://spicetify.app) extension that recolours Spotify's song progress bar — one colour, or several blended into a gradient.

> **Status:** in development. The first release (v0.1.0) is tracked in the [roadmap](ROADMAP.md).

<!-- TODO (#13): replace with preview.png -->
_Screenshot coming with v0.1.0._

## Features

- **Solid colour or gradient** — start with one colour; add more and the bar becomes a gradient automatically.
- **Up to 8 colours**, edited in a built-in colour picker with R/G/B and hex input, reorderable by drag-and-drop.
- **Theme colour stop** — a colour that follows your theme's accent instead of a fixed value. With themes that change their accent per song (like Hazy's album-art mode), the bar follows along.
- **Live preview** — changes show on the bar as you pick.
- **Leaves everything else alone** — only the song progress bar changes; the volume slider, layout and your theme's other styling stay as they are. With default settings the extension changes nothing at all.

The gradient always runs from the start of the bar to the playhead, so the bar looks balanced at any point in the song.

## Installation

### Spicetify Marketplace

Search for **Gradient Progress Bar** in the Marketplace and click *Install*.

### Manual

1. Download `gradientProgressBar.js` from this repository.
2. Find your Spicetify config folder:
   ```sh
   spicetify config-dir
   ```
3. Copy the file into its `Extensions` folder.
4. Enable it and apply:
   ```sh
   spicetify config extensions gradientProgressBar.js
   spicetify apply
   ```

To uninstall manually: `spicetify config extensions gradientProgressBar.js-` then `spicetify apply`.

## Usage

**Right-click the song progress bar** to open the settings. Where your Spicetify version supports it, there's also an entry in the profile menu or a button in the top bar (on Spotify 1.3.4 both are currently broken in Spicetify, so right-click is the reliable way).

- **Click a colour dot** to select it (it gets a ring) and edit it in the colour picker below the dots: drag in the square and the hue bar, use the eyedropper (where available), or type R/G/B values or a **hex code** (`#8372fd`, `8372fd` or `#87f`). Changes show on the bar as you go. With the keyboard, Enter or Space on a dot selects it and jumps to the hex field.
- **Use theme colour** in the picker makes the selected colour follow your theme's accent; the button then reads *Following theme colour*. Hover a dot to see whether it's a theme colour.
- **Right-click a dot** for **Duplicate** and **Remove** (also with the context-menu key or Shift+F10).
- **+ Add colour** adds another and selects it; with two or more, gradient mode switches on.
- **Drag the dots** to reorder the gradient.
- **Reset** returns to the default (your theme's own colour, no gradient). It asks for a second click to confirm: the button turns red and reads *Confirm reset?* for 3 seconds; waiting, pressing Escape or clicking anything else cancels.

## Compatibility

Designed to sit on top of any theme without fighting it: it uses no `!important`, never changes the bar's size or shape, and only targets the song progress bar.

Tested with:

| | Notes |
|---|---|
| [Hazy](https://github.com/Astromations/Hazy) | The theme colour stop follows Hazy's accent — whether that's the album-art colour or your *Custom color*. |
| [playback-bar-waveform](https://github.com/Konsl/spicetify-extensions) | The gradient is drawn inside the waveform shape. |

If something looks wrong with your theme or another extension, please [open an issue](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues) with the theme/extension name and a screenshot.

## Roadmap

See [ROADMAP.md](ROADMAP.md). Planned beyond v0.1.0: alternative gradient modes (e.g. a gradient fixed to the track and revealed as the song plays), angles, per-colour opacity, custom stop positions, hover effects, presets.

## Testing

Two layers, run before each release:

1. **Self-test** ([#23](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/23)). Run `await __gpb.selfTest()` in the devtools console of Spotify's **main window** (`spicetify enable-devtools` once). If the console says `__gpb is not defined`, check `typeof Spicetify` first: `"undefined"` means the console is attached to the wrong target, not the main window. If `Spicetify` exists, run `__gpb.status()` instead: it shows whether start-up is waiting, failed, or ready. It applies test settings through the extension's own code, checks the live bar, restores your settings and prints a pass/fail table. The JSON report is copied to the clipboard. It covers:
   - Inert by default: empty stylesheet, bar unchanged.
   - Scoping: the volume bar is never styled. No `!important`, no layout or mask properties, and the bar's theme variables are left alone.
   - Solid and gradient rendering: Compress-mode sizing, stop order, handle colour.
   - Theme stop: emitted as a CSS variable, follows runtime `--spice-button` changes, and the open modal's swatch follows too.
   - Switch, add, the 8-stop limit, dimmed unused stops, preview, drag reorder.
   - Layout: *+ Add colour* and *Reset* in one row (left and right edges), help text last with no empty footer below it.
   - Two-step Reset with real clicks: the first click only arms it (*Confirm reset?*, same width), the second resets; waiting 3 s, Escape, clicking a dot, or closing the settings disarms it without resetting.
   - Selection: the first dot is selected on open and after Reset; Add and Duplicate select the new dot; removing the selected dot selects its neighbour; clicking a dot moves the ring without rebuilding the dots; a drag never changes it.
   - Inline colour picker, driven with real pointer and keyboard events: it sits between the dots and *+ Add colour*, side by side when there's room; every control is reachable (scrolled into view and hit-tested, so nothing is clipped); the `HEX:` row is centred with a half-width field; the square, hue bar, R/G/B and hex fields each update the colour, the dot (in place) and the bar; invalid input is flagged and ignored; *Use theme colour*.
   - Right-click menu: opens at the cursor and is reachable, Duplicate (a theme colour stays a theme colour) and Remove, both disabled states, keyboard use.
   - The settings stay open after every picker and menu action; spacing under the title and above the help text.
   - Modal clean-up: listeners and observers removed on close, no clashes with Hazy's ids and classes.
   - Settings: invalid saved settings fall back to defaults with one warning; saves are debounced and survive a save–load round trip.
   - Bar size, radius and waveform masks unchanged.
2. **Visual checklist** ([#14](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/14)). What needs a human:
   1. Hover, click-seek and drag the bar, solid and gradient → no colour flicker; the whole gradient is visible at roughly 5 %, 50 % and 95 %.
   2. The picker is fully visible, nothing cut off, also under Hazy; clicking a dot moves the ring and the picker follows. Dragging in the square and hue bar feels smooth, also when you drag outside the settings; the eyedropper (if shown) picks a colour from the screen without closing the settings. Right-click a dot → Duplicate / Remove. Drag a dot → a marker shows where it lands and the order changes.
   3. playback-bar-waveform on → gradient inside the waveform, playhead line in the last colour; off → plain bar correct.
   4. Hazy with *Custom color* on → change it and Apply → the bar follows; off → the bar follows the album-art colour across songs.
   5. After using these settings, open Hazy Settings → its colour picker and Apply still work; this modal looks right under Hazy.
   6. No theme (`spicetify config inject_css 0 replace_colors 0 inject_theme_js 0`, `spicetify apply`; restore with `1 1 1`) → bar and modal readable, theme stop falls back sensibly.
   7. Reload Spotify → settings persist; a podcast episode and a window resize → no `[gpb]` errors in the console.
   8. Reset → *Confirm reset?* (red) → a second click resets; waiting 3 s or clicking elsewhere cancels.

## Contributing

Issues and pull requests are welcome. Please read [CLAUDE.md](CLAUDE.md) first — it documents the DOM structure and the compatibility rules the extension depends on.

## Credits

- [Spicetify](https://spicetify.app)
- [Hazy](https://github.com/Astromations/Hazy) by Astromations and [playback-bar-waveform](https://github.com/Konsl/spicetify-extensions) by Konsl — the setups this was built and tested against.
