const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The message for a name that `parsePersonName` refuses. */
export const PERSON_NAME_RULE =
  "Give a name of 1 to 80 characters that does not start with /.";

/**
 * Return the trimmed NFC form of a person's name, or null when the value is
 * not a name: 1 to 80 code points, no control characters, no leading `/`.
 * A name is a label, not an identity.
 */
export function parsePersonName(value: unknown): string | null {
  if (typeof value !== "string" || !value.isWellFormed()) return null;
  const name = value.trim().normalize("NFC");
  if (
    !name ||
    Array.from(name).length > 80 ||
    CONTROL.test(name) ||
    name.startsWith("/")
  )
    return null;
  return name;
}
