// Applies the saved theme before first paint. Kept as a file because the CSP forbids inline scripts.
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  } catch (e) { /* storage blocked: follow the system setting */ }
})();
