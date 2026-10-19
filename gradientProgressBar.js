// NAME: Gradient Progress Bar
// VERSION: 1.7.0
// AUTHOR: VoidCrowned
// REPO: https://github.com/VoidCrowned/spicetify-gradient-progress-bar
// DESCRIPTION: Recolours the song progress bar with a solid colour or a multi-stop gradient.
// LICENSE: WTFPL v2, see LICENSE
//
// Compatibility rules (details in CLAUDE.md → Hard rules):
//  1. Every rule is scoped to the song progress bar — the volume slider never changes.
//  2. Never sets mask, height, width, transform, --progress-bar-height, --progress-bar-radius,
//     --progress-bar-transform or any other layout property on bar elements.
//     Only exception: Anchored mode sets transform: none and clip-path on the fill (#15).
//  3. Never overrides --fg-color, --bg-color or --is-active-fg-color.
//  4. No !important — rules win by specificity only.
//  5. No element references from JS for the bar — one regenerated <style id="gpb-style">.
//  6. Inert by default: with default settings the stylesheet is empty.

(async function gpb() {
  "use strict";

  const VERSION = "1.7.0";
  // Where this copy was loaded from: the Marketplace (jsDelivr) or the CLI (extensions/).
  // currentScript is only set before the first await, so capture it here (#39).
  const SOURCE = document.currentScript?.src || null;

  // Song progress bar only — the volume slider is the same component without this test id.
  const SCOPE = ':is([data-testid="playback-progressbar"], .main-nowPlayingBar-center .playback-bar)';
  const FILL = ".x-progressBar-fillColor";
  const HANDLE = ':is([data-testid="progress-bar-handle"], .progress-bar__slider, .x-progressBar-handle)';

  // ── Start-up status ─────────────────────────────────────────────────────────
  // window.__gpb exists from the first line, so a stuck or failed start-up is visible in
  // devtools (`__gpb.status()`) instead of failing silently. Spotify updates can remove or
  // delay Spicetify APIs and change the bar's DOM; status() reports both.

  const startup = { phase: "waiting for Spicetify", waitingFor: [], entry: null, entryErrors: [], error: null, since: Date.now() };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = (name) => window.Spicetify?.[name];
  // Profile-menu entry state (#27). Up here because status() can run while start-up still waits.
  let menuRegistered = false;
  let shared = null; // our handle on the shared top-bar entry (#45, #58): joinGradientBars()
  const menuItemVerdicts = new WeakMap(); // MenuItem component → usable?

  window.__gpb = {
    version: VERSION,
    status: () => statusReport(),
    selfTest: async () => {
      console.warn(`[gpb] Not ready (${startup.phase}) — the self-test needs a started extension.`);
      return statusReport();
    },
  };

  // Rendering only needs storage; the modal needs PopupModal and Player; the entry point
  // extras are the profile menu (Menu) and the top bar (Topbar), both at once (#45).
  const REQUIRED = ["LocalStorage", "PopupModal", "Player"];
  let warned = false;
  while (REQUIRED.some((name) => !api(name))) {
    startup.waitingFor = REQUIRED.filter((name) => !api(name));
    if (!warned && Date.now() - startup.since > 10000) {
      warned = true;
      console.warn(`[gpb] Still waiting for Spicetify APIs: ${startup.waitingFor.join(", ")}`);
    }
    await sleep(300);
  }
  startup.waitingFor = [];
  startup.phase = "starting";
  const STORAGE_KEY = "gpb:settings";
  const SCHEMA_VERSION = 1;
  const MAX_STOPS = 8;
  const SAVE_DELAY = 250;
  const HEX_RE = /^#[0-9a-f]{6}$/i;
  // How a gradient spreads over the bar (#15). Optional in storage: missing means "compress".
  const MODES = ["compress", "anchored", "slide"];
  const DEFAULT_MODE = "compress";


  // Never resolved to a hex, so it follows runtime theme changes (e.g. Hazy's per-song accent).
  const THEME_COLOUR = "var(--spice-button, var(--spice-text, #1db954))";

  // ── Settings ────────────────────────────────────────────────────────────────

  function defaultSettings() {
    return { version: SCHEMA_VERSION, gradient: false, mode: DEFAULT_MODE, stops: [{ id: "s1", kind: "theme" }] };
  }

  // Returns a clean copy of `data`, or null if it isn't valid settings.
  function validateSettings(data) {
    if (!data || typeof data !== "object" || data.version !== SCHEMA_VERSION) return null;
    if (typeof data.gradient !== "boolean" || !Array.isArray(data.stops)) return null;
    if (data.stops.length < 1 || data.stops.length > MAX_STOPS) return null;
    // Settings saved before v1.2.0 have no mode; anything else unknown is invalid.
    const mode = data.mode === undefined ? DEFAULT_MODE : data.mode;
    if (!MODES.includes(mode)) return null;

    const ids = new Set();
    const stops = [];
    for (const stop of data.stops) {
      if (!stop || typeof stop.id !== "string" || !stop.id || ids.has(stop.id)) return null;
      ids.add(stop.id);
      if (stop.kind === "theme") stops.push({ id: stop.id, kind: "theme" });
      else if (stop.kind === "custom" && HEX_RE.test(stop.color))
        stops.push({ id: stop.id, kind: "custom", color: stop.color.toLowerCase() });
      else return null;
    }
    // A gradient needs at least two stops.
    return { version: SCHEMA_VERSION, gradient: data.gradient && stops.length > 1, mode, stops };
  }

  function loadSettings(raw = Spicetify.LocalStorage.get(STORAGE_KEY)) {
    if (raw == null) return defaultSettings();

    let valid = null;
    try {
      valid = validateSettings(JSON.parse(raw));
    } catch {}
    if (valid) return valid;

    console.warn("[gpb] Saved settings were invalid and have been reset to defaults.");
    const defaults = defaultSettings();
    Spicetify.LocalStorage.set(STORAGE_KEY, JSON.stringify(defaults));
    return defaults;
  }

  let saveTimer = 0;

  // Debounced: colour pickers fire many input events per second.
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSettings, SAVE_DELAY);
  }

  function flushSettings() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    Spicetify.LocalStorage.set(STORAGE_KEY, JSON.stringify(settings));
  }

  // ── Presets and share codes (#21) ───────────────────────────────────────────
  // Own presets live in their own key with their own version, so gpb:settings (schema v1)
  // never changes. Every stored preset and every imported code goes through validateSettings().

  const PRESETS_KEY = "gpb:presets";
  const PRESETS_VERSION = 1;
  const MAX_PRESETS = 12;
  const PRESET_NAME_MAX = 24;
  const CODE_PREFIX = "gpb1:"; // the code's format version; a future schema bumps it
  const MODE_CODES = { compress: "c", anchored: "a", slide: "s" };

  // Colours only, all fixed (no theme stops): applying one keeps the current Spread mode. They
  // can't be renamed or deleted, and they have their own chip row (#53).
  const BUILT_IN_PRESETS = [
    { id: "b:void", name: "Void", colours: ["#8372fd", "#5a82ff", "#8372fd"] },
    { id: "b:sunset", name: "Sunset", colours: ["#6e33ff", "#ff5f6d", "#ffc371"] },
    { id: "b:aurora", name: "Aurora", colours: ["#00f5a0", "#00d9f5", "#7f5af0"] },
    { id: "b:neon", name: "Neon", colours: ["#ff00cc", "#3333ff", "#33f7ff"] },
    { id: "b:fairy", name: "Fairy", colours: ["#ff59d1", "#ffb800", "#77bc00"] },
  ].map((preset) => ({ ...preset, builtIn: true }));

  let presets = []; // own presets: [{ id, name, settings: { gradient, mode, stops } }]

  // What a preset stores: the settings without the schema version.
  function snapshot(s) {
    return { gradient: s.gradient, mode: s.mode, stops: s.stops.map((stop) => ({ ...stop })) };
  }

  // The settings a preset applies. A built-in keeps the current mode.
  function presetSettings(preset, current = settings) {
    if (!preset.builtIn) return { version: SCHEMA_VERSION, ...structuredClone(preset.settings) };
    const stops = preset.colours.map((color, i) => ({ id: `s${i + 1}`, kind: "custom", color }));
    return { version: SCHEMA_VERSION, gradient: true, mode: current.mode, stops };
  }

  // Equal settings, ignoring stop ids. Built-ins therefore compare colours only (their mode is
  // the current one).
  function sameSettings(a, b) {
    return a.gradient === b.gradient && a.mode === b.mode && a.stops.length === b.stops.length &&
      a.stops.every((stop, i) => stop.kind === b.stops[i].kind && stop.color === b.stops[i].color);
  }

  const matchesPreset = (preset, s = settings) => sameSettings(s, presetSettings(preset, s));

  const presetById = (id) => BUILT_IN_PRESETS.find((p) => p.id === id) ?? presets.find((p) => p.id === id) ?? null;

  // A clean own preset, or null. Names are trimmed and 1–24 characters long.
  function validatePreset(entry) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string")
      return null;
    const name = entry.name.trim();
    if (!name || name.length > PRESET_NAME_MAX) return null;
    const valid = validateSettings({ ...entry.settings, version: SCHEMA_VERSION });
    return valid && { id: entry.id, name, settings: snapshot(valid) };
  }

  // Invalid entries (and any beyond 12) are dropped with one warning; an unreadable key gives
  // an empty list and one warning. Storage is only rewritten by the next change.
  function loadPresets(raw = Spicetify.LocalStorage.get(PRESETS_KEY)) {
    if (raw == null) return [];
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {}
    if (!data || data.version !== PRESETS_VERSION || !Array.isArray(data.presets)) {
      console.warn("[gpb] Saved presets were unreadable and have been ignored.");
      return [];
    }
    const list = [];
    for (const entry of data.presets) {
      const preset = validatePreset(entry);
      if (!preset || list.length >= MAX_PRESETS || list.some((p) => p.id === preset.id)) continue;
      preset.name = uniqueName(preset.name, list);
      list.push(preset);
    }
    const dropped = data.presets.length - list.length;
    if (dropped) console.warn(`[gpb] ${dropped} saved preset${dropped === 1 ? " was" : "s were"} invalid and dropped.`);
    return list;
  }

  function savePresets() {
    Spicetify.LocalStorage.set(PRESETS_KEY, JSON.stringify({ version: PRESETS_VERSION, presets }));
  }

  // Trimmed, at most 24 characters, and unique among the built-ins and `list` (case-insensitive,
  // `exceptId` aside): a clash gets " (2)", " (3)" and so on.
  function uniqueName(name, list = presets, exceptId = null) {
    const base = name.trim().slice(0, PRESET_NAME_MAX);
    const taken = new Set([...BUILT_IN_PRESETS, ...list].filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) {
      const suffix = ` (${n})`;
      const candidate = base.slice(0, PRESET_NAME_MAX - suffix.length).trimEnd() + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  const defaultPresetName = () => uniqueName(`Preset ${presets.length + 1}`);

  function nextPresetId() {
    const ids = new Set(presets.map((p) => p.id));
    let n = 1;
    while (ids.has(`p${n}`)) n++;
    return `p${n}`;
  }

  // Saves the current settings as a new own preset. Returns it, or null at the limit.
  function addPreset(name) {
    if (presets.length >= MAX_PRESETS) return null;
    const preset = { id: nextPresetId(), name: uniqueName(name.trim() || defaultPresetName()), settings: snapshot(settings) };
    presets.push(preset);
    savePresets();
    return preset;
  }

  function renamePreset(id, name) {
    const preset = presets.find((p) => p.id === id);
    if (!preset || !name.trim()) return false;
    preset.name = uniqueName(name, presets, id);
    savePresets();
    return true;
  }

  function updatePreset(id) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return false;
    preset.settings = snapshot(settings);
    savePresets();
    return true;
  }

  // Own presets only: a built-in id finds nothing. Returns { preset, index } for Undo, or null.
  function deletePreset(id) {
    const index = presets.findIndex((p) => p.id === id);
    if (index === -1) return null;
    const [preset] = presets.splice(index, 1);
    savePresets();
    return { preset, index };
  }

  function restorePreset({ preset, index }) {
    presets.splice(Math.min(index, presets.length), 0, preset);
    savePresets();
  }

  // gpb1: + base64url(JSON) of { g: 0|1, m: "c"|"a"|"s", s: ["t" | "rrggbb", …] }, t = theme.
  function encodeCode(s) {
    const json = JSON.stringify({
      g: s.gradient ? 1 : 0,
      m: MODE_CODES[s.mode],
      s: s.stops.map((stop) => (stop.kind === "theme" ? "t" : stop.color.slice(1))),
    });
    return CODE_PREFIX + btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // Settings from a share code (stop ids s1…sN), checked by validateSettings(), or null.
  // Surrounding whitespace is fine; an unknown prefix or version isn't.
  function decodeCode(text) {
    const code = String(text ?? "").trim();
    const body = code.slice(CODE_PREFIX.length);
    if (!code.startsWith(CODE_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(body)) return null;
    let data = null;
    try {
      data = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      return null;
    }
    if (!data || typeof data !== "object" || !Array.isArray(data.s)) return null;
    // Anything unexpected is passed on as a value validateSettings() rejects.
    const mode = Object.keys(MODE_CODES).find((key) => MODE_CODES[key] === data.m) ?? null;
    return validateSettings({
      version: SCHEMA_VERSION,
      gradient: data.g === 1 ? true : data.g === 0 ? false : null,
      mode,
      stops: data.s.map((value, i) =>
        value === "t"
          ? { id: `s${i + 1}`, kind: "theme" }
          : { id: `s${i + 1}`, kind: "custom", color: typeof value === "string" ? `#${value}` : null }
      ),
    });
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  function stopColour(stop) {
    return stop.kind === "theme" ? THEME_COLOUR : stop.color;
  }

  // Solid with a theme colour leaves the bar to the theme: no rules at all.
  function isInert(s) {
    return !s.gradient && s.stops[0].kind === "theme";
  }

  // The colours actually drawn: all stops for a gradient, otherwise just the first.
  function activeColours(s) {
    return s.gradient ? s.stops.map(stopColour) : [stopColour(s.stops[0])];
  }

  // The fill's background image — also used by the modal preview so the two can't drift.
  // Stops are evenly spaced.
  function fillImage(s) {
    const colours = activeColours(s);
    if (colours.length === 1) return `linear-gradient(${colours[0]}, ${colours[0]})`;
    return `linear-gradient(90deg, ${colours.join(", ")})`;
  }

  // The fill is a full-width element translated left, so only its rightmost
  // --progress-bar-transform percent is visible. Gradient-only declarations per mode (#15):
  // - Compress: size the gradient to that visible slice and anchor it right, so the whole
  //   gradient always spans bar start → playhead.
  // - Anchored: undo Spotify's translate and clip at the playhead instead, so the colours stay
  //   fixed to the track. The one deliberate exception to "never set transform" (CLAUDE.md).
  // - Slide: no overrides; the full-track gradient moves with the fill.
  const MODE_CSS = {
    compress: [
      "background-size: var(--progress-bar-transform) 100%;",
      "background-position: right center;",
      "background-repeat: no-repeat;",
    ],
    anchored: [
      "background-size: 100% 100%;",
      "transform: none;",
      "clip-path: inset(0 calc(100% - var(--progress-bar-transform)) 0 0 round var(--progress-bar-radius));",
    ],
    slide: [],
  };

  // Selectors are ≥ 0,2,0 so they beat themes' single-class rules without !important.
  // background-image (not -color) keeps Spotify's hover swap of background-color hidden.
  // Solid output is the same in every mode.
  function buildCss(s) {
    if (isInert(s)) return "";
    const colours = activeColours(s);
    const handle = colours[colours.length - 1]; // the last stop in every mode (#22 may refine Anchored)
    const spread = s.gradient ? MODE_CSS[s.mode].map((line) => `  ${line}`) : [];
    return [
      `${SCOPE} ${FILL} {`,
      `  background-image: ${fillImage(s)};`,
      ...spread,
      `}`,
      `${SCOPE} ${HANDLE} {`,
      `  background-color: ${handle};`,
      `}`,
      ``,
    ].join("\n");
  }

  function applyCss() {
    let style = document.getElementById("gpb-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "gpb-style";
      document.head.appendChild(style);
    }
    const css = buildCss(settings);
    if (style.textContent !== css) style.textContent = css;
  }

  // Called after every settings change: bar first, then the open modal, then storage.
  // `rerender: false` for picker edits — the dots are updated in place instead.
  function update({ rerender = true } = {}) {
    applyCss();
    if (modal) {
      rerender ? renderModal() : renderPreview();
      renderPresetStates();
    }
    // An Undo for applied settings would throw away later edits, so any other change drops it (#21).
    if (pendingUndo?.after && pendingUndo.after !== JSON.stringify(settings)) clearUndo();
    saveSettings();
  }

  // ── Stops ───────────────────────────────────────────────────────────────────

  function findStop(id) {
    return settings.stops.find((s) => s.id === id);
  }

  function nextStopId() {
    const ids = new Set(settings.stops.map((s) => s.id));
    let n = 1;
    while (ids.has(`s${n}`)) n++;
    return `s${n}`;
  }

  let colourCtx = null;

  // Any CSS colour → #rrggbb (alpha dropped), or null if it isn't a colour.
  function toHex(value) {
    if (!value || !CSS.supports("color", value)) return null;
    colourCtx ??= document.createElement("canvas").getContext("2d");
    colourCtx.fillStyle = "#000000";
    colourCtx.fillStyle = value;
    const out = colourCtx.fillStyle; // "#rrggbb", or "rgba(r, g, b, a)" when translucent
    if (out.startsWith("#")) return out;
    const [r, g, b] = out.match(/[\d.]+/g);
    return "#" + [r, g, b].map((n) => Math.round(+n).toString(16).padStart(2, "0")).join("");
  }

  // A stop's current colour as #rrggbb — for UI swatches only; the CSS uses THEME_COLOUR.
  function resolveStop(stop) {
    if (stop.kind === "custom") return stop.color;
    const root = getComputedStyle(document.documentElement);
    return (
      toHex(root.getPropertyValue("--spice-button").trim()) ||
      toHex(root.getPropertyValue("--spice-text").trim()) ||
      "#1db954"
    );
  }

  // A copy of the last stop at the end, selected: Duplicate on the last stop. With one colour
  // the Gradient switch does the same (#46).
  function addStop() {
    duplicateStop(settings.stops[settings.stops.length - 1].id);
  }

  // Inserts a copy directly after the stop (a theme stop stays a theme stop) and selects it.
  // Returns the copy's id.
  function duplicateStop(id) {
    const index = settings.stops.findIndex((s) => s.id === id);
    if (index === -1 || settings.stops.length >= MAX_STOPS) return id;
    const copy = { ...settings.stops[index], id: nextStopId() };
    settings.stops.splice(index + 1, 0, copy);
    if (settings.stops.length === 2) settings.gradient = true; // a second colour implies a gradient
    selectedId = copy.id;
    update();
    return copy.id;
  }

  // Removing the selected stop selects the one now at its position (or the new last one).
  // Returns that stop's id.
  function removeStop(id) {
    const index = settings.stops.findIndex((s) => s.id === id);
    if (index === -1 || settings.stops.length <= 1) return id;
    settings.stops.splice(index, 1);
    if (settings.stops.length === 1) settings.gradient = false;
    const neighbour = settings.stops[Math.min(index, settings.stops.length - 1)].id;
    if (selectedId === id) selectedId = neighbour;
    update();
    return neighbour;
  }

  // The button asks for a second click first (#37, enableReset).
  function resetSettings() {
    settings = defaultSettings();
    selectedId = settings.stops[0].id;
    update();
  }

  // Called from the Spread row, which is updated in place: the dots aren't re-rendered.
  function setMode(mode) {
    if (!MODES.includes(mode) || mode === settings.mode) return;
    settings.mode = mode;
    update({ rerender: false });
    if (modal) renderSpread();
  }

  // With one colour there's nothing to switch on, so the switch adds a second one, exactly
  // like adding a colour; that turns the gradient on (#46). The switch is never disabled.
  function toggleGradient() {
    if (settings.stops.length < 2) return addStop();
    settings.gradient = !settings.gradient;
    update();
  }

  // Editing a theme stop's colour turns it into a custom stop.
  function setStopColour(id, colour) {
    const stop = findStop(id);
    stop.kind = "custom";
    stop.color = colour;
    update({ rerender: false });
  }

  // `index` is an insertion point in the current order (0 … length).
  function moveStop(id, index) {
    const from = settings.stops.findIndex((s) => s.id === id);
    if (from === -1 || index === from || index === from + 1) return;
    const [stop] = settings.stops.splice(from, 1);
    settings.stops.splice(index > from ? index - 1 : index, 0, stop);
    update();
  }

  // Called from the picker, so the dots are updated in place, not re-rendered.
  function linkStopToTheme(id) {
    const stop = findStop(id);
    stop.kind = "theme";
    delete stop.color;
    update({ rerender: false });
  }

  // ── Settings modal ──────────────────────────────────────────────────────────
  // Colours come only from Spicetify variables so the modal follows any theme.
  // Never use the id "color-input" or the classes .slider/.toggle/.toggleWrapper —
  // Hazy looks them up and styles them globally.
  //
  // Dots are plain buttons: click to select one and edit it in the inline colour picker below
  // (#32, #35), right-click for Duplicate / Remove (#33), drag or Alt+arrows to reorder
  // (#8, #24), Delete/Backspace to remove (#49). No icons on the dots (#31). Exactly one dot is
  // selected whenever the modal is open. The −|+ stepper after them removes the selected dot
  // and adds one (#49).

  // The selected Spread mode is filled with var(--spice-button), the live theme colour. Never
  // --spice-rgb-button: Hazy rewrites --spice-button at runtime but leaves --spice-rgb-button
  // at the colour scheme's value (#40); tints use color-mix() on var(--spice-button) instead.
  // The label switches to --spice-main (gpb-on-light) when that contrasts more (#43).
  // The −|+ stepper is two "D"s (#50): − has the whole outline, its right edge is the middle
  // line; + overlaps it by 1 px with a transparent left border, so at rest the middle is one
  // line, not two translucent ones on top of each other. A hovered half lights up its whole
  // outline, middle line included (+ is raised over −'s edge), like Reset's border.
  const MODAL_CSS = `
.gpb-modal { display: flex; flex-direction: column; gap: 20px; padding-top: 20px; color: var(--spice-text); }
.gpb-modal [hidden] { display: none; }
.gpb-gradient-row { display: flex; align-items: center; justify-content: space-between; }
.gpb-label { font-weight: 700; }
.gpb-switch { position: relative; flex: none; width: 40px; height: 22px; padding: 0; border: 0; border-radius: 11px; background-color: rgba(var(--spice-rgb-text), .3); cursor: pointer; transition: background-color .15s; }
.gpb-switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background-color: var(--spice-text); transition: transform .15s; }
.gpb-switch[aria-checked="true"] { background-color: var(--spice-button); }
.gpb-switch[aria-checked="true"]::after { transform: translateX(18px); }
.gpb-switch:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-spread { display: flex; flex-direction: column; gap: 8px; }
.gpb-spread-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gpb-modes { display: flex; gap: 2px; padding: 2px; border-radius: 500px; background-color: rgba(var(--spice-rgb-text), .1); }
.gpb-mode { padding: 4px 12px; border: 1px solid transparent; border-radius: 500px; background: none; color: var(--spice-text); font: inherit; font-size: .875rem; font-weight: 700; cursor: pointer; transition: background-color .15s; }
.gpb-mode[aria-checked="true"] { background-color: var(--spice-button); }
.gpb-mode.gpb-on-light { color: var(--spice-main); }
.gpb-mode:hover:not(:disabled):not([aria-checked="true"]) { background-color: rgba(var(--spice-rgb-text), .1); }
.gpb-mode:disabled { opacity: .5; cursor: not-allowed; }
.gpb-mode:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-spread-hint { margin: 0; font-size: .75rem; line-height: 1.4; color: var(--spice-subtext); }
.gpb-preview { height: 8px; border-radius: 4px; }
.gpb-dots { display: flex; align-items: flex-end; gap: 10px; }
.gpb-stops { position: relative; display: flex; flex-wrap: wrap; gap: 14px; padding: 4px; }
.gpb-stop { position: relative; width: 32px; height: 32px; padding: 0; border: 2px solid rgba(var(--spice-rgb-text), .25); border-radius: 50%; cursor: pointer; }
.gpb-stop.gpb-selected, .gpb-stop:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 3px; }
.gpb-stop.gpb-unused { opacity: .5; }
.gpb-stop.gpb-dragging { opacity: .3; }
.gpb-announce { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.gpb-stepper { flex: none; display: flex; height: 32px; margin: 4px 0; }
.gpb-step { display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 36px; height: 100%; margin: 0; padding: 0; border: 1px solid rgba(var(--spice-rgb-text), .3); background: none; color: var(--spice-subtext); cursor: pointer; }
.gpb-minus { border-radius: 16px 0 0 16px; }
.gpb-plus { margin-left: -1px; border-left-color: transparent; border-radius: 0 16px 16px 0; }
.gpb-step:hover:not(:disabled) { border-color: var(--spice-text); color: var(--spice-text); }
.gpb-plus:hover:not(:disabled) { position: relative; z-index: 1; }
.gpb-step:disabled { cursor: not-allowed; }
.gpb-step:disabled > svg { opacity: .5; }
.gpb-step:focus-visible { outline: 2px solid var(--spice-text); outline-offset: -3px; }
.gpb-marker { position: absolute; width: 2px; height: 32px; border-radius: 1px; background-color: var(--spice-button); pointer-events: none; }
.gpb-button { align-self: flex-start; padding: 8px 16px; border: 1px solid rgba(var(--spice-rgb-text), .3); border-radius: 500px; background: none; color: var(--spice-text); font: inherit; font-weight: 700; cursor: pointer; }
.gpb-button:hover:not(:disabled) { border-color: var(--spice-text); }
.gpb-button:disabled { opacity: .5; cursor: not-allowed; }
.gpb-button:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-share-button { display: inline-flex; align-items: center; align-self: center; gap: 6px; padding: 4px 12px 4px 10px; font-size: .8125rem; }
.gpb-share-button > svg { flex: none; }
.gpb-share-text { display: inline-grid; justify-items: center; }
.gpb-share-text > span { grid-area: 1 / 1; }
.gpb-share-button[aria-expanded="true"] { border-color: var(--spice-text); }
.gpb-actions { display: flex; justify-content: center; align-items: center; }
.gpb-actions > .gpb-button { align-self: center; }
.gpb-reset { display: inline-grid; justify-items: center; }
.gpb-reset > span { grid-area: 1 / 1; }
.gpb-reset-sizer { visibility: hidden; }
.gpb-reset.gpb-armed, .gpb-reset.gpb-armed:hover:not(:disabled) { border-color: var(--spice-notification-error, #e91429); color: var(--spice-notification-error, #e91429); }
.gpb-help { margin: 8px 0 0; font-size: .875rem; line-height: 1.5; color: var(--spice-subtext); }
.gpb-popover { position: fixed; z-index: 10; box-sizing: border-box; border-radius: 8px; background-color: var(--spice-card); box-shadow: 0 8px 24px rgba(0, 0, 0, .5); color: var(--spice-text); }
.gpb-popover[hidden] { display: none; }
.gpb-menu { display: flex; flex-direction: column; min-width: 140px; padding: 4px; }
.gpb-menu-item { padding: 8px 12px; border: 0; border-radius: 4px; background: none; color: var(--spice-text); font: inherit; font-size: .875rem; text-align: left; cursor: pointer; }
.gpb-menu-item:hover:not(:disabled), .gpb-menu-item:focus-visible { outline: none; background-color: rgba(var(--spice-rgb-text), .1); }
.gpb-menu-item:disabled { opacity: .5; cursor: default; }
.gpb-colour-picker { display: flex; flex-wrap: wrap; gap: 16px; }
.gpb-sv { position: relative; flex: 1 1 202px; min-height: 150px; border-radius: 4px; background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent); cursor: crosshair; touch-action: none; }
.gpb-sv-handle, .gpb-hue-handle { position: absolute; box-sizing: border-box; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0, 0, 0, .6); pointer-events: none; }
.gpb-sv-handle { width: 14px; height: 14px; margin: -7px 0 0 -7px; }
.gpb-controls { flex: 1 1 202px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.gpb-tools { display: flex; align-items: center; gap: 10px; }
.gpb-eyedropper { flex: none; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--spice-text); cursor: pointer; }
.gpb-eyedropper:hover { background-color: rgba(var(--spice-rgb-text), .1); }
.gpb-swatch { flex: none; box-sizing: border-box; width: 24px; height: 24px; border: 1px solid rgba(var(--spice-rgb-text), .3); border-radius: 50%; }
.gpb-hue { position: relative; flex: 1; height: 12px; border-radius: 6px; background-image: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); cursor: pointer; touch-action: none; }
.gpb-hue-handle { top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; }
.gpb-sv:focus-visible, .gpb-hue:focus-visible, .gpb-eyedropper:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-rgb { display: flex; gap: 8px; }
.gpb-channel { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: .75rem; color: var(--spice-subtext); }
.gpb-hex-row { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: .75rem; color: var(--spice-subtext); }
.gpb-field { width: 100%; min-width: 0; height: 28px; box-sizing: border-box; padding: 0 6px; border: 1px solid rgba(var(--spice-rgb-text), .3); border-radius: 4px; background-color: rgba(var(--spice-rgb-text), .08); color: var(--spice-text); font: inherit; font-size: .875rem; text-align: center; }
.gpb-field:focus { outline: none; border-color: var(--spice-text); }
.gpb-field[aria-invalid="true"] { border-color: var(--spice-notification-error, #e91429); }
.gpb-hex-wrap { position: relative; flex: none; display: flex; }
.gpb-hex { flex: none; width: calc(10ch + 24px); padding-right: 28px; font-family: ui-monospace, Consolas, monospace; text-align: left; }
.gpb-hex-copy { position: absolute; top: 50%; right: 2px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 24px; height: 24px; margin: -12px 0 0; padding: 0; border: 0; border-radius: 4px; background: none; color: var(--spice-subtext); cursor: pointer; }
.gpb-hex-copy:hover { color: var(--spice-text); }
.gpb-hex-copy:focus-visible { outline: 2px solid var(--spice-text); outline-offset: -1px; }
.gpb-colour-picker .gpb-button { align-self: stretch; padding: 6px 12px; font-size: .875rem; }
.gpb-presets > * { margin: 0; }
.gpb-presets > * + * { margin-top: 8px; }
.gpb-presets > .gpb-undo:not(.gpb-has-status) { margin-top: 0; }
.gpb-presets-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gpb-text-button { display: inline-grid; padding: 2px 8px; border: 0; border-radius: 500px; background: none; color: var(--spice-subtext); font: inherit; font-size: .8125rem; font-weight: 700; cursor: pointer; }
.gpb-text-button > span { grid-area: 1 / 1; }
.gpb-text-button:hover:not(:disabled) { background-color: rgba(var(--spice-rgb-text), .1); color: var(--spice-text); }
.gpb-text-button:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 1px; }
.gpb-sizer { visibility: hidden; }
.gpb-chips { display: flex; flex-direction: column; gap: 8px; }
.gpb-chip-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.gpb-chip { display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; height: 28px; padding: 0 12px 0 7px; border: 1px solid rgba(var(--spice-rgb-text), .3); border-radius: 500px; background: none; color: var(--spice-text); font: inherit; font-size: .8125rem; cursor: pointer; }
.gpb-chip:hover:not(:disabled) { border-color: var(--spice-text); }
.gpb-chip[aria-pressed="true"], .gpb-chip[aria-pressed="true"]:hover:not(:disabled), .gpb-chip.gpb-armed, .gpb-chip.gpb-armed:hover:not(:disabled) { border-color: var(--spice-button); }
.gpb-chip.gpb-armed { background-color: color-mix(in srgb, var(--spice-button) 20%, transparent); }
.gpb-chip:disabled { opacity: .5; cursor: not-allowed; }
.gpb-chip:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-save-chip { padding: 0 12px; color: var(--spice-subtext); }
.gpb-save-chip:hover:not(:disabled) { color: var(--spice-text); }
.gpb-chip-swatch { flex: none; width: 12px; height: 12px; border-radius: 50%; }
.gpb-chip-text { display: inline-grid; justify-items: center; }
.gpb-chip-text > span { grid-area: 1 / 1; white-space: nowrap; }
.gpb-name-field { flex: none; width: 18ch; height: 28px; padding: 0 12px; border-radius: 500px; text-align: left; }
.gpb-undo { font-size: .8125rem; color: var(--spice-subtext); }
.gpb-presets-tools { display: flex; align-items: center; gap: 8px; }
.gpb-code-hint { margin: 6px 0 0; font-size: .75rem; color: var(--spice-subtext); }
.gpb-code-output, .gpb-code-input { font-family: ui-monospace, Consolas, monospace; font-size: .8125rem; text-align: left; }
.gpb-import-row { display: flex; align-items: center; gap: 8px; }
.gpb-import-row > .gpb-code-input { flex: 1; }
.gpb-import-row > .gpb-button { flex: none; align-self: center; padding: 4px 14px; font-size: .875rem; }
.gpb-import-error { margin: 0; font-size: .75rem; color: var(--spice-notification-error, #e91429); }
.gpb-import-error:not(:empty) { margin-top: 6px; }
.gpb-undo-button { padding: 2px 4px; color: var(--spice-text); text-decoration: underline; }
`;
  // Two columns from 420 px of content (202 + 16 + 202), stacked below that. Flex-wrap rather
  // than a container query: inline-size containment could collapse a shrink-to-fit modal.
  const PICKER_COLUMNS_MIN = 420;

  const MODE_LABELS = { compress: "Compress", anchored: "Anchored", slide: "Slide" };
  const SPREAD_HINTS = {
    compress: "The whole gradient always fits between the start and the playhead.",
    anchored: "Colours stay fixed to the bar and are revealed as the song plays.",
    slide: "The gradient spans the whole bar and slides in with the playhead.",
  };
  const SPREAD_OFF_HINT = "Applies when the gradient is on.";

  const REORDER_HINT = "Drag or Alt+←/→ to reorder"; // second line of the dot tooltip (#24)
  const HELP_LINES = [ // one line each, joined with <br> (#47, #49, #52)
    "Click a colour to edit it, drag to reorder, right-click to duplicate.",
    "+ adds a colour, − removes the selected one.",
    "Reset goes back to a single colour that follows your theme.",
  ];
  const ADD_LABEL = "Add colour";
  const ADD_FULL_LABEL = `Up to ${MAX_STOPS} colours`;
  const REMOVE_LABEL = "Remove selected colour"; // the stepper's − (#49)
  const REMOVE_LAST_LABEL = "At least one colour";
  const MINUS_ICON =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M2 7.25h12v1.5H2z"/></svg>';
  const PLUS_ICON =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7.25 2h1.5v5.25H14v1.5H8.75V14h-1.5V8.75H2v-1.5h5.25z"/></svg>';

  const EXPORT_ICON = // arrow up out of a tray (#52)
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 1.5 4.5 5h2.75v5.5h1.5V5h2.75z"/><path d="M1 9.5h1.5v4h11v-4H15V15H1z"/></svg>';
  const IMPORT_ICON = // arrow down into a tray (#52)
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7.25 1.5h1.5V7h2.75L8 10.5 4.5 7h2.75z"/><path d="M1 9.5h1.5v4h11v-4H15V15H1z"/></svg>';

  const COPY_ICON = // two overlapping rounded squares: the hex field's copy button (#56)
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M5 1.75A1.75 1.75 0 0 1 6.75 0h6.5A1.75 1.75 0 0 1 15 1.75v6.5A1.75 1.75 0 0 1 13.25 10H11V8.5h2.25a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25h-6.5a.25.25 0 0 0-.25.25V4H5z"/><path d="M1 6.75C1 5.784 1.784 5 2.75 5h6.5c.966 0 1.75.784 1.75 1.75v6.5A1.75 1.75 0 0 1 9.25 15h-6.5A1.75 1.75 0 0 1 1 13.25zm1.75-.25a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25z"/></svg>';
  const CHECK_ICON = // shown in place of a copy button's icon after copying (#54, #56)
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13.53 3.47a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06L6 9.94l6.47-6.47a.75.75 0 0 1 1.06 0z"/></svg>';
  // Both icons are in the markup and swapped with `hidden`, so no node is replaced (#26).
  const withClass = (svg, className, hidden = false) => svg.replace("<svg ", `<svg class="${className}"${hidden ? " hidden" : ""} `);

  const EYEDROPPER_ICON =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M13.35 2.65a2 2 0 0 0-2.83 0L8.9 4.27l-.7-.71-1.06 1.06.7.71-5.3 5.3a1.5 1.5 0 0 0-.44 1.07L2 14l2.3-.1a1.5 1.5 0 0 0 1.07-.44l5.3-5.3.71.7 1.06-1.06-.7-.71 1.61-1.61a2 2 0 0 0 0-2.83zM4.3 12.4l-.8.04.04-.8 5.37-5.37.76.76z"/></svg>';

  let modal = null; // the open modal's elements, or null

  // "#rrggbb", "rrggbb", "#rgb" or "rgb" → "#rrggbb", otherwise null.
  function parseHex(value) {
    let hex = value.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
    return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
  }

  function openModal() {
    const root = document.createElement("div");
    root.className = "gpb-modal";
    root.innerHTML = `
      <style>${MODAL_CSS}</style>
      <div class="gpb-popover gpb-menu" role="menu" aria-label="Colour actions" hidden>
        <button type="button" role="menuitem" class="gpb-menu-item gpb-duplicate">Duplicate</button>
        <button type="button" role="menuitem" class="gpb-menu-item gpb-remove">Remove</button>
        <button type="button" role="menuitem" class="gpb-menu-item gpb-rename" hidden>Rename</button>
        <button type="button" role="menuitem" class="gpb-menu-item gpb-update-preset" hidden>Update to current colours</button>
        <button type="button" role="menuitem" class="gpb-menu-item gpb-delete-preset" hidden>Delete</button>
      </div>
      <span class="gpb-announce" aria-live="polite"></span>
      <div class="gpb-gradient-row">
        <span class="gpb-label" id="gpb-gradient-label">Gradient</span>
        <button type="button" class="gpb-switch" role="switch" aria-labelledby="gpb-gradient-label"></button>
      </div>
      <div class="gpb-spread">
        <div class="gpb-spread-row">
          <span class="gpb-label" id="gpb-spread-label">Spread</span>
          <div class="gpb-modes" role="radiogroup" aria-labelledby="gpb-spread-label" aria-describedby="gpb-spread-hint">
            ${MODES.map((mode) => `<button type="button" class="gpb-mode" role="radio" data-mode="${mode}">${MODE_LABELS[mode]}</button>`).join("")}
          </div>
        </div>
        <p class="gpb-spread-hint" id="gpb-spread-hint"></p>
      </div>
      <div class="gpb-presets">
        <div class="gpb-presets-row">
          <span class="gpb-label" id="gpb-presets-label">Presets</span>
          <div class="gpb-presets-tools">
            <button type="button" class="gpb-button gpb-share-button gpb-export" title="${EXPORT_TITLE}">${withClass(EXPORT_ICON, "gpb-export-icon")}${withClass(CHECK_ICON, "gpb-export-check", true)}<span class="gpb-share-text"><span class="gpb-share-label gpb-export-label">${EXPORT_LABEL}</span><span class="gpb-sizer" aria-hidden="true">${EXPORT_LABEL}</span><span class="gpb-sizer" aria-hidden="true">${COPIED_LABEL}</span></span></button>
            <button type="button" class="gpb-button gpb-share-button gpb-import" title="${IMPORT_TITLE}" aria-expanded="false" aria-controls="gpb-import-panel">${IMPORT_ICON}<span class="gpb-share-label">Import</span></button>
          </div>
        </div>
        <div class="gpb-chips" role="group" aria-labelledby="gpb-presets-label">
          <div class="gpb-chip-row gpb-built-in-row"></div>
          <div class="gpb-chip-row gpb-own-row">
            <button type="button" class="gpb-chip gpb-save-chip">+ Save</button>
            <input type="text" class="gpb-field gpb-name-field" maxlength="${PRESET_NAME_MAX}" spellcheck="false" autocomplete="off" aria-label="Preset name" hidden>
          </div>
        </div>
        <div class="gpb-code-fallback" hidden>
          <input type="text" class="gpb-field gpb-code-output" readonly spellcheck="false" aria-label="Share code (copy it from here)" aria-describedby="gpb-code-hint">
          <p class="gpb-code-hint" id="gpb-code-hint">${COPY_HINT}</p>
        </div>
        <div class="gpb-import-panel" id="gpb-import-panel" hidden>
          <div class="gpb-import-row">
            <input type="text" class="gpb-field gpb-code-input" spellcheck="false" autocomplete="off" placeholder="gpb1:…" aria-label="Paste a share code" aria-describedby="gpb-import-error">
            <button type="button" class="gpb-button gpb-import-apply">Apply</button>
          </div>
          <p class="gpb-import-error" id="gpb-import-error" aria-live="polite"></p>
        </div>
        <p class="gpb-undo" aria-live="polite"><span class="gpb-undo-text"></span><button type="button" class="gpb-text-button gpb-undo-button" hidden>Undo</button></p>
      </div>
      <div class="gpb-preview"></div>
      <div class="gpb-dots">
        <div class="gpb-stops"></div>
        <div class="gpb-stepper" role="group" aria-label="Colours">
          <button type="button" class="gpb-step gpb-minus" aria-label="${REMOVE_LABEL}" title="${REMOVE_LABEL}">${MINUS_ICON}</button>
          <button type="button" class="gpb-step gpb-plus" aria-label="${ADD_LABEL}" title="${ADD_LABEL}">${PLUS_ICON}</button>
        </div>
      </div>
      <div class="gpb-colour-picker" role="group" aria-label="Selected colour">
        <div class="gpb-sv" role="slider" tabindex="0" aria-label="Saturation and brightness"><div class="gpb-sv-handle"></div></div>
        <div class="gpb-controls">
          <div class="gpb-tools">
            ${window.EyeDropper ? `<button type="button" class="gpb-eyedropper" aria-label="Pick a colour from the screen" title="Pick a colour from the screen">${EYEDROPPER_ICON}</button>` : ""}
            <div class="gpb-swatch"></div>
            <div class="gpb-hue" role="slider" tabindex="0" aria-label="Hue" aria-valuemin="0" aria-valuemax="360"><div class="gpb-hue-handle"></div></div>
          </div>
          <div class="gpb-rgb">
            ${["Red", "Green", "Blue"].map((name) =>
              `<label class="gpb-channel"><input type="text" class="gpb-field gpb-channel-input" inputmode="numeric" maxlength="3" spellcheck="false" autocomplete="off" aria-label="${name}"><span>${name[0]}</span></label>`
            ).join("")}
          </div>
          <div class="gpb-hex-row">
            <label for="gpb-hex-input">HEX:</label>
            <span class="gpb-hex-wrap">
              <input type="text" class="gpb-field gpb-hex" id="gpb-hex-input" spellcheck="false" autocomplete="off" maxlength="7" aria-label="Hex code">
              <button type="button" class="gpb-hex-copy" aria-label="${HEX_COPY_LABEL}" title="${HEX_COPY_LABEL}">${withClass(COPY_ICON, "gpb-hex-copy-icon")}${withClass(CHECK_ICON, "gpb-hex-copy-check", true)}</button>
            </span>
          </div>
          <button type="button" class="gpb-button gpb-use-theme">Use theme colour</button>
        </div>
      </div>
      <div class="gpb-actions">
        <button type="button" class="gpb-button gpb-reset"><span class="gpb-reset-label" aria-live="polite">Reset</span><span class="gpb-reset-sizer" aria-hidden="true">${RESET_CONFIRM_LABEL}</span></button>
      </div>
      <p class="gpb-help">${HELP_LINES.join("<br>")}</p>`;

    const m = {
      root,
      gradientRow: root.querySelector(".gpb-gradient-row"),
      switchButton: root.querySelector(".gpb-switch"),
      spread: root.querySelector(".gpb-spread"),
      modes: root.querySelector(".gpb-modes"),
      modeButtons: [...root.querySelectorAll(".gpb-mode")],
      spreadHint: root.querySelector(".gpb-spread-hint"),
      presets: root.querySelector(".gpb-presets"),
      presetsRow: root.querySelector(".gpb-presets-row"),
      chips: root.querySelector(".gpb-chips"),
      builtInRow: root.querySelector(".gpb-built-in-row"),
      ownRow: root.querySelector(".gpb-own-row"),
      saveChip: root.querySelector(".gpb-save-chip"),
      nameField: root.querySelector(".gpb-name-field"),
      exportButton: root.querySelector(".gpb-export"),
      exportLabel: root.querySelector(".gpb-export-label"),
      exportIcon: root.querySelector(".gpb-export-icon"),
      exportCheck: root.querySelector(".gpb-export-check"),
      codeFallback: root.querySelector(".gpb-code-fallback"),
      importButton: root.querySelector(".gpb-import"),
      codeOutput: root.querySelector(".gpb-code-output"),
      importPanel: root.querySelector(".gpb-import-panel"),
      codeInput: root.querySelector(".gpb-code-input"),
      importApply: root.querySelector(".gpb-import-apply"),
      importError: root.querySelector(".gpb-import-error"),
      undoLine: root.querySelector(".gpb-undo"),
      undoText: root.querySelector(".gpb-undo-text"),
      undoButton: root.querySelector(".gpb-undo-button"),
      preview: root.querySelector(".gpb-preview"),
      dotsLine: root.querySelector(".gpb-dots"),
      stopsRow: root.querySelector(".gpb-stops"),
      stepper: root.querySelector(".gpb-stepper"),
      minusButton: root.querySelector(".gpb-minus"),
      plusButton: root.querySelector(".gpb-plus"),
      actions: root.querySelector(".gpb-actions"),
      resetButton: root.querySelector(".gpb-reset"),
      resetLabel: root.querySelector(".gpb-reset-label"),
      help: root.querySelector(".gpb-help"),
      menu: root.querySelector(".gpb-menu"),
      announce: root.querySelector(".gpb-announce"),
      duplicateItem: root.querySelector(".gpb-duplicate"),
      removeItem: root.querySelector(".gpb-remove"),
      renameItem: root.querySelector(".gpb-rename"),
      updatePresetItem: root.querySelector(".gpb-update-preset"),
      deletePresetItem: root.querySelector(".gpb-delete-preset"),
      picker: root.querySelector(".gpb-colour-picker"),
      sv: root.querySelector(".gpb-sv"),
      svHandle: root.querySelector(".gpb-sv-handle"),
      hue: root.querySelector(".gpb-hue"),
      hueHandle: root.querySelector(".gpb-hue-handle"),
      swatch: root.querySelector(".gpb-swatch"),
      eyedropper: root.querySelector(".gpb-eyedropper"),
      rgb: [...root.querySelectorAll(".gpb-channel-input")],
      hex: root.querySelector(".gpb-hex"),
      hexWrap: root.querySelector(".gpb-hex-wrap"),
      hexCopy: root.querySelector(".gpb-hex-copy"),
      hexCopyIcon: root.querySelector(".gpb-hex-copy-icon"),
      hexCopyCheck: root.querySelector(".gpb-hex-copy-check"),
      useThemeButton: root.querySelector(".gpb-use-theme"),
      cleanups: [],
    };

    m.switchButton.addEventListener("click", toggleGradient);
    enableSpread(m);
    // The −|+ stepper sits outside .gpb-stops, which renderStops() empties, so a clicked half is
    // never detached (#26, #47). − is the dot menu's Remove on the selected dot (#49). Focus stays
    // on the clicked half; once that half is disabled (− at one colour, + at eight), it goes to
    // the selected dot.
    const stepper = (button, action) =>
      button.addEventListener("click", () => {
        const hadFocus = document.activeElement === button;
        action();
        if (hadFocus && button.disabled) dotEl(selectedId)?.focus({ preventScroll: true });
      });
    stepper(m.minusButton, () => removeStop(selectedId));
    stepper(m.plusButton, addStop);
    m.stopsRow.addEventListener("click", (e) => {
      const el = e.target.closest(".gpb-stop");
      if (!el || performance.now() - lastDragEnd < 300) return; // a drag never changes the selection
      selectStop(el.dataset.id, { focusHex: e.detail === 0 }); // detail 0: Enter/Space
    });
    enableDotMenu(m);
    enableColourPicker(m);
    enableReset(m);
    enablePresets(m);

    Spicetify.PopupModal.display({ title: "Gradient Progress Bar", content: root });
    evenPopupBottom(root);
    modal = m;
    selectedId = settings.stops[0].id; // the first dot is selected on open
    renderModal();
    renderChips(m);
    watchModalClose(m);
    watchThemeColour(m);
    watchPopovers(m);
    enableDragAndDrop(m);
    enableKeyboardReorder(m);
    enableKeyboardRemove(m);
  }

  // Spicetify pads the popup's content 0 24px 24px, but the popup also carries Spotify's
  // track-credits classes, and themes style those: Hazy gives .main-trackCreditsModal-container
  // padding-bottom: 32px, so there were 56 px below the help text against 24 px at the sides
  // (#48). Inline, on this display()'s elements only: PopupModal rebuilds its markup on every
  // display(), so no other extension's popup is affected. Never a global rule.
  function evenPopupBottom(root) {
    const content = root.closest(".spicetify-popup-content");
    const container = root.closest(".spicetify-popup-container");
    if (!content || !container) return;
    container.style.paddingBottom = "0px";
    content.style.paddingBottom = getComputedStyle(content).paddingLeft;
  }

  // ── Spread (#15) ──
  // A radiogroup of plain buttons (no <select>: Hazy styles select globally). Built once per
  // open and only updated in place, so a click never detaches its target (#26). Roving
  // tabindex; ←/→ (wrapping), Home and End move the choice, without modifier keys only.
  function enableSpread(m) {
    m.modes.addEventListener("click", (e) => {
      const button = e.target.closest(".gpb-mode");
      if (button && !button.disabled) setMode(button.dataset.mode);
    });
    m.modes.addEventListener("keydown", (e) => {
      const button = e.target.closest(".gpb-mode");
      if (!button || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const i = m.modeButtons.indexOf(button);
      const last = m.modeButtons.length - 1;
      const next = { ArrowLeft: i ? i - 1 : last, ArrowRight: i === last ? 0 : i + 1, Home: 0, End: last }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      setMode(m.modeButtons[next].dataset.mode);
      m.modeButtons[next].focus();
    });
  }

  // Also called by watchThemeColour(): the label colour depends on the live --spice-button.
  function renderSpread() {
    const on = settings.gradient;
    const onLight = labelOnLight(modal.modes);
    for (const button of modal.modeButtons) {
      const checked = button.dataset.mode === settings.mode;
      button.setAttribute("aria-checked", String(checked));
      button.tabIndex = checked ? 0 : -1;
      button.disabled = !on;
      button.classList.toggle("gpb-on-light", checked && onLight);
    }
    modal.spreadHint.textContent = on ? SPREAD_HINTS[settings.mode] : SPREAD_OFF_HINT;
  }

  // True when --spice-main contrasts more with the live --spice-button than --spice-text (#43).
  function labelOnLight(el) {
    const fill = computedRgb(el, "var(--spice-button)");
    const text = computedRgb(el, "var(--spice-text)");
    const main = computedRgb(el, "var(--spice-main)");
    return !!(fill && text && main) && contrast(main, fill) > contrast(text, fill);
  }

  // The computed sRGB value of a CSS colour, as [r, g, b, a] (0–255, alpha 0–1), or null.
  // Read through caret-color on one of our own elements, which holds no editable text, so it
  // has no visible effect. color-mix() converts any colour space to sRGB first.
  function computedRgb(el, colour) {
    el.style.setProperty("caret-color", `color-mix(in srgb, ${colour} 100%, transparent)`);
    const rgb = parseRgb(getComputedStyle(el).caretColor);
    el.style.removeProperty("caret-color");
    return rgb;
  }

  // Computed colours come back as rgb(), rgba() or color(srgb …), with commas or spaces.
  function parseRgb(colour) {
    const srgb = /^color\(srgb\s/.test(colour);
    if (!srgb && !/^rgba?\(/.test(colour)) return null;
    const n = colour.match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number) ?? [];
    if (n.length < 3 || n.some(Number.isNaN)) return null;
    const rgb = n.slice(0, 3).map((v) => Math.min(255, Math.max(0, srgb ? v * 255 : v)));
    return [...rgb, n[3] ?? 1];
  }

  // WCAG 2 relative luminance and contrast ratio (alpha ignored).
  function luminance([r, g, b]) {
    const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  // ── Two-step Reset (#37) ──
  // Reset can't be undone, so the first click only arms it
  // ("Confirm reset?" in red); a second click within RESET_CONFIRM_MS resets. Only the label
  // and a class change — the button node is never replaced, so its click target stays
  // connected (#26). A hidden copy of the longer label keeps the button's width fixed.

  const RESET_CONFIRM_MS = 3000;
  const RESET_CONFIRM_LABEL = "Confirm reset?";

  function enableReset(m) {
    const button = m.resetButton;
    let timer = 0;
    const armed = () => button.classList.contains("gpb-armed");
    const disarm = () => {
      clearTimeout(timer);
      timer = 0;
      button.classList.remove("gpb-armed");
      m.resetLabel.textContent = "Reset";
    };
    button.addEventListener("click", () => {
      if (armed()) {
        disarm();
        resetSettings();
        return;
      }
      button.classList.add("gpb-armed");
      m.resetLabel.textContent = RESET_CONFIRM_LABEL;
      timer = setTimeout(disarm, RESET_CONFIRM_MS);
    });
    button.addEventListener("blur", () => armed() && disarm());
    disarmOnOutsideInput(m, () => (armed() ? button : null), disarm);
    m.cleanups.push(disarm); // clears the timer when the modal closes
  }

  // An armed two-step button (Reset, a preset chip) disarms on Escape — stopped there, so the
  // modal stays — and on any pointerdown, click or keydown elsewhere. Enter/Space on the button
  // itself is the confirmation. `armedEl()` returns the armed element or null.
  function disarmOnOutsideInput(m, armedEl, disarm) {
    const listen = (type, handler) => {
      document.addEventListener(type, handler, true);
      m.cleanups.push(() => document.removeEventListener(type, handler, true));
    };
    const elsewhere = (e) => {
      const el = armedEl();
      if (el && !el.contains(e.target)) disarm();
    };
    listen("pointerdown", elsewhere);
    listen("click", elsewhere);
    listen("keydown", (e) => {
      const el = armedEl();
      if (!el) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        disarm();
      } else if (!el.contains(e.target)) disarm();
    });
  }

  // ── Presets row (#21) ──
  // Two chip rows (#53): the built-ins, then own presets and + Save. Applying is always two-step: the
  // first click arms the chip ("Apply?"; hidden sizers keep its width) and previews it in the
  // strip, the second applies (#51). Themes often hide the player behind the popup, so the strip
  // is the preview, not the bar. No timeout while armed; the active chip does nothing. Undo for
  // 10 s after applying, importing or deleting. Arming changes only a label and a class, in place;
  // re-rendering the chip row (Save, Rename, Update, Delete) is deferred and closes the menu
  // first, so a clicked chip or menu item is never detached during its own click (#26).

  const UNDO_MS = 10000;
  const APPLY_LABEL = "Apply?";
  const SAVE_LABEL = "Save the current settings as a preset";
  const SAVE_FULL_LABEL = `Up to ${MAX_PRESETS} presets`;
  const OWN_PRESET_HINT = "Right-click to rename, update or delete";

  const chipEl = (id) => modal?.chips.querySelector(`.gpb-preset-chip[data-preset="${CSS.escape(id)}"]`) ?? null;
  const isOwnPreset = (id) => presets.some((p) => p.id === id);

  function enablePresets(m) {
    m.chips.addEventListener("click", (e) => {
      const chip = e.target.closest(".gpb-chip");
      if (!chip || chip.disabled) return;
      if (chip === m.saveChip) startNaming(m, "save");
      else clickChip(m, chip);
    });
    // Own chips only: built-ins can't be renamed, updated or deleted, so they have no menu.
    m.chips.addEventListener("contextmenu", (e) => {
      const chip = e.target.closest(".gpb-preset-chip");
      if (!chip || !isOwnPreset(chip.dataset.preset)) return;
      e.preventDefault();
      e.stopPropagation();
      const id = chip.dataset.preset;
      if (popover?.id === id && performance.now() - popover.openedAt < 500) return; // opened from keydown
      const r = chip.getBoundingClientRect();
      const onChip = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      openChipMenu(id, onChip ? { at: { x: e.clientX, y: e.clientY } } : { keyboard: true });
    });
    m.chips.addEventListener("keydown", (e) => {
      const chip = e.target.closest(".gpb-preset-chip");
      if (!chip || !isOwnPreset(chip.dataset.preset) || !(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) return;
      e.preventDefault();
      openChipMenu(chip.dataset.preset, { keyboard: true });
    });
    m.chips.addEventListener("focusout", (e) => m.armed?.chip === e.target && disarmChip(m));
    disarmOnOutsideInput(m, () => m.armed?.chip ?? null, () => disarmChip(m));

    m.nameField.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        stopNaming(m, { commit: true });
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // the field closes, not the modal
        stopNaming(m, { refocus: true });
      }
    });
    m.nameField.addEventListener("blur", () => stopNaming(m));

    m.renameItem.addEventListener("click", () => runChipAction((id) => startNaming(m, "rename", id)));
    m.updatePresetItem.addEventListener("click", () =>
      runChipAction((id) => {
        if (pendingUndo?.kind === "preset") clearUndo(); // a restored preset could clash with this change
        if (updatePreset(id)) renderChipsLater(m, id);
      })
    );
    m.deletePresetItem.addEventListener("click", () => runChipAction((id) => deleteWithUndo(m, id)));
    m.undoButton.addEventListener("click", runUndo);
    enableSharing(m);
    m.cleanups.push(() => {
      disarmChip(m);
      clearUndo();
    });
  }

  // ── Clipboard (#54) ──
  // One helper for every copy: Export, the hex field's copy button (#56) and the self-test report.
  // Spotify's client refuses navigator.clipboard.writeText, so Spicetify's ClipboardAPI goes first,
  // then writeText, then execCommand("copy") from a hidden, selected textarea. An async tier that
  // hasn't settled after CLIPBOARD_TIMEOUT_MS counts as failed. execCommand needs the click's user
  // activation, which Chromium keeps for 5 s, so it still works after the other two have failed.

  const CLIPBOARD_TIMEOUT_MS = 1500;
  const clipboardSources = { // where the tiers come from; the self-test swaps these for stubs
    api: () => window.Spicetify?.Platform?.ClipboardAPI,
    clipboard: () => navigator.clipboard,
    execCommand: (command) => document.execCommand(command),
  };

  // Resolves to the tier that worked ("ClipboardAPI", "writeText" or "execCommand"), or null.
  async function writeClipboard(text) {
    const settle = (promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("clipboard timeout")), CLIPBOARD_TIMEOUT_MS)),
    ]);
    const asyncTiers = [
      ["ClipboardAPI", () => {
        const api = clipboardSources.api();
        if (typeof api?.copy !== "function") throw new Error("no ClipboardAPI");
        return api.copy(text);
      }],
      ["writeText", () => {
        const clipboard = clipboardSources.clipboard();
        if (typeof clipboard?.writeText !== "function") throw new Error("no clipboard");
        return clipboard.writeText(text);
      }],
    ];
    for (const [name, write] of asyncTiers) {
      try {
        await settle(Promise.resolve().then(write));
        return name;
      } catch {}
    }
    return execCommandCopy(text) ? "execCommand" : null;
  }

  // The textarea goes inside the modal root while it's open (never into Spotify's DOM around it)
  // and is removed straight away; focus goes back to where it was.
  function execCommandCopy(text) {
    const buffer = document.createElement("textarea");
    buffer.className = "gpb-copy-buffer";
    buffer.value = text;
    buffer.readOnly = true;
    buffer.tabIndex = -1;
    buffer.setAttribute("aria-hidden", "true");
    Object.assign(buffer.style, { position: "fixed", top: "0", left: "0", width: "1px", height: "1px", padding: "0", border: "0", opacity: "0", pointerEvents: "none" });
    const focused = document.activeElement;
    (modal?.root ?? document.body).append(buffer);
    buffer.focus({ preventScroll: true });
    buffer.select();
    let copied = false;
    try {
      copied = clipboardSources.execCommand("copy") === true;
    } catch {}
    buffer.remove();
    if (focused?.isConnected && focused !== document.body) focused.focus({ preventScroll: true });
    return copied;
  }

  // ── Sharing (#21) ──
  // Export puts a gpb1: code on the clipboard (writeClipboard()) and confirms on the button
  // itself (#54); only if every tier fails does the code show in a selected read-only field. Import is an inline paste field, never navigator.clipboard.readText()
  // (that asks for a permission). While the field holds a valid code the strip previews it; Apply
  // is the deliberate step, with Undo (#51).

  const EXPORT_TITLE = "Copy a share code to the clipboard";
  const IMPORT_TITLE = "Paste a share code";
  const EXPORT_LABEL = "Export";
  const COPIED_LABEL = "Copied"; // on the button for COPIED_MS; hidden sizers keep its width (#54)
  const COPIED_MS = 2000;
  const COPY_HINT = /Mac/i.test(navigator.platform) ? "Press ⌘C to copy" : "Press Ctrl+C to copy";
  const IMPORT_ERROR = "Not a valid code";
  const PREVIEW_CODE_MESSAGE = "Previewing code — Apply to use it";

  function enableSharing(m) {
    m.exportButton.addEventListener("click", () => copyCode(m));
    m.codeOutput.addEventListener("blur", () => (m.codeFallback.hidden = true));
    m.importButton.addEventListener("click", () => toggleImport(m));
    m.importApply.addEventListener("click", () => importCode(m));
    m.codeInput.addEventListener("input", () => {
      setImportError(m, false);
      renderPreview(); // a valid code previews in the strip (#51)
      renderStatus();
    });
    m.codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        importCode(m);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // the field closes, not the modal
        toggleImport(m, false);
        m.importButton.focus({ preventScroll: true });
      }
    });
    m.cleanups.push(() => clearTimeout(m.copiedTimer));
  }

  // Resolves to the tier that copied the code, or null when the fallback field shows instead.
  async function copyCode(m) {
    const code = encodeCode(settings);
    const tier = await writeClipboard(code);
    if (modal !== m) return tier;
    showExportCopied(m, !!tier);
    if (!tier) {
      m.codeOutput.value = code;
      m.codeFallback.hidden = false;
      m.codeOutput.focus({ preventScroll: true });
      m.codeOutput.select();
      return null;
    }
    m.codeFallback.hidden = true;
    m.announce.textContent = "Share code copied";
    return tier;
  }

  // In place: only the label's text and which icon is hidden change, never the button (#26).
  function showExportCopied(m, copied) {
    clearTimeout(m.copiedTimer);
    m.exportLabel.textContent = copied ? COPIED_LABEL : EXPORT_LABEL;
    m.exportIcon.toggleAttribute("hidden", copied);
    m.exportCheck.toggleAttribute("hidden", !copied);
    if (copied) m.copiedTimer = setTimeout(() => showExportCopied(m, false), COPIED_MS);
  }

  // Opening empties the field and closing ends its preview, so the strip shows the current
  // settings either way.
  function toggleImport(m, open = m.importPanel.hidden) {
    m.importPanel.hidden = !open;
    m.importButton.setAttribute("aria-expanded", String(open));
    if (open) {
      m.codeInput.value = "";
      setImportError(m, false);
      m.codeInput.focus({ preventScroll: true });
    }
    if (modal !== m) return;
    renderPreview();
    renderStatus();
  }

  function setImportError(m, invalid) {
    if (invalid) m.codeInput.setAttribute("aria-invalid", "true");
    else m.codeInput.removeAttribute("aria-invalid");
    m.importError.textContent = invalid ? IMPORT_ERROR : "";
  }

  // An invalid code changes nothing. A valid one applies; the panel (with the clicked Apply in
  // it) is hidden, not removed (#26).
  function importCode(m) {
    const next = decodeCode(m.codeInput.value);
    if (!next) {
      setImportError(m, true);
      return false;
    }
    toggleImport(m, false);
    m.importButton.focus({ preventScroll: true });
    applySettings(next, "Imported code", m.importButton);
    return true;
  }

  // The active chip does nothing; any other is armed (and previewed) by the first click and
  // applied by the second. A click on another chip disarms this one first (outside input), so
  // browsing moves the arm and the preview chip by chip.
  function clickChip(m, chip) {
    const preset = presetById(chip.dataset.preset);
    if (!preset || matchesPreset(preset)) return;
    if (m.armed?.chip !== chip) return armChip(m, chip, preset);
    disarmChip(m);
    applySettings(presetSettings(preset), `Applied "${preset.name}"`, chip);
  }

  function armChip(m, chip, preset) {
    disarmChip(m);
    chip.classList.add("gpb-armed");
    chip.querySelector(".gpb-chip-label").textContent = APPLY_LABEL;
    chip.setAttribute("aria-label", `Apply "${preset.name}"?`);
    m.armed = { chip, name: preset.name, settings: presetSettings(preset) };
    renderPreview();
    renderStatus();
  }

  function disarmChip(m) {
    if (!m.armed) return;
    const { chip } = m.armed;
    m.armed = null;
    const name = presetById(chip.dataset.preset)?.name ?? "";
    chip.classList.remove("gpb-armed");
    chip.querySelector(".gpb-chip-label").textContent = name;
    chip.setAttribute("aria-label", name);
    if (modal !== m) return;
    renderPreview();
    renderStatus();
  }

  // What the strip shows instead of the current settings (#51): the armed chip's preset, or a
  // valid code in the open Import field. Null when nothing is being previewed.
  function previewing(m) {
    if (m.armed) return { settings: m.armed.settings, message: `Previewing "${m.armed.name}" — click it again to apply, Esc to cancel` };
    const code = m.importPanel.hidden ? null : decodeCode(m.codeInput.value);
    return code && { settings: code, message: PREVIEW_CODE_MESSAGE };
  }

  // Replaces the settings (selection back on the first dot) and offers Undo for the old ones.
  function applySettings(next, message, focusAfterUndo = null) {
    const previous = structuredClone(settings);
    settings = next;
    selectedId = settings.stops[0].id;
    update();
    offerUndo(message, (hadFocus) => {
      settings = previous;
      selectedId = previous.stops[0].id;
      update();
      if (hadFocus && focusAfterUndo?.isConnected) focusAfterUndo.focus({ preventScroll: true });
    }, { trackSettings: true });
  }

  function deleteWithUndo(m, id) {
    const removed = deletePreset(id);
    if (!removed) return;
    renderChipsLater(m, (presets[removed.index] ?? presets[removed.index - 1])?.id ?? "save");
    offerUndo(`Deleted "${removed.preset.name}"`, (hadFocus) => {
      restorePreset(removed);
      renderChipsLater(m, hadFocus ? removed.preset.id : null);
    }, { kind: "preset" });
  }

  // ── Undo (#21) ──
  // One pending undo at a time: a new action replaces it. It lasts UNDO_MS, ends when the modal
  // closes, and a settings undo also ends when the settings change some other way (update()).

  let pendingUndo = null; // { message, kind, restore(hadFocus), after, timer }

  function offerUndo(message, restore, { trackSettings = false, kind = "settings" } = {}) {
    clearUndo();
    const after = trackSettings ? JSON.stringify(settings) : null;
    pendingUndo = { message, kind, restore, after, timer: setTimeout(clearUndo, UNDO_MS) };
    renderStatus();
  }

  function clearUndo() {
    if (!pendingUndo) return;
    clearTimeout(pendingUndo.timer);
    pendingUndo = null;
    renderStatus();
  }

  // The Undo button is hidden, not removed, in its own click (#26).
  function runUndo() {
    const undo = pendingUndo;
    if (!undo) return;
    const hadFocus = !!modal && document.activeElement === modal.undoButton;
    clearUndo();
    undo.restore(hadFocus);
  }

  // The status line under the chips: a preview's message wins (#51); when the preview ends, a
  // still-running Undo shows again.
  function renderStatus() {
    if (!modal) return;
    const preview = previewing(modal);
    const undo = !preview && pendingUndo;
    modal.undoLine.classList.toggle("gpb-has-status", !!(preview || undo));
    modal.undoText.textContent = preview ? preview.message : undo ? `${undo.message} · ` : "";
    modal.undoButton.hidden = !undo;
  }

  // ── Chip row rendering ──

  function renderChips(m) {
    disarmChip(m);
    if (!m.naming) m.saveChip.after(m.nameField);
    for (const chip of m.chips.querySelectorAll(".gpb-preset-chip")) chip.remove();
    m.builtInRow.append(...BUILT_IN_PRESETS.map(presetChip)); // row 1: the built-ins only (#53)
    for (const preset of presets) m.saveChip.before(presetChip(preset)); // row 2: own presets, then + Save
    const full = presets.length >= MAX_PRESETS;
    m.saveChip.disabled = full;
    m.saveChip.title = full ? SAVE_FULL_LABEL : SAVE_LABEL;
    renderPresetStates();
  }

  // After Save, Rename, Update and Delete: deferred, with the menu closed first (#26).
  function renderChipsLater(m, focusId = null) {
    closePopover();
    disarmChip(m);
    setTimeout(() => {
      if (modal !== m) return;
      renderChips(m);
      const target = focusId === "save" ? m.saveChip : focusId ? chipEl(focusId) : null;
      target?.focus({ preventScroll: true });
    }, 0);
  }

  // A pill: a 12 px swatch painted with the preset's fillImage(), and the name. Names are user
  // text, so they only ever go in through textContent.
  function presetChip(preset) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "gpb-chip gpb-preset-chip";
    chip.dataset.preset = preset.id;
    chip.setAttribute("aria-pressed", "false");
    chip.setAttribute("aria-label", preset.name);
    chip.title = preset.builtIn ? preset.name : `${preset.name}\n${OWN_PRESET_HINT}`;
    chip.innerHTML =
      '<span class="gpb-chip-swatch" aria-hidden="true"></span><span class="gpb-chip-text">' +
      '<span class="gpb-chip-label" aria-live="polite"></span><span class="gpb-sizer" aria-hidden="true"></span>' +
      `<span class="gpb-sizer" aria-hidden="true">${APPLY_LABEL}</span></span>`;
    chip.querySelector(".gpb-chip-swatch").style.backgroundImage = fillImage(presetSettings(preset));
    chip.querySelector(".gpb-chip-label").textContent = preset.name;
    chip.querySelector(".gpb-sizer").textContent = preset.name;
    return chip;
  }

  // The chip whose settings equal the current ones is marked active.
  function renderPresetStates() {
    for (const chip of modal.chips.querySelectorAll(".gpb-preset-chip")) {
      const preset = presetById(chip.dataset.preset);
      chip.setAttribute("aria-pressed", String(!!preset && matchesPreset(preset)));
    }
  }

  // ── Naming (+ Save, Rename) ──
  // One inline name field (not a popover) takes the place of the + Save chip or of the chip
  // being renamed. Enter saves, Escape cancels, and so does leaving the field.

  function startNaming(m, mode, id = null) {
    if (m.naming) return;
    const preset = mode === "rename" ? presets.find((p) => p.id === id) : null;
    const chip = mode === "rename" ? chipEl(id) : m.saveChip;
    if (!chip || (mode === "rename" && !preset)) return;
    disarmChip(m);
    m.naming = { mode, id, chip };
    chip.before(m.nameField);
    chip.hidden = true; // hidden, not removed: it may be the element being clicked (#26)
    m.nameField.value = preset ? preset.name : defaultPresetName();
    m.nameField.setAttribute("aria-label", preset ? `New name for "${preset.name}"` : "Preset name");
    m.nameField.hidden = false;
    m.nameField.focus({ preventScroll: true });
    m.nameField.select();
  }

  function stopNaming(m, { commit = false, refocus = false } = {}) {
    const naming = m.naming;
    if (!naming) return;
    m.naming = null;
    m.nameField.hidden = true;
    m.saveChip.after(m.nameField);
    naming.chip.hidden = false;
    if (!commit) {
      if (refocus) naming.chip.focus({ preventScroll: true });
      return;
    }
    if (pendingUndo?.kind === "preset") clearUndo(); // a restored preset could clash with this change
    if (naming.mode === "save") renderChipsLater(m, addPreset(m.nameField.value)?.id ?? "save");
    else {
      renamePreset(naming.id, m.nameField.value); // an empty name keeps the old one
      renderChipsLater(m, naming.id);
    }
  }

  // ── Chip menu ──
  // The dot menu's popover (#33) with the preset items instead: inside the modal root, hidden,
  // never removed.

  function openChipMenu(id, { at = null, keyboard = false } = {}) {
    const anchor = chipEl(id);
    if (!anchor || !isOwnPreset(id)) return;
    disarmChip(modal);
    setMenuKind("chip");
    if (showPopover(id, modal.menu, at, anchor) && keyboard) menuItems()[0]?.focus({ preventScroll: true });
  }

  function runChipAction(action) {
    if (!popover) return;
    const { id } = popover;
    closePopover();
    action(id);
  }

  // ── Selection ──
  // Exactly one dot is selected (it has the ring); the inline picker always edits it (#35).

  let selectedId = null;

  function dotEl(id) {
    return modal?.stopsRow.querySelector(`.gpb-stop[data-id="${CSS.escape(id)}"]`) ?? null;
  }

  // Moves the ring in place — the dots row is not re-rendered.
  function selectStop(id, { focusHex = false } = {}) {
    const stop = findStop(id);
    if (!stop || !modal) return;
    if (id !== selectedId) {
      dotEl(selectedId)?.classList.remove("gpb-selected");
      dotEl(selectedId)?.setAttribute("aria-current", "false");
      selectedId = id;
      dotEl(id).classList.add("gpb-selected");
      dotEl(id).setAttribute("aria-current", "true");
      showInPicker(stop);
    }
    if (focusHex) modal.hex.focus({ preventScroll: true });
  }

  // ── Dot menu popover (#33) ──
  // Rendered inside the modal root: Spicetify's PopupModal hides itself when a click lands
  // outside .GenericModal (#26). Shown and hidden, never removed while the modal is open, so a
  // click is never dispatched to a detached element. Only the small menu is a popover: a theme
  // can trap position: fixed inside the dialog (Hazy's backdrop-filter), so the picker is
  // inline (#35).

  let popover = null; // { id, el, anchor, at, openedAt } or null
  const POPOVER_EDGE = 8; // min distance from the window edge
  const POPOVER_GAP = 8; // between a dot and a popover anchored to it

  // `at` is a viewport point (menu at the cursor); without it the popover sits under the dot.
  // `anchor` is a dot by default, or a preset chip (#21).
  function showPopover(id, el, at = null, anchor = dotEl(id)) {
    closePopover();
    if (!anchor) return false;
    popover = { id, el, anchor, at, openedAt: performance.now() };
    el.hidden = false;
    placePopover();
    return true;
  }

  function closePopover({ focusDot = false } = {}) {
    if (!popover) return;
    const { el, anchor } = popover;
    popover = null;
    el.hidden = true; // hidden, not removed: it may contain the element being clicked (#26)
    if (focusDot && anchor.isConnected) anchor.focus({ preventScroll: true });
  }

  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

  // position: fixed escapes the modal's overflow clipping. A transformed ancestor would make
  // it relative to that ancestor instead of the window; measuring at 0,0 finds the offset.
  function placePopover() {
    const { el, anchor, at } = popover;
    el.style.left = el.style.top = "0px";
    const origin = el.getBoundingClientRect();
    const { width, height } = origin;
    let left, top;
    if (at) {
      left = at.x + width > innerWidth - POPOVER_EDGE ? at.x - width : at.x;
      top = at.y + height > innerHeight - POPOVER_EDGE ? at.y - height : at.y;
    } else {
      const r = anchor.getBoundingClientRect();
      left = r.left + r.width / 2 - width / 2;
      top = r.bottom + POPOVER_GAP;
      // Flip above the dot if it doesn't fit below but does above.
      if (top + height > innerHeight - POPOVER_EDGE && r.top - POPOVER_GAP - height >= POPOVER_EDGE)
        top = r.top - POPOVER_GAP - height;
    }
    left = clamp(left, POPOVER_EDGE, innerWidth - POPOVER_EDGE - width);
    top = clamp(top, POPOVER_EDGE, innerHeight - POPOVER_EDGE - height);
    el.style.left = `${left - origin.left}px`;
    el.style.top = `${top - origin.top}px`;
  }

  // Escape, or a click or focus anywhere outside the open menu, closes it. Listeners live
  // only while the modal is open.
  function watchPopovers(m) {
    const listen = (target, type, handler) => {
      target.addEventListener(type, handler, true);
      m.cleanups.push(() => target.removeEventListener(type, handler, true));
    };
    const outside = (target) => popover && !popover.el.contains(target);
    listen(document, "pointerdown", (e) => outside(e.target) && closePopover());
    listen(document, "focusin", (e) => outside(e.target) && closePopover());
    listen(document, "keydown", (e) => {
      if (!popover || e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation(); // the menu closes, not the modal
      closePopover({ focusDot: true });
    });
    listen(window, "resize", () => closePopover());
    listen(document, "scroll", () => closePopover());
  }

  // Right-click (or the context-menu key / Shift+F10) on a dot: Duplicate, Remove (#33).
  function enableDotMenu(m) {
    m.stopsRow.addEventListener("contextmenu", (e) => {
      const el = e.target.closest(".gpb-stop");
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const id = el.dataset.id;
      // Shift+F10 / the menu key already opened it from keydown.
      if (popover?.id === id && performance.now() - popover.openedAt < 500) return;
      // A keyboard-triggered contextmenu has no pointer position on the dot.
      const r = el.getBoundingClientRect();
      const onDot = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      openMenu(id, onDot ? { at: { x: e.clientX, y: e.clientY } } : { keyboard: true });
    });
    m.stopsRow.addEventListener("keydown", (e) => {
      const el = e.target.closest(".gpb-stop");
      if (!el || !(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) return;
      e.preventDefault();
      openMenu(el.dataset.id, { keyboard: true });
    });
    m.menu.addEventListener("keydown", (e) => {
      const items = menuItems();
      const i = items.indexOf(document.activeElement);
      const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
      if (next !== undefined) {
        e.preventDefault();
        items[(next + items.length) % items.length]?.focus();
      } else if (e.key === "Tab") {
        e.preventDefault();
        closePopover({ focusDot: true });
      }
    });
    m.duplicateItem.addEventListener("click", () => runMenuAction(duplicateStop));
    m.removeItem.addEventListener("click", () => runMenuAction(removeStop));
  }

  const menuItems = () => [...modal.menu.querySelectorAll(".gpb-menu-item:not(:disabled):not([hidden])")];

  // One menu element for dots (Duplicate, Remove) and own preset chips (Rename, Update, Delete).
  function setMenuKind(kind) {
    for (const item of [modal.duplicateItem, modal.removeItem]) item.hidden = kind !== "dot";
    for (const item of [modal.renameItem, modal.updatePresetItem, modal.deletePresetItem]) item.hidden = kind !== "chip";
    modal.menu.setAttribute("aria-label", kind === "dot" ? "Colour actions" : "Preset actions");
  }

  function openMenu(id, { at = null, keyboard = false } = {}) {
    setMenuKind("dot");
    modal.duplicateItem.disabled = settings.stops.length >= MAX_STOPS;
    modal.removeItem.disabled = settings.stops.length <= 1;
    if (showPopover(id, modal.menu, at) && keyboard) menuItems()[0]?.focus({ preventScroll: true });
  }

  // Hides the menu first, then acts: the clicked item stays connected, so the modal stays
  // open (#26). `action(id)` returns the id of the dot that should get focus afterwards.
  function runMenuAction(action) {
    if (!popover) return;
    const { id } = popover;
    closePopover();
    const focusId = action(id);
    dotEl(focusId)?.focus({ preventScroll: true });
  }

  // ── Colour picker (#32, #35) ──
  // Chromium's native picker popup is browser chrome and can't be extended, so this mirrors
  // its layout — saturation/value square, eyedropper, swatch, hue bar, R/G/B — and adds a hex
  // field and "Use theme colour". It's an inline panel that always edits the selected dot.
  // Edits apply live and update the dot in place: the dots row is never re-rendered by them.

  let pickerHsv = { h: 0, s: 0, v: 0 }; // kept apart from the hex so hue survives greys and black
  let lastDragEnd = -Infinity; // set by drag-and-drop; a click right after a drag is ignored

  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const rgbToHex = (rgb) => "#" + rgb.map((n) => n.toString(16).padStart(2, "0")).join("");

  // `hue` is kept when the colour has none (greys).
  function hexToHsv(hex, hue = 0) {
    const [r, g, b] = hexToRgb(hex).map((n) => n / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = hue;
    if (d) h = 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
    return { h, s: max ? d / max : 0, v: max };
  }

  function hsvToHex({ h, s, v }) {
    const channel = (n) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return rgbToHex([channel(5), channel(3), channel(1)]);
  }

  const pickerStop = () => (modal ? findStop(selectedId) : null);

  // ── Hex copy button (#56) ──
  // Copies the selected stop's colour as #rrggbb (a theme stop's resolved colour), never the
  // field's text, so half-typed or invalid input can't be copied. Through writeClipboard() (#54);
  // the icon turns into a check for HEX_COPIED_MS. Nothing else changes and nothing re-renders.

  const HEX_COPY_LABEL = "Copy hex code";
  const HEX_COPIED_MS = 1500;

  async function copyHex(m) {
    const stop = pickerStop();
    if (!stop) return null;
    const tier = await writeClipboard(resolveStop(stop));
    if (modal !== m) return tier;
    if (!tier) {
      m.hex.focus({ preventScroll: true }); // every tier failed: Ctrl+C on the selected field works
      m.hex.select();
      return null;
    }
    clearTimeout(m.hexCopiedTimer);
    showHexCopied(m, true);
    m.hexCopiedTimer = setTimeout(() => showHexCopied(m, false), HEX_COPIED_MS);
    m.announce.textContent = "Hex code copied";
    return tier;
  }

  // In place: only which icon is hidden changes, never the button (#26).
  function showHexCopied(m, copied) {
    m.hexCopyIcon.toggleAttribute("hidden", copied);
    m.hexCopyCheck.toggleAttribute("hidden", !copied);
  }

  // Loads a stop's current colour into the picker. The previous hue is kept for greys.
  function showInPicker(stop, from = null) {
    pickerHsv = hexToHsv(resolveStop(stop), pickerHsv.h);
    renderPicker(stop, from);
  }

  // `from` is the control being edited; it keeps its own text while you type.
  function renderPicker(stop, from = null) {
    const m = modal;
    const hex = resolveStop(stop);
    const { h, s, v } = pickerHsv;
    m.sv.style.backgroundColor = `hsl(${h}, 100%, 50%)`;
    m.svHandle.style.left = `${s * 100}%`;
    m.svHandle.style.top = `${(1 - v) * 100}%`;
    m.sv.setAttribute("aria-valuetext", `Saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`);
    m.hueHandle.style.left = `${(h / 360) * 100}%`;
    m.hue.setAttribute("aria-valuenow", String(Math.round(h)));
    m.swatch.style.backgroundColor = hex;
    if (from !== "rgb")
      hexToRgb(hex).forEach((n, i) => {
        m.rgb[i].value = String(n);
        m.rgb[i].setAttribute("aria-invalid", "false");
      });
    if (from !== "hex") {
      m.hex.value = hex;
      m.hex.setAttribute("aria-invalid", "false");
    }
    const isTheme = stop.kind === "theme";
    m.useThemeButton.disabled = isTheme;
    m.useThemeButton.textContent = isTheme ? "Following theme colour" : "Use theme colour";
  }

  // Applies a colour to the picker's stop: bar, preview and dot update in place; a theme stop
  // becomes custom. Colours from the square or hue bar keep their exact HSV.
  function commitPickerColour(hex, from = null) {
    const stop = pickerStop();
    if (!stop) return;
    if (from !== "hsv") pickerHsv = hexToHsv(hex, pickerHsv.h);
    if (stop.kind !== "custom" || stop.color !== hex) {
      setStopColour(stop.id, hex);
      renderStop(stop);
    }
    renderPicker(stop, from);
  }

  // Pointer drag on a picker area → apply({ x, y }) as fractions 0–1. Pointer capture keeps
  // the drag (and its click) on the area even outside the modal; moves are coalesced to one
  // update per frame, and the final position is applied on release.
  function enablePointerDrag(el, apply) {
    let active = false;
    let pending = null;
    let frame = 0;
    const at = (e) => {
      const r = el.getBoundingClientRect();
      return { x: clamp((e.clientX - r.left) / (r.width || 1), 0, 1), y: clamp((e.clientY - r.top) / (r.height || 1), 0, 1) };
    };
    const flush = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!pending) return;
      const p = pending;
      pending = null;
      apply(p);
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // no text selection or native drag
      el.focus({ preventScroll: true });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {} // synthetic events (self-test) have no active pointer
      active = true;
      apply(at(e));
    });
    el.addEventListener("pointermove", (e) => {
      if (!active) return;
      pending = at(e);
      frame ||= requestAnimationFrame(flush);
    });
    const end = (e) => {
      if (!active) return;
      active = false;
      if (e.type === "pointerup") pending = at(e);
      flush();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function enableColourPicker(m) {
    const setHsv = (change) => {
      pickerHsv = { ...pickerHsv, ...change };
      commitPickerColour(hsvToHex(pickerHsv), "hsv");
    };
    enablePointerDrag(m.sv, ({ x, y }) => setHsv({ s: x, v: 1 - y }));
    enablePointerDrag(m.hue, ({ x }) => setHsv({ h: x * 360 }));

    // Arrow keys: 1 % (hue: 1°), with Shift 10 % (10°).
    m.sv.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowDown: [0, -step], ArrowUp: [0, step] }[e.key];
      if (!delta) return;
      e.preventDefault();
      setHsv({ s: clamp(pickerHsv.s + delta[0], 0, 1), v: clamp(pickerHsv.v + delta[1], 0, 1) });
    });
    m.hue.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 1;
      const delta = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
      if (!delta) return;
      e.preventDefault();
      setHsv({ h: clamp(pickerHsv.h + delta, 0, 360) });
    });

    for (const field of m.rgb)
      field.addEventListener("input", () => {
        const texts = m.rgb.map((f) => f.value.trim());
        const values = texts.map((t) => (/^\d{1,3}$/.test(t) && +t <= 255 ? +t : null));
        m.rgb.forEach((f, i) => f.setAttribute("aria-invalid", String(values[i] === null && texts[i] !== "")));
        if (values.every((n) => n !== null)) commitPickerColour(rgbToHex(values), "rgb");
      });
    m.hex.addEventListener("input", () => {
      const hex = parseHex(m.hex.value);
      m.hex.setAttribute("aria-invalid", String(!hex && m.hex.value.trim() !== ""));
      if (hex) commitPickerColour(hex, "hex");
    });
    // Leaving a field (or Enter) shows the normalised value.
    for (const field of [...m.rgb, m.hex]) {
      field.addEventListener("change", () => pickerStop() && renderPicker(pickerStop()));
      field.addEventListener("keydown", (e) => e.key === "Enter" && field.blur());
    }

    // A mouse click leaves focus (and any half-typed text) in the field.
    m.hexCopy.addEventListener("mousedown", (e) => e.preventDefault());
    m.hexCopy.addEventListener("click", () => copyHex(m));
    m.cleanups.push(() => clearTimeout(m.hexCopiedTimer));

    m.useThemeButton.addEventListener("click", () => {
      const stop = pickerStop();
      if (!stop || stop.kind === "theme") return;
      const hadFocus = document.activeElement === m.useThemeButton; // it's about to be disabled
      linkStopToTheme(stop.id);
      renderStop(stop);
      showInPicker(stop);
      if (hadFocus) m.hex.focus({ preventScroll: true });
    });

    m.eyedropper?.addEventListener("click", async () => {
      const id = selectedId;
      try {
        const hex = toHex((await new window.EyeDropper().open()).sRGBHex);
        if (hex && modal === m && pickerStop()?.id === id) commitPickerColour(hex);
      } catch {} // cancelled with Escape
    });
  }

  const STOP_GAP = 14; // matches .gpb-stops gap; .gpb-dots' 10 px gap + its 4 px padding put the stepper as far away (#47, #49)

  // The dots are buttons, so dragging never fights a native colour input (#8, #31).
  function enableDragAndDrop(m) {
    const row = m.stopsRow;
    let dragId = null;
    let dropIndex = -1;

    const endDrag = () => {
      dragId = null;
      lastDragEnd = performance.now();
      row.querySelector(".gpb-dragging")?.classList.remove("gpb-dragging");
      row.querySelector(".gpb-marker").hidden = true;
    };

    row.addEventListener("dragstart", (e) => {
      const el = e.target.closest?.(".gpb-stop");
      if (!el || settings.stops.length < 2) return e.preventDefault();
      closePopover();
      dragId = el.dataset.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragId);
      e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2);
      el.classList.add("gpb-dragging");
    });
    row.addEventListener("dragover", (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      dropIndex = dropIndexAt(row, e.clientX, e.clientY);
      showDropMarker(row, dropIndex);
    });
    row.addEventListener("dragleave", (e) => {
      if (!row.contains(e.relatedTarget)) row.querySelector(".gpb-marker").hidden = true;
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const id = dragId;
      endDrag(); // before moveStop: re-rendering detaches the source, so its dragend never reaches us
      if (id) moveStop(id, dropIndex);
    });
    row.addEventListener("dragend", endDrag);
  }

  // Alt + ←/→ moves the focused dot one place, Alt + Home/End to the first or last place (#24),
  // through the same moveStop() as drag-and-drop. The row is re-rendered, so focus goes to the
  // new node with the same id; the selection doesn't change. Plain arrows, Enter/Space and
  // Shift+F10 are left alone.
  function enableKeyboardReorder(m) {
    m.stopsRow.addEventListener("keydown", (e) => {
      const el = e.target.closest(".gpb-stop");
      if (!el || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
      const id = el.dataset.id;
      const from = settings.stops.findIndex((s) => s.id === id);
      const last = settings.stops.length - 1;
      const to = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: last }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      e.stopPropagation(); // Alt+←/→ is also Spotify's Back/Forward, even at the edges
      if (from === -1 || to < 0 || to > last || to === from) return;
      moveStop(id, to > from ? to + 1 : to); // moveStop takes an insertion point
      dotEl(id)?.focus();
      m.announce.textContent = `Moved to position ${to + 1} of ${last + 1}`;
    });
  }

  // Delete or Backspace on a focused dot removes that dot (#49) through the same removeStop() as
  // the dot menu and −, so the selection rule (#35) applies. Focus goes to the dot now at its
  // index. With one colour nothing is removed, but the key is still consumed. On .gpb-stops, so
  // Backspace in the picker's text fields keeps editing text.
  function enableKeyboardRemove(m) {
    m.stopsRow.addEventListener("keydown", (e) => {
      const el = e.target.closest(".gpb-stop");
      if (!el || (e.key !== "Delete" && e.key !== "Backspace") || e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const index = settings.stops.findIndex((s) => s.id === el.dataset.id);
      if (index === -1 || settings.stops.length <= 1) return;
      removeStop(el.dataset.id);
      dotEl(settings.stops[Math.min(index, settings.stops.length - 1)].id)?.focus();
      m.announce.textContent = `Colour removed, ${settings.stops.length} left`;
    });
  }

  // Insertion index under the pointer; the row wraps, so compare line first, then x.
  function dropIndexAt(row, x, y) {
    const stops = [...row.querySelectorAll(".gpb-stop")];
    const i = stops.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top || (y <= r.bottom && x < r.left + r.width / 2);
    });
    return i === -1 ? stops.length : i;
  }

  // Absolutely positioned so showing it never reflows the row.
  function showDropMarker(row, index) {
    const stops = row.querySelectorAll(".gpb-stop");
    const marker = row.querySelector(".gpb-marker");
    const rowRect = row.getBoundingClientRect();
    const ref = stops[Math.min(index, stops.length - 1)].getBoundingClientRect();
    const x = index < stops.length ? ref.left - STOP_GAP / 2 : ref.right + STOP_GAP / 2;
    marker.style.left = `${x - rowRect.left - 1}px`;
    marker.style.top = `${ref.top - rowRect.top}px`;
    marker.hidden = false;
  }

  // Themes like Hazy rewrite --spice-button inline on :root (e.g. on every songchange),
  // so keep the theme swatches and the Spread label colour (#43) current while the modal is open.
  function watchThemeColour(m) {
    const sync = () => {
      if (modal !== m) return;
      renderSpread();
      for (const stop of settings.stops) if (stop.kind === "theme") renderStop(stop);
      const stop = pickerStop();
      if (stop?.kind === "theme") showInPicker(stop, document.activeElement === m.hex ? "hex" : null);
    };
    modalObserver(m, sync).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    Spicetify.Player.addEventListener("songchange", sync);
    m.cleanups.push(() => Spicetify.Player.removeEventListener("songchange", sync));
  }

  // PopupModal has no close callback: hide() removes it from <body>, and another
  // extension's display() replaces its contents. Either way our root is detached.
  function watchModalClose(m) {
    const observer = modalObserver(m, () => {
      if (!m.root.isConnected) closeModal(m);
    });
    observer.observe(document.body, { childList: true });
    observer.observe(Spicetify.PopupModal, { childList: true });
  }

  let liveObservers = 0; // checked by the self-test

  // A MutationObserver that is disconnected when the modal closes.
  function modalObserver(m, callback) {
    const observer = new MutationObserver(callback);
    liveObservers++;
    m.cleanups.push(() => {
      observer.disconnect();
      liveObservers--;
    });
    return observer;
  }

  function closeModal(m) {
    if (m.closed) return;
    m.closed = true;
    for (const cleanup of m.cleanups) cleanup();
    if (modal === m) modal = null;
    flushSettings();
  }

  function renderModal() {
    closePopover(); // the dots are rebuilt, so the menu would lose its anchor
    if (!findStop(selectedId)) selectedId = settings.stops[0].id; // never nothing selected
    renderSwitch();
    renderSpread(); // in place: the Spread row is never rebuilt
    renderPreview();
    renderStops();
    showInPicker(findStop(selectedId));
    const count = settings.stops.length;
    modal.plusButton.disabled = count >= MAX_STOPS;
    modal.plusButton.title = count >= MAX_STOPS ? ADD_FULL_LABEL : ADD_LABEL;
    modal.minusButton.disabled = count <= 1;
    modal.minusButton.title = count <= 1 ? REMOVE_LAST_LABEL : REMOVE_LABEL;
  }

  // In place, never replaced: focus stays on the switch when it adds a colour (#26, #46).
  function renderSwitch() {
    modal.switchButton.setAttribute("aria-checked", String(settings.gradient));
  }

  // The bar at 100 %, from the same gradient string as the stylesheet: the current settings, or
  // the preset or code being previewed (#51). Only the background-image changes, in place.
  function renderPreview() {
    modal.preview.style.backgroundImage = fillImage(previewing(modal)?.settings ?? settings);
  }

  function renderStops() {
    const row = modal.stopsRow;
    row.textContent = "";
    settings.stops.forEach((stop, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "gpb-stop";
      el.draggable = true;
      el.dataset.id = stop.id;
      el.dataset.index = String(i + 1);
      el.classList.toggle("gpb-selected", stop.id === selectedId);
      el.setAttribute("aria-current", String(stop.id === selectedId));
      // Kept but unused while the gradient is off.
      el.classList.toggle("gpb-unused", !settings.gradient && i > 0);
      row.appendChild(el);
      renderStop(stop);
    });
    const marker = document.createElement("div");
    marker.className = "gpb-marker";
    marker.hidden = true;
    row.appendChild(marker);
  }

  // Updates one dot in place.
  function renderStop(stop) {
    const el = modal?.stopsRow.querySelector(`.gpb-stop[data-id="${stop.id}"]`);
    if (!el) return;
    const colour = resolveStop(stop);
    const isTheme = stop.kind === "theme";
    el.style.backgroundColor = colour;
    el.classList.toggle("gpb-theme", isTheme);
    const count = settings.stops.length;
    el.title = (isTheme ? "Theme colour" : colour) + (count > 1 ? `\n${REORDER_HINT}` : "");
    el.setAttribute("aria-label", `Colour ${el.dataset.index} of ${count}: ${isTheme ? "theme colour" : colour}`);
  }

  // ── Self-test ───────────────────────────────────────────────────────────────
  // `await __gpb.selfTest()` in devtools. Drives the same functions and modal DOM the UI
  // uses, checks computed styles on the live bar, then restores everything it touched.

  const RED = "#ff0000";
  const GREEN = "#00ff00";
  const BLUE = "#0000ff";
  const PROBE = "#123456"; // stand-in theme colour

  const tick = () => new Promise((r) => setTimeout(r, 0));
  const custom = (id, color) => ({ id, kind: "custom", color });
  const theme = (id) => ({ id, kind: "theme" });
  const styleText = () => document.getElementById("gpb-style")?.textContent ?? null;
  const songFill = () => document.querySelector(`${SCOPE} ${FILL}`);
  const songHandle = () => document.querySelector(`${SCOPE} ${HANDLE}`);
  const songchangeCount = () => Spicetify.Player.eventListeners?.songchange?.length ?? 0;
  const computedHex = (el, prop) => (el ? toHex(getComputedStyle(el)[prop]) : null);

  // Variables themes and other extensions read from the bar — we must never change them.
  function barVars(fill) {
    const cs = getComputedStyle(fill.closest(".progress-bar") ?? fill);
    return ["--fg-color", "--bg-color", "--is-active-fg-color"]
      .map((v) => `${v}: ${cs.getPropertyValue(v).trim()}`)
      .join("; ");
  }

  // Size, shape and masking of the song bar — identical with and without our rules.
  function barGeometry(fill) {
    const bar = fill.closest(".progress-bar") ?? fill;
    const cs = getComputedStyle(bar);
    const areas = [...bar.querySelectorAll(".x-progressBar-sliderArea")];
    return JSON.stringify({
      vars: ["--progress-bar-height", "--progress-bar-radius"].map((v) => cs.getPropertyValue(v).trim()),
      heights: [bar, ...areas, fill].map((el) => el.offsetHeight),
      masks: areas.map((a) => {
        const style = getComputedStyle(a);
        return style.maskImage || style.webkitMaskImage || "none";
      }),
    });
  }

  function setTestSettings(gradient, stops, mode = DEFAULT_MODE) {
    settings = { version: SCHEMA_VERSION, gradient, mode, stops: stops.map((s) => ({ ...s })) };
    update();
  }

  // Declarations our stylesheet must never contain (CLAUDE.md → Hard rules).
  const FORBIDDEN_PROP =
    /^(-webkit-)?(mask(-.+)?|height|width|transform|clip-path|--progress-bar-.+|--fg-color|--bg-color|--is-active-fg-color)$/;

  // `mode` is the mode the CSS was built for. The only exception (#15): Anchored's fill rule
  // may set `transform: none` and `clip-path`.
  function cssProblems(css, mode) {
    const problems = [];
    if (/!important/i.test(css)) problems.push("!important");
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const sel = selector.trim();
      if (!sel.startsWith(SCOPE)) problems.push(`unscoped rule: ${sel}`);
      const anchoredFill = mode === "anchored" && sel === `${SCOPE} ${FILL}`;
      for (const decl of body.split(";")) {
        const [prop, ...rest] = decl.split(":");
        const name = prop.trim();
        const value = rest.join(":").trim();
        const allowed = anchoredFill && ((name === "transform" && value === "none") || name === "clip-path");
        if (FORBIDDEN_PROP.test(name) && !allowed) problems.push(`sets ${name}`);
      }
    }
    return problems;
  }

  // The fill's computed transform with our stylesheet and without it, read in the same task so
  // playback can't move in between.
  function fillTransforms(fill) {
    const sheet = document.getElementById("gpb-style")?.sheet;
    if (sheet) sheet.disabled = true;
    const spotify = getComputedStyle(fill).transform;
    if (sheet) sheet.disabled = false;
    return { ours: getComputedStyle(fill).transform, spotify };
  }

  // playback-bar-waveform masks the song bar's slider areas with held Web Animations.
  function hasMaskAnimation(el) {
    return el.getAnimations().some(
      (a) =>
        a.playState !== "idle" &&
        a.effect?.getKeyframes().some((k) => Object.keys(k).some((p) => /^(webkitM|m)ask/.test(p)))
    );
  }

  function waveformActive() {
    if (!document.getElementById("progress_bar_waveform_mask")) return false;
    return [...document.querySelectorAll(`${SCOPE} .x-progressBar-sliderArea`)].some(hasMaskAnimation);
  }

  // Every <script> that loads this extension. More than one means a Marketplace install and a
  // local CLI install are both active, and the second copy fights the first (#39).
  const loadedCopies = () =>
    [...document.querySelectorAll("script[src]")].map((el) => el.src).filter((src) => /gradientProgressBar.js/i.test(src));

  // A function declaration, so status() can use it from the first line on (#55).
  function spicetifyVersion() {
    return window.Spicetify?.Config?.version ?? "unknown";
  }

  // The states reported by the separate spicetify-fixes extension (window.__fixes), if it runs: its
  // workarounds for the top bar and MenuItem make ours work too. Read only, never relied on (#55).
  function otherFixes() {
    const fixes = window.__fixes?.fixes;
    return Array.isArray(fixes) ? Object.fromEntries(fixes.map((fix) => [fix?.id, fix?.state])) : null;
  }

  function environment() {
    return {
      extension: VERSION,
      source: SOURCE,
      copies: loadedCopies(),
      spotify: Spicetify.Platform?.version ?? null,
      spicetify: spicetifyVersion(), // #55: which Spicetify release fixed the top bar and MenuItem
      spicetifyFixes: otherFixes(), // #55: whether a separate fix extension is what makes them work
      theme: Spicetify.Config?.current_theme ?? null,
      colourScheme: Spicetify.Config?.color_scheme ?? null,
      extensions: Spicetify.Config?.extensions ?? null,
      waveform: waveformActive(),
      eyedropper: !!window.EyeDropper, // the picker's eyedropper button exists only with it
      presets: presets.length, // own presets (#21)
      spiceButton: getComputedStyle(document.documentElement).getPropertyValue("--spice-button").trim() || null,
      entry: startup.entry,
      phase: startup.phase,
      entryErrors: startup.entryErrors,
      menu: { registered: menuRegistered, menuItemUsable: menuItemUsable() }, // #27; info only, never a check
      topbar: { created: !!shared?.button, connected: !!shared?.button?.element?.isConnected }, // #45
      shared: shared?.status() ?? null, // #58
      startupError: startup.error,
      dom: domProbe(), // includes the song bar's DOM outline, for selector fixes after Spotify updates
    };
  }

  async function copyText(text) {
    return !!(await writeClipboard(text));
  }

  let selfTestRunning = false;

  async function selfTest() {
    if (selfTestRunning) return console.warn("[gpb] The self-test is already running.");
    selfTestRunning = true;

    const results = [];
    const check = (issue, name, pass, detail = "") =>
      results.push({ id: results.length + 1, issue: `#${issue}`, check: name, pass: !!pass, detail: String(detail) });

    const env = environment();
    check(55, "The environment block reports the Spicetify version", typeof env.spicetify === "string" && !!env.spicetify, env.spicetify);
    const savedSettings = structuredClone(settings);
    const savedRaw = Spicetify.LocalStorage.get(STORAGE_KEY);
    const savedPresets = structuredClone(presets); // #21
    const savedPresetsRaw = Spicetify.LocalStorage.get(PRESETS_KEY);
    const rootStyle = document.documentElement.style;
    const savedButton = [rootStyle.getPropertyValue("--spice-button"), rootStyle.getPropertyPriority("--spice-button")];
    const restoreButton = () =>
      savedButton[0]
        ? rootStyle.setProperty("--spice-button", savedButton[0], savedButton[1])
        : rootStyle.removeProperty("--spice-button");

    if (modal) {
      Spicetify.PopupModal.hide();
      closeModal(modal);
    }

    try {
      // The entries can take up to 15 s to register (the profile menu waits for ReactJSX).
      for (let waited = 0; startup.phase === "registering entry point" && waited < 21000; waited += 300) await sleep(300);
      check(3, "Settings entry registered (profile menu or top bar)", startup.entry,
        [`${startup.entry ?? "none"} (${startup.phase})`, ...startup.entryErrors, startup.error?.split("\n")[0]].filter(Boolean).join("; "));
      const menuApplicable = !!(api("Menu")?.Item && api("ReactJSX"));
      check(27, "Menu entry registered without throwing", !menuApplicable || menuRegistered,
        menuApplicable
          ? startup.entryErrors.filter((e) => e.startsWith("Menu:")).join("; ") || `registered${menuItemUsable() ? "" : ", hidden while Spicetify's MenuItem is broken (spicetify/cli#4012)"}`
          : `not applicable: Spicetify.Menu.Item ${api("Menu")?.Item ? "exists" : "missing"}, Spicetify.ReactJSX ${api("ReactJSX") ? "exists" : "missing"}`);
      const role = shared?.role ?? "none";
      check(45, "Top-bar button created as well, not only as a fallback: our own (owner, or next to another protocol) or the owner's shared one (#58)",
        !api("Topbar")?.Button || (role === "member" ? !shared.button && !!shared.registry?.entries.some((e) => e.id === SELF.id) : !!shared?.button),
        !api("Topbar")?.Button
          ? "not applicable: Spicetify.Topbar.Button missing"
          : role === "member"
            ? `member: the shared button is ${shared.registry.owner}'s`
            : !shared?.button
              ? startup.entryErrors.filter((e) => e.startsWith("Topbar:")).join("; ") || "not created"
              : shared.button.element?.isConnected
                ? `${role}, "${shared.button.label}", on screen`
                : `${role}, created, waiting for Spicetify's top bar (#38)`);
      check(39, "Exactly one copy of the extension is loaded", env.copies.length === 1,
        env.copies.length === 1
          ? env.copies[0]
          : `${env.copies.length} copies: ${env.copies.join(", ") || "none found"} (running: ${SOURCE ?? "unknown"}). Keep either the Marketplace install or the local CLI install (spicetify config extensions gradientProgressBar.js-), not both.`);
      await checkEntryIcon(check);
      await checkSharedEntry(check);
      await runChecks(check, rootStyle, restoreButton);
    } catch (e) {
      check(23, "Self-test ran to completion", false, e?.stack || e);
    } finally {
      if (modal) {
        Spicetify.PopupModal.hide();
        closeModal(modal);
      }
      restoreButton();
      clearTimeout(saveTimer);
      saveTimer = 0;
      settings = savedSettings;
      applyCss();
      if (savedRaw == null) Spicetify.LocalStorage.remove(STORAGE_KEY);
      else Spicetify.LocalStorage.set(STORAGE_KEY, savedRaw);
      presets = savedPresets;
      if (savedPresetsRaw == null) Spicetify.LocalStorage.remove(PRESETS_KEY);
      else Spicetify.LocalStorage.set(PRESETS_KEY, savedPresetsRaw);
      selfTestRunning = false;
    }

    const passed = results.filter((r) => r.pass).length;
    const report = { summary: `${passed}/${results.length} passed`, environment: env, results };
    console.table(results);
    console.log(`[gpb] self-test: ${passed}/${results.length} passed`);
    const copied = await copyText(JSON.stringify(report, null, 2));
    console.log(copied ? "[gpb] Full report copied to the clipboard." : "[gpb] Couldn't copy the report — it's the return value.");
    return report;
  }

  // ── Shared top-bar button (#58) ──
  async function checkSharedEntry(check) {
    const st = statusReport();
    const role = shared?.role ?? "none";
    check(58, "status() reports shared next to topbar",
      !!st.shared && ["protocol", "role", "owner", "entries"].every((k) => k in st.shared) && !!st.topbar && "created" in st.topbar,
      JSON.stringify({ topbar: st.topbar, shared: st.shared }));

    // The block's text is fixed: recomputed from this file's source (#58), so drift from GCB's
    // copy shows up. The markers are built here, so this code never matches them itself.
    const mark = (text) => `  // ── ${text} ──`;
    const startMark = mark("Shared entry (protocol 1) — keep identical in GCB and GPB");
    const endMark = mark("End shared entry");
    let hashOk = false;
    let hashDetail;
    try {
      const text = SOURCE
        ? await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", SOURCE);
          xhr.onload = () => (xhr.responseText ? resolve(xhr.responseText) : reject(new Error(`HTTP ${xhr.status}`)));
          xhr.onerror = () => reject(new Error("request failed"));
          xhr.send();
        })
        : null;
      if (!text) hashDetail = "not measured: the extension's source URL is unknown";
      else {
        const lf = text.replace(/\r\n/g, "\n");
        const start = lf.indexOf(startMark);
        const end = lf.indexOf(endMark, start);
        if (start === -1 || end === -1) hashDetail = "the block's markers aren't in the source";
        else {
          const block = lf.slice(start, end + endMark.length).replace(/^ {2}const SELF = .*\n/m, "");
          const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(block));
          const digest = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
          hashOk = digest === SHARED_ENTRY_SHA256;
          hashDetail = hashOk ? `${digest.slice(0, 16)}…, ${block.length} characters` : `${digest} — expected ${SHARED_ENTRY_SHA256}`;
        }
      }
    } catch (e) {
      hashDetail = `not measured: ${e?.message || e}`;
    }
    check(58, "Shared entry block unchanged: its SHA-256 (without SELF) is the one in SHARED_ENTRY_SHA256, as in GCB",
      hashOk || hashDetail.startsWith("not measured"), hashDetail);

    // The live registry: never touched by the self-test.
    const reg = window.__gradientBars;
    if (role.startsWith("own button")) check(58, "Live registry: protocol 1, our entry exactly once, sorted by name", true, `not ours to check: ${role}`);
    else {
      const names = reg?.entries.map((e) => e.name) ?? [];
      check(58, "Live registry: protocol 1, our entry exactly once, sorted by name",
        reg?.protocol === 1 && reg.entries.filter((e) => e.id === SELF.id).length === 1 &&
          names.join("|") === [...names].sort((a, b) => a.localeCompare(b)).join("|") && shared.registry === reg,
        `owner ${reg?.owner}, entries ${reg?.entries.map((e) => e.id).join(", ")}`);
    }
    const gcb = window.__gcb;
    if (!gcb) check(58, "With Gradient Connect Bar: exactly one top-bar button, the owner's", true, "not applicable: Gradient Connect Bar isn't running");
    else {
      const created = { gpb: !!st.topbar?.created, gcb: !!gcb.status?.().topbar?.created };
      check(58, "With Gradient Connect Bar: exactly one top-bar button, the owner's",
        Object.values(created).filter(Boolean).length === 1 && !!created[reg?.owner], `owner ${reg?.owner}; created ${JSON.stringify(created)}`);
    }
    // Alone, the button opens the settings directly, as in v1.6.1.
    if (role === "owner" && reg?.entries.length === 1 && shared.button?.element?.isConnected) {
      shared.button.element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
      const opened = !!modal?.root.isConnected;
      const menuShown = !document.getElementById("gradient-bars-menu")?.hidden && !!document.getElementById("gradient-bars-menu");
      if (modal) {
        Spicetify.PopupModal.hide();
        closeModal(modal);
      }
      check(58, "Alone: the live top-bar button ('Gradient Progress Bar') opens the settings directly, no menu",
        opened && !menuShown && shared.button.label === "Gradient Progress Bar", `opened ${opened}, menu ${menuShown}, label "${shared.button.label}"`);
    } else
      check(58, "Alone: the live top-bar button ('Gradient Progress Bar') opens the settings directly, no menu", true,
        `not applicable: ${role}, ${reg?.entries.length ?? 0} entries, button ${shared?.button?.element?.isConnected ? "on screen" : "not on screen"}`);

    // A separate instance from the same factory: its own key and prefix, fake buttons, stub
    // opens; removed afterwards.
    const KEY = "__gradientBarsSelfTest";
    const OTHER_KEY = "__gradientBarsSelfTestOther";
    const PREFIX = "gradient-bars-selftest";
    const liveBefore = window.__gradientBars;
    const liveEntries = liveBefore?.entries.map((e) => e.id).join();
    const opened = [];
    const buttons = [];
    const fakeButton = (label, icon, onClick) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `${PREFIX}-anchor`;
      el.textContent = "♪";
      Object.assign(el.style, { position: "fixed", top: "12px", right: "60px", width: "32px", height: "32px", zIndex: "99999" });
      el.addEventListener("click", () => onClick());
      document.body.append(el);
      const fake = { element: el, label, icon };
      buttons.push(fake);
      return fake;
    };
    const entry = (id, name) => ({ id: `${id}-selftest`, name, open: () => opened.push(id) });
    const clickAt = (el, keyboard = false) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: keyboard ? 0 : 1 }));
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    const menuEl = () => document.getElementById(`${PREFIX}-menu`);
    const shown = () => !!menuEl() && !menuEl().hidden;
    const items = () => [...(menuEl()?.querySelectorAll(`.${PREFIX}-item`) ?? [])];
    let a, b, c;
    try {
      a = joinGradientBars({ self: entry("gpb", "Gradient Progress Bar"), key: KEY, prefix: PREFIX, createButton: fakeButton });
      a.ensureButton();
      const anchor = a.button?.element;
      clickAt(anchor);
      check(58, "Protocol test instance, one entry: the owner's button opens it directly (no menu), labelled with its name",
        a.role === "owner" && window[KEY]?.protocol === 1 && opened.join() === "gpb" && !shown() && a.button.label === "Gradient Progress Bar",
        `role ${a.role}, opened ${opened.join() || "nothing"}, menu ${shown() ? "shown" : "none"}, label "${a.button?.label}"`);

      b = joinGradientBars({ self: entry("gcb", "Gradient Connect Bar"), key: KEY, prefix: PREFIX, createButton: fakeButton });
      const memberButton = b.ensureButton();
      opened.length = 0;
      clickAt(anchor);
      const names = items().map((el) => el.textContent).join(", ");
      const r = anchor.getBoundingClientRect();
      const mr = menuEl()?.getBoundingClientRect();
      const roles = menuEl()?.getAttribute("role") === "menu" && items().every((el) => el.getAttribute("role") === "menuitem");
      check(58, "Two entries: one button only ('Gradient bars'); a click shows the menu with both, in name order, 8 px below the button, right edges aligned",
        b.role === "member" && !memberButton && buttons.length === 1 && a.button.label === "Gradient bars" && shown() && roles &&
          names === "Gradient Connect Bar, Gradient Progress Bar" && !opened.length && document.activeElement !== items()[0] &&
          Math.abs(mr.top - (r.bottom + 8)) <= 1 && Math.abs(mr.right - r.right) <= 1 && menuEl().parentElement === document.body,
        `member ${b.role}, buttons ${buttons.length}, label "${a.button.label}", items ${names}; menu ${mr ? `${mr.left.toFixed(0)},${mr.top.toFixed(0)}–${mr.right.toFixed(0)}` : "none"}, button bottom ${r.bottom.toFixed(0)}, right ${r.right.toFixed(0)}`);

      const steps = [];
      const step = (label, ok) => steps.push(`${label}${ok ? "" : " ✗"}`);
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      step("outside pointerdown closes", !shown());
      anchor.focus();
      clickAt(anchor, true);
      const list = items();
      step("keyboard open focuses the first item", shown() && document.activeElement === list[0]);
      key(document.activeElement, "ArrowDown");
      step("↓", document.activeElement === list[1]);
      key(document.activeElement, "ArrowDown");
      step("↓ wraps", document.activeElement === list[0]);
      key(document.activeElement, "ArrowUp");
      step("↑ wraps", document.activeElement === list[1]);
      key(document.activeElement, "Home");
      step("Home", document.activeElement === list[0]);
      key(document.activeElement, "End");
      step("End", document.activeElement === list[1]);
      key(document.activeElement, "Escape");
      step("Escape closes and refocuses the button", !shown() && document.activeElement === anchor);
      clickAt(anchor, true);
      key(document.activeElement, "Tab");
      step("Tab closes", !shown());
      clickAt(anchor);
      window.dispatchEvent(new Event("blur"));
      step("window blur closes", !shown());
      clickAt(anchor);
      window.dispatchEvent(new Event("resize"));
      step("resize closes", !shown());
      clickAt(anchor);
      clickAt(anchor);
      step("a second click on the button closes", !shown());
      check(58, "Menu keyboard and closing: first item focused from the keyboard, ↑/↓ wrap, Home/End, Escape, Tab, outside pointerdown, blur, resize",
        !steps.some((x) => x.endsWith("✗")), steps.join("; "));

      opened.length = 0;
      clickAt(anchor);
      const second = items()[1];
      second.click();
      const hiddenFirst = !shown() && !opened.length && second.isConnected;
      await tick();
      const thenOpened = opened.join();
      anchor.focus();
      clickAt(anchor, true);
      key(document.activeElement, "Enter");
      const enterHidden = !shown() && opened.length === 1;
      await tick();
      check(58, "Activating an item hides the menu first, then opens that entry in the next task (click and Enter)",
        hiddenFirst && thenOpened === "gpb" && enterHidden && opened.join() === "gpb,gcb",
        `hidden first ${hiddenFirst}, then opened ${thenOpened}; Enter: hidden first ${enterHidden}, opened ${opened.join()}`);

      window[OTHER_KEY] = { protocol: 2, entries: [] };
      c = joinGradientBars({ self: entry("gpb", "Gradient Progress Bar"), key: OTHER_KEY, prefix: `${PREFIX}-other`, createButton: fakeButton });
      c.ensureButton();
      opened.length = 0;
      clickAt(c.button.element);
      check(58, "Another protocol: own button path, its own label, opens directly, the foreign registry untouched",
        c.role === "own button (protocol 2)" && !c.registry && c.button?.label === "Gradient Progress Bar" && opened.join() === "gpb" &&
          JSON.stringify(window[OTHER_KEY]) === JSON.stringify({ protocol: 2, entries: [] }) && c.status().role === "own button (protocol 2)",
        `role ${c.role}, label "${c.button?.label}", opened ${opened.join()}, registry ${JSON.stringify(window[OTHER_KEY])}`);
    } catch (e) {
      check(58, "Protocol test instance ran", false, e?.stack || e);
    } finally {
      a?.dispose();
      b?.dispose();
      c?.dispose();
      delete window[KEY];
      delete window[OTHER_KEY];
      for (const fake of buttons) fake.element.remove();
    }
    check(58, "The live registry is untouched by the test instance; nothing of the test instance is left",
      window.__gradientBars === liveBefore && window.__gradientBars?.entries.map((e) => e.id).join() === liveEntries &&
        !(KEY in window) && !(OTHER_KEY in window) && !document.querySelector(`[id^="${PREFIX}"], [class^="${PREFIX}"]`),
      `live entries ${window.__gradientBars?.entries.map((e) => e.id).join() ?? "none"}`);
  }

  // ── Entry icon (#44) ──
  async function checkEntryIcon(check) {
    check(44, "Entry icon: currentColor, 16 × 16 viewBox, no id= and no <defs>",
      ENTRY_ICON.includes("currentColor") && ENTRY_ICON.includes('viewBox="0 0 16 16"') &&
        !ENTRY_ICON.includes("id=") && !ENTRY_ICON.includes("<defs"),
      `${ENTRY_ICON.length} characters`);

    // On-screen size of our 16 × 16 viewBox. Not getBoundingClientRect(): for a nested <svg>
    // that measures the painted shapes, not the viewport.
    const px = (svg) => {
      const m = svg?.getScreenCTM?.();
      return m ? [16 * Math.hypot(m.a, m.b), 16 * Math.hypot(m.c, m.d)] : null;
    };
    const size = (svg) => px(svg)?.map((n) => n.toFixed(1)).join(" × ").concat(" px") ?? "not rendered";
    const is16 = (svg) => !!px(svg)?.every((n) => Math.abs(n - 16) <= 1);

    // Ours, or the owner's shared one (#58): the same icon either way.
    const button = shared?.button?.element ??
      [...document.querySelectorAll("button[aria-label]")].find((el) => ["Gradient bars", "Gradient Connect Bar"].includes(el.getAttribute("aria-label")));
    const svg = button?.querySelector("svg");
    if (svg) {
      const fill = getComputedStyle(svg).fill;
      const colour = getComputedStyle(button).color;
      const sameColour = fill === colour || String(parseRgb(fill)) === String(parseRgb(colour));
      check(44, "Top-bar icon renders at 16 × 16 px and takes the button's colour", is16(svg) && sameColour,
        `${size(svg)}, fill ${fill}, button colour ${colour}`);
    } else {
      check(44, "Top-bar icon renders at 16 × 16 px and takes the button's colour", true,
        "top-bar button not connected; expected on Spicetify ≤ 2.45.3 until its class-map fix for Spotify 1.3.4 is released (#38)");
    }

    // The profile menu renders only while it's open, so render the icon the way Spicetify's
    // createIconComponent() does — our string inside Spotify's IconComponent — off-screen.
    const Icon = api("ReactComponent")?.IconComponent;
    const React = api("React");
    const ReactDOM = api("ReactDOM");
    if (!Icon || !React || !ReactDOM) {
      check(44, "Profile-menu icon: nested in Spotify's IconComponent, our <svg> renders at 16 × 16 px", true,
        "IconComponent, React or ReactDOM not exposed by Spicetify; not measured");
      return;
    }
    const host = document.createElement("div");
    host.className = "gpb-icon-probe";
    host.style.cssText = "position: fixed; left: 0; top: 0; visibility: hidden; pointer-events: none";
    document.body.append(host);
    let root;
    try {
      root = ReactDOM.createRoot?.(host);
      const icon = React.createElement(Icon, { iconSize: 16, dangerouslySetInnerHTML: { __html: ENTRY_ICON } });
      if (root) root.render(icon);
      else ReactDOM.render(icon, host);
      await sleep(150);
      const outer = host.querySelector("svg");
      const inner = outer?.querySelector("svg");
      check(44, "Profile-menu icon: nested in Spotify's IconComponent, our <svg> renders at 16 × 16 px", is16(inner),
        inner
          ? `ours ${size(inner)}; IconComponent ${outer.getBoundingClientRect().width.toFixed(1)} px, viewBox ${outer.getAttribute("viewBox")}`
          : `no nested <svg>: ${host.innerHTML.slice(0, 120)}`);
    } catch (e) {
      check(44, "Profile-menu icon: nested in Spotify's IconComponent, our <svg> renders at 16 × 16 px", false,
        `rendering IconComponent failed: ${e?.message || e}`);
    } finally {
      try {
        if (root) root.unmount();
        else ReactDOM.unmountComponentAtNode?.(host);
      } catch {}
      host.remove();
    }
  }

  async function runChecks(check, rootStyle, restoreButton) {
    // ── Rendering ──
    settings = defaultSettings();
    update();
    check(1, "Default settings → #gpb-style is empty", styleText() === "", JSON.stringify(styleText()));

    const samples = [
      [false, [custom("s1", RED)]],
      [true, [theme("s1"), custom("s2", RED), custom("s3", BLUE)]],
      [false, [custom("s1", RED), theme("s2"), custom("s3", BLUE)]],
    ];
    const css = (mode, gradient, stops) => buildCss({ version: SCHEMA_VERSION, gradient, mode, stops });
    const problems = MODES.flatMap((mode) =>
      samples.flatMap(([gradient, stops]) => cssProblems(css(mode, gradient, stops), mode).map((p) => `${mode}: ${p}`))
    );
    check(1, "CSS: every rule scoped, no !important, no forbidden properties (all three modes)", !problems.length,
      problems.join("; ") || `${samples.length} samples × ${MODES.length} modes clean`);
    // The linter itself: Anchored's exception must not leak into other modes or rules.
    const anchoredCss = css("anchored", true, [custom("s1", RED), custom("s2", BLUE)]);
    const leaks = {
      "Anchored CSS checked as Compress": cssProblems(anchoredCss, "compress"),
      "Anchored CSS checked as Slide": cssProblems(anchoredCss, "slide"),
      "transform other than none": cssProblems(anchoredCss.replace("transform: none", "transform: translateX(0)"), "anchored"),
      "transform on the handle": cssProblems(anchoredCss.replace(`${HANDLE} {`, `${HANDLE} {\n  transform: none;`), "anchored"),
    };
    const missed = Object.entries(leaks).filter(([, found]) => !found.length).map(([label]) => label);
    check(15, "CSS lint allows transform: none + clip-path only in Anchored's fill rule",
      !cssProblems(anchoredCss, "anchored").length && !missed.length,
      missed.length ? `not flagged: ${missed.join(", ")}` : `flagged: ${Object.values(leaks).map((p) => p.join("/")).join("; ")}`);
    const solids = MODES.map((mode) => css(mode, false, [custom("s1", RED), custom("s2", GREEN)]));
    const inert = MODES.map((mode) => buildCss({ ...defaultSettings(), mode }));
    check(15, "Solid output is identical in all three modes; default settings are inert in every mode",
      solids[0] !== "" && solids.every((c) => c === solids[0]) && inert.every((c) => c === ""),
      `solid ${solids.map((c) => c.length).join("/")} chars, defaults ${inert.map((c) => JSON.stringify(c)).join("/")}`);
    const perMode = Object.fromEntries(MODES.map((mode) => [mode, css(mode, true, [custom("s1", RED), custom("s2", BLUE)])]));
    check(15, "Gradient CSS per mode: Compress sizes to the playhead, Anchored clips, Slide has no overrides",
      perMode.compress.includes("background-size: var(--progress-bar-transform) 100%;") &&
        perMode.compress.includes("background-position: right center;") &&
        perMode.anchored.includes("transform: none;") &&
        perMode.anchored.includes("clip-path: inset(0 calc(100% - var(--progress-bar-transform)) 0 0 round var(--progress-bar-radius));") &&
        !/background-(size|position)|transform:|clip-path/.test(perMode.slide),
      MODES.map((mode) => `${mode}: ${perMode[mode].replace(/\s+/g, " ")}`).join(" | "));
    const themeCssPerMode = MODES.map((mode) => css(mode, true, [theme("s1"), theme("s2")]));
    check(7, "Theme stop emits var(--spice-button …) in every mode, never a resolved hex",
      themeCssPerMode.every((c) => c.includes(THEME_COLOUR) && !/#[0-9a-f]{3,8}\b/i.test(c.replaceAll(THEME_COLOUR, ""))),
      `${MODES.length} modes`);

    const fill = songFill();
    check(1, "Song progress bar found", fill && songHandle(), fill ? "" : "nothing matches SCOPE FILL — Spotify's DOM may have changed");

    if (fill) {
      const varsBefore = barVars(fill); // stylesheet is empty here
      const geometryBefore = barGeometry(fill);
      const waveform = waveformActive();
      const volumeFills = () => [...document.querySelectorAll(FILL)].filter((f) => !f.matches(`${SCOPE} ${FILL}`));
      const volumeState = () =>
        volumeFills().map((f) => `${getComputedStyle(f).backgroundImage} | ${getComputedStyle(f).transform}`).join("; ") || "no other fills";
      const volumeBefore = volumeState();
      setTestSettings(false, [custom("s1", RED)]);
      const solid = getComputedStyle(fill).backgroundImage;
      check(1, "Solid → song fill has a linear-gradient background-image", solid.startsWith("linear-gradient"), solid);
      const others = [...document.querySelectorAll(FILL)].filter((f) => !f.matches(`${SCOPE} ${FILL}`));
      const touched = others.filter((f) => getComputedStyle(f).backgroundImage !== "none");
      check(1, "Solid → every other fill (volume) has no background-image", !touched.length,
        `${others.length} other fill(s), ${touched.length} styled`);
      const solidHandle = computedHex(songHandle(), "backgroundColor");
      check(6, "Solid → handle is the solid colour", solidHandle === RED, solidHandle);

      // Every mode against the real song fill, with the same invariants (#15).
      for (const mode of MODES) {
        const Mode = MODE_LABELS[mode];
        setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)], mode);
        const cs = getComputedStyle(fill);
        const progress = parseFloat(cs.getPropertyValue("--progress-bar-transform"));
        const area = fill.closest(".x-progressBar-sliderArea") ?? fill.parentElement;
        const leftGap = fill.getBoundingClientRect().left - area.getBoundingClientRect().left;
        const t = fillTransforms(fill);
        const where = `at ${progress}%: size ${cs.backgroundSize}, position ${cs.backgroundPosition}, repeat ${cs.backgroundRepeat}, ` +
          `transform ${t.ours} (Spotify's ${t.spotify}), clip-path ${cs.clipPath}, fill left ${leftGap.toFixed(1)} px from its slider area`;
        if (mode === "compress") {
          const sizeX = cs.backgroundSize.split(" ")[0];
          check(6, "Compress → background-size follows --progress-bar-transform",
            sizeX.endsWith("%") && Math.abs(parseFloat(sizeX) - progress) < 0.01, where);
          check(6, "Compress → anchored right, no-repeat", cs.backgroundPositionX === "100%" && cs.backgroundRepeat === "no-repeat", where);
          check(15, "Compress → Spotify's transform intact, no clip-path; below 100 % the fill starts left of its slider area",
            t.ours === t.spotify && cs.clipPath === "none" && (progress >= 99 || leftGap < -1), where);
        } else if (mode === "anchored") {
          check(15, "Anchored → transform none, clip-path inset(…), gradient sized to the whole track",
            t.ours === "none" && cs.clipPath.startsWith("inset(") && cs.backgroundSize === "100% 100%", where);
          check(15, "Anchored → the fill's left edge = its slider area's left edge (±1 px)", Math.abs(leftGap) <= 1, where);
        } else {
          check(15, "Slide → no background-size/position override, Spotify's transform intact, no clip-path",
            /^auto( auto)?$/.test(cs.backgroundSize) && cs.backgroundPositionX === "0%" && t.ours === t.spotify && cs.clipPath === "none",
            where);
        }
        const img = cs.backgroundImage;
        const order = ["rgb(255, 0, 0)", "rgb(0, 255, 0)", "rgb(0, 0, 255)"].map((c) => img.indexOf(c));
        const lastHandle = computedHex(songHandle(), "backgroundColor");
        check(6, `${Mode} → all stops in order, handle is the last stop`,
          order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])) && lastHandle === BLUE, `${img}; handle ${lastHandle}`);
        check(11, `${Mode} → bar's --fg-color, --bg-color, --is-active-fg-color untouched`, barVars(fill) === varsBefore, barVars(fill));
        check(12, `${Mode} → bar height, radius and masks identical with our rules applied`, barGeometry(fill) === geometryBefore,
          barGeometry(fill));
        check(1, `${Mode} → volume fill untouched (no background-image, transform unchanged)`,
          volumeState() === volumeBefore && volumeFills().every((f) => getComputedStyle(f).backgroundImage === "none"), volumeState());
        if (waveform) {
          const areas = [...(fill.closest(".progress-bar") ?? fill).querySelectorAll(".x-progressBar-sliderArea")];
          check(12, `${Mode} → waveform: both slider areas still masked`, areas.every(hasMaskAnimation),
            areas.map((a) => getComputedStyle(a).maskImage || getComputedStyle(a).webkitMaskImage).join(" | "));
        }
      }
    }

    setTestSettings(false, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
    const firstOnly = styleText();
    check(4, "Gradient off with 3 stops → CSS uses the first stop only",
      firstOnly.includes(RED) && !firstOnly.includes(GREEN) && !firstOnly.includes(BLUE), firstOnly.replace(/\s+/g, " "));

    // ── Theme colour ──
    setTestSettings(true, [theme("s1"), theme("s2")]);
    const themeCss = styleText();
    check(7, "Theme stop emits var(--spice-button …), never a resolved hex",
      themeCss.includes(THEME_COLOUR) && !/#[0-9a-f]{3,8}\b/i.test(themeCss.replaceAll(THEME_COLOUR, "")),
      themeCss.replace(/\s+/g, " "));
    const rootCs = getComputedStyle(document.documentElement);
    const expected =
      toHex(rootCs.getPropertyValue("--spice-button").trim()) ||
      toHex(rootCs.getPropertyValue("--spice-text").trim()) ||
      "#1db954";
    const resolved = resolveStop(theme("x"));
    check(7, "Theme stop resolves to the current computed --spice-button", resolved === expected,
      `${resolved} vs ${expected}${rootCs.getPropertyValue("--spice-button").trim() ? "" : " (--spice-button unset, fallback)"}`);
    if (fill) {
      const themeHandle = computedHex(songHandle(), "backgroundColor");
      check(7, "Theme stop on the live bar = current --spice-button", themeHandle === expected, themeHandle);
      // Hazy rewrites --spice-button inline on :root on every songchange.
      rootStyle.setProperty("--spice-button", PROBE, "important");
      const followedHandle = computedHex(songHandle(), "backgroundColor");
      const followedFill = getComputedStyle(fill).backgroundImage;
      restoreButton();
      check(11, "Runtime --spice-button change (as Hazy does per song) → bar follows, no JS",
        followedHandle === PROBE && followedFill.includes("rgb(18, 52, 86)"), `handle ${followedHandle}`);
    }

    // ── Modal ──
    settings = defaultSettings();
    update();
    if (fill) {
      const others = [...document.querySelectorAll(FILL)].filter((f) => !f.matches(`${SCOPE} ${FILL}`));
      for (const other of others) other.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const volumeOpened = !!modal;
      if (modal) {
        Spicetify.PopupModal.hide();
        closeModal(modal);
      }
      fill.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const opened = !!modal?.root.isConnected;
      check(28, "Right-click on the song bar opens the settings (volume bar doesn't)", opened && !volumeOpened,
        `song ${opened}, volume ${volumeOpened}`);
      if (modal) {
        Spicetify.PopupModal.hide();
        closeModal(modal);
      }
    }
    const listenersBefore = songchangeCount();
    openModal();
    let m = modal;
    check(3, "Modal opens", m?.root.isConnected, "");
    if (!m) return;
    // Records whether the modal survived an action; reopens it so later checks still run.
    const stillOpen = (after) => {
      const open = m.root.isConnected && modal === m;
      check(26, `Modal still open after ${after}`, open, open ? "" : "modal closed itself");
      if (!open) {
        if (modal) closeModal(modal);
        openModal();
        m = modal;
      }
    };

    const dots = () => [...m.stopsRow.querySelectorAll(".gpb-stop")];
    const ringed = () => dots().filter((el) => el.classList.contains("gpb-selected"));
    // Exactly one ring, on `id`'s dot, and the picker (hex and R/G/B) shows that stop's colour.
    const selectionIs = (id) => {
      const stop = findStop(id);
      const hex = stop && resolveStop(stop);
      return !!stop && selectedId === id && ringed().length === 1 && ringed()[0].dataset.id === id &&
        m.hex.value === hex && m.rgb.map((f) => f.value).join() === hexToRgb(hex).join();
    };
    const selection = () =>
      `selected ${selectedId}, ring on ${ringed().map((el) => el.dataset.id).join() || "none"}, hex "${m.hex.value}", ` +
      `stops ${settings.stops.map((s) => s.id).join()}`;
    const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));

    check(35, "On open the first dot is selected and the picker shows its colour",
      selectionIs(settings.stops[0].id) && m.hex.value !== "", selection());
    // ── Gradient switch with one colour (#46): it adds a second colour instead of being disabled ──
    const switchNode = m.switchButton;
    const switchState = () =>
      `${settings.stops.map((s) => `${s.id}:${s.kind}${s.color ? ` ${s.color}` : ""}`).join(", ")}; gradient ${settings.gradient}, ` +
      `aria-checked ${switchNode.getAttribute("aria-checked")}, disabled ${switchNode.disabled}, focus .${document.activeElement?.className}`;
    check(46, "One stop → switch enabled and off, no row tooltip",
      settings.stops.length === 1 && !switchNode.disabled && switchNode.getAttribute("aria-checked") === "false" &&
        !settings.gradient && !m.gradientRow.title && !switchNode.title,
      `${switchState()}, row title "${m.gradientRow.title}"`);
    const onlyStop = { ...settings.stops[0] };
    switchNode.focus();
    click(switchNode);
    await sleep(20);
    const openAfterSwitch = m.root.isConnected && modal === m;
    check(46, "Switch on with one colour → a copy of it after it (theme stays theme), gradient on, the new dot selected",
      settings.stops.length === 2 && settings.gradient && settings.stops[0].id === onlyStop.id &&
        settings.stops[1].kind === onlyStop.kind && settings.stops[1].color === onlyStop.color && selectionIs(settings.stops[1].id),
      `${switchState()}; ${selection()}`);
    check(46, "…focus stays on the switch, updated in place; Spread row enabled; modal still open",
      openAfterSwitch && document.activeElement === switchNode && m.switchButton === switchNode && switchNode.isConnected &&
        switchNode.getAttribute("aria-checked") === "true" && m.modeButtons.every((b) => !b.disabled),
      `${switchState()}, Spread disabled ${m.modeButtons.map((b) => b.disabled).join()}, open ${openAfterSwitch}`);
    stillOpen("switching the gradient on with one colour");
    click(m.switchButton);
    check(46, "Switch off → both stops kept, colour 2 dimmed",
      settings.stops.length === 2 && !settings.gradient && dots()[1]?.classList.contains("gpb-unused"), switchState());
    click(m.switchButton);
    check(46, "Switch on again with two colours → no third colour added",
      settings.stops.length === 2 && settings.gradient && !dots()[1]?.classList.contains("gpb-unused"), switchState());

    const foreign = [m.root, ...m.root.querySelectorAll("*")].filter(
      (el) => (el.id && !el.id.startsWith("gpb-")) || [...el.classList].some((c) => !c.startsWith("gpb-"))
    );
    check(3, "Every id and class in the modal starts with gpb-", !foreign.length,
      foreign.map((el) => `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join(".")}`).join(", ") || "all prefixed");
    const hazyHooks = m.root.querySelectorAll("#color-input, .slider, .toggle, .toggleWrapper, select");
    check(11, "Modal uses none of Hazy's global hooks (#color-input, .slider, .toggle, .toggleWrapper, select)",
      !hazyHooks.length, `${hazyHooks.length} found`);
    const colorInput = document.getElementById("color-input");
    check(3, "No id=color-input of ours (Hazy looks it up)", !colorInput || !m.root.contains(colorInput),
      colorInput ? "exists, but it's not ours" : "none in the document");
    const help = m.help;
    const helpLines = help.innerHTML.split(/<br\s*\/?>/).map((line) => line.trim());
    check(52, "Help text is the last element of the modal content, after the action row, in three lines in order",
      helpLines.length === HELP_LINES.length && helpLines.every((line, i) => line === HELP_LINES[i]) &&
        help.querySelectorAll("br").length === 2 && m.root.lastElementChild === help &&
        m.actions.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING && !m.root.querySelector(".gpb-footer"),
      `last child .${m.root.lastElementChild?.className}, text "${help.innerText ?? help.textContent}"`);
    check(47, "No + Add colour button left; Reset alone in the action row",
      !m.root.querySelector(".gpb-add") && m.actions.children.length === 1 && m.actions.firstElementChild === m.resetButton,
      `.gpb-add ${!!m.root.querySelector(".gpb-add")}, action row [${[...m.actions.children].map((el) => `.${el.className}`).join(", ")}]`);
    // Tab order inside the dots line: the dots, then −, then +.
    const tabOrder = [...m.dotsLine.querySelectorAll("button")].filter((el) => el.tabIndex >= 0);
    const tabNames = tabOrder.map((el) => (el.classList.contains("gpb-stop") ? "dot" : el === m.minusButton ? "−" : el === m.plusButton ? "+" : el.className));
    check(49, "−|+ stepper: a group 'Colours' outside .gpb-stops, right after it; − then +, labelled; not draggable; tab order dots, −, +",
      m.stepper?.getAttribute("role") === "group" && m.stepper.getAttribute("aria-label") === "Colours" &&
        !m.stopsRow.contains(m.stepper) && m.stopsRow.nextElementSibling === m.stepper && !m.root.querySelector(".gpb-stepper ~ .gpb-plus, .gpb-dots > .gpb-plus") &&
        [...m.stepper.querySelectorAll("button")].every((b, i) => b === [m.minusButton, m.plusButton][i] && !b.draggable) &&
        m.minusButton.getAttribute("aria-label") === REMOVE_LABEL && m.minusButton.title === REMOVE_LABEL && !m.minusButton.disabled &&
        m.plusButton.getAttribute("aria-label") === ADD_LABEL && m.plusButton.title === ADD_LABEL && !m.plusButton.disabled &&
        tabNames.join() === [...dots().map(() => "dot"), "−", "+"].join(),
      `after .${m.stepper?.previousElementSibling?.className}, role ${m.stepper?.getAttribute("role")}, ` +
        `− "${m.minusButton.title}" disabled ${m.minusButton.disabled}, + "${m.plusButton.title}" disabled ${m.plusButton.disabled}, tab order ${tabNames.join(", ")}`);
    const icons = m.stopsRow.querySelectorAll("svg, .gpb-action, .gpb-badge, .gpb-grip");
    check(31, "No icons on the colour dots", !icons.length, `${icons.length} found`);
    const editorRow = m.root.querySelectorAll('.gpb-editor, input[type="color"]');
    check(32, "No editor row and no native colour input", !editorRow.length, `${editorRow.length} found`);
    check(35, "Picker is an inline panel between the dots and the Reset row, not a popover",
      m.picker.parentElement === m.root && m.picker.previousElementSibling === m.dotsLine &&
        m.picker.nextElementSibling === m.actions && !m.picker.hidden && getComputedStyle(m.picker).position === "static",
      `after .${m.picker.previousElementSibling?.className}, before .${m.picker.nextElementSibling?.className}, ` +
        `position ${getComputedStyle(m.picker).position}`);

    check(15, "Spread row sits between the Gradient row and the Presets row (#21): a radiogroup of three radio buttons",
      m.spread.previousElementSibling === m.gradientRow && m.spread.nextElementSibling === m.presets &&
        m.modes.getAttribute("role") === "radiogroup" && m.modes.getAttribute("aria-labelledby") === "gpb-spread-label" &&
        m.modeButtons.length === 3 && m.modeButtons.every((b) => b.tagName === "BUTTON" && b.getAttribute("role") === "radio") &&
        m.modeButtons.map((b) => b.textContent).join() === "Compress,Anchored,Slide",
      `after .${m.spread.previousElementSibling?.className}, before .${m.spread.nextElementSibling?.className}, ` +
        `buttons ${m.modeButtons.map((b) => `${b.textContent}[${b.getAttribute("role")}]`).join(", ")}`);

    // ── Dot menu (#33) ──
    const menuShown = () => !m.menu.hidden && popover?.el === m.menu && m.root.contains(m.menu);
    const rightClick = (el) => {
      const r = el.getBoundingClientRect();
      const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: at.x, clientY: at.y }));
      return at;
    };
    const press = (el, key, init = {}) =>
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    // Scrolled into view (not for the fixed menu), the element's centre hit-tests to the element
    // or a descendant: visible, not clipped or covered (#35).
    const reachable = (el, scroll = true) => {
      if (scroll) el.scrollIntoView({ block: "nearest", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return r.width > 0 && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    };

    await sleep(350); // let the modal's opening animation settle before measuring positions
    // The title bar is Spicetify's: the outermost element whose whole text is our title.
    const titleBar = [...(m.root.closest(".GenericModal") ?? document.body).querySelectorAll("*")].find(
      (el) => !el.contains(m.root) && !m.root.contains(el) && el.textContent.trim() === "Gradient Progress Bar"
    );
    const titleGap = titleBar ? m.gradientRow.getBoundingClientRect().top - titleBar.getBoundingClientRect().bottom : NaN;
    const helpGap = help.getBoundingClientRect().top - m.actions.getBoundingClientRect().bottom;
    check(34, "Spacing: title bar → Gradient row and action row → help text are both ≥ 16 px",
      titleGap >= 16 && helpGap >= 16,
      `title gap ${titleBar ? `${Math.round(titleGap)} px` : "title bar not found"}, help gap ${Math.round(helpGap)} px`);

    // ── Action row (#37) ──
    const rowRect = m.actions.getBoundingClientRect();
    const resetRect = m.resetButton.getBoundingClientRect();
    const centreX = (r) => r.left + r.width / 2;
    const centreY = (r) => r.top + r.height / 2;
    const resetOff = centreX(resetRect) - centreX(rowRect);
    check(47, "Reset alone in the action row, centred (±1 px)", m.actions.children.length === 1 && Math.abs(resetOff) <= 1,
      `Reset's centre ${resetOff.toFixed(1)} px from the row's, row ${Math.round(rowRect.width)} px`);
    // ── −|+ stepper after the dots (#49) ──
    const lastDot = dots()[dots().length - 1];
    const dotRect = lastDot.getBoundingClientRect();
    const stepperRect = m.stepper.getBoundingClientRect();
    const stepperGap = stepperRect.left - dotRect.right;
    const stepperCentreDiff = Math.abs(centreY(stepperRect) - centreY(dotRect));
    check(49, `Stepper sits right after the last dot on the same line (centres within 2 px, ${STOP_GAP} px apart like the dots), a dot's height (±1 px)`,
      stepperCentreDiff <= 2 && Math.abs(stepperGap - STOP_GAP) <= 1 && Math.abs(stepperRect.height - dotRect.height) <= 1,
      `centres differ ${stepperCentreDiff.toFixed(1)} px, gap ${stepperGap.toFixed(1)} px, ` +
        `stepper ${stepperRect.width.toFixed(1)}×${stepperRect.height.toFixed(1)}, dot ${dotRect.width.toFixed(1)}×${dotRect.height.toFixed(1)}`);
    const halves = { "−": m.minusButton, "+": m.plusButton };
    const halfSizes = Object.entries(halves).map(([name, el]) => {
      const r = el.getBoundingClientRect();
      return `${name} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`;
    });
    const missedHalves = Object.entries(halves).filter(([, el]) => !reachable(el, false)).map(([name]) => name);
    const inner = Object.values(halves).map((el) => el.clientWidth); // between the borders
    check(49, "Both stepper halves are 34 px wide between their borders (pill 71 × 32 px) and hit-test to themselves",
      !missedHalves.length && inner.every((w) => Math.abs(w - 34) <= 1) && Math.abs(stepperRect.width - 71) <= 1,
      `${halfSizes.join(", ")}, inside the borders ${inner.join(" and ")} px, pill ${stepperRect.width.toFixed(1)} px` +
        `${missedHalves.length ? `; not hit: ${missedHalves.join(", ")}` : ""}`);
    // Real :hover can't be triggered from script, so the hover rules are read from our stylesheet (#50).
    const modalRules = [...(m.root.querySelector("style")?.sheet?.cssRules ?? [])].filter((r) => r.selectorText);
    const hoverRule = modalRules.find((r) => /\.gpb-step:hover:not\(:disabled\)/.test(r.selectorText) &&
      r.style.getPropertyValue("border-color").trim() === "var(--spice-text)" && r.style.getPropertyValue("color").trim() === "var(--spice-text)");
    const raiseRule = modalRules.find((r) => /\.gpb-plus:hover:not\(:disabled\)/.test(r.selectorText) &&
      r.style.getPropertyValue("z-index").trim() === "1" && r.style.getPropertyValue("position").trim() === "relative");
    check(50, "Hover on an enabled half: its whole outline and its glyph → --spice-text; + is raised over −'s edge",
      !!hoverRule && !!raiseRule,
      `${hoverRule ? `"${hoverRule.cssText}"` : "no .gpb-step:hover:not(:disabled) rule with border-color and color var(--spice-text)"}; ` +
        `${raiseRule ? `"${raiseRule.cssText}"` : "no .gpb-plus:hover:not(:disabled) rule with position: relative; z-index: 1"}`);
    const minusStyle = getComputedStyle(m.minusButton);
    const plusLeft = parseRgb(getComputedStyle(m.plusButton).borderLeftColor);
    const middle = parseRgb(minusStyle.borderRightColor);
    check(50, "At rest the middle is one line: +'s left border is transparent, −'s right border has the normal colour",
      !!plusLeft && plusLeft[3] === 0 && !!middle && middle[3] > 0 && minusStyle.borderRightColor === minusStyle.borderTopColor &&
        !m.stepper.querySelector(".gpb-step-divider"),
      `+ left ${getComputedStyle(m.plusButton).borderLeftColor}, − right ${minusStyle.borderRightColor}, − top ${minusStyle.borderTopColor}`);
    check(37, "Action row → help text gap is ≥ 16 px", helpGap >= 16, `${helpGap.toFixed(1)} px`);
    // ── Bottom margin (#48): help text → the dialog's bottom edge ≈ our root → its left edge ──
    // Scrolled to the end; every ancestor's share of the bottom gap goes into the detail.
    const dialog = m.root.closest(".GenericModal");
    const scroller = m.root.closest(".spicetify-popup-content");
    const scrollBefore = scroller?.scrollTop ?? 0;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    const chain = [help];
    for (let el = help.parentElement; dialog && el && chain[chain.length - 1] !== dialog; el = el.parentElement) chain.push(el);
    const bottom = (el) => el.getBoundingClientRect().bottom;
    const bottomGap = dialog ? bottom(dialog) - bottom(help) : NaN;
    const sideGap = dialog ? m.root.getBoundingClientRect().left - dialog.getBoundingClientRect().left : NaN;
    const nameOf = (el) => (el === m.root ? "our root" : el.classList[0] ? `.${el.classList[0]}` : `<${el.tagName.toLowerCase()}>`);
    const shares = chain.slice(1).map((el, i) => {
      const cs = getComputedStyle(el);
      return `${nameOf(el)} ${(bottom(el) - bottom(chain[i])).toFixed(1)} (padding ${cs.paddingBottom}, border ${cs.borderBottomWidth}, ` +
        `${nameOf(chain[i])} margin ${getComputedStyle(chain[i]).marginBottom})`;
    });
    if (scroller) scroller.scrollTop = scrollBefore;
    check(48, "Space below the help text matches the sides (≤ 4 px), to the dialog's edges, scrolled to the end",
      Math.abs(bottomGap - sideGap) <= 4,
      dialog
        ? `bottom ${bottomGap.toFixed(1)} px, side ${sideGap.toFixed(1)} px; help line-height ${getComputedStyle(help).lineHeight}; ${shares.join(" · ")}`
        : "dialog (.GenericModal) not found");

    const cursor = rightClick(dots()[1]);
    const mr = m.menu.getBoundingClientRect();
    const near = (a, b) => Math.abs(a - b) < 1.5;
    const atCursor = (near(mr.left, cursor.x) || near(mr.right, cursor.x)) && (near(mr.top, cursor.y) || near(mr.bottom, cursor.y));
    check(33, "Right-click on a dot opens the menu inside the modal root, at the cursor", menuShown() && atCursor,
      `shown ${menuShown()}, menu ${Math.round(mr.left)},${Math.round(mr.top)}, cursor ${Math.round(cursor.x)},${Math.round(cursor.y)}`);
    const menuHidden = [m.duplicateItem, m.removeItem].filter((el) => !reachable(el, false));
    check(33, "Menu is visible on top: Duplicate and Remove are reachable (not clipped by the modal)", !menuHidden.length,
      menuHidden.map((el) => el.textContent).join(", ") || "both reachable");
    m.removeItem.click();
    await sleep(20);
    stillOpen("Remove in the dot menu");
    check(5, "Remove down to one stop → gradient off, switch off but enabled (#46), menu closed",
      settings.stops.length === 1 && !settings.gradient && m.switchButton.getAttribute("aria-checked") === "false" &&
        !m.switchButton.disabled && !menuShown(),
      `${settings.stops.length} stop(s), gradient ${settings.gradient}`);
    check(35, "Removing the selected (last) dot selects the new last one", selectionIs(settings.stops[0].id), selection());

    rightClick(dots()[0]);
    check(33, "One stop → Remove disabled, Duplicate enabled", m.removeItem.disabled && !m.duplicateItem.disabled,
      `remove disabled ${m.removeItem.disabled}, duplicate disabled ${m.duplicateItem.disabled}`);
    const original = { ...settings.stops[0] };
    m.duplicateItem.click();
    await sleep(20);
    stillOpen("Duplicate in the dot menu");
    check(33, "Duplicate from one stop → identical copy after it, gradient on",
      settings.stops.length === 2 && settings.gradient && settings.stops[1].kind === original.kind &&
        settings.stops[1].color === original.color && settings.stops[0].id === original.id,
      JSON.stringify(settings.stops));
    check(35, "Duplicate selects the copy", selectionIs(settings.stops[1]?.id), selection());

    setTestSettings(true, [theme("s1"), custom("s2", RED)]);
    rightClick(dots()[0]);
    m.duplicateItem.click();
    await sleep(20);
    stillOpen("duplicating a theme stop");
    check(33, "Duplicating a theme stop inserts a theme stop directly after it",
      settings.stops.map((s) => `${s.id}:${s.kind}`).join() === "s1:theme,s3:theme,s2:custom",
      settings.stops.map((s) => `${s.id}:${s.kind}`).join());

    dots()[0].focus();
    press(dots()[0], "F10", { shiftKey: true });
    const items = [m.duplicateItem, m.removeItem];
    const firstFocused = menuShown() && document.activeElement === items[0];
    press(document.activeElement, "ArrowDown");
    const secondFocused = document.activeElement === items[1];
    press(document.activeElement, "Escape");
    check(33, "Keyboard: Shift+F10 opens the menu, arrows move, Escape closes and refocuses the dot",
      firstFocused && secondFocused && !menuShown() && document.activeElement === dots()[0],
      `first ${firstFocused}, arrow ${secondFocused}, closed ${!menuShown()}, focus ${document.activeElement?.className}`);
    stillOpen("Escape in the dot menu");

    rightClick(dots()[0]);
    m.gradientRow.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    check(33, "A click elsewhere in the modal closes the menu", !menuShown(), "");
    stillOpen("clicking away from the dot menu");

    const lastBeforeAdd = { ...settings.stops[settings.stops.length - 1] };
    const plusNode = m.plusButton;
    click(plusNode);
    await sleep(20);
    stillOpen("the + button");
    const added = settings.stops[settings.stops.length - 1];
    check(35, "+ selects the new dot", selectionIs(added.id), selection());
    check(4, "New stop = a copy of the last stop (theme stays theme, #46)",
      added.id !== lastBeforeAdd.id && added.kind === lastBeforeAdd.kind && added.color === lastBeforeAdd.color,
      `${JSON.stringify(added)} after ${JSON.stringify(lastBeforeAdd)}`);
    const stepperMenus = [m.minusButton, plusNode].map((el) => (rightClick(el), menuShown()));
    closePopover();
    check(49, "The stepper isn't a dot: same nodes after adding, no dot menu on right-click",
      m.plusButton === plusNode && plusNode.isConnected && m.minusButton.isConnected && !stepperMenus.some(Boolean) &&
        !dots().includes(plusNode) && !dots().includes(m.minusButton),
      `connected ${plusNode.isConnected}/${m.minusButton.isConnected}, menu ${stepperMenus.join("/")}`);
    plusNode.focus();
    for (let i = 0; i < MAX_STOPS + 2 && !m.plusButton.disabled; i++) click(m.plusButton);
    await sleep(20);
    stillOpen("+ up to eight colours");
    check(4, "Add stops at 8, + disabled with the title 'Up to 8 colours'",
      settings.stops.length === MAX_STOPS && m.plusButton.disabled && m.plusButton.title === ADD_FULL_LABEL,
      `${settings.stops.length} stops, disabled ${m.plusButton.disabled}, title "${m.plusButton.title}"`);
    check(49, "+ disabled while focused → focus moves to the selected dot",
      document.activeElement === dotEl(selectedId), `focus ${document.activeElement?.dataset?.id ?? document.activeElement?.className}, selected ${selectedId}`);
    rightClick(dots()[0]);
    check(33, "Eight stops → Duplicate disabled", m.duplicateItem.disabled, `disabled ${m.duplicateItem.disabled}`);
    closePopover();

    // ── − removes the selected dot (#49): the dot menu's Remove, so the #35 rule applies ──
    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
    selectStop("s2");
    const minusNode = m.minusButton;
    const minusState = () =>
      `stops ${settings.stops.map((s) => s.id).join()}, gradient ${settings.gradient}, ${selection()}, ` +
      `− disabled ${minusNode.disabled} "${minusNode.title}", focus ${document.activeElement?.dataset?.id ?? document.activeElement?.className}`;
    minusNode.focus();
    click(minusNode);
    await sleep(20);
    const minusOpen = m.root.isConnected && modal === m;
    check(49, "− removes the selected dot; the one now in its place is selected; focus stays on −; modal open",
      minusOpen && settings.stops.map((s) => s.id).join() === "s1,s3" && selectionIs("s3") &&
        m.minusButton === minusNode && minusNode.isConnected && document.activeElement === minusNode,
      minusState());
    stillOpen("−");
    click(minusNode);
    await sleep(20);
    const lastOpen = m.root.isConnected && modal === m;
    check(49, "− down to one colour → gradient off, − disabled ('At least one colour'), focus moves to the selected dot",
      lastOpen && settings.stops.length === 1 && !settings.gradient && minusNode.disabled && minusNode.title === REMOVE_LAST_LABEL &&
        selectionIs(settings.stops[0].id) && document.activeElement === dotEl(selectedId),
      minusState());
    stillOpen("− down to one colour");

    // ── Selection (#35) ──
    const removeVia = async (el, after) => {
      rightClick(el);
      m.removeItem.click();
      await sleep(20);
      stillOpen(after);
    };
    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
    selectStop("s1");
    const rowNodes = dots();
    click(rowNodes[2]);
    check(35, "Clicking a dot moves the ring and loads its colour, without re-rendering the dots",
      selectionIs("s3") && m.hex.value === BLUE && dots().every((el, i) => el === rowNodes[i] && el.isConnected),
      selection());
    stillOpen("selecting a dot");
    rowNodes[1].focus();
    rowNodes[1].click(); // detail 0, like Enter/Space
    check(35, "Enter/Space on a dot selects it and moves focus to the hex field",
      selectionIs("s2") && document.activeElement === m.hex, `${selection()}, focus ${document.activeElement?.className}`);
    await removeVia(dots()[1], "removing the selected dot");
    check(35, "Removing the selected dot selects the one now in its place", selectionIs("s3"), selection());
    await removeVia(dots()[0], "removing an unselected dot");
    check(35, "Removing an unselected dot keeps the selection", selectionIs("s3"), selection());

    setTestSettings(false, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
    const opacities = [...m.stopsRow.querySelectorAll(".gpb-stop")].map((el) => getComputedStyle(el).opacity || "1");
    check(4, "Gradient off with 3 stops → stops 2–3 at 50 % opacity", opacities.join() === "1,0.5,0.5", opacities.join(", "));

    setTestSettings(true, [theme("s1"), custom("s2", RED)]);
    if (fill) {
      const preview = getComputedStyle(m.preview).backgroundImage;
      const bar = getComputedStyle(fill).backgroundImage;
      check(9, "Preview shows the same gradient as the bar", preview === bar, preview);
    }

    // ── Colour picker (#32, #35) ──
    // One animation frame, or 100 ms if frames are paused (minimised window).
    const frame = () => new Promise((r) => (requestAnimationFrame(() => r()), setTimeout(r, 100)));
    const pointer = (el, type, fx, fy) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true,
        button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1,
        clientX: r.left + r.width * fx, clientY: r.top + r.height * fy,
      }));
    };
    const themeDot = dots()[0];
    const rowBefore = dots();
    // In place: the dots row not re-rendered (same, connected nodes), the dot showing the colour,
    // the bar has it too, and the dot is still the selected one.
    const inPlace = (hex) =>
      dots().every((el, i) => el === rowBefore[i] && el.isConnected) && computedHex(themeDot, "backgroundColor") === hex &&
      styleText().includes(hex) && selectedId === themeDot.dataset.id;
    const state = () => `${JSON.stringify(settings.stops[0])}, dot ${computedHex(themeDot, "backgroundColor")}, selected ${selectedId}`;

    selectStop("s2");
    click(themeDot);
    check(32, "Clicking the theme dot shows it in the picker", selectionIs("s1"), selection());

    // Layout, then reachability with the theme stop shown (theme button disabled but present).
    const controls = m.picker.querySelector(".gpb-controls");
    const sr = m.sv.getBoundingClientRect();
    const cr = controls.getBoundingClientRect();
    const contentWidth = m.picker.getBoundingClientRect().width;
    const sideBySide = cr.left >= sr.right && Math.abs(cr.top - sr.top) < 1;
    check(35, `Picker columns side by side (needs ≥ ${PICKER_COLUMNS_MIN} px of content)`, sideBySide,
      `content ${Math.round(contentWidth)} px, ${sideBySide ? "side by side" : cr.top >= sr.bottom ? "stacked" : "overlapping"}`);
    const pickerControls = {
      "SV square": m.sv, "hue slider": m.hue, R: m.rgb[0], G: m.rgb[1], B: m.rgb[2], "hex field": m.hex, "hex copy button": m.hexCopy,
      "theme button": m.useThemeButton, ...(m.eyedropper ? { eyedropper: m.eyedropper } : {}),
    };
    const unreachable = Object.entries(pickerControls).filter(([, el]) => !reachable(el)).map(([name]) => name);
    check(35, "Every picker control is reachable (scrolled into view, its centre hit-tests to it)", !unreachable.length,
      unreachable.length ? `not reachable: ${unreachable.join(", ")}` : `${Object.keys(pickerControls).length} controls`);
    const hexLabel = m.root.querySelector(".gpb-hex-row > label");
    check(36, "Hex label reads 'HEX:'", hexLabel?.textContent === "HEX:", JSON.stringify(hexLabel?.textContent ?? null));
    const columnRect = controls.getBoundingClientRect();
    const hexRect = m.hexWrap.getBoundingClientRect(); // the field with its copy button (#56)
    check(36, "Hex field (with its copy button) is at most 55 % of the right column's width", hexRect.width <= 0.55 * columnRect.width,
      `field ${Math.round(hexRect.width)} px, column ${Math.round(columnRect.width)} px`);
    const leftGap = hexLabel.getBoundingClientRect().left - columnRect.left;
    const rightGap = columnRect.right - hexRect.right;
    check(36, "Hex row is centred in the right column (gaps differ by ≤ 2 px)", Math.abs(leftGap - rightGap) <= 2,
      `left gap ${leftGap.toFixed(1)} px, right gap ${rightGap.toFixed(1)} px`);
    check(32, "Theme stop → 'Following theme colour', disabled",
      m.useThemeButton.disabled && m.useThemeButton.textContent === "Following theme colour", m.useThemeButton.textContent);
    check(32, "Eyedropper shown exactly when window.EyeDropper exists", !!m.eyedropper === !!window.EyeDropper,
      `EyeDropper ${!!window.EyeDropper}, button ${!!m.eyedropper}`);

    rootStyle.setProperty("--spice-button", PROBE, "important");
    await tick(); // let the :root MutationObserver run
    const swatch = computedHex(themeDot, "backgroundColor");
    const pickerSeen = m.hex.value;
    restoreButton();
    await tick();
    check(11, "Picker: theme dot and picker follow a runtime --spice-button change", swatch === PROBE && pickerSeen === PROBE,
      `dot ${swatch}, picker ${pickerSeen}`);
    check(34, "Theme dots: no dashed ring, 'Theme colour' tooltip",
      getComputedStyle(themeDot).borderTopStyle !== "dashed" && themeDot.title.split("\n")[0] === "Theme colour",
      `border ${getComputedStyle(themeDot).borderTopStyle}, title "${themeDot.title}"`);

    pointer(m.sv, "pointerdown", 0.9, 0.1);
    pointer(m.sv, "pointermove", 0.5, 0.5);
    await frame();
    const svExpected = hsvToHex({ h: pickerHsv.h, s: 0.5, v: 0.5 });
    const svLive = settings.stops[0].color;
    pointer(m.sv, "pointerup", 0.5, 0.5);
    check(32, "Dragging in the square: theme stop → custom, live, dot updated in place, bar follows",
      settings.stops[0].kind === "custom" && svLive === svExpected && settings.stops[0].color === svExpected &&
        !themeDot.classList.contains("gpb-theme") && inPlace(svExpected),
      `expected ${svExpected}, live ${svLive}; ${state()}`);
    stillOpen("dragging in the picker's square");

    pointer(m.hue, "pointerdown", 1 / 3, 0.5);
    pointer(m.hue, "pointerup", 1 / 3, 0.5);
    check(32, "Dragging the hue bar to 120° → #408040 everywhere", settings.stops[0].color === "#408040" && inPlace("#408040") &&
      m.hex.value === "#408040" && m.rgb.map((f) => f.value).join() === "64,128,64", state());
    stillOpen("dragging the hue bar");

    [10, 20, 30].forEach((n, i) => (m.rgb[i].value = String(n)));
    m.rgb[2].dispatchEvent(new Event("input", { bubbles: true }));
    check(32, "R/G/B fields 10/20/30 → #0a141e everywhere", settings.stops[0].color === "#0a141e" && inPlace("#0a141e") &&
      m.hex.value === "#0a141e", state());
    m.rgb[0].value = "300";
    m.rgb[0].dispatchEvent(new Event("input", { bubbles: true }));
    check(32, "R/G/B: 300 is flagged and ignored", m.rgb[0].getAttribute("aria-invalid") === "true" &&
      settings.stops[0].color === "#0a141e", state());
    m.rgb[0].dispatchEvent(new Event("change", { bubbles: true }));

    const typeHex = (value) => {
      m.hex.value = value;
      m.hex.dispatchEvent(new Event("input", { bubbles: true }));
    };
    typeHex("ABCDEF");
    const afterPlain = settings.stops[0].color;
    typeHex("#0f0");
    check(32, "Hex field accepts rrggbb and #rgb, case-insensitive; dot, bar and R/G/B follow",
      afterPlain === "#abcdef" && settings.stops[0].color === "#00ff00" && inPlace("#00ff00") &&
        m.rgb.map((f) => f.value).join() === "0,255,0",
      `${afterPlain}; ${state()}`);
    typeHex("#zz12");
    check(32, "Invalid hex is flagged and ignored", m.hex.getAttribute("aria-invalid") === "true" && settings.stops[0].color === "#00ff00",
      `aria-invalid ${m.hex.getAttribute("aria-invalid")}, colour ${settings.stops[0].color}`);
    m.hex.dispatchEvent(new Event("change", { bubbles: true }));
    check(32, "Leaving the hex field restores the normalised value", m.hex.value === "#00ff00" && m.hex.getAttribute("aria-invalid") === "false",
      m.hex.value);
    stillOpen("editing R/G/B and hex");

    check(32, "Custom stop → 'Use theme colour' enabled", !m.useThemeButton.disabled && m.useThemeButton.textContent === "Use theme colour",
      m.useThemeButton.textContent);
    m.useThemeButton.click();
    await sleep(20);
    stillOpen("'Use theme colour'");
    check(32, "'Use theme colour' → theme stop, button shows 'Following theme colour', dot updated in place",
      settings.stops[0].kind === "theme" && !("color" in settings.stops[0]) && m.useThemeButton.disabled &&
        m.useThemeButton.textContent === "Following theme colour" && dots()[0] === themeDot && selectionIs("s1") &&
        styleText().includes(THEME_COLOUR),
      `${JSON.stringify(settings.stops[0])}, button "${m.useThemeButton.textContent}"`);

    rightClick(dots()[1]);
    check(35, "Right-click opens the menu without changing the selection", menuShown() && selectionIs("s1"), selection());
    closePopover();

    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
    selectStop("s3");
    const draggable = [...m.root.querySelectorAll('[draggable="true"]')];
    const stopEls = m.stopsRow.querySelectorAll(".gpb-stop");
    if (stopEls.length < 3) {
      check(8, "Drag-and-drop test setup", false, `${stopEls.length} stop element(s), expected 3`);
      return;
    }
    const dt = new DataTransfer();
    stopEls[0].dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const lastRect = stopEls[2].getBoundingClientRect();
    const at = { clientX: lastRect.right + 4, clientY: lastRect.top + lastRect.height / 2 };
    m.stopsRow.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
    const markerShown = !m.stopsRow.querySelector(".gpb-marker").hidden;
    m.stopsRow.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
    const order = settings.stops.map((s) => s.id).join();
    check(8, "Dragging stop 1 past the last stop moves it to the end",
      order === "s2,s3,s1" && markerShown, `order ${order}, marker shown ${markerShown}`);
    click(dots()[0]);
    check(8, "A click straight after a drag doesn't change the selection", selectionIs("s3"), selection());
    check(8, "Only the colour dots are draggable, never an input",
      draggable.length === 3 && draggable.every((el) => el.classList.contains("gpb-stop") && el.tagName === "BUTTON"),
      draggable.map((el) => `${el.tagName.toLowerCase()}.${el.className}`).join(", "));

    stillOpen("dragging a stop");

    // ── Keyboard reordering (#24): real keydown events on the dot nodes ──
    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
    selectStop("s2");
    const stopOrder = () => settings.stops.map((s) => s.id).join();
    // Stop order in the bar's gradient: each colour's first occurrence in the stylesheet.
    const barOrder = () => {
      const css = styleText();
      return settings.stops.map((s) => [s.id, css.indexOf(s.color)]).sort((a, b) => a[1] - b[1]).map(([id]) => id).join();
    };
    const altKey = (id, key) => press(dotEl(id), key, { altKey: true }); // false if the default was prevented
    const focusedOn = (id) => !!dotEl(id) && document.activeElement === dotEl(id);
    const kbState = () =>
      `order ${stopOrder()}, bar ${barOrder()}, focus ${document.activeElement?.dataset?.id ?? document.activeElement?.className ?? "none"}, ` +
      `${selection()}, announced "${m.announce.textContent}"`;
    const moved = (expected, position) =>
      stopOrder() === expected && barOrder() === expected && focusedOn("s1") && selectionIs("s2") &&
      m.announce.textContent === `Moved to position ${position} of 3`;
    const navState = () => `${location.href} ${window.Spicetify?.Platform?.History?.location?.pathname ?? ""}`;
    const navBefore = navState();

    dotEl("s1").focus();
    altKey("s1", "ArrowRight");
    check(24, "Alt+→ on the first of three moves it to position 2; the bar's gradient order follows",
      stopOrder() === "s2,s1,s3" && barOrder() === "s2,s1,s3", kbState());
    check(24, "After the move, focus is on the moved dot and the selection is unchanged",
      focusedOn("s1") && selectionIs("s2"), kbState());
    check(24, "The new position is announced in a polite live region and the aria-label",
      m.announce.textContent === "Moved to position 2 of 3" && m.announce.getAttribute("aria-live") === "polite" &&
        dotEl("s1").getAttribute("aria-label") === `Colour 2 of 3: ${RED}`,
      `announced "${m.announce.textContent}", aria-label "${dotEl("s1")?.getAttribute("aria-label")}"`);
    stillOpen("Alt+→ on a dot");
    altKey("s1", "End");
    check(24, "Alt+End moves it to last (focus kept, selection unchanged, announced)", moved("s2,s3,s1", 3), kbState());
    stillOpen("Alt+End on a dot");
    altKey("s1", "Home");
    check(24, "Alt+Home moves it back to first (focus kept, selection unchanged, announced)", moved("s1,s2,s3", 1), kbState());
    stillOpen("Alt+Home on a dot");

    const unmoved = dots();
    const leftKept = altKey("s1", "ArrowLeft");
    const rightKept = altKey("s3", "ArrowRight");
    check(24, "Alt+← on the first dot and Alt+→ on the last change nothing (the keys are still consumed)",
      stopOrder() === "s1,s2,s3" && dots().every((el, i) => el === unmoved[i]) && !leftKept && !rightKept,
      `${kbState()}, default prevented ${!leftKept}/${!rightKept}`);
    stillOpen("Alt+arrows at the edges");
    dotEl("s1").focus();
    const plainKept = press(dotEl("s1"), "ArrowRight");
    check(24, "Plain → without Alt doesn't reorder",
      stopOrder() === "s1,s2,s3" && dots().every((el, i) => el === unmoved[i]) && plainKept, kbState());
    check(24, "Every dot's tooltip includes 'Drag or Alt+←/→ to reorder'",
      dots().every((el) => el.title.endsWith(`\n${REORDER_HINT}`)), dots().map((el) => JSON.stringify(el.title)).join(", "));
    await sleep(50);
    check(24, "Alt+arrow keys on a dot don't navigate Spotify (Back/Forward)", navState() === navBefore,
      `before ${navBefore}, after ${navState()}`);

    // ── Delete / Backspace on a focused dot (#49): real keydown events on the dot nodes ──
    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
    selectStop("s1");
    dotEl("s2").focus();
    const deleteKept = press(dotEl("s2"), "Delete");
    await sleep(20);
    const deleteOpen = m.root.isConnected && modal === m;
    check(49, "Delete on a focused, unselected dot removes that dot and keeps the selection; focus on the dot now at its index; announced",
      deleteOpen && !deleteKept && stopOrder() === "s1,s3" && selectionIs("s1") && focusedOn("s3") &&
        m.announce.textContent === "Colour removed, 2 left",
      `${kbState()}, default prevented ${!deleteKept}`);
    stillOpen("Delete on a dot");
    selectStop("s3");
    dotEl("s3").focus();
    const backspaceKept = press(dotEl("s3"), "Backspace");
    await sleep(20);
    const backspaceOpen = m.root.isConnected && modal === m;
    check(49, "Backspace on the selected (last) dot removes it; the selection moves as with Remove; focus on the dot now at that index (clamped)",
      backspaceOpen && !backspaceKept && stopOrder() === "s1" && selectionIs("s1") && focusedOn("s1") && !settings.gradient &&
        m.announce.textContent === "Colour removed, 1 left",
      `${kbState()}, gradient ${settings.gradient}, default prevented ${!backspaceKept}`);
    stillOpen("Backspace on a dot");
    const lastKept = press(dotEl("s1"), "Delete");
    check(49, "Delete with one colour removes nothing, but the key is consumed", stopOrder() === "s1" && !lastKept,
      `${kbState()}, default prevented ${!lastKept}`);
    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN)]);
    selectStop("s2");
    m.hex.focus();
    const hexKept = press(m.hex, "Backspace");
    check(49, "Backspace in the hex field removes no dot (and isn't consumed)", stopOrder() === "s1,s2" && hexKept,
      `${kbState()}, default prevented ${!hexKept}`);
    await sleep(50);
    check(49, "Delete and Backspace on a dot don't navigate Spotify", navState() === navBefore, `before ${navBefore}, after ${navState()}`);

    // ── Two-step Reset (#37): real pointer/mouse sequences and keys on the same button node ──
    const realClick = (el) => {
      const r = el.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, composed: true, button: 0, detail: 1,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      const ptr = { pointerId: 1, pointerType: "mouse", isPrimary: true };
      el.dispatchEvent(new PointerEvent("pointerdown", { ...init, ...ptr, buttons: 1 }));
      el.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
      el.dispatchEvent(new PointerEvent("pointerup", { ...init, ...ptr, buttons: 0 }));
      el.dispatchEvent(new MouseEvent("mouseup", init));
      el.dispatchEvent(new MouseEvent("click", init));
    };

    // ── Hex copy button (#56) ──
    const copyRect = m.hexCopy.getBoundingClientRect();
    const wrapRect = m.hexWrap.getBoundingClientRect();
    const hexStyle = getComputedStyle(m.hex);
    const copySvg = m.hexCopy.querySelector("svg:not([hidden])");
    const focusables = [...m.root.querySelectorAll("button, input, [tabindex]")].filter((el) => el.tabIndex >= 0 && !el.disabled && !el.hidden);
    check(56, "The copy button sits inside the hex field's wrap at its right edge, about 24 × 24 px, with a 14 px icon; the text box ends before it; Tab order after the field",
      m.hexWrap.contains(m.hexCopy) && m.hexWrap.contains(m.hex) && Math.abs(wrapRect.right - copyRect.right) <= 4 &&
        copyRect.left >= wrapRect.left && Math.abs(copyRect.width - 24) <= 1 && Math.abs(copyRect.height - 24) <= 1 &&
        Math.abs((copyRect.top + copyRect.bottom) / 2 - (wrapRect.top + wrapRect.bottom) / 2) <= 1 &&
        parseFloat(hexStyle.paddingRight) >= copyRect.width && Math.abs(copySvg?.getBoundingClientRect().width - 14) <= 0.5 &&
        m.hexCopy.getAttribute("aria-label") === HEX_COPY_LABEL && m.hexCopy.title === HEX_COPY_LABEL && m.hexCopy.type === "button" &&
        focusables.indexOf(m.hexCopy) === focusables.indexOf(m.hex) + 1,
      `button ${copyRect.width.toFixed(1)}×${copyRect.height.toFixed(1)}, ${(wrapRect.right - copyRect.right).toFixed(1)} px from the right; ` +
        `padding-right ${hexStyle.paddingRight}; wrap ${wrapRect.width.toFixed(1)} px, field ${m.hex.getBoundingClientRect().width.toFixed(1)} px`);
    const hexCopyRules = [...(m.root.querySelector("style")?.sheet?.cssRules ?? [])].filter((r) => r.selectorText);
    const hexCopyHover = hexCopyRules.find((r) => /\.gpb-hex-copy:hover/.test(r.selectorText) && r.style.getPropertyValue("color").trim() === "var(--spice-text)");
    const subtextProbe = document.createElement("span"); // the same computed form as the button colour
    subtextProbe.style.color = "var(--spice-subtext)";
    m.hexWrap.append(subtextProbe);
    const subtextColour = getComputedStyle(subtextProbe).color;
    subtextProbe.remove();
    check(56, "The copy button is --spice-subtext at rest and --spice-text on hover (CSSOM), with a focus ring",
      !!hexCopyHover && getComputedStyle(m.hexCopy).color === subtextColour &&
        hexCopyRules.some((r) => /\.gpb-hex-copy:focus-visible/.test(r.selectorText) && /outline: 2px solid/.test(r.cssText)),
      `rest ${getComputedStyle(m.hexCopy).color} (subtext ${subtextColour}); ${hexCopyHover ? `"${hexCopyHover.cssText}"` : "no hover rule"}`);
    {
      const realSources = { ...clipboardSources };
      let copied = null;
      let failing = false;
      try {
        clipboardSources.api = () => ({ copy: async (text) => {
          if (failing) throw new Error("stub");
          copied = text;
        } });
        clipboardSources.clipboard = () => ({ writeText: async () => { throw new Error("stub"); } });
        clipboardSources.execCommand = () => !failing && false;
        const iconShows = (name) => (name === "check") === !m.hexCopyCheck.hasAttribute("hidden") && (name === "check") === m.hexCopyIcon.hasAttribute("hidden");
        const copyNode = m.hexCopy;
        setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), theme("s3")]);
        selectStop("s2");
        const before = JSON.stringify(settings);
        const dotNodes = dots();
        realClick(copyNode);
        await sleep(20);
        const unchanged = () => JSON.stringify(settings) === before && selectionIs("s2") && dots().every((el, i) => el === dotNodes[i]) &&
          dots().length === dotNodes.length && copyNode.isConnected;
        check(56, "A click copies the selected stop's #rrggbb, shows the check and announces 'Hex code copied'; settings, selection and dots unchanged",
          copied === GREEN && iconShows("check") && m.announce.textContent === "Hex code copied" && unchanged() && m.hex.value === GREEN,
          `copied ${copied}, icon ${iconShows("check") ? "check" : "copy"}, announced "${m.announce.textContent}"`);
        stillOpen("the hex copy button");
        await sleep(HEX_COPIED_MS + 200);
        check(56, `The copy icon is back after ${HEX_COPIED_MS / 1000} s`, iconShows("copy"), iconShows("copy") ? "copy icon" : "still the check");
        copied = null;
        selectStop("s3");
        realClick(copyNode);
        await sleep(20);
        const themeHex = resolveStop(theme("s3"));
        check(56, "On a theme stop it copies the resolved colour as #rrggbb, and the stop stays a theme stop",
          copied === themeHex && /^#[0-9a-f]{6}$/.test(copied ?? "") && findStop("s3")?.kind === "theme",
          `copied ${copied}, resolved ${themeHex}`);
        selectStop("s1");
        m.hex.focus({ preventScroll: true });
        m.hex.value = "#12";
        m.hex.dispatchEvent(new Event("input", { bubbles: true }));
        copied = null;
        const beforeInvalid = JSON.stringify(settings);
        realClick(copyNode);
        await sleep(20);
        check(56, "While the field holds invalid text, it copies the last valid colour; the field keeps its text and focus",
          copied === RED && m.hex.value === "#12" && document.activeElement === m.hex && JSON.stringify(settings) === beforeInvalid,
          `copied ${copied}, field "${m.hex.value}", focus .${document.activeElement?.className}`);
        m.hex.dispatchEvent(new Event("change", { bubbles: true }));
        failing = true;
        copyNode.focus({ preventScroll: true });
        await copyHex(m);
        check(56, "If every tier fails, the field's text is selected so Ctrl+C works",
          document.activeElement === m.hex && m.hex.selectionStart === 0 && m.hex.selectionEnd === m.hex.value.length && m.hex.value === RED,
          `focus .${document.activeElement?.className}, selected ${m.hex.selectionStart}–${m.hex.selectionEnd}`);
        stillOpen("the hex copy button");
      } finally {
        Object.assign(clipboardSources, realSources);
      }
    }

    const resetBtn = m.resetButton;
    const isArmed = () => resetBtn.classList.contains("gpb-armed") && m.resetLabel.textContent === RESET_CONFIRM_LABEL;
    const isIdle = () => !resetBtn.classList.contains("gpb-armed") && m.resetLabel.textContent === "Reset";
    const resetState = () => `label "${m.resetLabel.textContent}", armed class ${resetBtn.classList.contains("gpb-armed")}, ` +
      `stops ${settings.stops.map((s) => s.id).join()}`;

    const beforeReset = JSON.stringify(settings);
    const idleWidth = resetBtn.getBoundingClientRect().width;
    realClick(resetBtn);
    const armedWidth = resetBtn.getBoundingClientRect().width;
    check(37, "First click on Reset doesn't reset; label 'Confirm reset?' with the warning class",
      JSON.stringify(settings) === beforeReset && isArmed(), resetState());
    check(37, "Reset button keeps its width when armed (≤ 1 px)", Math.abs(armedWidth - idleWidth) <= 1,
      `Reset ${idleWidth.toFixed(1)} px, Confirm reset? ${armedWidth.toFixed(1)} px`);
    realClick(resetBtn);
    check(10, "Second click on Reset → defaults and an empty stylesheet",
      JSON.stringify(settings) === JSON.stringify(defaultSettings()) && styleText() === "", JSON.stringify(settings));
    stillOpen("Reset");
    check(35, "Reset selects the first dot", selectionIs(settings.stops[0].id), selection());
    check(37, "After resetting, the same button reads 'Reset' again",
      m.resetButton === resetBtn && resetBtn.isConnected && isIdle(), resetState());

    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN)]);
    selectStop("s1");
    const armedBase = JSON.stringify(settings);
    realClick(resetBtn);
    const armedAtStart = isArmed();
    await sleep(RESET_CONFIRM_MS + 200);
    check(37, `Armed Reset disarms after ${RESET_CONFIRM_MS / 1000} s without resetting`,
      armedAtStart && isIdle() && JSON.stringify(settings) === armedBase, resetState());

    realClick(resetBtn);
    press(resetBtn, "Escape");
    check(37, "Escape disarms Reset without resetting", isIdle() && JSON.stringify(settings) === armedBase, resetState());
    stillOpen("Escape on an armed Reset");

    realClick(resetBtn);
    realClick(dots()[1]);
    check(37, "Clicking a dot disarms Reset without resetting; the selection moves",
      isIdle() && JSON.stringify(settings) === armedBase && selectionIs("s2"), `${resetState()}; ${selection()}`);

    // ── Spread row (#15): real clicks and keys; the nodes are only ever updated in place ──
    const modeNodes = [...m.modeButtons];
    const modeBtn = (mode) => modeNodes[MODES.indexOf(mode)];
    const spreadState = () =>
      `mode ${settings.mode}, gradient ${settings.gradient}, ` +
      `checked ${modeNodes.filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.dataset.mode).join() || "none"}, ` +
      `tabindex ${modeNodes.map((b) => b.tabIndex).join()}, disabled ${modeNodes.map((b) => b.disabled).join()}, ` +
      `focus ${document.activeElement?.dataset?.mode ?? document.activeElement?.className}, hint "${m.spreadHint.textContent}"`;
    const spreadShows = (mode, enabled) =>
      settings.mode === mode && m.spread.isConnected &&
      [...m.modes.querySelectorAll(".gpb-mode")].every((b, i) => b === modeNodes[i] && b.isConnected) &&
      modeNodes.every((b) => {
        const on = b.dataset.mode === mode;
        return (b.getAttribute("aria-checked") === "true") === on && b.tabIndex === (on ? 0 : -1) && b.disabled === !enabled;
      }) &&
      m.spreadHint.textContent === (enabled ? SPREAD_HINTS[mode] : SPREAD_OFF_HINT);

    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
    const dotsBeforeMode = dots();
    realClick(modeBtn("anchored"));
    check(15, "Clicking Anchored applies it live (clip-path in the stylesheet), updates the row in place, dots not re-rendered",
      spreadShows("anchored", true) && styleText().includes("clip-path:") && dots().every((el, i) => el === dotsBeforeMode[i]),
      spreadState());
    stillOpen("choosing Anchored");
    // Hazy changes --spice-button at runtime; --spice-rgb-button stays stale (#40). The checked
    // button is filled with the live colour, its label in whichever of --spice-text and
    // --spice-main contrasts more (#43). A dark and a light probe exercise both labels.
    check(40, "No --spice-rgb-button in the modal CSS (Hazy leaves it stale)", !MODAL_CSS.includes("--spice-rgb-button"),
      MODAL_CSS.match(/[^\n]*--spice-rgb-button[^\n]*/)?.[0] ?? "not used");
    const fmt = (rgb) => (rgb ? `rgb(${rgb.slice(0, 3).map(Math.round).join(", ")}${rgb[3] < 1 ? ` / ${rgb[3]}` : ""})` : "unparsed");
    for (const probe of ["#123456", "#ffe680"]) {
      rootStyle.setProperty("--spice-button", probe, "important");
      await sleep(250); // the :root observer, then the button's background-color transition (.15 s)
      const button = modeBtn("anchored");
      const bg = parseRgb(getComputedStyle(button).backgroundColor);
      const label = parseRgb(getComputedStyle(button).color);
      const options = { "--spice-text": computedRgb(m.modes, "var(--spice-text)"), "--spice-main": computedRgb(m.modes, "var(--spice-main)") };
      const want = hexToRgb(probe);
      const [best, bestRgb] = Object.entries(options).sort(([, a], [, b]) => (b ? contrast(b, want) : 0) - (a ? contrast(a, want) : 0))[0];
      const same = (a, b) => !!(a && b) && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= 1);
      const ratio = label ? contrast(label, want) : 0;
      check(43, `Checked Spread button is filled with a runtime --spice-button (${probe}, opaque); its label uses the higher-contrast option, ≥ 4.5:1`,
        same(bg, want) && bg[3] === 1 && same(label, bestRgb) && label[3] === 1 && ratio >= 4.5,
        `background ${fmt(bg)}, label ${fmt(label)} (${ratio.toFixed(2)}:1), expected ${best} ${fmt(bestRgb)}; ` +
          Object.entries(options).map(([k, v]) => `${k} ${v ? contrast(v, want).toFixed(2) : "?"}:1`).join(", "));
    }
    restoreButton();
    await sleep(250);
    realClick(modeBtn("slide"));
    check(15, "Clicking Slide → Slide, hint updated in place", spreadShows("slide", true) && !styleText().includes("clip-path:"),
      spreadState());
    stillOpen("choosing Slide");
    await sleep(SAVE_DELAY + 100);
    const savedMode = JSON.parse(Spicetify.LocalStorage.get(STORAGE_KEY) ?? "{}").mode;
    check(15, "The chosen mode is saved", savedMode === "slide", `stored mode ${savedMode}`);

    realClick(modeBtn("compress"));
    modeBtn("compress").focus();
    const keySteps = [];
    for (const [key, expected] of [["ArrowRight", "anchored"], ["End", "slide"], ["Home", "compress"], ["ArrowLeft", "slide"]]) {
      press(document.activeElement, key);
      keySteps.push(`${key} → ${settings.mode}${settings.mode === expected && document.activeElement === modeBtn(expected) && spreadShows(expected, true) ? "" : ` (expected ${expected} focused)`}`);
    }
    const altKept = press(document.activeElement, "ArrowRight", { altKey: true });
    keySteps.push(`Alt+→ → ${settings.mode}${settings.mode === "slide" && altKept ? "" : " (expected no change)"}`);
    check(15, "Spread keyboard: →, End, Home and ← (wrapping) change the mode and move focus; Alt+→ doesn't",
      !keySteps.some((step) => step.includes("expected")), keySteps.join(", "));
    stillOpen("changing Spread with the keyboard");

    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN)], "anchored");
    const gradientSteps = [];
    const step = (label, enabled) => gradientSteps.push(`${label}: ${spreadShows("anchored", enabled) ? "ok" : `wrong (${spreadState()})`}`);
    realClick(m.switchButton);
    step("switch off", false);
    realClick(m.switchButton);
    step("switch on", true);
    rightClick(dots()[1]);
    m.removeItem.click();
    await sleep(20);
    step("remove to one colour", false);
    const disabledWithOne = spreadShows("anchored", false) && settings.stops.length === 1;
    realClick(m.plusButton);
    step("+", true);
    realClick(m.minusButton);
    await sleep(20);
    step("− to one colour", false);
    rightClick(dots()[0]);
    m.duplicateItem.click();
    await sleep(20);
    step("Duplicate", true);
    check(15, "Row disabled with one colour: buttons disabled, hint 'Applies when the gradient is on.'", disabledWithOne,
      gradientSteps[2]);
    check(15, "The Gradient switch, Remove, the stepper's + and − and Duplicate disable/enable the row in place (mode kept)",
      gradientSteps.every((s) => s.endsWith(": ok")), gradientSteps.join("; "));
    stillOpen("gradient changes with the Spread row");

    // ── Presets and share codes (#21) ──
    // Store first: pure functions on crafted raw values, counting [gpb] warnings per load.
    const gpbWarnings = (fn) => {
      const original = console.warn;
      let count = 0;
      console.warn = (...args) => (String(args[0]).startsWith("[gpb]") ? count++ : original(...args));
      try {
        return [fn(), count];
      } finally {
        console.warn = original;
      }
    };
    const presetsJson = (list) => JSON.stringify({ version: PRESETS_VERSION, presets: list });
    const own = (id, name, s) => ({ id, name, settings: s });
    const sampleA = { gradient: true, mode: "anchored", stops: [theme("s1"), custom("s2", RED)] };
    const sampleB = { gradient: false, mode: "slide", stops: [custom("s1", BLUE)] };
    const names = (list) => list.map((p) => p.name).join(", ");

    presets = [own("p1", "One", sampleA), own("p2", "Two", sampleB)];
    savePresets();
    const [reloadedPresets, reloadWarnings] = gpbWarnings(() => loadPresets());
    check(21, "Presets store: save → load round-trip in gpb:presets (theme and custom stops, gradient, mode); gpb:settings untouched",
      JSON.stringify(reloadedPresets) === JSON.stringify(presets) && !reloadWarnings &&
        JSON.parse(Spicetify.LocalStorage.get(PRESETS_KEY)).version === PRESETS_VERSION,
      `${names(reloadedPresets)}; ${reloadWarnings} warning(s); ${Spicetify.LocalStorage.get(PRESETS_KEY).length} characters`);
    const [kept, dropWarnings] = gpbWarnings(() => loadPresets(presetsJson([
      own("p1", "  Good  ", sampleA),
      own("p2", "Bad hex", { ...sampleA, stops: [custom("s1", "#12345")] }),
      own("p3", "   ", sampleB),
      own("p4", "x".repeat(PRESET_NAME_MAX + 1), sampleB),
      own("p5", "Bad mode", { ...sampleB, mode: "sideways" }),
      { id: "p6", name: "No settings" },
      own("p1", "Same id", sampleB),
      own("p7", "good", sampleB),
    ])));
    check(21, "Invalid presets are dropped with one [gpb] warning; names trimmed; a name clash gets ' (2)'",
      names(kept) === "Good, good (2)" && dropWarnings === 1, `kept ${names(kept)}; ${dropWarnings} warning(s)`);
    const corrupt = ["{nope", JSON.stringify({ version: 2, presets: [] }), JSON.stringify([1, 2]), JSON.stringify({ version: 1 })]
      .map((raw) => gpbWarnings(() => loadPresets(raw)));
    check(21, "A corrupt or unknown gpb:presets gives an empty list and one warning",
      corrupt.every(([list, warnings]) => list.length === 0 && warnings === 1),
      corrupt.map(([list, warnings]) => `${list.length} presets/${warnings} warning(s)`).join(", "));
    const [capped, capWarnings] = gpbWarnings(() =>
      loadPresets(presetsJson(Array.from({ length: MAX_PRESETS + 2 }, (_, i) => own(`p${i + 1}`, `Mine ${i + 1}`, sampleB))))
    );
    presets = [own("p1", "Mine", sampleB)];
    const clashes = [uniqueName("Mine"), uniqueName("fairy"), uniqueName(" Spaced "), uniqueName("y".repeat(30))];
    presets = [own("p1", "y".repeat(PRESET_NAME_MAX), sampleB)];
    const longClash = uniqueName("y".repeat(PRESET_NAME_MAX));
    check(21, `At most ${MAX_PRESETS} presets load; names are unique (built-ins included, any case), trimmed and ≤ ${PRESET_NAME_MAX} characters`,
      capped.length === MAX_PRESETS && capWarnings === 1 &&
        clashes.join("|") === `Mine (2)|fairy (2)|Spaced|${"y".repeat(PRESET_NAME_MAX)}` &&
        longClash.length === PRESET_NAME_MAX && longClash.endsWith(" (2)"),
      `${capped.length} loaded, ${capWarnings} warning(s); ${clashes.join(" | ")} | ${longClash}`);
    presets = [];
    savePresets();
    const builtInsBefore = BUILT_IN_PRESETS.map((p) => p.id).join();
    check(21, "Built-ins can't be deleted, renamed or updated",
      deletePreset("b:fairy") === null && !renamePreset("b:fairy", "Sea") && !updatePreset("b:fairy") &&
        BUILT_IN_PRESETS.map((p) => p.id).join() === builtInsBefore && BUILT_IN_PRESETS[4].name === "Fairy",
      builtInsBefore);
    // The maintainer's set (#53), as share codes: names, order and colours, all fixed.
    const expectedBuiltIns = [
      ["b:void", "Void", "gpb1:eyJnIjoxLCJtIjoiYyIsInMiOlsiODM3MmZkIiwiNWE4MmZmIiwiODM3MmZkIl19"],
      ["b:sunset", "Sunset", "gpb1:eyJnIjoxLCJtIjoiYyIsInMiOlsiNmUzM2ZmIiwiZmY1ZjZkIiwiZmZjMzcxIl19"],
      ["b:aurora", "Aurora", "gpb1:eyJnIjoxLCJtIjoiYyIsInMiOlsiMDBmNWEwIiwiMDBkOWY1IiwiN2Y1YWYwIl19"],
      ["b:neon", "Neon", "gpb1:eyJnIjoxLCJtIjoiYyIsInMiOlsiZmYwMGNjIiwiMzMzM2ZmIiwiMzNmN2ZmIl19"],
      ["b:fairy", "Fairy", "gpb1:eyJnIjoxLCJtIjoiYyIsInMiOlsiZmY1OWQxIiwiZmZiODAwIiwiNzdiYzAwIl19"],
    ];
    const builtInMismatches = expectedBuiltIns.filter(([id, name, code], i) => {
      const preset = BUILT_IN_PRESETS[i];
      const applied = preset && presetSettings(preset, { mode: "compress" });
      const decoded = decodeCode(code);
      return !preset || preset.id !== id || preset.name !== name || encodeCode(applied) !== code ||
        !decoded || !sameSettings(decoded, applied) || applied.stops.some((stop) => stop.kind !== "custom");
    }).map(([id]) => id);
    check(53, "The built-ins are exactly Void, Sunset, Aurora, Neon, Fairy (in order, fixed colours); each encodes to and decodes from its code",
      BUILT_IN_PRESETS.length === expectedBuiltIns.length && !builtInMismatches.length,
      builtInMismatches.length ? `mismatch: ${builtInMismatches.join(", ")}` : BUILT_IN_PRESETS.map((p) => `${p.name} ${p.colours.join("→")}`).join("; "));
    const [renamedOnLoad, renameWarnings] = gpbWarnings(() =>
      loadPresets(presetsJson([own("p3", "fairy", sampleB), own("p1", "Void", sampleA), own("p2", "Ocean", sampleB)]))
    );
    check(53, "Stored own presets whose names clash with a built-in are renamed on load (' (2)'), ids unchanged, no warning",
      names(renamedOnLoad) === "fairy (2), Void (2), Ocean" && renamedOnLoad.map((p) => p.id).join() === "p3,p1,p2" && !renameWarnings,
      `${names(renamedOnLoad)}; ids ${renamedOnLoad.map((p) => p.id).join()}; ${renameWarnings} warning(s)`);

    // Share codes: round-trip and rejection, all through validateSettings().
    const codeCases = MODES.flatMap((mode) => [true, false].map((gradient) =>
      ({ version: SCHEMA_VERSION, gradient, mode, stops: [theme("a"), custom("b", RED), custom("c", "#00ff7f")] })));
    const roundTrips = codeCases.map((s) => {
      const back = decodeCode(encodeCode(s));
      return !!back && sameSettings(back, s) && back.stops.map((stop) => stop.id).join() === "s1,s2,s3";
    });
    const threeColours = encodeCode({ version: SCHEMA_VERSION, gradient: true, mode: "compress", stops: [custom("a", RED), custom("b", GREEN), custom("c", BLUE)] });
    check(21, "Code round-trip: theme and custom stops, every mode, gradient on and off (ids s1…sN)",
      roundTrips.every(Boolean) && threeColours.startsWith(CODE_PREFIX),
      `${roundTrips.filter(Boolean).length}/${roundTrips.length}; three colours: ${threeColours} (${threeColours.length} characters)`);
    const rawCode = (data) => CODE_PREFIX + btoa(JSON.stringify(data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const validBody = threeColours.slice(CODE_PREFIX.length);
    const invalidCodes = {
      garbage: "garbage",
      empty: "",
      "wrong prefix": `gpb2:${validBody}`,
      "prefix only": CODE_PREFIX,
      "not base64": `${CODE_PREFIX}@@@`,
      "9 stops": rawCode({ g: 1, m: "c", s: Array(9).fill("ff0000") }),
      "bad hex": rawCode({ g: 1, m: "c", s: ["zzzzzz"] }),
      "short hex": rawCode({ g: 1, m: "c", s: ["fff"] }),
      "unknown mode": rawCode({ g: 1, m: "x", s: ["ff0000"] }),
      "no mode": rawCode({ g: 1, s: ["ff0000"] }),
      "g 2": rawCode({ g: 2, m: "c", s: ["ff0000"] }),
    };
    const accepted = Object.entries(invalidCodes).filter(([, code]) => decodeCode(code) !== null).map(([name]) => name);
    check(21, "Invalid codes are rejected: garbage, a wrong prefix, 9 stops, a bad hex and more", !accepted.length,
      accepted.length ? `accepted: ${accepted.join(", ")}` : `${Object.keys(invalidCodes).length} rejected`);
    check(21, "Whitespace around a code is accepted", !!decodeCode(`  \n${threeColours}\t `), "");


    // The Presets row in the open modal.
    renderChips(m);
    const chipIds = () => [...m.chips.querySelectorAll(".gpb-chip")].filter((el) => !el.hidden)
      .map((el) => (el === m.saveChip ? "save" : el.dataset.preset)).join();
    const chipOf = (id) => chipEl(id);
    const pressed = () => [...m.chips.querySelectorAll('.gpb-preset-chip[aria-pressed="true"]')].map((el) => el.dataset.preset).join() || "none";
    const undoState = () => `undo "${m.undoText.textContent}"${m.undoButton.hidden ? " (no button)" : " + Undo"}`;
    const undoShows = (message) => m.undoText.textContent === `${message} · ` && !m.undoButton.hidden &&
      m.undoLine.getAttribute("aria-live") === "polite";
    const presetsRect = m.presets.getBoundingClientRect();
    const toolsRect = m.presetsRow.querySelector(".gpb-presets-tools").getBoundingClientRect();
    const labelRect = m.presetsRow.querySelector(".gpb-label").getBoundingClientRect();
    const unreachableChips = [...m.chips.querySelectorAll(".gpb-chip"), m.exportButton, m.importButton].filter((el) => !reachable(el));
    check(21, "Presets row between Spread and the preview: label left, Export and Import right, every chip reachable",
      m.presets.previousElementSibling === m.spread && m.presets.nextElementSibling === m.preview &&
        Math.abs(labelRect.left - presetsRect.left) <= 1 && Math.abs(toolsRect.right - presetsRect.right) <= 1 && !unreachableChips.length,
      `after .${m.presets.previousElementSibling?.className}, before .${m.presets.nextElementSibling?.className}; ` +
        `tools ${(presetsRect.right - toolsRect.right).toFixed(1)} px from the right` +
        (unreachableChips.length ? `; not reachable: ${unreachableChips.map((el) => el.textContent).join(", ")}` : ""));
    // Export and Import look like buttons (#52): an outline, an icon, a bold label; hover read through CSSOM (#50).
    const shareButtons = [[m.exportButton, "Export", EXPORT_TITLE], [m.importButton, "Import", IMPORT_TITLE]];
    const shareProblems = shareButtons.flatMap(([el, label, title]) => {
      const cs = getComputedStyle(el);
      const border = parseRgb(cs.borderTopColor);
      const svg = el.querySelector("svg");
      const problems = [];
      if (!(parseFloat(cs.borderTopWidth) >= 1) || cs.borderTopStyle !== "solid" || !border || border[3] === 0) problems.push(`${label}: border ${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`);
      if (!svg || el.firstElementChild !== svg || Math.abs(svg.getBoundingClientRect().width - 14) > 0.5) problems.push(`${label}: icon ${svg ? svg.getBoundingClientRect().width.toFixed(1) + " px" : "missing"}`);
      const shown = el.querySelector(".gpb-share-label")?.textContent;
      if (shown !== label || el.title !== title) problems.push(`${label}: label "${shown}", title "${el.title}"`);
      if (parseInt(cs.fontWeight, 10) < 700 || cs.borderTopLeftRadius === "0px") problems.push(`${label}: weight ${cs.fontWeight}, radius ${cs.borderTopLeftRadius}`);
      return problems;
    });
    const copyCodeLeft = [...m.root.querySelectorAll("*")].filter((el) => el.childElementCount === 0 && /copy code/i.test(el.textContent));
    check(52, "Export and Import are outlined pills with a 14 px icon first, bold labels 'Export' / 'Import' and their titles; no 'Copy code' left",
      !shareProblems.length && !copyCodeLeft.length,
      [...shareProblems, ...copyCodeLeft.map((el) => `"Copy code" in .${el.className}`)].join("; ") || "both fine");
    const shareRules = [...(m.root.querySelector("style")?.sheet?.cssRules ?? [])].filter((r) => r.selectorText);
    const shareHover = shareRules.find((r) => r.selectorText.split(",").some((sel) => sel.trim() === ".gpb-button:hover:not(:disabled)") &&
      r.style.getPropertyValue("border-color").trim() === "var(--spice-text)");
    const shareOverride = shareRules.find((r) => /\.gpb-share-button/.test(r.selectorText) && /:hover/.test(r.selectorText));
    check(52, "Hover on Export / Import: the border → --spice-text, as for Reset (read through CSSOM)",
      !!shareHover && !shareOverride && m.exportButton.matches(".gpb-button") && m.importButton.matches(".gpb-button"),
      shareHover ? `"${shareHover.cssText}"` : "no .gpb-button:hover:not(:disabled) rule with border-color var(--spice-text)");
    const chipSwatch = chipOf("b:aurora")?.querySelector(".gpb-chip-swatch");
    const swatchRect = chipSwatch?.getBoundingClientRect();
    const swatchProbe = document.createElement("span"); // the same serialisation as the chip's inline style
    swatchProbe.style.backgroundImage = fillImage(presetSettings(BUILT_IN_PRESETS[2]));
    check(21, "Chips: the built-ins first, then own presets, + Save last; 12 px swatches painted with fillImage()",
      chipIds() === "b:void,b:sunset,b:aurora,b:neon,b:fairy,save" && swatchRect && Math.abs(swatchRect.width - 12) <= 0.5 &&
        Math.abs(swatchRect.height - 12) <= 0.5 && getComputedStyle(chipSwatch).borderRadius === "50%" &&
        chipSwatch.style.backgroundImage === swatchProbe.style.backgroundImage,
      `${chipIds()}; swatch ${swatchRect?.width.toFixed(1)}×${swatchRect?.height.toFixed(1)}, ${chipSwatch?.style.backgroundImage}`);
    // Two rows (#53): the built-ins alone, then own presets and + Save (always there).
    const rowIds = (row) => [...row.querySelectorAll(".gpb-chip")].filter((el) => !el.hidden)
      .map((el) => (el === m.saveChip ? "save" : el.dataset.preset)).join();
    const rowsSplit = (own) => rowIds(m.builtInRow) === BUILT_IN_PRESETS.map((p) => p.id).join() && rowIds(m.ownRow) === [...own, "save"].join() &&
      m.builtInRow.parentElement === m.chips && m.ownRow.parentElement === m.chips && m.builtInRow.nextElementSibling === m.ownRow;
    const rowGap = m.ownRow.getBoundingClientRect().top - m.builtInRow.getBoundingClientRect().bottom;
    check(53, "Row 1 holds only the built-ins; row 2 holds just + Save with no own presets; about 8 px between the rows",
      rowsSplit([]) && Math.abs(rowGap - 8) <= 1, `row 1 ${rowIds(m.builtInRow)}; row 2 ${rowIds(m.ownRow)}; gap ${rowGap.toFixed(1)} px`);

    // Two-step apply with a preview in the strip (#51): always two clicks, no timeout.
    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN)], "anchored");
    const notAPreset = JSON.stringify(settings);
    const cssBeforePreview = styleText();
    const stripProbe = document.createElement("span"); // the same serialisation as the strip's inline style
    const stripShows = (s) => {
      stripProbe.style.backgroundImage = fillImage(s);
      return m.preview.style.backgroundImage === stripProbe.style.backgroundImage;
    };
    const statusText = () => m.undoText.textContent;
    const previewMessage = (name) => `Previewing "${name}" — click it again to apply, Esc to cancel`;
    const untouched = () => JSON.stringify(settings) === notAPreset && styleText() === cssBeforePreview;
    const fairy = chipOf("b:fairy");
    const fairyLabel = () => fairy.querySelector(".gpb-chip-label").textContent;
    const idleChipWidth = fairy.getBoundingClientRect().width;
    const dotNodes = dots();
    const hexBefore = m.hex.value;
    realClick(fairy);
    const armedChipWidth = fairy.getBoundingClientRect().width;
    check(51, "First click on a chip arms it ('Apply?', width ±1 px) and previews it in the strip; settings, #gpb-style, dots and picker unchanged",
      fairy.classList.contains("gpb-armed") && fairyLabel() === APPLY_LABEL && Math.abs(armedChipWidth - idleChipWidth) <= 1 &&
        stripShows(presetSettings(BUILT_IN_PRESETS[4])) && untouched() &&
        dots().every((el, i) => el === dotNodes[i]) && dots().length === dotNodes.length && m.hex.value === hexBefore,
      `label "${fairyLabel()}", width ${idleChipWidth.toFixed(1)} → ${armedChipWidth.toFixed(1)} px; strip ${m.preview.style.backgroundImage}`);
    check(51, "While previewing, the status line (polite live region) reads 'Previewing \"Fairy\" — click it again to apply, Esc to cancel'",
      statusText() === previewMessage("Fairy") && m.undoButton.hidden && m.undoLine.getAttribute("aria-live") === "polite",
      `"${statusText()}"`);
    stillOpen("arming a preset chip");
    press(fairy, "Escape");
    check(51, "Escape disarms the chip: the strip shows the current settings again, the status line is empty, nothing applied",
      !fairy.classList.contains("gpb-armed") && fairyLabel() === "Fairy" && stripShows(settings) && !statusText() && untouched(),
      `label "${fairyLabel()}", status "${statusText()}"`);
    stillOpen("Escape on an armed chip");
    realClick(fairy);
    await sleep(RESET_CONFIRM_MS + 500);
    check(51, `No timeout while previewing: still armed and previewing after ${(RESET_CONFIRM_MS + 500) / 1000} s`,
      fairy.classList.contains("gpb-armed") && stripShows(presetSettings(BUILT_IN_PRESETS[4])) && statusText() === previewMessage("Fairy") && untouched(),
      `label "${fairyLabel()}", status "${statusText()}"`);
    const aurora = chipOf("b:aurora");
    realClick(aurora);
    check(51, "A click on another chip moves the arm and the preview to it in one click",
      !fairy.classList.contains("gpb-armed") && fairyLabel() === "Fairy" && aurora.classList.contains("gpb-armed") &&
        stripShows(presetSettings(BUILT_IN_PRESETS[2])) && statusText() === previewMessage("Aurora") && untouched(),
      `armed ${m.armed?.chip.dataset.preset}, status "${statusText()}"`);
    stillOpen("moving the arm to another chip");
    realClick(dots()[0]);
    check(51, "A click elsewhere disarms: the strip reverts, the status line clears, nothing applied",
      !aurora.classList.contains("gpb-armed") && !m.armed && stripShows(settings) && !statusText() && untouched(),
      `status "${statusText()}"`);
    stillOpen("a click outside an armed chip");
    selectStop("s2");
    realClick(fairy);
    realClick(fairy);
    const appliedOpen = m.root.isConnected && modal === m;
    check(21, "Second click applies Fairy: its colours, gradient on, the mode kept (Anchored), the first dot selected; same chip node",
      appliedOpen && sameSettings(settings, presetSettings(BUILT_IN_PRESETS[4])) && settings.mode === "anchored" &&
        selectionIs(settings.stops[0].id) && chipOf("b:fairy") === fairy && fairy.isConnected,
      `${settings.mode}, ${settings.stops.map((s) => s.color).join(", ")}; ${selection()}`);
    check(51, "After applying, the strip and #gpb-style show the applied settings",
      stripShows(settings) && styleText() === buildCss(settings) && !fairy.classList.contains("gpb-armed"), m.preview.style.backgroundImage);
    stillOpen("applying a preset");
    const buttonColour = computedRgb(m.root, "var(--spice-button)");
    const fairyBorder = parseRgb(getComputedStyle(fairy).borderTopColor);
    check(21, "The active chip is marked: aria-pressed on Fairy only, with a --spice-button border",
      pressed() === "b:fairy" && !!fairyBorder && !!buttonColour && fairyBorder.slice(0, 3).every((v, i) => Math.abs(v - buttonColour[i]) <= 1),
      `pressed ${pressed()}, border ${getComputedStyle(fairy).borderTopColor}`);
    check(21, "Undo line after applying: 'Applied \"Fairy\" · Undo' in a polite live region", undoShows('Applied "Fairy"'), undoState());
    const fairyApplied = JSON.stringify(settings);
    realClick(fairy);
    check(51, "A click on the active chip does nothing: not armed, nothing applied, the Undo kept",
      !fairy.classList.contains("gpb-armed") && !m.armed && JSON.stringify(settings) === fairyApplied && undoShows('Applied "Fairy"'),
      `armed ${!!m.armed}, ${undoState()}`);

    const sunset = chipOf("b:sunset");
    realClick(sunset);
    const sunsetPreview = statusText() === previewMessage("Sunset") && m.undoButton.hidden && JSON.stringify(settings) === fairyApplied;
    press(sunset, "Escape");
    check(51, "Two clicks even when the current settings are a preset; disarming shows the still-running Undo again",
      sunsetPreview && undoShows('Applied "Fairy"') && JSON.stringify(settings) === fairyApplied, `previewed ${sunsetPreview}; ${undoState()}`);
    realClick(sunset);
    realClick(sunset);
    const sunsetApplied = sameSettings(settings, presetSettings(BUILT_IN_PRESETS[1])) && pressed() === "b:sunset";
    const fairyState = presetSettings(BUILT_IN_PRESETS[4]);
    realClick(m.undoButton);
    check(21, "A new action replaces the pending undo: Undo goes back to Fairy, not further",
      sunsetApplied && sameSettings(settings, fairyState) && selectionIs(settings.stops[0].id) && m.undoButton.hidden && !m.undoText.textContent,
      `${settings.stops.map((s) => s.color).join(", ")}; ${undoState()}`);
    stillOpen("Undo after applying");

    setTestSettings(true, [theme("s1"), custom("s2", RED), custom("s3", GREEN)], "slide");
    selectStop("s3");
    const exact = JSON.stringify(settings);
    realClick(fairy);
    realClick(fairy);
    realClick(m.undoButton);
    check(21, "Undo after applying restores exactly the previous settings (ids included), the selection on the first dot",
      JSON.stringify(settings) === exact && selectedId === "s1" && selectionIs("s1"), `${JSON.stringify(settings)}; ${selection()}`);
    stillOpen("Undo after applying");
    setTestSettings(false, [theme("s1")]);
    realClick(chipOf("b:neon"));
    const neonArmed = chipOf("b:neon").classList.contains("gpb-armed") && sameSettings(settings, defaultSettings());
    realClick(chipOf("b:neon"));
    check(51, "Two clicks from the defaults too: the first only arms, the second applies Neon",
      neonArmed && sameSettings(settings, presetSettings(BUILT_IN_PRESETS[3])) && pressed() === "b:neon",
      `armed first ${neonArmed}, pressed ${pressed()}`);
    setStopColour(settings.stops[0].id, BLUE);
    check(21, "Editing the colours afterwards drops the pending undo, so it never throws away later edits",
      m.undoButton.hidden && !pendingUndo, undoState());
    realClick(chipOf("b:neon"));
    realClick(chipOf("b:neon"));
    await sleep(UNDO_MS + 200);
    check(21, `Undo expires after ${UNDO_MS / 1000} s`, m.undoButton.hidden && !m.undoText.textContent && !pendingUndo, undoState());

    // + Save, the inline name field, own presets.
    setTestSettings(true, [theme("s1"), custom("s2", RED)], "slide");
    const saveNode = m.saveChip;
    realClick(saveNode);
    const nameShown = !m.nameField.hidden && m.saveChip.hidden && document.activeElement === m.nameField && m.nameField.value === "Preset 1" &&
      m.nameField.tagName === "INPUT" && !m.nameField.closest(".gpb-popover") && saveNode.isConnected;
    check(21, "+ Save turns into an inline name field (not a popover), prefilled 'Preset 1' and focused",
      nameShown, `field hidden ${m.nameField.hidden}, value "${m.nameField.value}", focus .${document.activeElement?.className}`);
    stillOpen("+ Save");
    press(m.nameField, "Escape");
    check(21, "Escape in the name field cancels: nothing saved, + Save back and focused",
      !presets.length && m.nameField.hidden && !m.saveChip.hidden && document.activeElement === m.saveChip,
      `${presets.length} presets, focus .${document.activeElement?.className}`);
    stillOpen("Escape in the name field");
    realClick(m.saveChip);
    m.nameField.value = "  Mine  ";
    press(m.nameField, "Enter");
    await tick();
    await tick();
    const mineId = presets[0]?.id;
    const mineChip = mineId && chipOf(mineId);
    const storedPresets = JSON.parse(Spicetify.LocalStorage.get(PRESETS_KEY) ?? "{}").presets ?? [];
    check(21, "Enter saves the current settings as 'Mine' (stored), its chip appears after the built-ins, active and focused",
      presets.length === 1 && presets[0].name === "Mine" && sameSettings(presetSettings(presets[0]), settings) &&
        storedPresets[0]?.name === "Mine" && chipIds() === `b:void,b:sunset,b:aurora,b:neon,b:fairy,${mineId},save` &&
        mineChip?.getAttribute("aria-pressed") === "true" && document.activeElement === mineChip && m.saveChip === saveNode,
      `${chipIds()}; pressed ${pressed()}; focus ${document.activeElement?.dataset?.preset ?? document.activeElement?.className}`);
    stillOpen("saving a preset");
    check(53, "With an own preset, row 1 still holds only the built-ins and row 2 holds the own chip, then + Save",
      rowsSplit([mineId]), `row 1 ${rowIds(m.builtInRow)}; row 2 ${rowIds(m.ownRow)}`);

    setTestSettings(true, [custom("s1", GREEN), custom("s2", BLUE)], "compress");
    realClick(chipOf(mineId));
    realClick(chipOf(mineId));
    check(21, "An own preset restores everything: gradient, mode (Slide) and stops, theme stops stay theme",
      sameSettings(settings, { gradient: true, mode: "slide", stops: [theme("x"), custom("y", RED)] }), JSON.stringify(settings));
    stillOpen("applying an own preset");

    rightClick(chipOf("b:fairy"));
    const builtInMenu = menuShown();
    closePopover();
    rightClick(chipOf(mineId));
    const shownItems = [...m.menu.querySelectorAll(".gpb-menu-item")].filter((el) => !el.hidden).map((el) => el.textContent);
    check(21, "Right-click on an own chip opens the existing menu inside the modal root: Rename, Update to current colours, Delete; built-ins have none",
      !builtInMenu && menuShown() && m.root.contains(m.menu) && popover?.anchor === chipOf(mineId) &&
        shownItems.join() === "Rename,Update to current colours,Delete" && m.menu.getAttribute("aria-label") === "Preset actions",
      `built-in menu ${builtInMenu}; items ${shownItems.join(", ")}`);
    const renameNode = m.renameItem;
    realClick(renameNode);
    const renaming = !m.nameField.hidden && m.nameField.value === "Mine" && chipOf(mineId)?.hidden &&
      m.nameField.nextElementSibling === chipOf(mineId) && renameNode.isConnected && !menuShown();
    m.nameField.value = "Fairy";
    press(m.nameField, "Enter");
    await tick();
    await tick();
    check(21, "Rename: an inline field in the chip's place; a clash with a built-in gets ' (2)'; the menu item stays connected",
      renaming && presets[0].name === "Fairy (2)" && chipOf(mineId)?.textContent.includes("Fairy (2)") && !chipOf(mineId)?.hidden,
      `field shown in place ${renaming}; name "${presets[0].name}"`);
    stillOpen("renaming a preset");
    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)], "compress");
    rightClick(chipOf(mineId));
    realClick(m.updatePresetItem);
    await tick();
    await tick();
    check(21, "Update to current colours stores the current settings in the preset; its chip turns active",
      sameSettings(presetSettings(presets[0]), settings) && chipOf(mineId)?.getAttribute("aria-pressed") === "true",
      `pressed ${pressed()}`);
    stillOpen("updating a preset");

    chipOf(mineId).focus();
    press(chipOf(mineId), "F10", { shiftKey: true });
    const keyboardMenu = menuShown() && document.activeElement === m.renameItem;
    press(document.activeElement, "Escape");
    check(21, "Keyboard: Shift+F10 on an own chip opens the menu on Rename; Escape closes it and refocuses the chip",
      keyboardMenu && !menuShown() && document.activeElement === chipOf(mineId),
      `menu ${keyboardMenu}, focus ${document.activeElement?.dataset?.preset ?? document.activeElement?.className}`);
    stillOpen("Escape in the chip menu");

    addPreset("Second");
    renderChips(m);
    const beforeDelete = JSON.stringify(presets);
    rightClick(chipOf(mineId));
    const deleteNode = m.deletePresetItem;
    realClick(deleteNode);
    await tick();
    await tick();
    check(21, "Delete removes the preset at once (storage too); 'Deleted \"Fairy (2)\" · Undo'; the menu item stays connected",
      presets.length === 1 && !chipOf(mineId) && !Spicetify.LocalStorage.get(PRESETS_KEY).includes('"Fairy (2)"') &&
        undoShows('Deleted "Fairy (2)"') && deleteNode.isConnected,
      `${names(presets)}; ${undoState()}`);
    stillOpen("deleting a preset");
    realClick(m.undoButton);
    await tick();
    await tick();
    check(21, "Undo after Delete restores the preset in its old place, in storage too",
      JSON.stringify(presets) === beforeDelete && Spicetify.LocalStorage.get(PRESETS_KEY) === presetsJson(JSON.parse(beforeDelete)) &&
        chipIds().startsWith(`b:void,b:sunset,b:aurora,b:neon,b:fairy,${mineId},`),
      `${names(presets)}; ${chipIds()}`);
    stillOpen("Undo after deleting");

    while (presets.length < MAX_PRESETS) addPreset("Fill");
    renderChips(m);
    check(21, `+ Save is disabled at ${MAX_PRESETS} presets with the title 'Up to ${MAX_PRESETS} presets'; a ${MAX_PRESETS + 1}th isn't added`,
      m.saveChip.disabled && m.saveChip.title === SAVE_FULL_LABEL && addPreset("One more") === null && presets.length === MAX_PRESETS,
      `${presets.length} presets, disabled ${m.saveChip.disabled}, title "${m.saveChip.title}"`);
    presets = [];
    savePresets();
    renderChips(m);

    // Import: an inline paste field; nothing changes on an invalid code.
    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN)], "anchored");
    const beforeImport = JSON.stringify(settings);
    realClick(m.importButton);
    const importOpen = !m.importPanel.hidden && m.importButton.getAttribute("aria-expanded") === "true" && document.activeElement === m.codeInput;
    m.codeInput.value = "gpb1:not-a-code";
    const applyNode = m.importApply;
    realClick(applyNode);
    check(21, "Import: an invalid code is flagged (aria-invalid, 'Not a valid code') and changes nothing",
      importOpen && m.codeInput.getAttribute("aria-invalid") === "true" && m.importError.textContent === IMPORT_ERROR &&
        JSON.stringify(settings) === beforeImport,
      `panel open ${importOpen}, aria-invalid ${m.codeInput.getAttribute("aria-invalid")}, error "${m.importError.textContent}"`);
    stillOpen("an invalid import");
    const codeSample = { version: SCHEMA_VERSION, gradient: true, mode: "slide", stops: [theme("x"), custom("y", BLUE)] };
    const cssBeforeImport = styleText();
    const typeCode = (value) => {
      m.codeInput.value = value;
      m.codeInput.dispatchEvent(new Event("input", { bubbles: true }));
    };
    typeCode(`  ${encodeCode(codeSample)}  `);
    const errorCleared = !m.codeInput.hasAttribute("aria-invalid") && !m.importError.textContent;
    check(51, "A valid code in the Import field previews in the strip ('Previewing code — Apply to use it'); settings and #gpb-style unchanged",
      errorCleared && stripShows(codeSample) && statusText() === PREVIEW_CODE_MESSAGE && JSON.stringify(settings) === beforeImport &&
        styleText() === cssBeforeImport, `status "${statusText()}"`);
    typeCode("");
    const clearedReverts = stripShows(settings) && !statusText();
    typeCode(encodeCode(codeSample));
    press(m.codeInput, "Escape");
    check(51, "Clearing the field or Escape (field closed) reverts the strip and the status line",
      clearedReverts && m.importPanel.hidden && stripShows(settings) && !statusText() && JSON.stringify(settings) === beforeImport,
      `cleared reverts ${clearedReverts}; panel hidden ${m.importPanel.hidden}, status "${statusText()}"`);
    stillOpen("previewing a code");
    realClick(m.importButton);
    typeCode(`  ${encodeCode(codeSample)}  `);
    realClick(applyNode);
    check(21, "Import: a valid code applies at once (no arming), the field closes, 'Imported code · Undo'; Apply stays connected",
      errorCleared && sameSettings(settings, codeSample) && m.importPanel.hidden && undoShows("Imported code") && applyNode.isConnected,
      `${JSON.stringify(settings)}; ${undoState()}`);
    stillOpen("importing a code");
    realClick(m.undoButton);
    check(21, "Undo after Import restores exactly", JSON.stringify(settings) === beforeImport, JSON.stringify(settings));
    stillOpen("Undo after importing");

    // Export (#54): writeClipboard()'s tiers in order with stubbed sources, then the real ones.
    const realSources = { ...clipboardSources };
    const exportWidth = () => m.exportButton.getBoundingClientRect().width;
    const idleExportWidth = exportWidth();
    const exportState = () => `"${m.exportLabel.textContent}", ${m.exportCheck.hasAttribute("hidden") ? "export" : "check"} icon, ${exportWidth().toFixed(1)} px`;
    const showsCopied = () => m.exportLabel.textContent === COPIED_LABEL && m.exportIcon.hasAttribute("hidden") && !m.exportCheck.hasAttribute("hidden") &&
      Math.abs(exportWidth() - idleExportWidth) <= 1;
    const showsExport = () => m.exportLabel.textContent === EXPORT_LABEL && !m.exportIcon.hasAttribute("hidden") && m.exportCheck.hasAttribute("hidden");
    let captured = null;
    let bufferSeen = "";
    const tierLog = [];
    const stubClipboard = ({ api, write, exec }) => { // each "ok", "fail" or undefined (not there)
      tierLog.length = 0;
      captured = null;
      bufferSeen = "";
      clipboardSources.api = () => api && { copy: async (text) => {
        tierLog.push("ClipboardAPI");
        if (api !== "ok") throw new Error("stub");
        captured = text;
      } };
      clipboardSources.clipboard = () => write && { writeText: async (text) => {
        tierLog.push("writeText");
        if (write !== "ok") throw new Error("stub");
        captured = text;
      } };
      clipboardSources.execCommand = (command) => {
        tierLog.push("execCommand");
        const buffer = document.activeElement;
        bufferSeen = buffer?.classList.contains("gpb-copy-buffer") && m.root.contains(buffer) &&
          buffer.selectionStart === 0 && buffer.selectionEnd === buffer.value.length ? "in the modal root, selected" : "not found";
        if (exec !== "ok" || command !== "copy") return false;
        captured = buffer?.value ?? null;
        return true;
      };
    };
    try {
      const code = encodeCode(settings);
      stubClipboard({ api: "ok", write: "ok", exec: "ok" });
      const viaApi = await copyCode(m);
      check(54, "Export uses Spicetify's ClipboardAPI first; the button itself reads 'Copied' with the check icon, width ±1 px; 'Share code copied' announced",
        viaApi === "ClipboardAPI" && tierLog.join() === "ClipboardAPI" && captured === code && showsCopied() &&
          m.announce.textContent === "Share code copied" && m.codeFallback.hidden,
        `tiers ${tierLog.join(" → ")}; ${exportState()} (was ${idleExportWidth.toFixed(1)} px); announced "${m.announce.textContent}"`);
      await sleep(COPIED_MS + 200);
      check(54, `The button reads 'Export' with its icon again after ${COPIED_MS / 1000} s`, showsExport(), exportState());
      stubClipboard({ write: "ok", exec: "ok" });
      const viaWrite = await copyCode(m);
      check(54, "Without ClipboardAPI, navigator.clipboard.writeText is used", viaWrite === "writeText" && tierLog.join() === "writeText" &&
        captured === code && showsCopied(), `tiers ${tierLog.join(" → ")}; ${exportState()}`);
      stubClipboard({ api: "fail", write: "fail", exec: "ok" });
      m.exportButton.focus({ preventScroll: true });
      const viaExec = await copyCode(m);
      check(54, "When both fail, execCommand('copy') copies from a hidden, selected textarea inside the modal root, which is removed again; focus returns",
        viaExec === "execCommand" && tierLog.join() === "ClipboardAPI,writeText,execCommand" && captured === code &&
          bufferSeen === "in the modal root, selected" && !document.querySelector(".gpb-copy-buffer") &&
          document.activeElement === m.exportButton && showsCopied(),
        `tiers ${tierLog.join(" → ")}; buffer ${bufferSeen}; focus .${document.activeElement?.className}`);
      stubClipboard({ api: "fail", write: "fail", exec: "fail" });
      const copyNode = m.exportButton;
      realClick(copyNode);
      await sleep(50);
      const out = m.codeOutput;
      check(54, "When all three fail, the code shows in a read-only field, selected, with the hint; the button reads 'Export'",
        tierLog.join() === "ClipboardAPI,writeText,execCommand" && !m.codeFallback.hidden && out.readOnly && out.value === code &&
          document.activeElement === out && out.selectionStart === 0 && out.selectionEnd === out.value.length &&
          m.codeFallback.querySelector(".gpb-code-hint")?.textContent === COPY_HINT && copyNode.isConnected && showsExport(),
        `tiers ${tierLog.join(" → ")}; shown ${!m.codeFallback.hidden}, selected ${out.selectionStart}–${out.selectionEnd}, hint "${m.codeFallback.querySelector(".gpb-code-hint")?.textContent}"`);
      stillOpen("Export");
    } finally {
      Object.assign(clipboardSources, realSources);
    }
    m.codeFallback.hidden = true;
    const realTier = await copyCode(m);
    check(54, "Export with the real clipboard: the code reaches it through one of the tiers, without the fallback field",
      !!realTier && m.codeFallback.hidden, realTier ? `via ${realTier}` : "every tier failed; fallback field shown");
    m.codeFallback.hidden = true;
        stillOpen("the Presets row");

    realClick(resetBtn);
    realClick(resetBtn);
    check(15, "Reset → Compress (row updated in place, disabled with one colour)", spreadShows("compress", false), spreadState());
    stillOpen("Reset from Anchored");
    const base = JSON.parse(armedBase); // back to the Reset checks' settings for the close-and-reopen check
    setTestSettings(base.gradient, base.stops, base.mode);

    realClick(resetBtn);
    const oldLabel = m.resetLabel;
    Spicetify.PopupModal.hide();
    await tick(); // the close observer runs the clean-ups
    openModal();
    m = modal;
    check(37, "Arm, close and reopen → the button reads 'Reset' (timer cleared)",
      !!m && m.resetLabel.textContent === "Reset" && !m.resetButton.classList.contains("gpb-armed") &&
        oldLabel.textContent === "Reset" && JSON.stringify(settings) === armedBase,
      `new "${m?.resetLabel.textContent}", old "${oldLabel.textContent}"`);
    if (!m) return;

    const listenersOpen = songchangeCount();
    const observersOpen = liveObservers;
    Spicetify.PopupModal.hide();
    await tick();
    check(7, "songchange listener: +1 while open, removed on close",
      listenersOpen === listenersBefore + 1 && songchangeCount() === listenersBefore,
      `${listenersBefore} → ${listenersOpen} → ${songchangeCount()}`);
    check(7, "Modal observers disconnected on close", observersOpen > 0 && liveObservers === 0 && modal === null,
      `${observersOpen} → ${liveObservers}`);
    check(11, "Nothing of ours left in the page after close (Hazy Settings can open cleanly)",
      !document.querySelector(".gpb-modal, .gpb-stop, .gpb-switch"), "");
    // Another extension's popup is rebuilt by display(), so our inline padding fix is gone (#48).
    Spicetify.PopupModal.display({ title: "gpb self-test", content: document.createElement("p") });
    const otherPopup = [".spicetify-popup-container", ".spicetify-popup-content"]
      .map((sel) => Spicetify.PopupModal.querySelector(sel)?.getAttribute("style") ?? null);
    Spicetify.PopupModal.hide();
    check(48, "The next popup (another extension's) has none of our inline padding",
      otherPopup.every((style) => !style), `container style "${otherPopup[0] ?? ""}", content style "${otherPopup[1] ?? ""}"`);

    // ── Persistence ──
    const invalid = {
      "corrupt JSON": "{broken",
      "bad hex": JSON.stringify({ version: 1, gradient: false, stops: [{ id: "s1", kind: "custom", color: "red" }] }),
      "unknown version": JSON.stringify({ version: 99, gradient: false, stops: [theme("s1")] }),
      "9 stops": JSON.stringify({ version: 1, gradient: true, stops: Array.from({ length: 9 }, (_, i) => theme(`s${i}`)) }),
      "unknown mode": JSON.stringify({ version: 1, gradient: true, mode: "zoom", stops: [theme("s1"), theme("s2")] }),
    };
    // loadSettings() with console.warn captured; returns the result and the number of [gpb] warnings.
    const loadQuietly = (raw) => {
      const warnings = [];
      const warn = console.warn;
      console.warn = (...args) => warnings.push(args.join(" "));
      try {
        return { loaded: loadSettings(raw), ours: warnings.filter((w) => w.startsWith("[gpb]")).length };
      } finally {
        console.warn = warn;
      }
    };
    for (const [label, raw] of Object.entries(invalid)) {
      const { loaded, ours } = loadQuietly(raw);
      check(label === "unknown mode" ? 15 : 2, `Invalid stored settings (${label}) → defaults + exactly one [gpb] warning`,
        JSON.stringify(loaded) === JSON.stringify(defaultSettings()) && ours === 1, `${ours} warning(s)`);
    }
    const legacy = loadQuietly(JSON.stringify({ version: 1, gradient: true, stops: [theme("s1"), custom("s2", RED)] }));
    check(15, "Stored settings without mode (before v1.2.0) → Compress, no warning",
      legacy.loaded.mode === "compress" && legacy.loaded.gradient && legacy.loaded.stops.length === 2 && legacy.ours === 0,
      `${JSON.stringify(legacy.loaded)}, ${legacy.ours} warning(s)`);

    setTestSettings(true, [theme("s1"), custom("s2", RED), custom("s4", BLUE)], "anchored");
    const writtenAtOnce = Spicetify.LocalStorage.get(STORAGE_KEY) === JSON.stringify(settings);
    await new Promise((r) => setTimeout(r, SAVE_DELAY + 100));
    const reloaded = loadSettings();
    check(2, "Saves are debounced, then a load returns identical settings (mode included)",
      !writtenAtOnce && JSON.stringify(reloaded) === JSON.stringify(settings) && reloaded.mode === "anchored",
      `written at once ${writtenAtOnce}, reloaded mode ${reloaded.mode}`);
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────────

  // Compact outline of the song bar's DOM — enough to fix selectors after a Spotify update
  // without another round trip.
  function outline(el, depth = 0) {
    if (!el || depth > 7) return [];
    const testid = el.dataset?.testid ? `[data-testid="${el.dataset.testid}"]` : "";
    const cls = [...(el.classList ?? [])].map((c) => `.${c}`).join("");
    const line = `${"  ".repeat(depth)}${el.tagName.toLowerCase()}${testid}${cls}`;
    return [line, ...[...el.children].flatMap((c) => outline(c, depth + 1))];
  }

  function domProbe() {
    const all = (sel) => document.querySelectorAll(sel).length;
    const wrapper =
      document.querySelector(SCOPE) ??
      document.querySelector('[data-testid="progress-bar"]')?.closest('[class*="playback"], [data-testid]')?.parentElement;
    return {
      scope: all(SCOPE),
      fill: all(`${SCOPE} ${FILL}`),
      handle: all(`${SCOPE} ${HANDLE}`),
      progressBars: all(".progress-bar, [data-testid='progress-bar']"),
      fillsAnywhere: all(FILL),
      songBarOutline: outline(wrapper).join("\n") || "no progress bar found",
    };
  }

  function statusReport() {
    const report = {
      version: VERSION,
      phase: startup.phase,
      waitingFor: startup.waitingFor,
      entry: startup.entry,
      entryErrors: startup.entryErrors,
      error: startup.error,
      spotify: window.Spicetify?.Platform?.version ?? null,
      spicetify: spicetifyVersion(), // #55
      apis: Object.fromEntries(["LocalStorage", "PopupModal", "Player", "Menu", "Topbar", "ReactJSX"].map((n) => [n, !!api(n)])),
      menu: { registered: menuRegistered, menuItemUsable: menuItemUsable() },
      topbar: { created: !!shared?.button, connected: !!shared?.button?.element?.isConnected },
      shared: shared?.status() ?? null, // #58
      page: location.href,
      dom: domProbe(),
    };
    console.log(`[gpb] ${report.phase}${report.entry ? `, entry: ${report.entry}` : ""}`);
    return report;
  }

  // ── Start-up ────────────────────────────────────────────────────────────────

  const ENTRY_LABEL = "Gradient progress bar";
  // A brush over a progress bar (#44). Monochrome (currentColor follows the theme and hover),
  // 16 × 16, no <defs> and no ids: ids in inline SVG are document-global. Used as-is by the top
  // bar (the button's innerHTML) and the profile menu (nested inside Spotify's IconComponent,
  // the way Spicetify renders its own named icons).
  const ENTRY_ICON =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M14.6 1.4a1.3 1.3 0 0 0-1.85 0L7.6 6.55l1.85 1.85 5.15-5.15a1.3 1.3 0 0 0 0-1.85zM6.7 7.5c-1.3 0-2.2 1-2.2 2.3 0 .5-.3.9-.9 1.1 1.5.9 4.3.7 4.9-1.3.1-.4.1-.7 0-1z"/><rect x="0.5" y="12.5" width="15" height="2.5" rx="1.25" opacity=".35"/><rect x="0.5" y="12.5" width="9" height="2.5" rx="1.25"/></svg>';

  // ── Shared entry (protocol 1) — keep identical in GCB and GPB ──
  // Gradient Connect Bar and Gradient Progress Bar share one top-bar button. Whichever starts
  // first creates window.__gradientBars (it's the owner) and the only button; the other registers
  // its entry. One entry: the button opens it directly. Two: a small menu with both. Each
  // extension keeps its own right-click and profile-menu entries; the only call across is
  // entries[i].open. This block depends on nothing but SELF, ENTRY_ICON and window.Spicetify.
  // joinGradientBars() takes overrides for a separate test instance (key, prefix, createButton);
  // the live registry uses the defaults.
  const SELF = { id: "gpb", name: "Gradient Progress Bar", open: openModal };

  function joinGradientBars({ self = SELF, key = "__gradientBars", prefix = "gradient-bars", createButton = null } = {}) {
    const PROTOCOL = 1;
    const MULTI_LABEL = "Gradient bars";
    const GAP = 8; // menu below the button, and its distance from the window edges
    const makeButton = createButton ?? ((label, icon, onClick) => new window.Spicetify.Topbar.Button(label, icon, onClick));
    let button = null;
    let hideMenu = () => {};
    const errors = [];

    // The registry: created by the first extension, a synchronous check-and-set, so two that
    // start close together can't both become owner. Its shape is frozen for protocol 1.
    function ownerRegistry() {
      let menu = null;
      let anchor = null;
      let detach = null; // removes the open menu's listeners
      const items = () => [...menu.querySelectorAll(`.${prefix}-item`)];
      const reg = {
        protocol: PROTOCOL,
        owner: self.id,
        entries: [],
        // Adds, or replaces by id; sorted by name.
        register(entry) {
          const i = reg.entries.findIndex((e) => e.id === entry.id);
          if (i === -1) reg.entries.push(entry);
          else reg.entries[i] = entry;
          reg.entries.sort((a, b) => a.name.localeCompare(b.name));
          reg.refresh();
        },
        refresh() {
          if (button) button.label = reg.entries.length === 1 ? reg.entries[0].name : MULTI_LABEL;
        },
        // One entry: open it. Two or more: toggle the menu. Entries are read at click time.
        click(at) {
          if (reg.entries.length === 1) return reg.entries[0].open();
          if (menu && !menu.hidden) return hide();
          // Keyboard activation clicks with detail 0 (or isn't a click at all).
          const e = window.event;
          show(at, e ? e.type !== "click" || e.detail === 0 : !!at?.matches?.(":focus-visible"));
        },
      };

      // One element, appended once, hidden and shown, never removed while the page lives.
      function build() {
        menu = document.getElementById(`${prefix}-menu`);
        if (menu) return;
        menu = document.createElement("div");
        menu.id = `${prefix}-menu`;
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", MULTI_LABEL);
        menu.hidden = true;
        menu.innerHTML = `<style>
#${prefix}-menu { position: fixed; z-index: 9999; display: flex; flex-direction: column; box-sizing: border-box; min-width: 180px; padding: 4px; border-radius: 8px; background-color: var(--spice-card, var(--spice-main)); color: var(--spice-text); box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }
#${prefix}-menu[hidden] { display: none; }
.${prefix}-item { padding: 8px 12px; border: 0; border-radius: 4px; background: none; color: inherit; font: inherit; font-size: .875rem; text-align: left; white-space: nowrap; cursor: pointer; }
.${prefix}-item:hover, .${prefix}-item:focus-visible { outline: none; background-color: color-mix(in srgb, var(--spice-button) 20%, transparent); }
</style>`;
        menu.addEventListener("keydown", (e) => {
          const list = items();
          const i = list.indexOf(document.activeElement);
          const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
          if (next !== undefined) {
            e.preventDefault();
            list[(next + list.length) % list.length]?.focus();
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (i !== -1) activate(i);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            hide({ refocus: true });
          } else if (e.key === "Tab") hide();
        });
        menu.addEventListener("click", (e) => {
          const item = e.target.closest(`.${prefix}-item`);
          if (item) activate(items().indexOf(item));
        });
        document.body.append(menu);
      }

      // The items are rebuilt on opening only, never during a click on one of them.
      function show(at, keyboard) {
        build();
        for (const item of items()) item.remove();
        for (const entry of reg.entries) {
          const item = document.createElement("button");
          item.type = "button";
          item.className = `${prefix}-item`;
          item.setAttribute("role", "menuitem");
          item.dataset.entry = entry.id;
          item.textContent = entry.name;
          menu.append(item);
        }
        anchor = at ?? null;
        menu.hidden = false;
        place();
        const outside = (e) => !menu.contains(e.target) && !anchor?.contains(e.target) && hide();
        const close = () => hide();
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("scroll", close, true);
        window.addEventListener("blur", close);
        window.addEventListener("resize", close);
        detach = () => {
          document.removeEventListener("pointerdown", outside, true);
          document.removeEventListener("scroll", close, true);
          window.removeEventListener("blur", close);
          window.removeEventListener("resize", close);
        };
        if (keyboard) items()[0]?.focus({ preventScroll: true });
      }

      // 8 px below the button, right edges aligned, clamped into the window.
      function place() {
        const r = anchor?.getBoundingClientRect() ?? { right: innerWidth - GAP, bottom: GAP };
        const { width, height } = menu.getBoundingClientRect();
        const left = Math.min(Math.max(r.right - width, GAP), Math.max(GAP, innerWidth - GAP - width));
        const top = Math.min(Math.max(r.bottom + GAP, GAP), Math.max(GAP, innerHeight - GAP - height));
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
      }

      function hide({ refocus = false } = {}) {
        if (!menu || menu.hidden) return;
        menu.hidden = true;
        detach?.();
        detach = null;
        if (refocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
      }
      hideMenu = hide;

      // Hidden first, then opened in the next task: the clicked item stays connected.
      function activate(i) {
        const entry = reg.entries[i];
        hide();
        if (entry) setTimeout(() => entry.open(), 0);
      }

      return reg;
    }

    const found = window[key];
    let registry = null;
    let role;
    if (found?.protocol === PROTOCOL) {
      registry = found;
      role = "member";
    } else if (found) role = `own button (protocol ${found.protocol})`;
    else {
      registry = window[key] = ownerRegistry();
      role = "owner";
    }
    registry?.register(self);

    // The owner (or, next to another protocol, each extension) creates one button at most. It
    // stays registered while it isn't on screen yet: Spicetify mounts it once it finds its top bar.
    function ensureButton() {
      if (button || role === "member") return button;
      if (!createButton && !window.Spicetify?.Topbar?.Button) return null;
      try {
        if (registry) {
          button = makeButton(self.name, ENTRY_ICON, () => registry.click(button?.element));
          registry.refresh();
        } else button = makeButton(self.name, ENTRY_ICON, () => self.open());
      } catch (e) {
        errors.push(`Topbar: ${e?.message || e}`);
      }
      return button;
    }

    return {
      role,
      registry,
      errors,
      ensureButton,
      get button() {
        return button;
      },
      status: () => ({
        protocol: registry?.protocol ?? found?.protocol ?? PROTOCOL,
        role,
        owner: registry?.owner ?? null,
        entries: registry ? registry.entries.map((e) => e.id) : [self.id],
      }),
      // Test instances only: the live menu and registry stay for the page's lifetime.
      dispose() {
        hideMenu();
        document.getElementById(`${prefix}-menu`)?.remove();
        button?.element?.remove();
        if (role === "owner" && window[key] === registry) delete window[key];
      },
    };
  }
  // ── End shared entry ──

  // Shared entry block hash (#58): SHA-256 of the text from the start marker to the end marker,
  // without the SELF line, with LF line endings: 691e7f30deccee36a447bcac5b5b42e25abeb34bbb80ff812d2ddc19e808ed4f
  // The block in gradientConnectBar.js has the same hash. The self-test recomputes it from this
  // file, so drift shows up; change both copies or neither.
  const SHARED_ENTRY_SHA256 = "691e7f30deccee36a447bcac5b5b42e25abeb34bbb80ff812d2ddc19e808ed4f";

  // The settings always open by right-clicking the song progress bar: one delegated listener,
  // no Spicetify UI wrappers, nothing for a Spotify update to remove. Spicetify's profile menu
  // and top bar are extras — on Spotify 1.3.4.258 / Spicetify 2.45.3 the menu entry has to stay
  // hidden and the top-bar button never renders (#27, #38), so neither can be the only way in.
  function enableBarContextMenu() {
    document.addEventListener(
      "contextmenu",
      (e) => {
        if (!e.target.closest?.(SCOPE)) return;
        e.preventDefault();
        e.stopPropagation();
        if (!modal) openModal();
      },
      true
    );
    return "right-click on the progress bar";
  }

  // Spicetify renders its profile-menu items inside Spotify's legacy menu. On Spotify 1.3.4,
  // Spicetify.ReactComponent.MenuItem resolves to Spotify's V2-only item, which throws "cannot be
  // rendered outside a collection" there, so with any Spicetify item registered the profile menu
  // doesn't open at all (spicetify/cli#4012). The V2-only item's source has "forceV2LeadingIcon"
  // but not "aria-describedby"; Spotify's layout-switching item, the right one, has both.
  // Unknown shapes count as usable. Cached per component, since shouldAdd runs on every render.
  function menuItemUsable() {
    const component = api("ReactComponent")?.MenuItem;
    if (!component || !["function", "object"].includes(typeof component)) return true;
    if (!menuItemVerdicts.has(component)) {
      const fn = typeof component === "function" ? component : component.render ?? component.type?.render ?? component.type;
      let source = "";
      try {
        source = Function.prototype.toString.call(fn);
      } catch {}
      menuItemVerdicts.set(component, !(source.includes("forceV2LeadingIcon") && !source.includes("aria-describedby")));
    }
    return menuItemVerdicts.get(component);
  }

  // Both Spicetify entries, independently and at the same time, not one as the other's fallback:
  // people look for settings in different places (#45). The menu's ReactJSX wait never delays
  // the top bar. Resolves to a description of what's registered, or null.
  async function registerSpicetifyEntries() {
    const entries = await Promise.all([registerMenuEntry(), registerTopbarEntry()]);
    return entries.filter(Boolean).join(" + ") || null;
  }

  async function registerMenuEntry() {
    if (!api("Menu")?.Item) return null;
    // Menu.Item's constructor calls Spicetify.ReactJSX.jsx() right away, and spicetify-bindings
    // set ReactJSX only after CLI extensions have started: "reading 'jsx'" (#27). Right-click
    // on the bar already works, so only this entry waits.
    for (let waited = 0; !window.Spicetify?.ReactJSX?.jsx && waited < 15000; waited += 250) await sleep(250);
    if (!window.Spicetify?.ReactJSX?.jsx) {
      startup.entryErrors.push("Menu: Spicetify.ReactJSX not ready after 15 s");
      return null;
    }
    try {
      const item = new Spicetify.Menu.Item(ENTRY_LABEL, false, openModal, ENTRY_ICON);
      // On an affected build our entry must never be what breaks the profile menu. shouldAdd
      // runs on every render, so the entry appears by itself once MenuItem is fixed.
      const base = item.shouldAdd;
      item.shouldAdd = (...a) => menuItemUsable() && base(...a);
      item.register();
      window.__gpb.menuItem = item;
      menuRegistered = true;
      // Items render when the menu opens, so this can't be checked here.
      return menuItemUsable() ? "profile menu" : "profile menu (hidden while Spicetify's MenuItem is broken)";
    } catch (e) {
      startup.entryErrors.push(`Menu: ${e?.message || e}`);
      return null;
    }
  }

  // The shared top-bar button (#58): a member creates none (the owner's button lists us); the
  // owner (or, next to another protocol, each extension) creates one once Spicetify.Topbar exists,
  // waiting up to 15 s for it. One button at most. One that isn't on screen yet stays registered:
  // Spicetify keeps it and mounts it once it finds its top bar (#38). Alone, the button opens the
  // settings directly, as before.
  async function registerTopbarEntry() {
    if (shared.role === "member") return `shared top-bar button (owner: ${shared.registry.owner})`;
    for (let waited = 0; !api("Topbar")?.Button && waited < 15000; waited += 250) await sleep(250);
    if (!api("Topbar")?.Button) return null;
    if (!shared.ensureButton()) {
      startup.entryErrors.push(...shared.errors);
      return null;
    }
    window.__gpb.topbarButton = shared.button;
    for (let waited = 0; waited < 4000; waited += 250) {
      if (shared.button.element?.isConnected) return "top bar button";
      await sleep(250);
    }
    startup.entryErrors.push("Topbar: button created, not on screen yet (Spicetify hasn't found its top bar, #38)");
    return null;
  }

  let settings;
  try {
    settings = loadSettings();
    presets = loadPresets(); // #21
    window.addEventListener("beforeunload", flushSettings);
    applyCss(); // the bar works even if no entry point can be registered
    window.__gpb = { version: VERSION, status: () => statusReport(), selfTest, open: () => modal || openModal() };
    startup.entry = enableBarContextMenu();
    shared = joinGradientBars(); // #58, synchronous: the registry is claimed before anything awaits
    startup.phase = "registering entry point";
    const extra = await registerSpicetifyEntries();
    if (extra) startup.entry += ` + ${extra}`;
    startup.phase = "ready";
    console.log(`[gpb] v${VERSION} ready — open the settings with a ${startup.entry}.`);
    if (startup.entryErrors.length) console.warn("[gpb] Spicetify entry points unavailable:", startup.entryErrors.join("; "));
  } catch (e) {
    startup.phase = "failed";
    startup.error = e?.stack || String(e);
    console.error("[gpb] Start-up failed:", e);
  }
})();
