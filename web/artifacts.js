import { el, icon, externalLink, renderBlocks } from "./dom.js";
import { safePreviewUrl } from "./links.js";
/** @typedef {import('../src/web/api-types.ts').Artifact} Artifact */
/** @param {HTMLDialogElement} dialog @returns {{open:(artifact:Artifact,origin:HTMLElement)=>void,close:()=>void}} */
export function mountArtifactViewer(dialog) {
  const doc = dialog.ownerDocument,
    container = /** @type {HTMLElement} */ (dialog.querySelector(".vw"));
  /** @type {Artifact|null} */ let active = null;
  /** @type {HTMLElement|null} */ let trigger = null;
  let index = 0;
  /** @param {string} action @param {string} text @param {string} [className] */
  function button(action, text, className = "btn btn-sm") {
    const b = el(doc, "button", className, text);
    b.type = "button";
    b.dataset.vw = action;
    return b;
  }
  function render() {
    const a = active;
    if (!a) return;
    const head = el(doc, "div", "vw-head");
    head.append(
      el(
        doc,
        "div",
        "vw-kind",
        {
          spec: "Spec",
          plan: "Plan",
          mockup: "Mockup",
          diagram: "Show-me diagram",
          shots: "Visual evidence",
        }[a.kind],
      ),
    );
    const title = el(doc, "h2");
    title.id = "vw-title";
    title.append(icon(doc, "icon-" + a.kind), doc.createTextNode(a.title));
    if (a.draft) title.append(el(doc, "span", "art-draft", "draft"));
    head.append(title);
    const meta = el(doc, "div", "vw-meta");
    meta.append(
      el(doc, "code", "", a.path),
      el(doc, "span", "", a.commit ? "at " + a.commit : "Not committed"),
      el(doc, "span", "", a.location),
    );
    head.append(meta);
    const actions = el(doc, "div", "vw-actions");
    if (a.sourceUrl)
      actions.append(
        externalLink(doc, "View on GitHub", a.sourceUrl, "btn btn-sm"),
      );
    const local =
      a.preview.kind === "page"
        ? safePreviewUrl(a.preview.url)
        : a.preview.kind === "gallery"
          ? safePreviewUrl(a.preview.shots[index]?.url ?? "")
          : null;
    if (local) {
      const link = el(doc, "a", "btn btn-sm", "Open in new tab");
      link.href = local;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      actions.append(link);
    }
    if (actions.childElementCount) head.append(actions);
    const close = button("close", "×", "vw-close");
    close.setAttribute("aria-label", "Close");
    head.append(close);
    const body = el(doc, "div", "vw-body");
    if (a.preview.kind === "document") {
      const article = el(doc, "article", "md-body");
      article.append(renderBlocks(doc, a.preview.blocks));
      body.append(article);
    } else if (a.preview.kind === "page" && local) {
      body.classList.add("is-frame");
      const frame = el(doc, "iframe", "art-frame");
      frame.title = a.title;
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.src = local;
      body.append(
        frame,
        el(
          doc,
          "p",
          "vw-note",
          "Sample preview. Scripts are off. The file cannot read this page or act as you.",
        ),
      );
    } else if (a.preview.kind === "gallery") {
      const shots = a.preview.shots,
        shot = shots[index];
      if (shot) {
        const figure = el(doc, "figure", "gallery"),
          image = el(doc, "div", "shot"),
          url = safePreviewUrl(shot.url);
        if (url) {
          const img = el(doc, "img");
          img.src = url;
          img.alt = shot.caption;
          image.append(img);
        }
        const caption = el(doc, "figcaption");
        caption.append(
          el(doc, "b", "", shot.caption),
          el(doc, "code", "", shot.path),
        );
        figure.append(image, caption);
        body.append(figure);
        const nav = el(doc, "div", "gal-nav"),
          prev = button("prev", "←"),
          next = button("next", "→"),
          count = el(
            doc,
            "span",
            "gal-count",
            `${index + 1} / ${shots.length}`,
          );
        prev.setAttribute("aria-label", "Previous screenshot");
        next.setAttribute("aria-label", "Next screenshot");
        count.setAttribute("aria-live", "polite");
        nav.append(prev, count, next);
        const thumbs = el(doc, "div", "thumbs");
        shots.forEach((item, i) => {
          const b = button("shot", String(i + 1), "thumb");
          b.dataset.index = String(i);
          b.setAttribute("aria-label", `Screenshot ${i + 1}: ${item.caption}`);
          b.setAttribute("aria-current", String(i === index));
          const url = safePreviewUrl(item.url);
          if (url) {
            const img = el(doc, "img");
            img.alt = "";
            img.src = url;
            b.replaceChildren(img);
          }
          thumbs.append(b);
        });
        nav.append(thumbs);
        body.append(nav);
      }
    } else body.append(el(doc, "p", "", "Preview unavailable."));
    container.replaceChildren(head, body);
  }
  /** @param {number} delta */
  function move(delta) {
    if (active?.preview.kind !== "gallery" || !active.preview.shots.length)
      return;
    index =
      (index + delta + active.preview.shots.length) %
      active.preview.shots.length;
    render();
  }
  function close() {
    if (dialog.open) dialog.close();
  }
  /** @param {string} action */
  function focusAction(action) {
    [...container.querySelectorAll("button")]
      .find((b) => b.dataset.vw === action)
      ?.focus();
  }
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    active = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    trigger = null;
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      close();
      return;
    }
    if (!(event.target instanceof Element)) return;
    const b = event.target.closest("[data-vw]");
    const action = b?.getAttribute("data-vw");
    if (action === "close") close();
    else if (action === "prev" || action === "next") {
      move(action === "next" ? 1 : -1);
      focusAction(action);
    } else if (action === "shot") {
      const target = Number(b?.getAttribute("data-index"));
      if (
        active?.preview.kind === "gallery" &&
        Number.isInteger(target) &&
        target >= 0 &&
        target < active.preview.shots.length
      ) {
        index = target;
        render();
        const thumbnail = [...container.querySelectorAll("button")].find(
          (b) => b.dataset.vw === "shot" && b.dataset.index === String(index),
        );
        thumbnail?.focus();
      }
    }
  });
  dialog.addEventListener("keydown", (event) => {
    if (
      active?.preview.kind === "gallery" &&
      ["ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      event.preventDefault();
      move(event.key === "ArrowRight" ? 1 : -1);
      focusAction("close");
    }
  });
  return {
    /** @param {Artifact} artifact @param {HTMLElement} origin */ open(
      artifact,
      origin,
    ) {
      active = artifact;
      trigger = origin;
      index = 0;
      render();
      if (!dialog.open) dialog.showModal();
      focusAction("close");
    },
    close,
  };
}
