// Gradient Progress Bar has moved to https://github.com/VoidCrowned/spicetify-gradient-bars.
// This file only loads it from there, marked as coming from this forwarder, unless it already runs.
(function () {
  document.currentScript?.setAttribute("data-gradient-bars-forwarder", "");
  if (window.__gpb || window.__gradientBarsCopies?.gpb?.active) {
    console.warn("[gpb] Gradient Progress Bar already runs, so the forwarder from the old repository skips it. Keep only one of them installed.");
    return;
  }
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/gh/VoidCrowned/spicetify-gradient-bars@main/dist/gradientProgressBar.js?time=" + Date.now();
  script.dataset.gradientBarsVia = "forwarder";
  document.head.append(script);
})();
