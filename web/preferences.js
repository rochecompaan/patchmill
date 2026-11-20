/** @typedef {Pick<Storage,'getItem'|'setItem'>|null} PreferenceStorage */
/** @param {PreferenceStorage} storage @param {string} key */
function read(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
/** @param {string} value */
function validName(value) {
  const name = value.isWellFormed() ? value.trim().normalize("NFC") : "";
  // The server refuses these names too (src/web/person-name.ts).
  if (
    !name ||
    Array.from(name).length > 32 ||
    // eslint-disable-next-line no-control-regex -- the rule is about them
    /[\u0000-\u001f\u007f-\u009f]/.test(name) ||
    name.startsWith("/")
  )
    throw new Error(
      "Enter a name of 1 to 32 characters that does not start with /.",
    );
  return name;
}
/** @param {PreferenceStorage} storage @returns {string|null} */
export function readName(storage) {
  try {
    return validName(read(storage, "patchmill-name") ?? "");
  } catch {
    return null;
  }
}
/** @param {PreferenceStorage} storage @param {string} value */
export function saveName(storage, value) {
  const name = validName(value);
  try {
    storage?.setItem("patchmill-name", name);
  } catch {
    /* Keep the name in memory if storage is unavailable. */
  }
  return name;
}
/** @param {PreferenceStorage} storage @param {boolean} osLight @returns {'light'|'dark'} */
export function preferredTheme(storage, osLight) {
  const saved = read(storage, "patchmill-theme");
  return saved === "light" || saved === "dark"
    ? saved
    : osLight
      ? "light"
      : "dark";
}
