export const HELP_TEXT = `Usage:
  patchmill init [options]

Create a minimal patchmill.config.json for this repository.

Options:
  --help, -h  Show this help and exit.
`;

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    return 0;
  }
  console.log("patchmill init is not implemented yet");
  return 1;
}
