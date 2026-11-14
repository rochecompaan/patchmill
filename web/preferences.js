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
  const name = value.trim();
  if (!name || name.length > 32)
    throw new Error("Enter a name of 1 to 32 characters.");
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
