# Changelog

All notable changes to Gradient Progress Bar. Versions follow [semantic versioning](https://semver.org).

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
