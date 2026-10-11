# Roadmap

Mirrors the [GitHub milestones](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/milestones). Issues are the source of truth; this file is kept in sync when they change.

## v0.1.0 — MVP

Solid colour or a gradient that always spans bar start → playhead (Compress mode), a stop that follows the theme colour, and clean coexistence with Hazy and playback-bar-waveform.

| # | Issue | Area | Status |
|---|---|---|---|
| [#1](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/1) | Scoped stylesheet engine (inert by default) | rendering | |
| [#2](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/2) | Settings schema, persistence and validation | core | ✅ |
| [#3](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/3) | Settings modal: entry point and layout | ui | |
| [#4](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/4) | Colour stops: pickers, add and remove | ui | |
| [#5](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/5) | Gradient switch behaviour | ui | |
| [#6](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/6) | Gradient rendering: Compress mode + handle colour | rendering | |
| [#7](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/7) | Theme colour stop | ui, compatibility | |
| [#8](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/8) | Drag-and-drop reordering of stops | ui | |
| [#9](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/9) | Live preview strip in the modal | ui | |
| [#10](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/10) | Reset to defaults | ui | |
| [#11](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/11) | Compatibility: Hazy theme | compatibility | |
| [#12](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/12) | Compatibility: playback-bar-waveform extension | compatibility | |
| [#13](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/13) | Marketplace packaging | packaging | |
| [#14](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/14) | v0.1.0 manual test pass (visual checklist, ≤ 8 items) | testing | |
| [#23](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/23) | Built-in self-test: `__gpb.selfTest()` | testing | |

Suggested build order: #2 → #1 → #6 → #3 → #4 → #5 → #7 → #9 → #8 → #10 → #23 → #11/#12 → #13 → #14.

Builds are handed over as a `Test build <sha>` comment on #14: run the self-test, do the visual checklist, report back. See `CLAUDE.md → Working mode`.

## Future

Agreed ideas, not scheduled.

| # | Issue | Notes |
|---|---|---|
| [#15](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/15) | Gradient mode option: Compress / Anchored / Slide | Anchored + waveform is the likely showcase |
| [#16](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/16) | Gradient direction / angle | |
| [#17](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/17) | Per-stop opacity | ties into #19 |
| [#18](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/18) | Custom stop positions | schema v2 |
| [#19](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/19) | Hover behaviour option | |
| [#20](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/20) | Optional styling for the track and the volume bar | opt-in only |
| [#21](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/21) | Presets and import/export | |
| [#22](https://github.com/VoidCrowned/spicetify-gradient-progress-bar/issues/22) | Handle colour = colour at current position | needs #15 Anchored |
