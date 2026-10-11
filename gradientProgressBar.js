// NAME: Gradient Progress Bar
// VERSION: 0.1.0
// AUTHOR: VoidCrowned
// REPO: https://github.com/VoidCrowned/spicetify-gradient-progress-bar
// DESCRIPTION: Recolours the song progress bar with a solid colour or a multi-stop gradient.
//
// Compatibility rules (details in CLAUDE.md → Hard rules):
//  1. Every rule is scoped to the song progress bar — the volume slider never changes.
//  2. Never sets mask, height, width, transform, --progress-bar-height, --progress-bar-radius,
//     --progress-bar-transform or any other layout property on bar elements.
//  3. Never overrides --fg-color, --bg-color or --is-active-fg-color.
//  4. No !important — rules win by specificity only.
//  5. No element references from JS for the bar — one regenerated <style id="gpb-style">.
//  6. Inert by default: with default settings the stylesheet is empty.

(async function gpb() {
  "use strict";

  while (!Spicetify?.LocalStorage || !Spicetify?.Menu || !Spicetify?.PopupModal || !Spicetify?.Player)
    await new Promise((r) => setTimeout(r, 300));

  const STORAGE_KEY = "gpb:settings";
  const SCHEMA_VERSION = 1;
  const MAX_STOPS = 8;
  const SAVE_DELAY = 250;
  const HEX_RE = /^#[0-9a-f]{6}$/i;

  // Song progress bar only — the volume slider is the same component without this test id.
  const SCOPE = ':is([data-testid="playback-progressbar"], .main-nowPlayingBar-center .playback-bar)';
  const FILL = ".x-progressBar-fillColor";
  const HANDLE = ':is([data-testid="progress-bar-handle"], .progress-bar__slider, .x-progressBar-handle)';

  // Never resolved to a hex, so it follows runtime theme changes (e.g. Hazy's per-song accent).
  const THEME_COLOUR = "var(--spice-button, var(--spice-text, #1db954))";

  // ── Settings ────────────────────────────────────────────────────────────────

  function defaultSettings() {
    return { version: SCHEMA_VERSION, gradient: false, stops: [{ id: "s1", kind: "theme" }] };
  }

  // Returns a clean copy of `data`, or null if it isn't valid settings.
  function validateSettings(data) {
    if (!data || typeof data !== "object" || data.version !== SCHEMA_VERSION) return null;
    if (typeof data.gradient !== "boolean" || !Array.isArray(data.stops)) return null;
    if (data.stops.length < 1 || data.stops.length > MAX_STOPS) return null;

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
    return { version: SCHEMA_VERSION, gradient: data.gradient && stops.length > 1, stops };
  }

  function loadSettings() {
    const raw = Spicetify.LocalStorage.get(STORAGE_KEY);
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

  // Selectors are ≥ 0,2,0 so they beat themes' single-class rules without !important.
  // background-image (not -color) keeps Spotify's hover swap of background-color hidden.
  //
  // Compress mode: the fill is a full-width element translated left, so only its rightmost
  // --progress-bar-transform percent is visible. Sizing the gradient to that slice and
  // anchoring it right makes the whole gradient span bar start → playhead.
  function buildCss(s) {
    if (isInert(s)) return "";
    const colours = activeColours(s);
    const handle = colours[colours.length - 1];
    const compress = s.gradient
      ? [
          `  background-size: var(--progress-bar-transform) 100%;`,
          `  background-position: right center;`,
          `  background-repeat: no-repeat;`,
        ]
      : [];
    return [
      `${SCOPE} ${FILL} {`,
      `  background-image: ${fillImage(s)};`,
      ...compress,
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
  // `rerender: false` while a colour picker is open — rebuilding would close it.
  function update({ rerender = true } = {}) {
    applyCss();
    if (modal && rerender) renderModal();
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
    settings.stops.push({ id: nextStopId(), kind: "custom", color: resolveStop(last) });
    if (settings.stops.length === 2) settings.gradient = true; // a second colour implies a gradient
    update();
  }

  function removeStop(id) {
    if (settings.stops.length <= 1) return;
    settings.stops = settings.stops.filter((s) => s.id !== id);
    if (settings.stops.length === 1) settings.gradient = false;
    update();
  }

  function toggleGradient() {
    if (settings.stops.length < 2) return;
    settings.gradient = !settings.gradient;
    update();
  }

  function setStopColour(id, colour) {
    const stop = findStop(id);
    stop.kind = "custom";
    stop.color = colour;
    update({ rerender: false });
  }

  // ── Settings modal ──────────────────────────────────────────────────────────
  // Colours come only from Spicetify variables so the modal follows any theme.
  // Never use the id "color-input" or the classes .slider/.toggle/.toggleWrapper —
  // Hazy looks them up and styles them globally.

  const MODAL_CSS = `
.gpb-modal { display: flex; flex-direction: column; gap: 20px; color: var(--spice-text); }
.gpb-gradient-row { display: flex; align-items: center; justify-content: space-between; }
.gpb-label { font-weight: 700; }
.gpb-switch { position: relative; flex: none; width: 40px; height: 22px; padding: 0; border: 0; border-radius: 11px; background-color: rgba(var(--spice-rgb-text), .3); cursor: pointer; transition: background-color .15s; }
.gpb-switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background-color: var(--spice-text); transition: transform .15s; }
.gpb-switch[aria-checked="true"] { background-color: var(--spice-button); }
.gpb-switch[aria-checked="true"]::after { transform: translateX(18px); }
.gpb-switch:disabled { opacity: .5; cursor: not-allowed; }
.gpb-switch:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-preview { height: 8px; border-radius: 4px; }
.gpb-stops { position: relative; display: flex; flex-wrap: wrap; gap: 12px; }
.gpb-stop { position: relative; width: 32px; height: 32px; }
.gpb-stop.gpb-unused { opacity: .5; }
.gpb-dot { display: block; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: none; cursor: pointer; }
.gpb-dot::-webkit-color-swatch-wrapper { padding: 0; }
.gpb-dot::-webkit-color-swatch { border: 2px solid rgba(var(--spice-rgb-text), .2); border-radius: 50%; }
.gpb-dot:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-action { position: absolute; right: -6px; display: none; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%; background-color: var(--spice-card); color: var(--spice-text); cursor: pointer; }
.gpb-action:hover { background-color: var(--spice-button); }
.gpb-remove { top: -6px; }
.gpb-stop:hover .gpb-action, .gpb-stop:focus-within .gpb-action { display: flex; }
.gpb-button { align-self: flex-start; padding: 8px 16px; border: 1px solid rgba(var(--spice-rgb-text), .3); border-radius: 500px; background: none; color: var(--spice-text); font: inherit; font-weight: 700; cursor: pointer; }
.gpb-button:hover:not(:disabled) { border-color: var(--spice-text); }
.gpb-button:disabled { opacity: .5; cursor: not-allowed; }
.gpb-button:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-footer { display: flex; justify-content: flex-end; }
`;

  const ICON_REMOVE =
    '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  let modal = null; // the open modal's elements, or null

  function openModal() {
    const root = document.createElement("div");
    root.className = "gpb-modal";
    root.innerHTML = `
      <style>${MODAL_CSS}</style>
      <div class="gpb-gradient-row">
        <span class="gpb-label" id="gpb-gradient-label">Gradient</span>
        <button type="button" class="gpb-switch" role="switch" aria-labelledby="gpb-gradient-label"></button>
      </div>
      <div class="gpb-preview"></div>
      <div class="gpb-stops"></div>
      <button type="button" class="gpb-button gpb-add">+ Add colour</button>
      <div class="gpb-footer"></div>`;

    const m = {
      root,
      gradientRow: root.querySelector(".gpb-gradient-row"),
      switchButton: root.querySelector(".gpb-switch"),
      preview: root.querySelector(".gpb-preview"),
      stopsRow: root.querySelector(".gpb-stops"),
      addButton: root.querySelector(".gpb-add"),
      cleanups: [],
    };

    m.switchButton.addEventListener("click", toggleGradient);
    m.addButton.addEventListener("click", addStop);
    m.stopsRow.addEventListener("input", (e) => {
      const dot = e.target.closest(".gpb-dot");
      if (dot) setStopColour(dot.closest(".gpb-stop").dataset.id, dot.value);
    });
    m.stopsRow.addEventListener("click", (e) => {
      const action = e.target.closest(".gpb-action");
      if (!action) return;
      const id = action.closest(".gpb-stop").dataset.id;
      if (action.classList.contains("gpb-remove")) removeStop(id);
    });

    Spicetify.PopupModal.display({ title: "Gradient Progress Bar", content: root });
    modal = m;
    renderModal();
    watchModalClose(m);
  }

  // PopupModal has no close callback: hide() removes it from <body>, and another
  // extension's display() replaces its contents. Either way our root is detached.
  function watchModalClose(m) {
    const observer = new MutationObserver(() => {
      if (!m.root.isConnected) closeModal(m);
    });
    observer.observe(document.body, { childList: true });
    observer.observe(Spicetify.PopupModal, { childList: true });
    m.cleanups.push(() => observer.disconnect());
  }

  function closeModal(m) {
    for (const cleanup of m.cleanups) cleanup();
    if (modal === m) modal = null;
    flushSettings();
  }

  function renderModal() {
    renderSwitch();
    renderStops();
    modal.addButton.disabled = settings.stops.length >= MAX_STOPS;
  }

  function renderSwitch() {
    const single = settings.stops.length < 2;
    modal.switchButton.setAttribute("aria-checked", String(settings.gradient));
    modal.switchButton.disabled = single;
    // On the row, not the button: disabled buttons don't reliably show tooltips.
    modal.gradientRow.title = single ? "Add a second colour to use a gradient" : "";
  }

  function renderStops() {
    const row = modal.stopsRow;
    const removable = settings.stops.length > 1;
    row.textContent = "";
    settings.stops.forEach((stop, i) => {
      const el = document.createElement("div");
      el.className = "gpb-stop";
      el.dataset.id = stop.id;
      // Kept but unused while the gradient is off.
      el.classList.toggle("gpb-unused", !settings.gradient && i > 0);
      el.innerHTML = `
        <input type="color" class="gpb-dot" aria-label="Colour ${i + 1}">
        ${removable ? `<button type="button" class="gpb-action gpb-remove" title="Remove colour" aria-label="Remove colour">${ICON_REMOVE}</button>` : ""}`;
      el.querySelector(".gpb-dot").value = resolveStop(stop);
      row.appendChild(el);
    });
  }

  // ── Start-up ────────────────────────────────────────────────────────────────

  let settings = loadSettings();
  window.addEventListener("beforeunload", flushSettings);
  applyCss();
  new Spicetify.Menu.Item("Gradient progress bar", false, openModal).register();
})();
