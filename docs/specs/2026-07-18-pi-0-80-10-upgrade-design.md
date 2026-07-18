# Pi 0.80.10 compatibility upgrade design

## Context

Patchmill currently pins `@earendil-works/pi-coding-agent` and
`@earendil-works/pi-tui` to `0.80.3` in `package.json`, `package-lock.json`, and
`npm-shrinkwrap.json`. Pi `0.80.10` is available, but the release train between
those versions includes a breaking SDK migration that affects Patchmill's `init`
and `auth` code.

This upgrade is a manual prerequisite before issue #96. Issue #96 should
automate future Pi dependency upgrade PRs after Patchmill's compatibility
boundary is updated to work with current Pi APIs.

## Release-note findings

- `v0.80.5`: no migration or breaking notice found.
- `v0.80.6`: added the `max` thinking level and input-token pricing tiers. No
  direct Patchmill migration required.
- `v0.80.7`: breaking `models.json` compatibility rename for OpenAI Responses
  custom models: `compat.sendSessionIdHeader` was removed and replaced by
  `compat.sessionAffinityFormat`. Patchmill does not currently reference
  `sendSessionIdHeader`, so no repository migration is needed.
- `v0.80.8`: breaking SDK auth/model runtime migration:
  - `CreateAgentSessionOptions.authStorage` and `modelRegistry` were replaced by
    async `modelRuntime`.
  - `AuthStorage` and storage backends are no longer exported from the root
    `@earendil-works/pi-coding-agent` package.
  - `ModelRegistry.refresh()` is now asynchronous.
  - `ModelRuntime` is the canonical SDK facade for model configuration, provider
    authentication, provider-owned login, and dynamic catalogs.
- `v0.80.9`: added Kimi K3/deferred tool loading and removed several built-in
  xAI model catalog entries. No direct Patchmill migration required.
- `v0.80.10`: fixed Kimi thinking metadata and restored xAI catalog generation
  issues from `0.80.9`. No direct Patchmill migration required beyond the
  `0.80.8` SDK migration.

Confirmed against the `0.80.10` packages: `@earendil-works/pi-coding-agent` root
exports `ModelRuntime`, `ModelRegistry`, `readStoredCredential`, and
`getAgentDir`; it does not export `AuthStorage`. Other direct Patchmill imports
from `@earendil-works/pi-tui`, `@earendil-works/pi-ai`, and coding-agent UI
helpers remain available.

## Decision

Upgrade Patchmill to Pi `0.80.10` by migrating Patchmill's repo-local Pi
auth/readiness boundary from root-exported `AuthStorage` to `ModelRuntime`.

Do not implement issue #96 automation in this change. This work should leave
Patchmill in a known-good manual-upgrade state so issue #96 can later automate
the same metadata updates and run the compatibility checks.

## Goals

- Patchmill builds, tests, and packages with
  `@earendil-works/pi-coding-agent@0.80.10` and `@earendil-works/pi-tui@0.80.10`
  exact pins.
- `patchmill init` and `patchmill auth` continue to use repo-local
  `.patchmill/pi-agent/auth.json` and `.patchmill/pi-agent/models.json`.
- Patchmill no longer imports the removed root `AuthStorage` export from
  `@earendil-works/pi-coding-agent`.
- Compatibility coverage fails clearly if future Pi packages remove or change
  the SDK symbols Patchmill uses.
- Nix packaging uses the updated npm dependency graph and verifies the
  packed/install-level behavior.

## Non-goals

- Do not build the issue #96 scheduled/automated upgrade PR workflow in this
  change.
- Do not change upstream Pi APIs or vendor Pi internals into Patchmill.
- Do not migrate user auth file formats beyond Pi's normal `ModelRuntime`
  handling of the existing `auth.json` shape.
- Do not alter Patchmill's default model-selection UX except where necessary to
  adapt to async Pi runtime APIs.

## Design

### Repo-local Pi runtime factory

Introduce a small Patchmill-owned adapter around
`ModelRuntime.create({ authPath, modelsPath })`. The adapter should be
responsible for constructing the Pi runtime for repo-local auth and model
configuration paths:

- `authPath`: `join(agentDir, "auth.json")`
- `modelsPath`: `join(agentDir, "models.json")`

The adapter should expose only the methods Patchmill needs:

- list provider/model choices for API-key setup;
- list OAuth-capable providers for subscription setup;
- read current provider credential/status labels;
- persist API-key credentials;
- run provider-owned OAuth login;
- refresh model/catalog availability;
- provide synchronous snapshots where the model selector needs stable arrays.

Keeping this adapter local prevents Pi SDK shape changes from leaking through
the rest of Patchmill's init/auth code.

### Readiness detection

Update `src/cli/commands/init/pi-preflight.ts` to construct readiness from
`ModelRuntime` instead of `AuthStorage + ModelRegistry.create(...)`.

`ModelRuntime.create` and `ModelRuntime.refresh` are async, so the default
readiness detector path should become async. Callers that inject fake readiness
in tests can keep passing a ready-made detector, but production `runInit` and
`patchmill auth` paths must await readiness before selecting models or running
smoke tests.

The readiness data model can remain unchanged:

- `ready` when one or more configured provider/model choices are available;
- `missing` when Pi reports no configured provider/model choices;
- `error` when the runtime reports model/provider configuration errors and no
  usable choices are available.

### Interactive auth setup

Update `src/cli/commands/init/pi-auth-flow.ts` to use the same local runtime
adapter.

