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
          label: "Guides",
          items: [
            {
              label: "Issue-agent workflows",
              slug: "guides/issue-agent-workflows",
            },
            {
              label: "Workflow artifacts",
              slug: "guides/workflow-artifacts",
            },
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
              label: "Task contracts",
              slug: "reference/task-contracts",
            },
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
