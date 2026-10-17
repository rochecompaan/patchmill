# Quality checks

Run these commands from a source checkout after `npm ci`. Use existing
behavioral tests for meaningful changes. Use direct inspection and formatting
for documentation and static configuration. Do not add tests that only assert
document text, dependency versions, or static file structure.

| Gate             | Command                | Purpose                                               |
| ---------------- | ---------------------- | ----------------------------------------------------- |
| Type checks      | `npm run check:types`  | Check TypeScript types. Also runs through `npm test`. |
| Behavioral tests | `npm test`             | Run the existing `node --test` suites.                |
| TypeScript lint  | `npm run lint:ts`      | Run ESLint.                                           |
| Format           | `npm run format:check` | Run Prettier without writes.                          |
| Markdown lint    | `npm run lint:md`      | Run markdownlint.                                     |

`npm run lint` combines format, TypeScript lint, and Markdown lint. Build and
package smoke commands remain integration checks. They do not replace these
gates. See `package.json` for the exact command definitions.
