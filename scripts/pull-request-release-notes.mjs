export const GITHUB_PULL_REQUEST_BODY_LIMIT = 65_536;

/**
 * Renders a pull-request body whose release notes fit GitHub's body limit.
 *
 * Releases stay in the given order (oldest first). When every full note does
 * not fit, the oldest releases are rendered as links instead, one at a time,
 * until the body fits. The newest notes matter most for review, so they are
 * the last to be reduced. The body is rejected only when it is still too long
 * with every release rendered as a link.
 */
export function renderReleaseNotesWithinLimit({
  label,
  releases,
  renderFull,
  renderLink,
  renderBody,
}) {
  for (let linked = 0; linked <= releases.length; linked += 1) {
    const sections = releases.map((release, index) =>
      index < linked ? renderLink(release) : renderFull(release),
    );
    const body = renderBody({ sections, notice: truncationNotice(linked) });
    if (body.length <= GITHUB_PULL_REQUEST_BODY_LIMIT) return body;
  }
  throw new Error(
    `${label} pull-request body exceeds GitHub's 65,536-character limit`,
  );
}

function truncationNotice(linked) {
  if (linked === 0) return undefined;
  const releases = linked === 1 ? "release" : "releases";
  return `Full notes for the ${linked} oldest ${releases} were left out to stay within GitHub's 65,536-character pull-request body limit. Follow the links to read them.`;
}
