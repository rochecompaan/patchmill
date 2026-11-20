import { el, person } from "./dom.js";
/** @typedef {import('../src/web/api-types.ts').PresencePerson} PresencePerson */

/** At most this many avatars show; the rest go in a `+N` chip. */
const SHOWN = 5;

/** @param {string} me @param {readonly PresencePerson[]|null} people @returns {string[]} */
export function presenceNames(me, people) {
  const names = [me];
  for (const p of people ?? []) if (!names.includes(p.name)) names.push(p.name);
  return names;
}

/** @param {string} me @param {readonly PresencePerson[]|null} people */
export function typingText(me, people) {
  const typing = (people ?? [])
    .filter((p) => p.typing && p.name !== me)
    .map((p) => p.name);
  if (!typing.length) return "";
  if (typing.length === 1) return `${typing[0]} is typing`;
  if (typing.length === 2) return `${typing[0]} and ${typing[1]} are typing`;
  return `${typing.length} people are typing`;
}

/**
 * The lines to announce for a new list. The first list after a connect
 * announces nothing.
 * @param {readonly PresencePerson[]|null} previous
 * @param {readonly PresencePerson[]} next
 * @param {string} me
 * @returns {string[]}
 */
export function presenceChanges(previous, next, me) {
  if (!previous) return [];
  const before = previous.map((p) => p.name).filter((n) => n !== me);
  const after = next.map((p) => p.name).filter((n) => n !== me);
  return [
    ...after
      .filter((n) => !before.includes(n))
      .map((n) => `${n} joined the page.`),
    ...before
      .filter((n) => !after.includes(n))
      .map((n) => `${n} left the page.`),
  ];
}

/** @param {string[]} names */
function spoken(names) {
  const all = ["you", ...names.slice(1)];
  if (all.length === 1) return "you";
  return `${all.slice(0, -1).join(", ")} and ${all.at(-1)}`;
}

/**
 * Fill the "here now" avatars, their hidden text and the typing line in
 * place. A slot that is not in `root` is skipped.
 * @param {ParentNode} root @param {string} me @param {readonly PresencePerson[]|null} people
 */
export function paintPresence(root, me, people) {
  const stack = root.querySelector(".presence[data-live]");
  const doc = root.ownerDocument ?? /** @type {Document} */ (root);
  if (stack) {
    const names = presenceNames(me, people);
    const avatars = names.slice(0, SHOWN).map((n) => {
      const a = person(doc, n, true);
      a.setAttribute("aria-hidden", "true");
      return a;
    });
    if (names.length > SHOWN) {
      const more = el(doc, "span", "av av-more sm", `+${names.length - SHOWN}`);
      more.title = names.slice(SHOWN).join(", ");
      more.setAttribute("aria-hidden", "true");
      avatars.push(more);
    }
    stack.replaceChildren(...avatars);
    const text = root.querySelector(".presence-text");
    if (text) text.textContent = `Here now: ${spoken(names)}`;
  }
  const line = root.querySelector(".typing");
  if (line) {
    const text = typingText(me, people);
    if (!text) line.replaceChildren();
    else if (line.querySelector(".typing-text")?.textContent !== text) {
      const dots = el(doc, "span", "dots");
      dots.append(el(doc, "i"), el(doc, "i"), el(doc, "i"));
      line.replaceChildren(dots, el(doc, "span", "typing-text", text));
    }
  }
}
