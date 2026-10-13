# Gradient Progress Bar

A [Spicetify](https://spicetify.app) extension that recolours Spotify's song progress bar — one colour, or several blended into a gradient.

> **Status:** in development. The first release (v0.1.0) is tracked in the [roadmap](ROADMAP.md).

<!-- TODO (#13): replace with preview.png -->
_Screenshot coming with v0.1.0._

## Features

- **Solid colour or gradient** — start with one colour; add more and the bar becomes a gradient automatically.
- **Up to 8 colours**, each with its own colour picker, reorderable by drag-and-drop.
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

Open the profile menu (top right) → **Gradient progress bar**.

- Click a colour dot to change it.
- **+ Add colour** adds another; with two or more, gradient mode switches on.
- Hover a dot to remove it, or to link it to your theme colour.
- Drag a dot by its grip (top-left, shown on hover) to reorder the gradient.
- **Reset** returns to the default (your theme's own colour, no gradient).

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
   - Switch, add, remove, the 8-stop limit, dimmed unused stops, preview, drag reorder and reset.
   - Modal clean-up: listeners and observers removed on close, no clashes with Hazy's ids and classes.
   - Settings: invalid saved settings fall back to defaults with one warning; saves are debounced and survive a save–load round trip.
   - Bar size, radius and waveform masks unchanged.
2. **Visual checklist** ([#14](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/14)). What needs a human:
   1. Hover, click-seek and drag the bar, solid and gradient → no colour flicker; the whole gradient is visible at roughly 5 %, 50 % and 95 %.
   2. Click a dot → the colour picker opens; drag a dot's grip → a marker shows where it lands and the order changes.
   3. playback-bar-waveform on → gradient inside the waveform, playhead line in the last colour; off → plain bar correct.
   4. Hazy with *Custom color* on → change it and Apply → the bar follows; off → the bar follows the album-art colour across songs.
   5. After using these settings, open Hazy Settings → its colour picker and Apply still work; this modal looks right under Hazy.
   6. No theme (`spicetify config inject_css 0 replace_colors 0 inject_theme_js 0`, `spicetify apply`; restore with `1 1 1`) → bar and modal readable, theme stop falls back sensibly.
   7. Reload Spotify → settings persist.
   8. Podcast episode and window resize → no `[gpb]` errors in the console.

## Contributing

Issues and pull requests are welcome. Please read [CLAUDE.md](CLAUDE.md) first — it documents the DOM structure and the compatibility rules the extension depends on.

## Credits

- [Spicetify](https://spicetify.app)
- [Hazy](https://github.com/Astromations/Hazy) by Astromations and [playback-bar-waveform](https://github.com/Konsl/spicetify-extensions) by Konsl — the setups this was built and tested against.
