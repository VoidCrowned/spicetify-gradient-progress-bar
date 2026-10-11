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
      const el = e.target.closest?.(".gpb-stop");
      if (!el) return;
      dragId = el.dataset.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragId);
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
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    Spicetify.Player.addEventListener("songchange", sync);
    m.cleanups.push(() => {
      observer.disconnect();
      Spicetify.Player.removeEventListener("songchange", sync);
    });
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
      el.draggable = true;
      el.classList.toggle("gpb-theme", stop.kind === "theme");
      // Kept but unused while the gradient is off.
      el.classList.toggle("gpb-unused", !settings.gradient && i > 0);
      el.innerHTML = `
        <input type="color" class="gpb-dot" aria-label="Colour ${i + 1}" title="${stop.kind === "theme" ? "Theme colour" : ""}">
        <span class="gpb-badge" aria-hidden="true">${ICON_LINK}</span>
        <button type="button" class="gpb-action gpb-link" title="Link to theme colour" aria-label="Link to theme colour">${ICON_LINK}</button>
        ${removable ? `<button type="button" class="gpb-action gpb-remove" title="Remove colour" aria-label="Remove colour">${ICON_REMOVE}</button>` : ""}`;
      el.querySelector(".gpb-dot").value = resolveStop(stop);
      row.appendChild(el);
    });
    const marker = document.createElement("div");
    marker.className = "gpb-marker";
    marker.hidden = true;
    row.appendChild(marker);
  }

  // ── Start-up ────────────────────────────────────────────────────────────────

  let settings = loadSettings();
  window.addEventListener("beforeunload", flushSettings);
  applyCss();
  new Spicetify.Menu.Item("Gradient progress bar", false, openModal).register();
})();