API-key setup should persist credentials through Pi's credential store path
rather than runtime-only overrides. The Pi `CredentialStore` contract persists a
credential with:

```ts
await credentials.modify(providerId, async () => ({ type: "api_key", key }));
```

If the adapter cannot access the credential store directly from public APIs, use
`ModelRuntime.login(providerId, "api_key", interaction)` and route the
interaction prompt through Patchmill's existing `promptApiKey` callback. Do not
use `setRuntimeApiKey` for Patchmill init/auth because Pi documents that as a
non-persisted runtime override.

OAuth/subscription setup should use
`ModelRuntime.login(providerId, "oauth", interaction)`. Map Pi's
`AuthInteraction` events to Patchmill's existing OAuth callbacks:

- `auth_url` -> display/open auth URL;
- `device_code` -> display/open verification URI and code;
- `progress`/`info` -> terminal progress messages;
- `prompt` text/secret/manual-code/select -> existing TUI prompt/select helpers.

After any successful login, await runtime refresh before detecting readiness and
prompting for a default model.

### Provider choices and status labels

Replace `AuthStorageLike` with adapter-level provider credential/status reads.
`createAuthProviderChoices` can keep returning the same `AuthProviderChoice`
objects, but it should not assume `AuthStorage.getOAuthProviders()`, `get()`, or
`getAuthStatus()` exist.

For OAuth choices, use Pi provider metadata exposed by
`ModelRuntime.getProviders()` and include providers that support OAuth login.
For API-key choices, use the providers represented by all configured/built-in
models. Status labels should preserve current user-facing behavior where
possible:

- stored API key -> `✓ configured` for API-key mode;
- stored OAuth -> `✓ configured` for OAuth mode;
- environment/runtime/models.json sources -> the existing descriptive labels;
- unconfigured -> `• unconfigured`.

### Compatibility contract tests

Update `src/cli/commands/init/pi-dependency-contract.test.ts` so it reflects the
new compatibility boundary:

- require root exports `ModelRuntime`, `ModelRegistry`, and `getAgentDir`;
- require `ModelRuntime.create` to be a function;
- require `ModelRegistry.prototype.refresh` to be a function and treat it as
  async in Patchmill code;
- assert `AuthStorage` is not part of Patchmill's required root-export contract.

Add focused tests around the adapter behavior so future Pi changes fail with
actionable messages before package publication.

### Dependency metadata updates

Update exact Pi pins together:

- `package.json`: `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`
  to `0.80.10`.
- `package-lock.json`: resolved root package records and nested Pi dependency
  graph.
- `npm-shrinkwrap.json`: same resolved dependency graph for published installs.
- `nix/package.nix`: update `npmDepsHash` after lockfile changes.

Do not widen the Pi dependency ranges. Exact pins remain part of Patchmill's
compatibility boundary until issue #96 automates validated updates.

## Testing and verification

Use automated tests for the SDK migration because it changes production
behavior, reusable auth logic, async control flow, and dependency compatibility.

Required verification:

1. Targeted init/auth tests:
   - `node --test src/cli/commands/init/pi-auth-flow.test.ts src/cli/commands/init/pi-auth-provider-state.test.ts src/cli/commands/init/pi-preflight.test.ts src/cli/commands/init/pi-dependency-contract.test.ts`
2. Full Node test suite:
   - `npm test`
3. Type/build verification:
   - `npm run build`
4. Lint/format verification:
   - `npm run lint`
5. Packed artifact smoke:
   - `npm pack`
   - install the tarball into a temporary project;
   - run `patchmill --help`;
   - run `patchmill init --skills none --yes` or the current non-interactive
     equivalent;
   - assert the installed package resolves
     `@earendil-works/pi-coding-agent/package.json` version `0.80.10` and
     `@earendil-works/pi-tui/package.json` version `0.80.10`.
6. Nix verification after npm dependency changes:
   - run the package build/install checks exposed by the flake, including the
     Patchmill package output;
   - if the flake exposes broader checks, run the relevant package check set.

Because npm dependencies change, rerun the Nix build as part of verification per
project instructions.

## Risks and mitigations

- **Risk: persisted API keys accidentally become runtime-only.** Mitigation: do
  not use `ModelRuntime.setRuntimeApiKey` for init/auth persistence; test that
  API-key setup writes `auth.json` through the persistent login/credential path.
- **Risk: async refresh timing hides configured models.** Mitigation: await
  `ModelRuntime.create` and refresh before readiness detection; add tests that
  fail when selection reads stale snapshots.
- **Risk: provider-owned login prompts differ from the older OAuth callback
  shape.** Mitigation: centralize prompt/event mapping in one adapter and cover
  text, secret/manual code, select, auth URL, device code, and progress paths.
- **Risk: npm lockfile and shrinkwrap drift.** Mitigation: update both lockfiles
  in the same task and assert the same `0.80.10` root dependency versions.
- **Risk: Nix `npmDepsHash` mismatch.** Mitigation: rebuild once to obtain the
  new hash, update `nix/package.nix`, and rerun the Nix package build.

## Relationship to issue #96

This design deliberately does not automate future upgrades. After this manual
compatibility upgrade lands, issue #96 can automate the metadata bump and
validation workflow with a cleaner target:

- exact Pi pins remain the source of truth;
- compatibility tests check Patchmill's current Pi SDK boundary;
- packed artifact smoke tests assert installed Pi versions;
- Nix hash updates become a mechanical part of an upgrade PR.
