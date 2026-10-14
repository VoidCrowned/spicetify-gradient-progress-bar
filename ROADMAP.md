# Roadmap

Mirrors the [GitHub milestones](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/milestones). Issues are the source of truth; this file is kept in sync when they change.

## v1.2.2 — planned

| # | Issue | Area | Status |
|---|---|---|---|
| [#43](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/43) | Spread: fill the selected mode with the theme colour | ui, compatibility | ✅ |
| [#42](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/42) | Workflow maintenance: github-script v9; keep the scheduled CDN heal from disabling the purge | packaging | ⏳ |

## v1.2.1 — released 2026-10-14

| # | Issue | Area | Status |
|---|---|---|---|
| [#40](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/40) | Spread: selected mode tinted with a stale colour instead of the theme colour | bug, ui, compatibility | ✅ |
| [#41](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/41) | Purge workflow fails when jsDelivr throttles or is slow to refresh @main | bug, packaging | ✅ |

## v1.2.0 — released 2026-10-14

| # | Issue | Area | Status |
|---|---|---|---|
| [#15](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/15) | Gradient modes ("Spread"): Compress / Anchored / Slide | rendering, ui | ✅ |

## v1.1.0 — released 2026-10-14

| # | Issue | Area | Status |
|---|---|---|---|
| [#24](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/24) | Keyboard reordering of colour stops (Alt + arrow keys) | ui | ✅ |

## v1.0.1 — released 2026-10-13

| # | Issue | Area | Status |
|---|---|---|---|
| [#39](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/39) | Marketplace serves stale code: jsDelivr caches `@main` | packaging | ✅ |

## v1.0.0 — released 2026-10-13

Solid colour or a gradient that always spans bar start → playhead (Compress mode), a stop that follows the theme colour, and clean coexistence with Hazy and playback-bar-waveform.

| # | Issue | Area | Status |
|---|---|---|---|
| [#1](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/1) | Scoped stylesheet engine (inert by default) | rendering | ✅ |
| [#2](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/2) | Settings schema, persistence and validation | core | ✅ |
| [#3](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/3) | Settings modal: entry point and layout | ui | ✅ |
| [#4](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/4) | Colour stops: pickers, add and remove | ui | ✅ |
| [#5](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/5) | Gradient switch behaviour | ui | ✅ |
| [#6](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/6) | Gradient rendering: Compress mode + handle colour | rendering | ✅ |
| [#7](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/7) | Theme colour stop | ui, compatibility | ✅ |
| [#8](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/8) | Drag-and-drop reordering of stops | ui | ✅ |
| [#9](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/9) | Live preview strip in the modal | ui | ✅ |
| [#10](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/10) | Reset to defaults | ui | ✅ |
| [#11](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/11) | Compatibility: Hazy theme | compatibility | ✅ |
| [#12](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/12) | Compatibility: playback-bar-waveform extension | compatibility | ✅ |
| [#13](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/13) | Marketplace packaging | packaging | ✅ |
| [#14](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/14) | v0.1.0 manual test pass (visual checklist, ≤ 8 items) | testing | ✅ |
| [#23](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/23) | Built-in self-test: `__gpb.selfTest()` | testing | ✅ |
| [#25](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/25) | Silent start-up hang; re-verify DOM on Spotify 1.3.4.258 | bug, compatibility | ✅ |
| [#26](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/26) | Removing a colour closes the settings modal | bug, ui | ✅ |
| [#27](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/27) | Profile menu registration throws on Spotify 1.3.4.258 — no settings entry | bug, compatibility | ✅ |
| [#28](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/28) | Top-bar button never renders on Spotify 1.3.4.258 — no visible way to open settings | bug, compatibility | ✅ |
| [#30](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/30) | Hex colour field for the selected colour | ui | ✅ |
| [#31](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/31) | Labelled actions and help text instead of tiny icons on the dots | ui | ✅ |
| [#32](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/32) | Own colour picker on left-click, with hex field and theme button | ui | ✅ |
| [#33](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/33) | Right-click menu on colour dots: Duplicate / Remove | ui | ✅ |
| [#34](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/34) | Settings polish: spacing, no dashed ring, new help text | ui | ✅ |
| [#35](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/35) | Picker is clipped by the settings window — move it inline | bug, ui, compatibility | ✅ |
| [#36](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/36) | Hex row: "HEX:" label, half-width field, centred | ui | ✅ |
| [#37](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/37) | Reset in the + Add colour row, help text last | ui | ✅ |

Suggested build order: #2 → #1 → #6 → #3 → #4 → #5 → #7 → #9 → #8 → #10 → #23 → #11/#12 → #13 → #14.

Builds were handed over as `Test build <sha>` comments on #14 (closed with the release). See `CLAUDE.md → Working mode`. Release notes: [CHANGELOG.md](CHANGELOG.md); test procedure: [TESTING.md](TESTING.md).

## Next

v1.2.2 (#43, #42) is next, see above. Other candidates are in the [Future milestone](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/milestone/2), with [#38](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/38) (Hazy retest once Spicetify's Topbar works) waiting on Spicetify.

## Future

Agreed ideas, not scheduled.

| # | Issue | Notes |
|---|---|---|
| [#16](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/16) | Gradient direction / angle | |
| [#17](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/17) | Per-stop opacity | ties into #19 |
| [#18](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/18) | Custom stop positions | schema v2; requested again — drag stops along the preview strip |
| [#19](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/19) | Hover behaviour option | |
| [#20](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/20) | Optional styling for the track and the volume bar | opt-in only |
| [#21](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/21) | Presets and import/export | |
| [#22](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/22) | Handle colour = colour at current position | builds on Anchored (#15, v1.2.0) |
| [#29](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/29) | Own visible settings button independent of Spicetify UI wrappers | only if right-click isn't enough |
| [#38](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/38) | Retest with Hazy settings changes once Spicetify's Topbar works | the two Hazy items moved from #14 |
