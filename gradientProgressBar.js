// NAME: Gradient Progress Bar
// VERSION: 1.2.3
// AUTHOR: VoidCrowned
// REPO: https://github.com/VoidCrowned/spicetify-gradient-progress-bar
// DESCRIPTION: Recolours the song progress bar with a solid colour or a multi-stop gradient.
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

  const VERSION = "1.2.3";
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

  window.__gpb = {
    version: VERSION,
    status: () => statusReport(),
    selfTest: async () => {
      console.warn(`[gpb] Not ready (${startup.phase}) — the self-test needs a started extension.`);
      return statusReport();
    },
  };

  // Rendering only needs storage; the modal needs PopupModal and Player; the entry point
  // needs Menu (profile menu) or, as a fallback, Topbar.
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
    if (modal) rerender ? renderModal() : renderPreview();
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

  function addStop() {
    if (settings.stops.length >= MAX_STOPS) return;
    const last = settings.stops[settings.stops.length - 1];
    const id = nextStopId();
    settings.stops.push({ id, kind: "custom", color: resolveStop(last) });
    if (settings.stops.length === 2) settings.gradient = true; // a second colour implies a gradient
    selectedId = id;
    update();
  }

  // Inserts a copy directly after the stop (a theme stop stays a theme stop) and selects it.
  // Returns the copy's id.
  function duplicateStop(id) {
    const index = settings.stops.findIndex((s) => s.id === id);
    if (index === -1 || settings.stops.length >= MAX_STOPS) return id;
    const copy = { ...settings.stops[index], id: nextStopId() };
    settings.stops.splice(index + 1, 0, copy);
    if (settings.stops.length === 2) settings.gradient = true; // same rule as adding
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

  function toggleGradient() {
    if (settings.stops.length < 2) return;
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
  // (#8, #24). No icons on the dots (#31). Exactly one dot is selected whenever the modal is open.

  // The selected Spread mode is filled with var(--spice-button), the live theme colour. Never
  // --spice-rgb-button: Hazy rewrites --spice-button at runtime but leaves --spice-rgb-button
  // at the colour scheme's value (#40); tints use color-mix() on var(--spice-button) instead.
  // The label switches to --spice-main (gpb-on-light) when that contrasts more (#43).
  const MODAL_CSS = `
.gpb-modal { display: flex; flex-direction: column; gap: 20px; padding-top: 20px; color: var(--spice-text); }
.gpb-gradient-row { display: flex; align-items: center; justify-content: space-between; }
.gpb-label { font-weight: 700; }
.gpb-switch { position: relative; flex: none; width: 40px; height: 22px; padding: 0; border: 0; border-radius: 11px; background-color: rgba(var(--spice-rgb-text), .3); cursor: pointer; transition: background-color .15s; }
.gpb-switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background-color: var(--spice-text); transition: transform .15s; }
.gpb-switch[aria-checked="true"] { background-color: var(--spice-button); }
.gpb-switch[aria-checked="true"]::after { transform: translateX(18px); }
.gpb-switch:disabled { opacity: .5; cursor: not-allowed; }
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
.gpb-stops { position: relative; display: flex; flex-wrap: wrap; gap: 14px; padding: 4px; }
.gpb-stop { position: relative; width: 32px; height: 32px; padding: 0; border: 2px solid rgba(var(--spice-rgb-text), .25); border-radius: 50%; cursor: pointer; }
.gpb-stop.gpb-selected, .gpb-stop:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 3px; }
.gpb-stop.gpb-unused { opacity: .5; }
.gpb-stop.gpb-dragging { opacity: .3; }
.gpb-announce { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.gpb-marker { position: absolute; width: 2px; height: 32px; border-radius: 1px; background-color: var(--spice-button); pointer-events: none; }
.gpb-button { align-self: flex-start; padding: 8px 16px; border: 1px solid rgba(var(--spice-rgb-text), .3); border-radius: 500px; background: none; color: var(--spice-text); font: inherit; font-weight: 700; cursor: pointer; }
.gpb-button:hover:not(:disabled) { border-color: var(--spice-text); }
.gpb-button:disabled { opacity: .5; cursor: not-allowed; }
.gpb-button:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
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
.gpb-hex { flex: none; width: 10ch; font-family: ui-monospace, Consolas, monospace; text-align: left; }
.gpb-colour-picker .gpb-button { align-self: stretch; padding: 6px 12px; font-size: .875rem; }
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
  const HELP_TEXT =
    "Click a colour to edit it below, right-click it to duplicate or remove it. Drag colours to reorder them.";

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
      <div class="gpb-preview"></div>
      <div class="gpb-stops"></div>
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
          <label class="gpb-hex-row"><span>HEX:</span><input type="text" class="gpb-field gpb-hex" spellcheck="false" autocomplete="off" maxlength="7" aria-label="Hex code"></label>
          <button type="button" class="gpb-button gpb-use-theme">Use theme colour</button>
        </div>
      </div>
      <div class="gpb-actions">
        <button type="button" class="gpb-button gpb-add">+ Add colour</button>
        <button type="button" class="gpb-button gpb-reset"><span class="gpb-reset-label" aria-live="polite">Reset</span><span class="gpb-reset-sizer" aria-hidden="true">${RESET_CONFIRM_LABEL}</span></button>
      </div>
      <p class="gpb-help">${HELP_TEXT}</p>`;

    const m = {
      root,
      gradientRow: root.querySelector(".gpb-gradient-row"),
      switchButton: root.querySelector(".gpb-switch"),
      spread: root.querySelector(".gpb-spread"),
      modes: root.querySelector(".gpb-modes"),
      modeButtons: [...root.querySelectorAll(".gpb-mode")],
      spreadHint: root.querySelector(".gpb-spread-hint"),
      preview: root.querySelector(".gpb-preview"),
      stopsRow: root.querySelector(".gpb-stops"),
      actions: root.querySelector(".gpb-actions"),
      addButton: root.querySelector(".gpb-add"),
      resetButton: root.querySelector(".gpb-reset"),
      resetLabel: root.querySelector(".gpb-reset-label"),
      help: root.querySelector(".gpb-help"),
      menu: root.querySelector(".gpb-menu"),
      announce: root.querySelector(".gpb-announce"),
      duplicateItem: root.querySelector(".gpb-duplicate"),
      removeItem: root.querySelector(".gpb-remove"),
      picker: root.querySelector(".gpb-colour-picker"),
      sv: root.querySelector(".gpb-sv"),
      svHandle: root.querySelector(".gpb-sv-handle"),
      hue: root.querySelector(".gpb-hue"),
      hueHandle: root.querySelector(".gpb-hue-handle"),
      swatch: root.querySelector(".gpb-swatch"),
      eyedropper: root.querySelector(".gpb-eyedropper"),
      rgb: [...root.querySelectorAll(".gpb-channel-input")],
      hex: root.querySelector(".gpb-hex"),
      useThemeButton: root.querySelector(".gpb-use-theme"),
      cleanups: [],
    };

    m.switchButton.addEventListener("click", toggleGradient);
    enableSpread(m);
    m.addButton.addEventListener("click", addStop);
    m.stopsRow.addEventListener("click", (e) => {
      const el = e.target.closest(".gpb-stop");
      if (!el || performance.now() - lastDragEnd < 300) return; // a drag never changes the selection
      selectStop(el.dataset.id, { focusHex: e.detail === 0 }); // detail 0: Enter/Space
    });
    enableDotMenu(m);
    enableColourPicker(m);
    enableReset(m);

    Spicetify.PopupModal.display({ title: "Gradient Progress Bar", content: root });
    modal = m;
    selectedId = settings.stops[0].id; // the first dot is selected on open
    renderModal();
    watchModalClose(m);
    watchThemeColour(m);
    watchPopovers(m);
    enableDragAndDrop(m);
    enableKeyboardReorder(m);
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
  // Reset can't be undone and sits next to + Add colour, so the first click only arms it
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

    // Any other click or key disarms; Enter/Space on the button are the confirmation itself.
    const listen = (type, handler) => {
      document.addEventListener(type, handler, true);
      m.cleanups.push(() => document.removeEventListener(type, handler, true));
    };
    const elsewhere = (e) => armed() && !button.contains(e.target) && disarm();
    listen("pointerdown", elsewhere);
    listen("click", elsewhere);
    listen("keydown", (e) => {
      if (!armed()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // Reset disarms, the modal stays
        disarm();
      } else if (!button.contains(e.target)) disarm();
    });
    m.cleanups.push(disarm); // clears the timer when the modal closes
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
  function showPopover(id, el, at = null) {
    closePopover();
    const anchor = dotEl(id);
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

  const menuItems = () => [...modal.menu.querySelectorAll(".gpb-menu-item:not(:disabled)")];

  function openMenu(id, { at = null, keyboard = false } = {}) {
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

  const STOP_GAP = 14; // matches .gpb-stops gap

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
    modal.addButton.disabled = settings.stops.length >= MAX_STOPS;
  }

  function renderSwitch() {
    const single = settings.stops.length < 2;
    modal.switchButton.setAttribute("aria-checked", String(settings.gradient));
    modal.switchButton.disabled = single;
    // On the row, not the button: disabled buttons don't reliably show tooltips.
    modal.gradientRow.title = single ? "Add a second colour to use a gradient" : "";
  }

  // The bar at 100 %, from the same gradient string as the stylesheet.
  function renderPreview() {
    modal.preview.style.backgroundImage = fillImage(settings);
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

  function environment() {
    return {
      extension: VERSION,
      source: SOURCE,
      copies: loadedCopies(),
      spotify: Spicetify.Platform?.version ?? null,
      theme: Spicetify.Config?.current_theme ?? null,
      colourScheme: Spicetify.Config?.color_scheme ?? null,
      extensions: Spicetify.Config?.extensions ?? null,
      waveform: waveformActive(),
      eyedropper: !!window.EyeDropper, // the picker's eyedropper button exists only with it
      spiceButton: getComputedStyle(document.documentElement).getPropertyValue("--spice-button").trim() || null,
      entry: startup.entry,
      phase: startup.phase,
      entryErrors: startup.entryErrors,
      startupError: startup.error,
      dom: domProbe(), // includes the song bar's DOM outline, for selector fixes after Spotify updates
    };
  }

  async function copyText(text) {
    try {
      if (Spicetify.Platform?.ClipboardAPI?.copy) await Spicetify.Platform.ClipboardAPI.copy(text);
      else await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  let selfTestRunning = false;

  async function selfTest() {
    if (selfTestRunning) return console.warn("[gpb] The self-test is already running.");
    selfTestRunning = true;

    const results = [];
    const check = (issue, name, pass, detail = "") =>
      results.push({ id: results.length + 1, issue: `#${issue}`, check: name, pass: !!pass, detail: String(detail) });

    const env = environment();
    const savedSettings = structuredClone(settings);
    const savedRaw = Spicetify.LocalStorage.get(STORAGE_KEY);
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
      // The entry point can take up to 20 s to register (profile menu, then top-bar fallback).
      for (let waited = 0; startup.phase === "registering entry point" && waited < 21000; waited += 300) await sleep(300);
      check(3, "Settings entry registered (profile menu or top bar)", startup.entry,
        [`${startup.entry ?? "none"} (${startup.phase})`, ...startup.entryErrors, startup.error?.split("\n")[0]].filter(Boolean).join("; "));
      check(39, "Exactly one copy of the extension is loaded", env.copies.length === 1,
        env.copies.length === 1
          ? env.copies[0]
          : `${env.copies.length} copies: ${env.copies.join(", ") || "none found"} (running: ${SOURCE ?? "unknown"}). Keep either the Marketplace install or the local CLI install (spicetify config extensions gradientProgressBar.js-), not both.`);
      await checkEntryIcon(check);
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

    const button = document.querySelector(`button[aria-label="${ENTRY_LABEL}"]`);
    const svg = button?.querySelector("svg");
    if (svg) {
      const fill = getComputedStyle(svg).fill;
      const colour = getComputedStyle(button).color;
      const sameColour = fill === colour || String(parseRgb(fill)) === String(parseRgb(colour));
      check(44, "Top-bar icon renders at 16 × 16 px and takes the button's colour", is16(svg) && sameColour,
        `${size(svg)}, fill ${fill}, button colour ${colour}`);
    } else {
      check(44, "Top-bar icon renders at 16 × 16 px and takes the button's colour", true,
        startup.entry?.includes("profile menu")
          ? "no top-bar button: the profile-menu entry registered instead"
          : "top-bar button not connected; expected on Spicetify ≤ 2.45.3 until its class-map fix for Spotify 1.3.4 is released (#38)");
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
    check(5, "One stop → switch disabled, gradient off", m.switchButton.disabled && !settings.gradient,
      `disabled ${m.switchButton.disabled}, gradient ${settings.gradient}`);
    m.addButton.click();
    stillOpen("adding a stop");
    check(35, "+ Add colour selects the new dot", selectionIs(settings.stops[1]?.id), selection());
    check(5, "Adding a 2nd stop → gradient on, switch enabled",
      settings.stops.length === 2 && settings.gradient && m.switchButton.getAttribute("aria-checked") === "true" && !m.switchButton.disabled,
      `${settings.stops.length} stops, gradient ${settings.gradient}`);
    check(4, "New stop = last stop's resolved colour",
      settings.stops[1].kind === "custom" && settings.stops[1].color === resolveStop(settings.stops[0]),
      `${settings.stops[1].color} vs ${resolveStop(settings.stops[0])}`);

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
    check(37, "Help text is the last element of the modal content, after the action row",
      help.textContent === HELP_TEXT && m.root.lastElementChild === help &&
        m.actions.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING && !m.root.querySelector(".gpb-footer"),
      `last child .${m.root.lastElementChild?.className}, text "${help.textContent}"`);
    const icons = m.stopsRow.querySelectorAll("svg, .gpb-action, .gpb-badge, .gpb-grip");
    check(31, "No icons on the colour dots", !icons.length, `${icons.length} found`);
    const editorRow = m.root.querySelectorAll('.gpb-editor, input[type="color"]');
    check(32, "No editor row and no native colour input", !editorRow.length, `${editorRow.length} found`);
    check(35, "Picker is an inline panel between the dots and + Add colour, not a popover",
      m.picker.parentElement === m.root && m.picker.previousElementSibling === m.stopsRow &&
        m.picker.nextElementSibling === m.actions && !m.picker.hidden && getComputedStyle(m.picker).position === "static",
      `after .${m.picker.previousElementSibling?.className}, before .${m.picker.nextElementSibling?.className}, ` +
        `position ${getComputedStyle(m.picker).position}`);

    check(15, "Spread row sits between the Gradient row and the preview: a radiogroup of three radio buttons",
      m.spread.previousElementSibling === m.gradientRow && m.spread.nextElementSibling === m.preview &&
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
    const addRect = m.addButton.getBoundingClientRect();
    const resetRect = m.resetButton.getBoundingClientRect();
    const centreY = (r) => r.top + r.height / 2;
    const leftOff = addRect.left - rowRect.left;
    const rightOff = rowRect.right - resetRect.right;
    const centreDiff = Math.abs(centreY(addRect) - centreY(resetRect));
    check(37, "+ Add colour and Reset share one row: Add at its left edge, Reset at its right",
      m.addButton.parentElement === m.actions && m.resetButton.parentElement === m.actions &&
        centreDiff <= 2 && Math.abs(leftOff) <= 2 && Math.abs(rightOff) <= 2,
      `centres differ ${centreDiff.toFixed(1)} px, Add ${leftOff.toFixed(1)} px from the left, ` +
        `Reset ${rightOff.toFixed(1)} px from the right, row ${Math.round(rowRect.width)} px`);
    check(37, "Action row → help text gap is ≥ 16 px", helpGap >= 16, `${helpGap.toFixed(1)} px`);
    // The content's bottom inside Spicetify's container (scroll-aware, its own padding excluded):
    // anything more than a small gap below the help text is empty space of ours.
    const container = m.root.parentElement;
    const containerStyle = getComputedStyle(container);
    const contentBottom = container.getBoundingClientRect().top + container.clientTop - container.scrollTop +
      container.scrollHeight - parseFloat(containerStyle.paddingBottom || "0");
    const helpBottom = help.getBoundingClientRect().bottom;
    const bottomGap = contentBottom - helpBottom;
    check(37, "Help text bottom → modal content bottom is ≤ 24 px (no empty footer)", bottomGap <= 24,
      `${bottomGap.toFixed(1)} px (help → our root's bottom ${(m.root.getBoundingClientRect().bottom - helpBottom).toFixed(1)} px, ` +
        `container <${container.tagName.toLowerCase()}> padding-bottom ${containerStyle.paddingBottom})`);

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
    check(5, "Remove down to one stop → gradient off, switch disabled, menu closed",
      settings.stops.length === 1 && !settings.gradient && m.switchButton.disabled && !menuShown(),
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

    for (let i = 0; i < MAX_STOPS + 2; i++) m.addButton.click();
    check(4, "Add stops at 8, button disabled", settings.stops.length === MAX_STOPS && m.addButton.disabled,
      `${settings.stops.length} stops, disabled ${m.addButton.disabled}`);
    rightClick(dots()[0]);
    check(33, "Eight stops → Duplicate disabled", m.duplicateItem.disabled, `disabled ${m.duplicateItem.disabled}`);
    closePopover();

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
      "SV square": m.sv, "hue slider": m.hue, R: m.rgb[0], G: m.rgb[1], B: m.rgb[2], "hex field": m.hex,
      "theme button": m.useThemeButton, ...(m.eyedropper ? { eyedropper: m.eyedropper } : {}),
    };
    const unreachable = Object.entries(pickerControls).filter(([, el]) => !reachable(el)).map(([name]) => name);
    check(35, "Every picker control is reachable (scrolled into view, its centre hit-tests to it)", !unreachable.length,
      unreachable.length ? `not reachable: ${unreachable.join(", ")}` : `${Object.keys(pickerControls).length} controls`);
    const hexLabel = m.root.querySelector(".gpb-hex-row > span");
    check(36, "Hex label reads 'HEX:'", hexLabel?.textContent === "HEX:", JSON.stringify(hexLabel?.textContent ?? null));
    const columnRect = controls.getBoundingClientRect();
    const hexRect = m.hex.getBoundingClientRect();
    check(36, "Hex field is at most 55 % of the right column's width", hexRect.width <= 0.55 * columnRect.width,
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
    realClick(m.addButton);
    step("+ Add colour", true);
    rightClick(dots()[1]);
    m.removeItem.click();
    await sleep(20);
    rightClick(dots()[0]);
    m.duplicateItem.click();
    await sleep(20);
    step("Duplicate", true);
    check(15, "Row disabled with one colour: buttons disabled, hint 'Applies when the gradient is on.'", disabledWithOne,
      gradientSteps[2]);
    check(15, "The Gradient switch, Remove, + Add colour and Duplicate disable/enable the row in place (mode kept)",
      gradientSteps.every((s) => s.endsWith(": ok")), gradientSteps.join("; "));
    stillOpen("gradient changes with the Spread row");

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
      apis: Object.fromEntries(["LocalStorage", "PopupModal", "Player", "Menu", "Topbar"].map((n) => [n, !!api(n)])),
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

  // The settings always open by right-clicking the song progress bar: one delegated listener,
  // no Spicetify UI wrappers, nothing for a Spotify update to remove. Spicetify's Menu and
  // Topbar are tried as extras — on Spotify 1.3.4.258 the menu throws and the top-bar button
  // silently never renders (#27, #28), so neither can be the only way in.
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

  // Resolves to a description of the Spicetify entry that is actually on screen, or null.
  async function registerSpicetifyEntry() {
    if (api("Menu")?.Item) {
      try {
        new Spicetify.Menu.Item(ENTRY_LABEL, false, openModal, ENTRY_ICON).register();
        return "profile menu"; // items render when the menu opens, so this can't be checked here
      } catch (e) {
        startup.entryErrors.push(`Menu: ${e?.message || e}`);
      }
    }
    if (api("Topbar")?.Button) {
      try {
        const button = new Spicetify.Topbar.Button(ENTRY_LABEL, ENTRY_ICON, openModal);
        for (let waited = 0; waited < 4000; waited += 250) {
          if (button.element?.isConnected || document.querySelector(`button[aria-label="${ENTRY_LABEL}"]`))
            return "top bar button";
          await sleep(250);
        }
        startup.entryErrors.push("Topbar: button created but never rendered");
      } catch (e) {
        startup.entryErrors.push(`Topbar: ${e?.message || e}`);
      }
    }
    return null;
  }

  let settings;
  try {
    settings = loadSettings();
    window.addEventListener("beforeunload", flushSettings);
    applyCss(); // the bar works even if no entry point can be registered
    window.__gpb = { version: VERSION, status: () => statusReport(), selfTest, open: () => modal || openModal() };
    startup.entry = enableBarContextMenu();
    startup.phase = "registering entry point";
    const extra = await registerSpicetifyEntry();
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
