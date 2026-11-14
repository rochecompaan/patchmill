(() => {
  let saved = null;
  try {
    saved = localStorage.getItem("patchmill-theme");
  } catch {
    /* Storage can be disabled. */
  }
  document.documentElement.dataset.theme =
    saved === "light" || saved === "dark"
      ? saved
      : matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
})();
