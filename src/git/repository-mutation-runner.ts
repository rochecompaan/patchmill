import type { CommandRunner } from "../command/types.ts";
import {
  withRepositoryMutation,
  type RepositoryMutationContext,
} from "./repository-mutation.ts";

/** Supplies one transaction runner to the full check-and-mutate operation. */
export function withRepositoryMutationRunner<T>(
  runner: CommandRunner,
  context: RepositoryMutationContext | undefined,
  action: (runner: CommandRunner) => Promise<T>,
): Promise<T> {
  if (context === undefined) return action(runner);
  return withRepositoryMutation(context, (transaction) =>
    action({
      ...(runner.supportsOwnedGit ? { supportsOwnedGit: true as const } : {}),
      run: (command, args, options) =>
        command === "git"
          ? transaction.run(args, options)
          : runner.run(command, args, options),
    }),
  );
}
