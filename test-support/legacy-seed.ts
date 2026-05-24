function text(...parts: string[]): string {
  return parts.join("");
}

export const LEGACY_RUN_ONCE_LOGIN_ENV = text(
  "CROP",
  "RUN_AGENT_ISSUE_TEA_LOGIN",
);
export const LEGACY_TRIAGE_LOGIN_ENV = text("CROP", "RUN_TRIAGE_TEA_LOGIN");
export const LEGACY_AGENT_TEAM_ENV = text("CROP", "RUN_AGENT_ISSUE_AGENT_TEAM");
export const LEGACY_FORGEJO_URL_ENV = text(
  "CROP",
  "RUN_AGENT_ISSUE_FORGEJO_URL",
);
export const LEGACY_FORGEJO_TOKEN_ENV = text(
  "CROP",
  "RUN_AGENT_ISSUE_FORGEJO_TOKEN",
);
export const LEGACY_FORGEJO_REPO_ENV = text(
  "CROP",
  "RUN_AGENT_ISSUE_FORGEJO_REPO",
);

export function literalPattern(textValue: string): RegExp {
  return new RegExp(textValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
