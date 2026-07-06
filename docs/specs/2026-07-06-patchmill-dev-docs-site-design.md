# Patchmill.dev Documentation Site Design

## Summary

Build `patchmill.dev` as a static documentation site using Astro and Starlight.
The site will live in this repository under `site/`, deploy to GitHub Pages, and
present Patchmill as an agent-driven software factory while preserving
maintainable Markdown-first documentation.

The first version should lead with a polished product landing page and support
mostly standard docs pages. It should serve a mixed audience: developers
evaluating Patchmill, existing users looking for reference material, and
contributors who need to understand the workflow model.

## Goals

- Create a public `patchmill.dev` site in this repository.
- Use Astro for a flexible product landing page.
- Use Starlight for documentation navigation, search, page layout, code
  highlighting, dark mode, and accessibility defaults.
- Deploy static output to GitHub Pages.
- Adapt the existing README and public reference docs into purpose-written site
  content.
- Keep the first implementation small enough to maintain alongside the
  TypeScript package.

## Non-goals

- Do not build a highly custom marketing application in the first version.
- Do not publish internal plans, specs, or implementation notes from
  `docs/plans/` or `docs/specs/`.
- Do not introduce docs versioning, i18n, blog infrastructure, or plugin-heavy
  community features unless a later requirement justifies them.
- Do not move the existing package source or change Patchmill runtime behavior
  as part of the docs-site setup.

## Site architecture

Add a dedicated Astro app under `site/`.

Proposed structure:

```text
site/
  astro.config.mjs
  package.json
  src/
    assets/
    content/
      docs/
    pages/
      index.astro
  public/
```

The root package remains the Patchmill package. The site should have its own
`site/package.json` initially. A workspace setup can be introduced later if it
becomes useful, but the first version should minimize coupling with the
CLI/package build.

`site/src/pages/index.astro` will provide the custom landing page. Starlight
docs content will live in `site/src/content/docs/`. Static assets such as logos,
screenshots, or diagrams should live under `site/src/assets/` or `site/public/`
depending on how Astro needs to reference them.

## Content model

The homepage should explain Patchmill as an agent-driven software factory: a
visible production line from issue intake to reviewed, landed change. It should
make the core value clear quickly, then route readers into installation and
conceptual docs.

Primary calls to action:

- Get started
- Read the docs
- View on GitHub

Initial docs navigation:

- Getting started
  - What Patchmill is
  - Quickstart
  - Configuration
- Guides
  - Issue-agent workflows
  - Skills configuration
  - Providers
- Reference
  - Task contracts
  - Environment variables and configuration reference

The existing `README.md` and public Markdown docs under `docs/` are source
material, but the site should not simply mirror the README. Rewrite or split
content where that produces clearer onboarding and reference pages.

Exclude internal development artifacts from the public site, especially
`docs/plans/`, `docs/specs/`, and any private process notes that are useful to
maintainers but not to users evaluating Patchmill.

## Design direction

Use Starlight's standard docs UI for documentation pages. Keep custom visual
work focused on the landing page so the site remains easy to maintain.

The landing page should feel polished and product-led without becoming a bespoke
web app. It should reuse existing Patchmill logo assets where possible and
establish a simple visual language that can grow later: strong headline, clear
value proposition, product workflow framing, concise feature sections, and
direct CTAs.

## Deployment

Deploy the static site to GitHub Pages from the `site/` app.

Expected build output:

```text
site/dist/
```

Add a GitHub Actions workflow that installs site dependencies, builds the Astro
site, and publishes the generated static output to GitHub Pages. The workflow
should run on manual dispatch and on pushes that touch `site/**` or the Pages
workflow file.

## Root scripts

Add root convenience scripts so maintainers do not need to remember site-local
commands:

```json
{
  "site:dev": "npm --prefix site run dev",
  "site:build": "npm --prefix site run build",
  "site:preview": "npm --prefix site run preview"
}
```

The exact commands can be adjusted to match the generated Astro/Starlight
package scripts.

## Verification plan

For the first implementation:

1. Install or update dependencies for the site.
2. Build the site with `npm run site:build`.
3. Run existing project checks that are appropriate for the touched files.
4. Because npm dependency files will change, rerun the Nix build as required by
   the project instructions.
5. Confirm the GitHub Pages workflow syntax is valid by linting or using an
   appropriate dry-run/static validation where available.

Do not add tests merely to assert workflow YAML or static docs text. Use build,
lint, and existing tests for verification instead.

## Implementation planning notes

- Use `site/` as the dedicated docs-site directory.
- Reuse the existing Patchmill logo assets for the landing page and Starlight
  header, selecting the light/dark variants that match the generated theme.
- Copy and adapt selected public docs into `site/src/content/docs/` for the
  first version instead of generating pages directly from the existing
  `docs/*.md` files.
