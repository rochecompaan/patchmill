export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
  /** Opt-in lifecycle for Patchmill-owned Git groups, not agent processes. */
  ownedGit?: {
    onSpawn: (processGroupId: number) => Promise<void>;
    onStopped: (verified: boolean) => Promise<void>;
    shutdownMs?: number;
  };
};

export type CommandRunner = {
  supportsOwnedGit?: true;
  run(
    command: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult>;
};
