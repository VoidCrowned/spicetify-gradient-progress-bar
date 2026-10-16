# Changelog

All notable changes to Gradient Progress Bar. Versions follow [semantic versioning](https://semver.org).

## [1.2.3] — 2026-10-16

### Changed
- **New entry icon: a brush over a progress bar** ([#44](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/44)). The old icon, a thin line with a knob, read as a speck in the top bar. The new one follows your theme's icon colour and hover state, and the profile-menu entry now shows it too, so both entry points look alike. The top-bar button returns for everyone with the next Spicetify release ([#38](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/38)).

## [1.2.2] — 2026-10-14

### Changed
- **Spread: the selected mode is filled with your theme colour** ([#43](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/43)). The thin outline and faint tint from 1.2.1 were hard to spot on a dark background. The button is now filled like the Gradient switch, and its label switches between your theme's text and background colours, whichever is easier to read on it. That keeps it readable with light album-art colours under Hazy and in light themes.

### Maintenance
- **Workflows** ([#42](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/42)): the issue-hygiene workflow runs on `actions/github-script@v9` (Node 24). The 3-hourly CDN check moved into its own workflow, so if GitHub pauses it after a quiet stretch, the purge on every release keeps working and switches the check back on.

## [1.2.1] — 2026-10-14

### Fixed
- **Spread: the selected mode follows your theme colour** ([#40](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/40)). Under Hazy it was tinted with the colour scheme's static accent instead of the live one (for example a green fill inside a purple border). It now uses the live `--spice-button`, so it follows Hazy's *Custom color* and album-art colours.
- **Marketplace updates reach users even when jsDelivr is slow** ([#41](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/41)). The cache purge after a release no longer fails on jsDelivr throttling or a slow refresh. It waits up to 20 minutes, and a check every 3 hours purges again until the CDN serves the current version.

## [1.2.0] — 2026-10-14

### Added
- **Spread modes** ([#15](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/15)): choose how a gradient covers the bar, in a new *Spread* row under the Gradient switch.
  - *Compress* (the default, as before): the whole gradient always fits between the start and the playhead.
  - *Anchored*: the colours stay fixed to the bar and are revealed as the song plays. Looks especially good with playback-bar-waveform.
  - *Slide*: a full-length gradient slides in with the playhead.

  Solid colours look the same in every mode, and settings saved by earlier versions load as *Compress*. The self-test checks every mode on the live bar.

## [1.1.0] — 2026-10-14

### Added
- **Keyboard reordering** ([#24](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/24)): with a colour dot focused, Alt + ← / → moves it one place, Alt + Home / End to the first or last place. The bar, the preview and saving work exactly as with drag-and-drop; focus stays on the moved dot and the selection doesn't change.
- Screen readers: each dot's label includes its position ("Colour 2 of 3: #ff0000"), and a move is announced ("Moved to position 3 of 3").
- Dot tooltips mention how to reorder: "Drag or Alt+←/→ to reorder".

## [1.0.1] — 2026-10-13

### Fixed
- **Marketplace installs got stale code** ([#39](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/39)). The Marketplace loads the extension from jsDelivr `@main`, which kept serving an old commit for hours after 1.0.0 was pushed. A workflow now purges jsDelivr's cache on every push and release, and checks that the CDN serves the new version.

### Added
- The self-test reports where the running copy was loaded from (`source`) and every loaded copy (`copies`), and checks that exactly one copy is loaded. A Marketplace install plus a local CLI install would otherwise both run.

## [1.0.0] — 2026-10-13

First public release.

### Features
- **Solid colour or gradient on the song progress bar** ([#1](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/1), [#5](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/5), [#6](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/6)). *Compress* mode: the whole gradient always runs from the bar's start to the playhead, and the playhead takes the last colour. With default settings the extension changes nothing.
- **Theme colour stop** ([#7](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/7)): a colour that follows your theme's accent (`--spice-button`) live, including themes that change it per song.
- **Inline colour picker** ([#32](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/32), [#35](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/35), [#36](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/36)): saturation/brightness square, hue bar, eyedropper (where Chromium offers it), R/G/B fields, a centred `HEX:` field, and *Use theme colour*. It always edits the selected colour, and changes show on the bar as you go.
- **Up to 8 colours** ([#4](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/4)), with a live preview strip ([#9](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/9)).
- **Right-click a colour** for **Duplicate** / **Remove** ([#33](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/33)), also from the keyboard (context-menu key or Shift+F10).
- **Drag colours to reorder them** ([#8](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/8)).
- **Two-step Reset** ([#10](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/10), [#37](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/37)): the first click asks *Confirm reset?*, the second resets; waiting 3 s or clicking elsewhere cancels.
- **Right-click the song progress bar to open the settings** ([#28](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/28)). It works without any Spicetify menu or top-bar API.
- **Built-in self-test** ([#23](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/23)): `await __gpb.selfTest()` in devtools checks rendering, scoping and the settings UI on the live DOM, and copies a JSON report.
- Settings are saved in Spicetify's local storage; invalid saved settings fall back to the defaults ([#2](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/2)).

### Compatibility
- **Hazy** ([#11](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/11)): wins by selector specificity, never with `!important`; follows Hazy's runtime accent (album-art colour or *Custom color*); avoids Hazy's global ids and classes.
- **playback-bar-waveform** ([#12](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/12)): the gradient is cut into the waveform shape; the bar's size, radius, masks and held animations are never touched.
- Only the song progress bar is styled; the volume slider (the same component) never changes.
- Verified on **Spotify 1.3.4.258 / Spicetify 2.45.3** ([#25](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/25)). On that version:
  - `Spicetify.Menu` registration throws ([#27](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/27));
  - `Spicetify.Topbar` buttons never render ([#28](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/28)).

  Both are caught, and right-clicking the bar always opens the settings. The settings window stays open while you edit ([#26](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/26)), and the picker isn't clipped by themes that blur the dialog ([#35](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/35)).

### Known limitations
- **No profile-menu entry or top-bar button** on Spotify 1.3.4.258 / Spicetify 2.45.3 ([#27](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/27), [#28](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/28)). Right-click the song progress bar to open the settings. The extension tries both entries again on every start, so they'll appear once Spicetify fixes them.
- **Hazy's settings couldn't be retested** on that version, because Hazy's own settings button doesn't render either (the same Topbar breakage). Two checks are pending in [#38](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/38): changing *Custom color*, and Hazy's settings after using ours.
