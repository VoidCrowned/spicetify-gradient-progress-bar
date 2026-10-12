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

  const VERSION = "0.1.0";
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

  // No confirmation: it's quickly undone.
  function resetSettings() {
    settings = defaultSettings();
    update();
  }

  function toggleGradient() {
    if (settings.stops.length < 2) return;
    settings.gradient = !settings.gradient;
    update();
  }

  // Picking a colour on a theme stop turns it into a custom stop.
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

  function linkStopToTheme(id) {
    const stop = findStop(id);
    stop.kind = "theme";
    delete stop.color;
    update();
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
.gpb-stop.gpb-dragging { opacity: .3; }
.gpb-marker { position: absolute; width: 2px; height: 32px; border-radius: 1px; background-color: var(--spice-button); pointer-events: none; }
.gpb-dot { display: block; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: none; cursor: pointer; }
.gpb-dot::-webkit-color-swatch-wrapper { padding: 0; }
.gpb-dot::-webkit-color-swatch { border: 2px solid rgba(var(--spice-rgb-text), .2); border-radius: 50%; }
.gpb-dot:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-action, .gpb-badge { position: absolute; right: -6px; display: none; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%; background-color: var(--spice-card); color: var(--spice-text); }
.gpb-action { cursor: pointer; }
.gpb-action:hover { background-color: var(--spice-button); }
.gpb-remove { top: -6px; }
.gpb-grip { top: -6px; right: auto; left: -6px; cursor: grab; }
.gpb-link, .gpb-badge { bottom: -6px; }
.gpb-badge { pointer-events: none; }
.gpb-stop:hover .gpb-action, .gpb-stop:focus-within .gpb-action, .gpb-stop.gpb-theme .gpb-badge { display: flex; }
.gpb-stop.gpb-theme .gpb-link { display: none; }
.gpb-button { align-self: flex-start; padding: 8px 16px; border: 1px solid rgba(var(--spice-rgb-text), .3); border-radius: 500px; background: none; color: var(--spice-text); font: inherit; font-weight: 700; cursor: pointer; }
.gpb-button:hover:not(:disabled) { border-color: var(--spice-text); }
.gpb-button:disabled { opacity: .5; cursor: not-allowed; }
.gpb-button:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-footer { display: flex; justify-content: flex-end; }
`;

  const ICON_REMOVE =
    '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_LINK =
    '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M6.6 9.4l2.8-2.8M7.3 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M8.7 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  const ICON_GRIP =
    '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" fill="currentColor"><circle cx="6" cy="4" r="1.3"/><circle cx="10" cy="4" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="6" cy="12" r="1.3"/><circle cx="10" cy="12" r="1.3"/></svg>';

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
      <div class="gpb-footer">
        <button type="button" class="gpb-button gpb-reset">Reset</button>
      </div>`;

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
    root.querySelector(".gpb-reset").addEventListener("click", resetSettings);
    m.stopsRow.addEventListener("input", (e) => {
      const dot = e.target.closest(".gpb-dot");
      if (!dot) return;
      const el = dot.closest(".gpb-stop");
      // Updated in place: re-rendering would close the picker.
      el.classList.remove("gpb-theme");
      dot.title = "";
      setStopColour(el.dataset.id, dot.value);
    });
    m.stopsRow.addEventListener("click", (e) => {
      const action = e.target.closest(".gpb-action");
      if (!action) return;
      const id = action.closest(".gpb-stop").dataset.id;
      if (action.classList.contains("gpb-remove")) removeStop(id);
      else if (action.classList.contains("gpb-link")) linkStopToTheme(id);
    });

    Spicetify.PopupModal.display({ title: "Gradient Progress Bar", content: root });
    modal = m;
    renderModal();
    watchModalClose(m);
    watchThemeColour(m);
    enableDragAndDrop(m);
  }

  const STOP_GAP = 12; // matches .gpb-stops gap

  // Only the grip is draggable: a native colour input inside a draggable element can swallow
  // the drag or start one instead of opening the picker.
  function enableDragAndDrop(m) {
    const row = m.stopsRow;
    let dragId = null;
    let dropIndex = -1;

    const endDrag = () => {
      dragId = null;
      row.querySelector(".gpb-dragging")?.classList.remove("gpb-dragging");
      row.querySelector(".gpb-marker").hidden = true;
    };

    row.addEventListener("dragstart", (e) => {
      const el = e.target.closest?.(".gpb-grip")?.closest(".gpb-stop");
      if (!el) return;
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
  // so keep the theme swatches current while the modal is open.
  function watchThemeColour(m) {
    const sync = () => {
      const colour = resolveStop({ kind: "theme" });
      for (const dot of m.stopsRow.querySelectorAll(".gpb-theme .gpb-dot")) dot.value = colour;
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
    renderSwitch();
    renderPreview();
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

  // The bar at 100 %, from the same gradient string as the stylesheet.
  function renderPreview() {
    modal.preview.style.backgroundImage = fillImage(settings);
  }

  function renderStops() {
    const row = modal.stopsRow;
    const removable = settings.stops.length > 1;
    row.textContent = "";
    settings.stops.forEach((stop, i) => {
      const el = document.createElement("div");
      el.className = "gpb-stop";
      el.dataset.id = stop.id;
      el.classList.toggle("gpb-theme", stop.kind === "theme");
      // Kept but unused while the gradient is off.
      el.classList.toggle("gpb-unused", !settings.gradient && i > 0);
      el.innerHTML = `
        <input type="color" class="gpb-dot" aria-label="Colour ${i + 1}" title="${stop.kind === "theme" ? "Theme colour" : ""}">
        <span class="gpb-badge" aria-hidden="true">${ICON_LINK}</span>
        <button type="button" class="gpb-action gpb-link" title="Link to theme colour" aria-label="Link to theme colour">${ICON_LINK}</button>
        ${removable ? `<button type="button" class="gpb-action gpb-remove" title="Remove colour" aria-label="Remove colour">${ICON_REMOVE}</button>` : ""}
        ${removable ? `<span class="gpb-action gpb-grip" draggable="true" title="Drag to reorder" aria-hidden="true">${ICON_GRIP}</span>` : ""}`;
      el.querySelector(".gpb-dot").value = resolveStop(stop);
      row.appendChild(el);
    });
    const marker = document.createElement("div");
    marker.className = "gpb-marker";
    marker.hidden = true;
    row.appendChild(marker);
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

  function setTestSettings(gradient, stops) {
    settings = { version: SCHEMA_VERSION, gradient, stops: stops.map((s) => ({ ...s })) };
    update();
  }

  // Declarations our stylesheet must never contain (CLAUDE.md → Hard rules).
  const FORBIDDEN_PROP =
    /^(-webkit-)?(mask(-.+)?|height|width|transform|--progress-bar-.+|--fg-color|--bg-color|--is-active-fg-color)$/;

  function cssProblems(css) {
    const problems = [];
    if (/!important/i.test(css)) problems.push("!important");
    for (const [, selector] of css.matchAll(/([^{}]+)\{/g))
      if (!selector.trim().startsWith(SCOPE)) problems.push(`unscoped rule: ${selector.trim()}`);
    for (const [, body] of css.matchAll(/\{([^}]*)\}/g))
      for (const decl of body.split(";")) {
        const prop = decl.split(":")[0].trim();
        if (FORBIDDEN_PROP.test(prop)) problems.push(`sets ${prop}`);
      }
    return problems;
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

  function environment() {
    return {
      extension: VERSION,
      spotify: Spicetify.Platform?.version ?? null,
      theme: Spicetify.Config?.current_theme ?? null,
      colourScheme: Spicetify.Config?.color_scheme ?? null,
      extensions: Spicetify.Config?.extensions ?? null,
      waveform: waveformActive(),
      spiceButton: getComputedStyle(document.documentElement).getPropertyValue("--spice-button").trim() || null,
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
    const problems = samples.flatMap(([gradient, stops]) =>
      cssProblems(buildCss({ version: SCHEMA_VERSION, gradient, stops }))
    );
    check(1, "CSS: every rule scoped, no !important, no forbidden properties", !problems.length,
      problems.join("; ") || `${samples.length} samples clean`);

    const fill = songFill();
    check(1, "Song progress bar found", fill && songHandle(), fill ? "" : "nothing matches SCOPE FILL — Spotify's DOM may have changed");

    if (fill) {
      const varsBefore = barVars(fill); // stylesheet is empty here
      const geometryBefore = barGeometry(fill);
      const waveform = waveformActive();
      setTestSettings(false, [custom("s1", RED)]);
      const solid = getComputedStyle(fill).backgroundImage;
      check(1, "Solid → song fill has a linear-gradient background-image", solid.startsWith("linear-gradient"), solid);
      const others = [...document.querySelectorAll(FILL)].filter((f) => !f.matches(`${SCOPE} ${FILL}`));
      const touched = others.filter((f) => getComputedStyle(f).backgroundImage !== "none");
      check(1, "Solid → every other fill (volume) has no background-image", !touched.length,
        `${others.length} other fill(s), ${touched.length} styled`);
      const solidHandle = computedHex(songHandle(), "backgroundColor");
      check(6, "Solid → handle is the solid colour", solidHandle === RED, solidHandle);

      setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
      const cs = getComputedStyle(fill);
      const transform = cs.getPropertyValue("--progress-bar-transform").trim();
      const sizeX = cs.backgroundSize.split(" ")[0];
      check(6, "Gradient → background-size follows --progress-bar-transform",
        sizeX.endsWith("%") && Math.abs(parseFloat(sizeX) - parseFloat(transform)) < 0.01,
        `size ${cs.backgroundSize}, transform ${transform}`);
      check(6, "Gradient → anchored right, no-repeat",
        cs.backgroundPositionX === "100%" && cs.backgroundRepeat === "no-repeat",
        `position ${cs.backgroundPosition}, repeat ${cs.backgroundRepeat}`);
      const img = cs.backgroundImage;
      const order = ["rgb(255, 0, 0)", "rgb(0, 255, 0)", "rgb(0, 0, 255)"].map((c) => img.indexOf(c));
      check(6, "Gradient → all stops present, in order", order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), img);
      const lastHandle = computedHex(songHandle(), "backgroundColor");
      check(6, "Gradient → handle is the last stop", lastHandle === BLUE, lastHandle);
      check(11, "Bar's --fg-color, --bg-color, --is-active-fg-color untouched", barVars(fill) === varsBefore, barVars(fill));
      check(12, "Bar height, radius and masks identical with our rules applied", barGeometry(fill) === geometryBefore,
        barGeometry(fill));
      if (waveform) {
        const areas = [...(fill.closest(".progress-bar") ?? fill).querySelectorAll(".x-progressBar-sliderArea")];
        check(12, "Waveform: both slider areas still masked with a gradient applied", areas.every(hasMaskAnimation),
          areas.map((a) => getComputedStyle(a).maskImage || getComputedStyle(a).webkitMaskImage).join(" | "));
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
    const listenersBefore = songchangeCount();
    openModal();
    const m = modal;
    check(3, "Modal opens", m?.root.isConnected, "");
    if (!m) return;

    check(5, "One stop → switch disabled, gradient off", m.switchButton.disabled && !settings.gradient,
      `disabled ${m.switchButton.disabled}, gradient ${settings.gradient}`);
    m.addButton.click();
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

    m.stopsRow.querySelectorAll(".gpb-remove")[1].click();
    check(5, "Removing back to one stop → gradient off, switch disabled",
      settings.stops.length === 1 && !settings.gradient && m.switchButton.disabled,
      `${settings.stops.length} stop(s), gradient ${settings.gradient}`);

    for (let i = 0; i < MAX_STOPS + 2; i++) m.addButton.click();
    check(4, "Add stops at 8, button disabled", settings.stops.length === MAX_STOPS && m.addButton.disabled,
      `${settings.stops.length} stops, disabled ${m.addButton.disabled}`);

    setTestSettings(false, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
    const opacities = [...m.stopsRow.querySelectorAll(".gpb-stop")].map((el) => getComputedStyle(el).opacity);
    check(4, "Gradient off with 3 stops → stops 2–3 at 50 % opacity", opacities.join() === "1,0.5,0.5", opacities.join(", "));

    setTestSettings(true, [theme("s1"), custom("s2", RED)]);
    if (fill) {
      const preview = getComputedStyle(m.preview).backgroundImage;
      const bar = getComputedStyle(fill).backgroundImage;
      check(9, "Preview shows the same gradient as the bar", preview === bar, preview);
    }

    rootStyle.setProperty("--spice-button", PROBE, "important");
    await tick(); // let the :root MutationObserver run
    const swatch = m.stopsRow.querySelector(".gpb-theme .gpb-dot")?.value;
    restoreButton();
    await tick();
    check(11, "Open modal: theme swatch follows a runtime --spice-button change", swatch === PROBE, swatch);

    const firstStop = m.stopsRow.querySelector(".gpb-stop");
    const dot = firstStop.querySelector(".gpb-dot");
    dot.value = GREEN;
    dot.dispatchEvent(new Event("input", { bubbles: true }));
    check(7, "Picking a colour on a theme dot → custom, without re-rendering (picker stays open)",
      settings.stops[0].kind === "custom" && settings.stops[0].color === GREEN && firstStop.isConnected && !firstStop.classList.contains("gpb-theme"),
      JSON.stringify(settings.stops[0]));

    m.stopsRow.querySelectorAll(".gpb-link")[1].click();
    check(7, "'Link to theme colour' turns a custom stop into a theme stop",
      settings.stops[1].kind === "theme" && !("color" in settings.stops[1]), JSON.stringify(settings.stops[1]));

    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
    const draggable = [...m.stopsRow.querySelectorAll('[draggable="true"]')];
    const stopEls = m.stopsRow.querySelectorAll(".gpb-stop");
    const dt = new DataTransfer();
    stopEls[0].querySelector(".gpb-grip").dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    const lastRect = stopEls[2].getBoundingClientRect();
    const at = { clientX: lastRect.right + 4, clientY: lastRect.top + lastRect.height / 2 };
    m.stopsRow.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
    const markerShown = !m.stopsRow.querySelector(".gpb-marker").hidden;
    m.stopsRow.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
    const order = settings.stops.map((s) => s.id).join();
    check(8, "Dragging stop 1's grip past the last stop moves it to the end",
      order === "s2,s3,s1" && markerShown, `order ${order}, marker shown ${markerShown}`);
    check(8, "Only the grips are draggable, never the colour inputs",
      draggable.length === 3 && draggable.every((el) => el.classList.contains("gpb-grip")),
      draggable.map((el) => el.className).join(", "));

    m.root.querySelector(".gpb-reset").click();
    check(10, "Reset → defaults and an empty stylesheet",
      JSON.stringify(settings) === JSON.stringify(defaultSettings()) && styleText() === "", JSON.stringify(settings));

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
    };
    for (const [label, raw] of Object.entries(invalid)) {
      const warnings = [];
      const warn = console.warn;
      console.warn = (...args) => warnings.push(args.join(" "));
      let loaded;
      try {
        loaded = loadSettings(raw);
      } finally {
        console.warn = warn;
      }
      const ours = warnings.filter((w) => w.startsWith("[gpb]")).length;
      check(2, `Invalid stored settings (${label}) → defaults + exactly one [gpb] warning`,
        JSON.stringify(loaded) === JSON.stringify(defaultSettings()) && ours === 1, `${ours} warning(s)`);
    }

    setTestSettings(true, [theme("s1"), custom("s2", RED), custom("s4", BLUE)]);
    const writtenAtOnce = Spicetify.LocalStorage.get(STORAGE_KEY) === JSON.stringify(settings);
    await new Promise((r) => setTimeout(r, SAVE_DELAY + 100));
    const reloaded = loadSettings();
    check(2, "Saves are debounced, then a load returns identical settings",
      !writtenAtOnce && JSON.stringify(reloaded) === JSON.stringify(settings), `written at once ${writtenAtOnce}`);
  }

  // ── Start-up ────────────────────────────────────────────────────────────────

  let settings = loadSettings();
  window.addEventListener("beforeunload", flushSettings);
  applyCss();
  new Spicetify.Menu.Item("Gradient progress bar", false, openModal).register();
  window.__gpb = { selfTest, version: VERSION };
})();
