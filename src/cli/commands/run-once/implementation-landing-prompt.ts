export function renderPrCreationInstruction(
  remote: string,
  issueNumber: number,
  requiredPullRequestMarker?: string,
): string {
  return [
    `Push the branch to \`${remote}\` and open a pull request using the repository's configured host tooling. Include \`Closes #${issueNumber}\` in the pull request description/body.`,
    "Use a multiline-safe PR body construction path so Markdown line breaks remain real newlines.",
    'For Forgejo/Gitea through `tea`, write the Markdown PR description to a temp file or here-doc first, then pass actual newline characters with `tea pulls create --description "$(cat "$file")"`.',
    "Do not pass Markdown containing literal `\\n` escape text as the `tea --description` value.",
    "For GitHub through `gh`, use a multiline-safe supported path such as `gh pr create --body-file`.",
    "Example PR body shape:",
    "```md",
    "Summary",
    "",
    "- Implemented change summary.",
    "",
    "## Validation",
    "",
    "- npm test",
    "",
    "## Reviews",
    "",
    "- Review completed.",
    "",
    `Closes #${issueNumber}`,
    ...(requiredPullRequestMarker === undefined
      ? []
      : [requiredPullRequestMarker]),
    "```",
  ].join("\n");
}

function renderBlockedContract(): string {
  return `Blocker contract:
If human input is required, stop safely, leave committed work as-is, keep the reason and questions concise enough to post directly as a \`needs-info\` comment, and return this exact JSON object as the final response:
{
  "status": "blocked",
  "reason": "short reason",
  "questions": [
    {
      "question": "question a human must answer",
      "recommendedAnswer": "recommended answer and reasoning"
    }
  ],
  "commits": ["<sha>"],
  "validation": ["command and result summary"]
}`;
}

function renderPrCreatedContract(branch: string): string {
  return `Successful final response for human-review PR fallback:
Return this exact JSON object after PR handoff succeeds:
{
  "status": "pr-created",
  "prUrl": "<pull request URL>",
  "branch": "${branch}",
  "commits": ["<sha>"],
  "validation": ["command and result summary"],
  "reviewSummary": "short reviewer/fix summary",
  "landingDecision": "PR required: <reason>"
}`;
}

export function renderLandingResultContracts(input: {
  allowDirectLand: boolean;
  hasLandingSkill: boolean;
  targetBranch: string;
  remote: string;
  issueNumber: number;
  branch: string;
  requiredPullRequestMarker?: string;
}): string {
  const {
    targetBranch,
    remote,
    issueNumber,
    branch,
    requiredPullRequestMarker,
  } = input;
  const prInstruction = renderPrCreationInstruction(
    remote,
    issueNumber,
    requiredPullRequestMarker,
  );
  return `Landing result contracts:
Direct squash-landing is disabled for this repository.
${prInstruction}
Do not land directly on \`${targetBranch}\`.

If human review is required:
1. ${prInstruction}
2. Explain briefly why human review is required.
3. Return the \`pr-created\` final response.

${renderBlockedContract()}

${renderPrCreatedContract(branch)}`;
}
