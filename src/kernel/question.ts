import { errorMessage } from "./errors.ts";

/** Required questions must be posted before recording the workflow status. */
export async function postQuestionThenRecord(
  post: (() => Promise<string>) | undefined,
  record: (questionUrl?: string) => Promise<void>,
  failure: { prefix: string; noun: string },
): Promise<void> {
  let questionUrl: string | undefined;
  if (post) {
    try {
      questionUrl = await post();
    } catch (error) {
      throw new Error(`Comment failed: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }
  try {
    await record(questionUrl);
  } catch (error) {
    throw new Error(
      `${failure.prefix}: ${errorMessage(error)}${questionUrl !== undefined ? ` (${failure.noun} posted at ${questionUrl})` : ""}`,
      { cause: error },
    );
  }
}
