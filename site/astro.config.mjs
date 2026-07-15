import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightThemeNova from "starlight-theme-nova";

export default defineConfig({
  site: "https://patchmill.dev",
  integrations: [
    starlight({
      title: "Patchmill",
      description:
        "Patchmill is an agent-driven software factory for turning product work into reviewed, landed changes.",
      head: [
        {
          tag: "link",
          attrs: { rel: "icon", href: "/favicon.ico", sizes: "any" },
        },
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: "/favicon.svg",
            type: "image/svg+xml",
          },
        },
        {
          tag: "link",
          attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        },
      ],
      logo: {
        light: "./src/assets/logo-horizontal-light.svg",
        dark: "./src/assets/logo-horizontal-dark.svg",
        alt: "Patchmill",
        replacesTitle: true,
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/rochecompaan/patchmill",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/rochecompaan/patchmill/edit/main/site/",
      },
      plugins: [starlightThemeNova()],
      customCss: ["./src/styles/starlight.css"],
      sidebar: [
        {
          label: "Getting started",
          items: [
            {
              label: "Overview",
              slug: "getting-started/overview",
            },
            { label: "Quickstart", slug: "getting-started/quickstart" },
            {
              label: "Configuration",
              slug: "getting-started/configuration",
            },
          ],
        },
        {
          label: "Using Patchmill",
          items: [
            { label: "Triage", slug: "using-patchmill/triage" },
            { label: "Run-once", slug: "using-patchmill/run-once" },
            {
              label: "Workflow artifacts",
              slug: "using-patchmill/workflow-artifacts",
            },
          ],
        },
        {
          label: "Guides",
          items: [
            {
              label: "Skills configuration",
              slug: "guides/skills-configuration",
            },
            { label: "Providers", slug: "guides/providers" },
          ],
        },
        {
          label: "Reference",
          items: [
            {
              label: "Configuration example",
              slug: "reference/configuration-example",
            },
            {
              label: "Workflow labels",
              slug: "reference/workflow-labels",
            },
            {
              label: "Task contracts",
              slug: "reference/task-contracts",
            },
            {
              label: "Agent workflow lifecycle",
              slug: "reference/agent-workflow-lifecycle",
            },
            { label: "Git safety", slug: "reference/git-safety" },
            {
              label: "Environment and configuration",
              slug: "reference/environment-and-config",
            },
          ],
        },
      ],
    }),
  ],
});
