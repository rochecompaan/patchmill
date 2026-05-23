export type CleanupHookConfig = {
  name: string;
  whenPathExists?: string;
  terminateProcessPatterns?: string[];
  command?: string;
  args?: string[];
};

export type CleanupHookResult = {
  name: string;
  status: "skipped" | "cleaned" | "failed";
  message: string;
};
