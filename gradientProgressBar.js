// NAME: Gradient Progress Bar
// VERSION: 0.2.0
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

  const VERSION = "0.2.0";

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
    const id = nextStopId();
    settings.stops.push({ id, kind: "custom", color: resolveStop(last) });
    if (settings.stops.length === 2) settings.gradient = true; // a second colour implies a gradient
    selectedId = id; // the new colour is the one you'll want to edit
    update();
  }

  // Inserts a copy directly after the stop (a theme stop stays a theme stop). Returns the copy's id.
  function duplicateStop(id) {
    const index = settings.stops.findIndex((s) => s.id === id);
    if (index === -1 || settings.stops.length >= MAX_STOPS) return id;
    const copy = { ...settings.stops[index], id: nextStopId() };
    settings.stops.splice(index + 1, 0, copy);
    if (settings.stops.length === 2) settings.gradient = true; // same rule as adding
    update();
    return copy.id;
  }

  function removeStop(id) {
    if (settings.stops.length <= 1) return;
    const index = settings.stops.findIndex((s) => s.id === id);
    settings.stops = settings.stops.filter((s) => s.id !== id);
    if (selectedId === id) selectedId = settings.stops[Math.min(index, settings.stops.length - 1)].id;
    if (settings.stops.length === 1) settings.gradient = false;
    update();
  }

  // No confirmation: it's quickly undone.
  function resetSettings() {
    settings = defaultSettings();
    selectedId = settings.stops[0].id;
    update();
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
  //
  // Dots are plain buttons: click to select, drag to reorder. The selected colour is edited
  // in one editor row (picker, hex field, labelled actions) — no tiny icons on the dots (#30, #31).

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
.gpb-stops { position: relative; display: flex; flex-wrap: wrap; gap: 14px; padding: 4px; }
.gpb-stop { position: relative; width: 32px; height: 32px; padding: 0; border: 2px solid rgba(var(--spice-rgb-text), .25); border-radius: 50%; cursor: grab; }
.gpb-stop.gpb-theme { border-style: dashed; border-color: var(--spice-text); }
.gpb-stop[aria-pressed="true"], .gpb-stop:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 3px; }
.gpb-stop.gpb-unused { opacity: .5; }
.gpb-stop.gpb-dragging { opacity: .3; }
.gpb-marker { position: absolute; width: 2px; height: 32px; border-radius: 1px; background-color: var(--spice-button); pointer-events: none; }
.gpb-editor { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.gpb-picker { flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; background: none; cursor: pointer; }
.gpb-picker::-webkit-color-swatch-wrapper { padding: 0; }
.gpb-picker::-webkit-color-swatch { border: 2px solid rgba(var(--spice-rgb-text), .2); border-radius: 6px; }
.gpb-picker:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-hex { width: 11ch; height: 32px; box-sizing: border-box; padding: 0 8px; border: 1px solid rgba(var(--spice-rgb-text), .3); border-radius: 6px; background-color: rgba(var(--spice-rgb-text), .08); color: var(--spice-text); font: inherit; font-family: ui-monospace, Consolas, monospace; }
.gpb-hex:focus { outline: none; border-color: var(--spice-text); }
.gpb-hex[aria-invalid="true"] { border-color: #e91429; }
.gpb-button { align-self: flex-start; padding: 8px 16px; border: 1px solid rgba(var(--spice-rgb-text), .3); border-radius: 500px; background: none; color: var(--spice-text); font: inherit; font-weight: 700; cursor: pointer; }
.gpb-editor .gpb-button { align-self: center; padding: 6px 12px; font-size: .875rem; }
.gpb-button:hover:not(:disabled) { border-color: var(--spice-text); }
.gpb-button:disabled { opacity: .5; cursor: not-allowed; }
.gpb-button:focus-visible { outline: 2px solid var(--spice-text); outline-offset: 2px; }
.gpb-help { margin: 0; font-size: .875rem; line-height: 1.5; color: var(--spice-subtext); }
.gpb-footer { display: flex; justify-content: flex-end; }
.gpb-stop.gpb-open { outline: 2px solid var(--spice-text); outline-offset: 3px; }
.gpb-popover { position: fixed; z-index: 10; box-sizing: border-box; border-radius: 8px; background-color: var(--spice-card); box-shadow: 0 8px 24px rgba(0, 0, 0, .5); color: var(--spice-text); }
.gpb-popover[hidden] { display: none; }
.gpb-menu { display: flex; flex-direction: column; min-width: 140px; padding: 4px; }
.gpb-menu-item { padding: 8px 12px; border: 0; border-radius: 4px; background: none; color: var(--spice-text); font: inherit; font-size: .875rem; text-align: left; cursor: pointer; }
.gpb-menu-item:hover:not(:disabled), .gpb-menu-item:focus-visible { outline: none; background-color: rgba(var(--spice-rgb-text), .1); }
.gpb-menu-item:disabled { opacity: .5; cursor: default; }
`;

  const HELP_TEXT =
    "Click a colour to select it, then change it with the picker or a hex code. " +
    "Right-click it to duplicate or remove it. Drag colours to reorder them. Dashed colours follow your theme.";

  let modal = null; // the open modal's elements, or null
  let selectedId = "s1";

  // The selected stop; falls back to the first if the selection no longer exists.
  function selectedStop() {
    const stop = findStop(selectedId) ?? settings.stops[0];
    selectedId = stop.id;
    return stop;
  }

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
      <div class="gpb-gradient-row">
        <span class="gpb-label" id="gpb-gradient-label">Gradient</span>
        <button type="button" class="gpb-switch" role="switch" aria-labelledby="gpb-gradient-label"></button>
      </div>
      <div class="gpb-preview"></div>
      <div class="gpb-stops"></div>
      <div class="gpb-editor">
        <input type="color" class="gpb-picker" aria-label="Pick the selected colour" title="Pick a colour">
        <input type="text" class="gpb-hex" aria-label="Hex code of the selected colour" spellcheck="false" autocomplete="off" maxlength="7">
        <button type="button" class="gpb-button gpb-use-theme">Use theme colour</button>
      </div>
      <button type="button" class="gpb-button gpb-add">+ Add colour</button>
      <p class="gpb-help">${HELP_TEXT}</p>
      <div class="gpb-footer">
        <button type="button" class="gpb-button gpb-reset">Reset</button>
      </div>
      <div class="gpb-popover gpb-menu" role="menu" aria-label="Colour actions" hidden>
        <button type="button" role="menuitem" class="gpb-menu-item gpb-duplicate">Duplicate</button>
        <button type="button" role="menuitem" class="gpb-menu-item gpb-remove">Remove</button>
      </div>`;

    const m = {
      root,
      gradientRow: root.querySelector(".gpb-gradient-row"),
      switchButton: root.querySelector(".gpb-switch"),
      preview: root.querySelector(".gpb-preview"),
      stopsRow: root.querySelector(".gpb-stops"),
      picker: root.querySelector(".gpb-picker"),
      hex: root.querySelector(".gpb-hex"),
      useThemeButton: root.querySelector(".gpb-use-theme"),
      addButton: root.querySelector(".gpb-add"),
      menu: root.querySelector(".gpb-menu"),
      duplicateItem: root.querySelector(".gpb-duplicate"),
      removeItem: root.querySelector(".gpb-remove"),
      cleanups: [],
    };

    m.switchButton.addEventListener("click", toggleGradient);
    m.addButton.addEventListener("click", addStop);
    root.querySelector(".gpb-reset").addEventListener("click", resetSettings);
    m.stopsRow.addEventListener("click", (e) => {
      const el = e.target.closest(".gpb-stop");
      if (el) selectStop(el.dataset.id);
    });
    // Picker and hex field update in place: re-rendering would close the native picker.
    m.picker.addEventListener("input", () => editSelected(m.picker.value));
    m.hex.addEventListener("input", () => {
      const hex = parseHex(m.hex.value);
      m.hex.setAttribute("aria-invalid", String(!hex && m.hex.value.trim() !== ""));
      if (hex) editSelected(hex, { fromHex: true });
    });
    m.hex.addEventListener("change", () => renderEditor()); // blur / Enter: show the normalised value
    m.hex.addEventListener("keydown", (e) => {
      if (e.key === "Enter") m.hex.blur();
    });
    m.useThemeButton.addEventListener("click", () => linkStopToTheme(selectedStop().id));
    enableDotMenu(m);

    Spicetify.PopupModal.display({ title: "Gradient Progress Bar", content: root });
    modal = m;
    renderModal();
    watchModalClose(m);
    watchThemeColour(m);
    watchPopovers(m);
    enableDragAndDrop(m);
  }

  // ── Popovers: dot menu ──
  // Rendered inside the modal root: Spicetify's PopupModal hides itself when a click lands
  // outside .GenericModal (#26). Popovers are shown and hidden, never removed while the modal
  // is open, so a click is never dispatched to a detached element. One open at a time.

  let popover = null; // { kind, id, el, anchor, at, openedAt } or null
  const POPOVER_EDGE = 8; // min distance from the window edge
  const POPOVER_GAP = 8; // between a dot and a popover anchored to it

  function dotEl(id) {
    return modal?.stopsRow.querySelector(`.gpb-stop[data-id="${CSS.escape(id)}"]`) ?? null;
  }

  // `at` is a viewport point (menu at the cursor); without it the popover sits under the dot.
  function showPopover(kind, id, el, at = null) {
    closePopover();
    const anchor = dotEl(id);
    if (!anchor) return false;
    popover = { kind, id, el, anchor, at, openedAt: performance.now() };
    el.hidden = false;
    placePopover();
    anchor.classList.add("gpb-open");
    anchor.setAttribute("aria-expanded", "true");
    return true;
  }

  function closePopover({ focusDot = false } = {}) {
    if (!popover) return;
    const { el, anchor } = popover;
    popover = null;
    el.hidden = true; // hidden, not removed: it may contain the element being clicked (#26)
    anchor.classList.remove("gpb-open");
    anchor.setAttribute("aria-expanded", "false");
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

  // Escape, or a click or focus anywhere outside the open popover, closes it. Listeners live
  // only while the modal is open.
  function watchPopovers(m) {
    const listen = (target, type, handler) => {
      target.addEventListener(type, handler, true);
      m.cleanups.push(() => target.removeEventListener(type, handler, true));
    };
    // Clicking the picker's own dot toggles it in the dot's click handler instead.
    const outside = (target) =>
      popover && !popover.el.contains(target) && !(popover.kind === "picker" && popover.anchor.contains(target));
    listen(document, "pointerdown", (e) => outside(e.target) && closePopover());
    listen(document, "focusin", (e) => outside(e.target) && closePopover());
    listen(document, "keydown", (e) => {
      if (!popover || e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation(); // the popover closes, not the modal
      closePopover({ focusDot: true });
    });
    listen(window, "resize", () => closePopover());
    listen(document, "scroll", () => popover && (popover.kind === "menu" ? closePopover() : placePopover()));
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
      if (popover?.kind === "menu" && popover.id === id && performance.now() - popover.openedAt < 500) return;
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
    m.removeItem.addEventListener("click", () =>
      runMenuAction((id) => {
        const index = settings.stops.findIndex((s) => s.id === id);
        removeStop(id);
        return settings.stops[Math.min(index, settings.stops.length - 1)].id;
      })
    );
  }

  const menuItems = () => [...modal.menu.querySelectorAll(".gpb-menu-item:not(:disabled)")];

  function openMenu(id, { at = null, keyboard = false } = {}) {
    modal.duplicateItem.disabled = settings.stops.length >= MAX_STOPS;
    modal.removeItem.disabled = settings.stops.length <= 1;
    if (showPopover("menu", id, modal.menu, at) && keyboard) menuItems()[0]?.focus({ preventScroll: true });
  }

  // Hides the menu first, then acts: the clicked item stays connected, so the modal stays
  // open (#26). `action(id)` returns the id of the dot that should get focus afterwards.
  function runMenuAction(action) {
    if (popover?.kind !== "menu") return;
    const { id } = popover;
    closePopover();
    const focusId = action(id);
    dotEl(focusId)?.focus({ preventScroll: true });
  }

  function selectStop(id) {
    if (!findStop(id)) return;
    selectedId = id;
    for (const el of modal.stopsRow.querySelectorAll(".gpb-stop"))
      el.setAttribute("aria-pressed", String(el.dataset.id === id));
    renderEditor();
  }

  // Picker or hex field changed the selected colour (a theme stop becomes custom).
  function editSelected(colour, { fromHex = false } = {}) {
    const stop = selectedStop();
    setStopColour(stop.id, colour);
    renderStop(stop);
    if (!fromHex) {
      modal.hex.value = colour;
      modal.hex.setAttribute("aria-invalid", "false");
    } else modal.picker.value = colour;
    renderEditorButtons();
  }

  const STOP_GAP = 14; // matches .gpb-stops gap

  // The dots are buttons, so dragging never fights a native colour input (#8, #31).
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
      for (const stop of settings.stops) if (stop.kind === "theme") renderStop(stop);
      if (selectedStop().kind === "theme") renderEditor();
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
    closePopover(); // the dots are rebuilt, so a popover would lose its anchor
    renderSwitch();
    renderPreview();
    renderStops();
    renderEditor();
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
    const selected = selectedStop();
    row.textContent = "";
    settings.stops.forEach((stop, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "gpb-stop";
      el.draggable = true;
      el.dataset.id = stop.id;
      el.dataset.index = String(i + 1);
      el.setAttribute("aria-pressed", String(stop.id === selected.id));
      el.setAttribute("aria-haspopup", "menu");
      el.setAttribute("aria-expanded", "false");
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
    el.title = isTheme ? `Theme colour (${colour})` : colour;
    el.setAttribute("aria-label", `Colour ${el.dataset.index}: ${isTheme ? "theme colour" : colour}`);
  }

  function renderEditor() {
    const stop = selectedStop();
    const colour = resolveStop(stop);
    modal.picker.value = colour;
    if (document.activeElement !== modal.hex) {
      modal.hex.value = colour;
      modal.hex.setAttribute("aria-invalid", "false");
    }
    renderEditorButtons();
  }

  function renderEditorButtons() {
    const isTheme = selectedStop().kind === "theme";
    modal.useThemeButton.disabled = isTheme;
    modal.useThemeButton.textContent = isTheme ? "Following theme colour" : "Use theme colour";
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

    check(5, "One stop → switch disabled, gradient off", m.switchButton.disabled && !settings.gradient,
      `disabled ${m.switchButton.disabled}, gradient ${settings.gradient}`);
    m.addButton.click();
    stillOpen("adding a stop");
    check(5, "Adding a 2nd stop → gradient on, switch enabled",
      settings.stops.length === 2 && settings.gradient && m.switchButton.getAttribute("aria-checked") === "true" && !m.switchButton.disabled,
      `${settings.stops.length} stops, gradient ${settings.gradient}`);
    check(4, "New stop = last stop's resolved colour",
      settings.stops[1].kind === "custom" && settings.stops[1].color === resolveStop(settings.stops[0]),
      `${settings.stops[1].color} vs ${resolveStop(settings.stops[0])}`);
    const pressed = () => [...m.stopsRow.querySelectorAll('.gpb-stop[aria-pressed="true"]')].map((el) => el.dataset.id);
    check(30, "A new colour is selected", pressed().join() === settings.stops[1].id && selectedStop().id === settings.stops[1].id,
      `pressed ${pressed().join()}`);

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
    const help = m.root.querySelector(".gpb-help");
    const addBtn = m.root.querySelector(".gpb-add");
    check(31, "Help text sits between + Add colour and Reset",
      help?.textContent.includes("Drag") && addBtn.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING &&
        help.compareDocumentPosition(m.root.querySelector(".gpb-reset")) & Node.DOCUMENT_POSITION_FOLLOWING,
      help?.textContent ?? "missing");
    const icons = m.stopsRow.querySelectorAll("svg, .gpb-action, .gpb-badge, .gpb-grip");
    check(31, "No icons on the colour dots", !icons.length, `${icons.length} found`);

    // ── Dot menu (#33) ──
    const dots = () => [...m.stopsRow.querySelectorAll(".gpb-stop")];
    const menuShown = () => !m.menu.hidden && popover?.kind === "menu" && m.root.contains(m.menu);
    const rightClick = (el) => {
      const r = el.getBoundingClientRect();
      const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: at.x, clientY: at.y }));
      return at;
    };
    const press = (el, key, init = {}) =>
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    // The element's centre hit-tests to something inside `container`: visible, not clipped or covered.
    const hitsInside = (container, el) => {
      const r = el.getBoundingClientRect();
      return container.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    };

    await sleep(350); // let the modal's opening animation settle before measuring positions
    const cursor = rightClick(dots()[1]);
    const mr = m.menu.getBoundingClientRect();
    const near = (a, b) => Math.abs(a - b) < 1.5;
    const atCursor = (near(mr.left, cursor.x) || near(mr.right, cursor.x)) && (near(mr.top, cursor.y) || near(mr.bottom, cursor.y));
    check(33, "Right-click on a dot opens the menu inside the modal root, at the cursor", menuShown() && atCursor,
      `shown ${menuShown()}, menu ${Math.round(mr.left)},${Math.round(mr.top)}, cursor ${Math.round(cursor.x)},${Math.round(cursor.y)}`);
    check(33, "Menu is visible on top (not clipped by the modal)", hitsInside(m.menu, m.removeItem), "");
    m.removeItem.click();
    await sleep(20);
    stillOpen("Remove in the dot menu");
    check(5, "Remove down to one stop → gradient off, switch disabled, menu closed",
      settings.stops.length === 1 && !settings.gradient && m.switchButton.disabled && !menuShown(),
      `${settings.stops.length} stop(s), gradient ${settings.gradient}`);

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

    setTestSettings(false, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
    const opacities = [...m.stopsRow.querySelectorAll(".gpb-stop")].map((el) => getComputedStyle(el).opacity || "1");
    check(4, "Gradient off with 3 stops → stops 2–3 at 50 % opacity", opacities.join() === "1,0.5,0.5", opacities.join(", "));

    setTestSettings(true, [theme("s1"), custom("s2", RED)]);
    if (fill) {
      const preview = getComputedStyle(m.preview).backgroundImage;
      const bar = getComputedStyle(fill).backgroundImage;
      check(9, "Preview shows the same gradient as the bar", preview === bar, preview);
    }

    const stopEl = (i) => m.stopsRow.querySelectorAll(".gpb-stop")[i];
    stopEl(0).click(); // select the theme stop
    rootStyle.setProperty("--spice-button", PROBE, "important");
    await tick(); // let the :root MutationObserver run
    const swatch = computedHex(stopEl(0), "backgroundColor");
    const editorSeen = `picker ${m.picker.value}, hex ${m.hex.value}`;
    const editorFollows = m.picker.value === PROBE && m.hex.value === PROBE;
    restoreButton();
    await tick();
    check(11, "Open modal: theme dot and editor follow a runtime --spice-button change", swatch === PROBE && editorFollows,
      `dot ${swatch}, ${editorSeen}`);
    check(31, "Theme colours are shown with a dashed ring", stopEl(0).classList.contains("gpb-theme") &&
      getComputedStyle(stopEl(0)).borderTopStyle === "dashed", getComputedStyle(stopEl(0)).borderTopStyle);

    const themeDot = stopEl(0);
    m.picker.value = GREEN;
    m.picker.dispatchEvent(new Event("input", { bubbles: true }));
    check(7, "Picking a colour for a theme stop → custom, without re-rendering (picker stays open)",
      settings.stops[0].kind === "custom" && settings.stops[0].color === GREEN && themeDot.isConnected &&
        !themeDot.classList.contains("gpb-theme") && m.hex.value === GREEN,
      JSON.stringify(settings.stops[0]));

    stopEl(1).click();
    check(30, "Hex field shows the selected colour", m.hex.value === RED && m.picker.value === RED, m.hex.value);
    const typeHex = (value) => {
      m.hex.value = value;
      m.hex.dispatchEvent(new Event("input", { bubbles: true }));
    };
    typeHex("ABCDEF");
    const afterPlain = settings.stops[1].color;
    typeHex("#0f0");
    const afterShort = settings.stops[1].color;
    check(30, "Hex field accepts rrggbb and #rgb, case-insensitive, and updates bar + picker",
      afterPlain === "#abcdef" && afterShort === "#00ff00" && m.picker.value === "#00ff00" &&
        styleText().includes("#00ff00") && stopEl(1).isConnected,
      `${afterPlain}, ${afterShort}, picker ${m.picker.value}`);
    typeHex("#zz12");
    check(30, "Invalid hex is flagged and ignored", m.hex.getAttribute("aria-invalid") === "true" && settings.stops[1].color === "#00ff00",
      `aria-invalid ${m.hex.getAttribute("aria-invalid")}, colour ${settings.stops[1].color}`);
    m.hex.dispatchEvent(new Event("change", { bubbles: true }));
    check(30, "Leaving the hex field restores the normalised value", m.hex.value === "#00ff00" && m.hex.getAttribute("aria-invalid") === "false",
      m.hex.value);

    m.useThemeButton.click();
    await sleep(20);
    stillOpen("linking a stop to the theme colour");
    check(31, "'Use theme colour' turns the selected stop into a theme stop",
      settings.stops[1].kind === "theme" && !("color" in settings.stops[1]) && m.useThemeButton.disabled,
      `${JSON.stringify(settings.stops[1])}, button "${m.useThemeButton.textContent}"`);

    setTestSettings(true, [custom("s1", RED), custom("s2", GREEN), custom("s3", BLUE)]);
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
    check(8, "Only the colour dots are draggable, never an input",
      draggable.length === 3 && draggable.every((el) => el.classList.contains("gpb-stop") && el.tagName === "BUTTON"),
      draggable.map((el) => `${el.tagName.toLowerCase()}.${el.className}`).join(", "));

    stillOpen("dragging a stop");
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
  const ENTRY_ICON =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1 7h14v2H1z" opacity=".35"/><path d="M1 7h9v2H1z"/><circle cx="10" cy="8" r="2.5"/></svg>';

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
        new Spicetify.Menu.Item(ENTRY_LABEL, false, openModal).register();
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
