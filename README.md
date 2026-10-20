# Gradient Progress Bar

A [Spicetify](https://spicetify.app) extension that recolours Spotify's song progress bar — one colour, or several blended into a gradient.

> **Status:** released — **v1.7.0**. See the [changelog](CHANGELOG.md) and the [roadmap](ROADMAP.md).

<p align="center"><img src="preview.png" alt="Gradient Progress Bar: a gradient song progress bar and the settings window with the inline colour picker" width="580"></p>

## Features

Your progress bar, your colours. Pick one colour or blend up to eight into a gradient, and the bar changes as you go.

- **Paint it your way.** Click a colour dot, then drag in the picker, type a hex code, or take any colour from the screen with the eyedropper. Press **+** for another colour and the bar becomes a gradient. Drag the dots to reorder them.
- **Three ways to spread a gradient.**
  - *Compress* fits the whole gradient between the start and the playhead.
  - *Anchored* keeps the colours fixed to the bar and reveals them as the song plays.
  - *Slide* moves a full-length gradient in with the playhead.
- **Match your theme.** *Use theme colour* makes a colour follow your theme's accent, even one that changes with every album cover, like Hazy's album-art mode.
- **Presets to start from.** There are five built-in gradients (Void, Sunset, Aurora, Neon, Fairy) and room for 12 of your own. Click a preset once to preview it and again to apply it. *Undo* is there if you change your mind.
- **Share your look.** **Export** copies your settings as a short code (`gpb1:…`), and whoever you send it to pastes it into **Import**. Codes from [Gradient Connect Bar](https://github.com/VoidCrowned/spicetify-gradient-connect-bar) (`gcb1:…`) work too.
- **Plays nicely with others.** Only the song progress bar changes. The volume slider, the layout and your theme stay as they are. With default settings the extension changes nothing at all, and *Reset* takes you back there in two clicks.

## Installation

**Spicetify Marketplace:** search for **Gradient Progress Bar** and click *Install*.

**Manual:**

1. Download `gradientProgressBar.js` from the [latest release](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/releases/latest).
2. Copy it into the `Extensions` folder inside your Spicetify config folder (`spicetify config-dir` shows where), then enable it:
   ```sh
   spicetify config extensions gradientProgressBar.js
   spicetify apply
   ```

To uninstall: `spicetify config extensions gradientProgressBar.js-` then `spicetify apply`.

## Usage

**Right-click the song progress bar** to open the settings. You can also use the brush icon in the top bar or the profile menu, where Spicetify shows them ([Troubleshooting](#troubleshooting)). If you also use Gradient Connect Bar, the two share one top-bar button.

The window explains the rest, with a short help text at the bottom and tooltips on the controls.

**Keyboard:**
- Alt + ←/→ moves a colour.
- Delete removes it.
- Enter jumps to the hex field.
- Shift + F10 opens a colour's menu.

## Compatibility

Designed to sit on top of any theme without fighting it: it uses no `!important`, never changes the bar's size or shape, and only targets the song progress bar. Tested with:

| | Notes |
|---|---|
| [Hazy](https://github.com/Astromations/Hazy) | The theme colour stop follows Hazy's accent — whether that's the album-art colour or your *Custom color*. |
| [playback-bar-waveform](https://github.com/Konsl/spicetify-extensions) | The gradient is drawn inside the waveform shape. |

## Troubleshooting

> **Spicetify 2.45.3 on Spotify 1.3.4 or later:** two Spicetify bugs hide the top-bar button ([#38](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/38)) and the profile-menu entry ([spicetify/cli#4012](https://github.com/spicetify/cli/issues/4012)). Until Spicetify releases the fixes, my [spicetify-fixes](https://github.com/VoidCrowned/spicetify-fixes) works around both (read its README first). Either way, the settings always open with a right-click on the song progress bar.

- **After a Spotify update the bar is back to normal:** updates remove Spicetify's patch. Run `spicetify apply`, or `spicetify backup apply` if Spicetify asks for it.
- **The bar keeps the theme colour although you set colours:** with the gradient off, only the first colour counts. If that one follows the theme, the extension deliberately leaves the bar alone. Click it and pick a colour, or switch the gradient on.
- **Something looks wrong with your theme or another extension:** [open an issue](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/new/choose) and follow [CONTRIBUTING.md → Reporting a bug](CONTRIBUTING.md#reporting-a-bug).

## Roadmap

See [ROADMAP.md](ROADMAP.md) and the [changelog](CHANGELOG.md).

## Contributing

Bug reports and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) and [TESTING.md](TESTING.md).

## Credits

- [Spicetify](https://spicetify.app)
- [Hazy](https://github.com/Astromations/Hazy) by Astromations and [playback-bar-waveform](https://github.com/Konsl/spicetify-extensions) by Konsl — the setups this was built and tested against.

## Licence

Copyright © 2026 VoidCrowned. This program is free software. It comes without any warranty, to the extent permitted by applicable law. You can redistribute it and/or modify it under the terms of the Do What The Fuck You Want To Public License, Version 2, as published by Sam Hocevar. See [LICENSE](LICENSE) or http://www.wtfpl.net/ for more details.
