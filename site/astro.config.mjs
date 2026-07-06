import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://patchmill.dev",
  integrations: [
    starlight({
      title: "Patchmill",
      description:
        "Patchmill is an agent-driven software factory for turning product work into reviewed, landed changes.",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
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
        baseUrl:
          "https://github.com/rochecompaan/patchmill/edit/main/site/src/content/docs/",
      },
      customCss: ["./src/styles/starlight.css"],
      sidebar: [
        {
          label: "Getting started",
          items: [
            {
              label: "What Patchmill is",
              slug: "getting-started/what-is-patchmill",
            },
          ],
        },
      ],
    }),
  ],
});
