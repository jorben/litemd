// Run before the stylesheet so a saved theme is applied before the first paint.
(() => {
  let preference = "system";
  try {
    const stored = localStorage.getItem("litemd-theme");
    if (["light", "dark", "system"].includes(stored)) preference = stored;
  } catch { /* System appearance works when browser storage is unavailable. */ }
  document.documentElement.dataset.theme = preference;
})();
