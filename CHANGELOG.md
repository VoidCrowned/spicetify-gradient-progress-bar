# Changelog

All notable changes to Gradient Progress Bar. Versions follow [semantic versioning](https://semver.org).

## [1.6.1] — unreleased

### Changed
- **New built-in presets** ([#53](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/53)): Void, Sunset, Aurora, Neon and Fairy, in their own row. Your own presets and **+ Save** are in the row below. Ocean is gone, and Sunset and Neon have new colours. If one of your own presets has the same name as a built-in, it's shown as "Name (2)".
- **Spotify 1.3.5.3058** ([#55](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/55)): verified; the bar renders as before. The self-test and `__gpb.status()` now report the Spicetify version.

### Fixed
- **Export copies straight to the clipboard** ([#54](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/54)). Spotify's client refuses the browser's clipboard, so Export always showed the code field instead. It now copies through Spicetify's clipboard, with two fallbacks. The button itself confirms with *Copied* and a check mark for 2 seconds. The code field only appears if copying fails completely.

## [1.6.0] — 2026-10-18

### Changed
- **Presets preview before they apply** ([#51](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/51)). The first click on a preset shows it in the strip in the settings window, and the chip asks *Apply?*; the second click applies it. Many themes hide or blur the player while the settings are open, so the strip is where you see what you're trying.
  - Nothing else changes while previewing: not your settings, not the bar. There's no time limit; Escape or clicking elsewhere cancels, and clicking another preset previews that one instead.
  - Every preset is two clicks now, even when your current colours are already a preset. Clicking the preset you're already on does nothing.
  - A share code pasted into *Import* previews in the strip the same way until you press *Apply*.
- **Export and Import look like buttons** ([#52](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/52)): outlined, with an icon. *Copy code* is now called **Export**; *Copied* appears beside it.
- The help text at the bottom has one line per topic: editing, − and +, Reset ([#52](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/52)).

## [1.5.0] — 2026-10-18

### Added
- **Presets** ([#21](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/21)). A new row below Spread has four built-in gradients (Sunset, Ocean, Aurora, Neon) and up to 12 of your own.
  - Click a chip to apply it. If your current colours aren't saved anywhere, it first asks *Apply?*, so you can't lose them by accident.
  - After applying, *Undo* is there for 10 seconds.
  - The built-ins only change the colours and keep your Spread choice; your own presets bring back everything they saved.
  - **+ Save** stores the current settings under a name. Right-click your own preset to rename it, update it to the current colours or delete it (with Undo).
- **Share codes** ([#21](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/21)). *Copy code* puts a short code for your settings (`gpb1:…`, about 60–70 characters for three colours) on the clipboard. If the clipboard isn't available, the code shows selected so you can copy it yourself. *Import* takes a pasted code, applies it and offers Undo; an invalid code changes nothing.

## [1.4.1] — 2026-10-17

### Fixed
- **Hover feedback on − and +** ([#50](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/50)). Hovering a half of the − | + pill only made its symbol slightly lighter, which was hard to see, especially under Hazy. Now the hovered half's whole outline, including the line in the middle, brightens together with its symbol, the same way Reset's border does. At rest the pill looks as before.

## [1.4.0] — 2026-10-17

### Changed
- **− | + after the colour dots** ([#49](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/49)). The round + is now a small pill with two halves: **+** adds a colour as before, and the new **−** removes the selected colour (the one with the ring). Until now removing a colour was only in the right-click menu, which was easy to miss. The right-click menu stays.
- **Delete or Backspace removes a colour** ([#49](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/49)): tab to a colour dot and press either key. Typing in the hex or R/G/B fields isn't affected.
- The help text now mentions + and −.

## [1.3.0] — 2026-10-17

### Changed
- **The Gradient switch works with one colour** ([#46](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/46)). It used to be greyed out until you added a second colour, and the only hint was a tooltip on the row. Now switching it on adds a second colour, a copy of the first, and selects it so you can change it straight away. Switching off keeps your colours as before.
- **A round + after the colour dots** replaces the *+ Add colour* button ([#47](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/47)). It adds a copy of the last colour and selects it; at 8 colours it's greyed out. Adding a colour after a theme colour now gives another theme colour, the same as Duplicate.
- **Reset is centred** below the colour picker, and the help text explains it: "Reset goes back to a single colour that follows your theme." ([#47](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/47))

### Fixed
- **Even margins in the settings window** ([#48](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/48)). Under Hazy there was more than twice as much empty space below the help text as at the sides, because the theme adds padding to the popup that Spicetify's settings windows share. The space now matches the sides. Only this extension's settings window changes; other extensions' popups are untouched.

## [1.2.5] — 2026-10-16

### Changed
- **Top-bar button and profile-menu entry, both at the same time** ([#45](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/45)). Until now the top-bar button was only a fallback when the profile-menu entry couldn't be added, so since 1.2.4 it never appeared. Both are now added, so the settings are wherever you look first. Spicetify 2.45.3 can't show top-bar buttons on Spotify 1.3.4 ([#38](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/38)); ours appears by itself once Spicetify is fixed. Right-clicking the song progress bar always works.

## [1.2.4] — 2026-10-16

### Fixed
- **Profile-menu entry works with local installs and never breaks the profile menu** ([#27](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/27)). The entry used to fail as a local (CLI) install because the extension started before Spicetify was ready; it now waits for Spicetify. On Spotify 1.3.4 with Spicetify 2.45.3, a Spicetify bug makes the profile menu fail to open as soon as any extension adds an entry ([spicetify/cli#4012](https://github.com/spicetify/cli/issues/4012)). The entry stays hidden while that bug is present and appears by itself once Spicetify is fixed. Right-clicking the song progress bar always opens the settings.

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
