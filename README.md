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
- Drag dots to reorder the gradient.
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

Run `await __gpb.selfTest()` in the Spotify devtools console — it checks everything that can be checked automatically and prints a pass/fail table ([#23](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/23)). The full list of behaviours covered, by the self-test or by eye ([#14](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/14)):

1. Fresh install → bar looks exactly as before.
2. Solid custom colour → fill and handle change; volume bar unchanged.
3. Two or more colours → gradient switches on; full gradient visible from bar start to playhead at 5 %, 50 % and 95 % progress.
4. Seek by clicking and dragging; hover the bar → no colour flicker.
5. Remove down to one colour → gradient switches off and the switch is disabled.
6. Hazy with *Custom color* on → theme stop matches; change it in Hazy → the bar follows.
7. Hazy with *Custom color* off → theme stop follows the album-art colour across songs.
8. playback-bar-waveform on → gradient inside the waveform; off → plain bar still correct.
9. No theme (`spicetify config inject_css 0 replace_colors 0 inject_theme_js 0`, `spicetify apply`; restore with `1 1 1`) → works; theme stop falls back sensibly.
10. Open and close the settings, then open Hazy Settings → Hazy's colour picker and Apply still work.
11. Reload Spotify → settings persist.
12. Corrupt the saved settings → defaults are restored with one console warning.
13. Podcast episode and window resize → no console errors.

## Contributing

Issues and pull requests are welcome. Please read [CLAUDE.md](CLAUDE.md) first — it documents the DOM structure and the compatibility rules the extension depends on.

## Credits

- [Spicetify](https://spicetify.app)
- [Hazy](https://github.com/Astromations/Hazy) by Astromations and [playback-bar-waveform](https://github.com/Konsl/spicetify-extensions) by Konsl — the setups this was built and tested against.
