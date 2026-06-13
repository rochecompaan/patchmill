import type { IssueHostProvider } from "../../../host/types.ts";
import { missingLabelDefinitions } from "../triage/labels.ts";
import type { AgentIssueConfig } from "./types.ts";

export async function ensureAutomationLabel(
  host: IssueHostProvider,
  config: Pick<AgentIssueConfig, "labelCatalog">,
  name: string,
): Promise<void> {
  const missing = missingLabelDefinitions(
    await host.listLabels(),
    config.labelCatalog,
  );
  const label = missing.find((definition) => definition.name === name);
  if (!label) return;
  await host.createLabel(label);
}
