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

Patchmill should not reimplement Pi's provider/auth/model discovery when a Pi
surface exists. Provider readiness checks should delegate to Pi's existing model
registry and auth resolution through a stable library API or CLI behavior, so
Patchmill observes the same provider availability that Pi itself would use.
Direct inspection of environment variables, `auth.json`, or `models.json` is
only a fallback when Pi does not expose a stable readiness API for the needed
check.

## Init flow

`patchmill init` should run this sequence:

1. Create or validate the minimal Patchmill config as today.
2. Install or validate project-local skills as today.
3. Perform existing local setup such as `.git/info/exclude` entries and optional
   deterministic label setup.
4. Ask Pi, through its existing model/auth implementation, whether a usable
   provider/model appears available.
5. If Pi reports usable models, select a model for the smoke test; interactive
   runs may prompt, while non-interactive runs choose the first Pi-reported
   model.
6. If Pi does not report usable models, keep setup explicit: run the smoke test
   without a model override and render manual Pi `/login` remediation only when
   setup is missing or the smoke test fails.
7. Run a real Pi smoke test immediately.
8. Print next steps based on the smoke-test result.

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

## Model selection and setup remediation

Patchmill should not introduce a fake setup wizard that merely tells the user to
run unconstrained Pi and `/login`. Until Patchmill can route through a stable Pi
login API, setup should remain explicit manual remediation and the owned
interactive behavior should be limited to model selection for Pi-reported
available models.

The first implementation should create dedicated modules with clean seams:

- `pi-preflight`: wrap Pi's existing provider/auth/model discovery instead of
  duplicating it. Prefer a stable Pi library API; otherwise use the narrowest Pi
  CLI behavior that exercises the same code path, such as model listing or a dry
  readiness probe.
- `pi-model-selection`: select one Pi-reported model for the smoke test. It must
  not fabricate provider credentials or silently fall back after invalid input.
- `pi-smoke-test`: run the final Pi smoke test and normalize success/failure.

Model-selection flow:

1. If Pi reports usable models and init is interactive, let the user choose a
   listed model or enter an explicit `provider/model` string.
2. If Pi reports usable models and init is non-interactive, choose the first
   Pi-reported model for the smoke test.
3. If Pi does not report usable models, do not prompt for fake setup. Run the
   smoke test without a model override and render manual Pi `/login` remediation
   if the smoke test fails.
4. If interactive model input is invalid, do not silently choose the first
   model; report invalid selection and skip the smoke test.

Patchmill must not write API keys into `patchmill.config.json`.

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

Doctor remediation should point back to `patchmill init` when available, while
still documenting manual Pi `/login` setup.

## Testing

Add tests for:

- Pi-backed readiness detection reports available auth/model and smoke test is
  invoked;
- direct env/auth-file probing is covered only as a fallback when the Pi-backed
  readiness surface is unavailable;
- no auth in interactive mode does not pretend to configure Pi and reports
  manual remediation when the smoke test fails;
- no auth in non-interactive mode prints manual remediation and does not hang;
- smoke-test success prints `patchmill triage --dry-run` as the next step;
- smoke-test failure keeps Patchmill config but reports incomplete Pi setup;
- `patchmill.config.json` never contains API keys or other credential values;
- invalid model input does not silently fall back to the first model;
- `--yes` does not silently choose or create provider credentials.
