# Pi provider onboarding during `patchmill init`

## Purpose

Patchmill onboarding currently lets users create configuration, run `doctor`,
and try `triage --dry-run` before they have explicitly selected a Pi provider,
logged in, or selected a model. That makes the first real workflow fail late and
makes Pi setup feel separate from Patchmill setup.

`patchmill init` should become the first-use gate for Pi provider readiness. It
should guide the user through provider/model setup when needed, run a real Pi
smoke test, and only then point the user at `patchmill triage --dry-run`.

## Ownership boundaries

Patchmill must not create repository-local Pi credential state.

- Pi credentials and provider auth remain user-level Pi state, such as
  `~/.pi/agent/auth.json` or provider API key environment variables.
- Patchmill writes only Patchmill repository configuration.
- Patchmill may later store a non-secret preferred model/provider string in repo
  config if deterministic automation needs it, but this design does not require
  storing secrets or changing Pi's agent directory.
- Existing user-level Pi configuration is treated as apparent setup, but `init`
  still verifies it with a smoke test.

Pi is considered apparently configured when any of the following are present:

- known provider API key environment variables, such as `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, or `GEMINI_API_KEY`;
- user-level Pi auth entries in `~/.pi/agent/auth.json`;
- user-level Pi model/provider configuration such as `~/.pi/agent/models.json`.

## Init flow

`patchmill init` should run this sequence:

1. Create or validate the minimal Patchmill config as today.
2. Install or validate project-local skills as today.
3. Perform existing local setup such as `.git/info/exclude` entries and optional
   deterministic label setup.
4. Detect apparent Pi provider/auth/model configuration.
5. If setup is missing, or if the user chooses to reconfigure, run an embedded
   Pi setup wizard.
6. Run a real Pi smoke test immediately.
7. Print next steps based on the smoke-test result.

The smoke test should use Pi print mode with no Patchmill session or project
context, for example:

```sh
pi --no-session --no-context-files --no-prompt-templates \
  -p "Reply with PATCHMILL_PI_OK and nothing else."
```

If a specific selected model is available, include it explicitly:

```sh
pi --no-session --no-context-files --no-prompt-templates \
  --model <provider/model> \
  -p "Reply with PATCHMILL_PI_OK and nothing else."
```

On success, `init` should point the user at:

```sh
patchmill triage --dry-run
```

On failure, `init` should keep the created Patchmill config but report that Pi
setup is incomplete and point the user at remediation plus `patchmill doctor`.

## Embedded setup wizard

The setup wizard should be Patchmill-owned rather than a normal unconstrained Pi
session. Launching Pi directly and asking the user to run `/login` gives too
little control over whether provider login and model selection are completed.

The first implementation should create a dedicated setup module with clean
seams:

- `pi-preflight`: detect apparent existing Pi auth/model configuration.
- `pi-setup-wizard`: interactively collect provider/login/model choices.
- `pi-smoke-test`: run the final Pi smoke test and normalize success/failure.

The wizard should prefer Pi UI library components when Patchmill can import them
cleanly. If direct Pi TUI reuse is awkward, the first version may use readline
prompts with the same flow and keep the module boundary ready for a later TUI
swap.

Wizard flow:

1. If no apparent configuration exists, ask whether to configure Pi now.
2. If apparent configuration exists, ask whether to use it or reconfigure.
3. Let the user select a common provider or choose manual/custom setup.
4. For key-based providers, show exact environment variable or Pi auth guidance.
5. For OAuth-capable providers, route through Pi-compatible login behavior where
   possible.
6. Let the user select a recommended model for common providers or manually
   enter a `provider/model` string.
7. Run the smoke test.

The wizard must not write API keys into `patchmill.config.json`.

## Non-interactive and `--yes` behavior

`patchmill init --yes` may approve deterministic Patchmill setup such as label
creation, but it must not invent credentials or silently choose a private model
provider. If provider setup requires user input, `--yes` should print manual
setup instructions and continue to the smoke test only when apparent Pi
configuration already exists.

Non-interactive `init` must never hang. If auth/model setup is missing, it
should print exact manual remediation, such as:

```sh
pi
/login
patchmill init
# or
patchmill doctor
```

It may return success for config creation while clearly stating that Pi provider
setup is incomplete, or it may return a distinct non-zero status if the command
contract is later tightened. The key requirement is that the output is explicit
and machine-safe.

## Doctor relationship

`patchmill doctor` should keep its Pi binary and Pi provider checks. After this
change, doctor is a re-check and troubleshooting command rather than the first
place users discover that provider/model setup was skipped.

Doctor remediation should point back to the embedded `init` setup path when
available, while still documenting manual Pi `/login` setup.

## Testing

Add tests for:

- apparent user-level Pi auth detected and smoke test invoked;
- no auth in interactive mode, setup accepted, wizard completed, smoke test
  invoked;
- no auth in non-interactive mode prints manual remediation and does not hang;
- smoke-test success prints `patchmill triage --dry-run` as the next step;
- smoke-test failure keeps Patchmill config but reports incomplete Pi setup;
- `patchmill.config.json` never contains API keys or other credential values;
- `--yes` does not silently choose or create provider credentials.
