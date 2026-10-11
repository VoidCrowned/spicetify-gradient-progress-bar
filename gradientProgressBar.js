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

  // ── Start-up ────────────────────────────────────────────────────────────────

  let settings = loadSettings();
  window.addEventListener("beforeunload", flushSettings);
})();
