# Changelog

## [0.5.1](https://github.com/rochecompaan/patchmill/compare/v0.5.0...v0.5.1) (2026-06-01)


### Bug Fixes

* **nix:** update and check npm deps hash ([41a0b2a](https://github.com/rochecompaan/patchmill/commit/41a0b2aec0ec1b24917b874ac0bca6d22af92fad))
* **release:** format generated release files ([f3e877b](https://github.com/rochecompaan/patchmill/commit/f3e877b4384b5fa8aa14d810282f62867f753751))

## [0.5.0](https://github.com/rochecompaan/patchmill/compare/v0.4.0...v0.5.0) (2026-06-01)


### Features

* **init:** add Pi provider onboarding ([#9](https://github.com/rochecompaan/patchmill/issues/9)) ([19ce441](https://github.com/rochecompaan/patchmill/commit/19ce4415f8207d48eb99c92f7d0aff21de6581d8))

## [0.4.0](https://github.com/rochecompaan/patchmill/compare/v0.3.2...v0.4.0) (2026-05-31)


### Features

* **labels:** automate approved setup ([cdcd8a0](https://github.com/rochecompaan/patchmill/commit/cdcd8a01cac4f4b70a7e569f6e864161d8a9c57b))

## [0.3.2](https://github.com/rochecompaan/patchmill/compare/v0.3.1...v0.3.2) (2026-05-31)


### Bug Fixes

* **init:** make installed skills owner-writable ([035c2fa](https://github.com/rochecompaan/patchmill/commit/035c2fac4167070719ed5b30f134ccacee137f69))
* **init:** make patchmill setup local-only ([e04351b](https://github.com/rochecompaan/patchmill/commit/e04351bf526121f731f3d29d14a23cd30b0ecd68))
* **init:** use local git excludes ([2ad36df](https://github.com/rochecompaan/patchmill/commit/2ad36dfbfe100bdd9589031de598bcaaffb103c8))

## [0.3.1](https://github.com/rochecompaan/patchmill/compare/v0.3.0...v0.3.1) (2026-05-31)


### Bug Fixes

* **nix:** bundle skills in package ([d8ece26](https://github.com/rochecompaan/patchmill/commit/d8ece26528832c9a7f977d282341be4009433c2d))

## [0.3.0](https://github.com/rochecompaan/patchmill/compare/v0.2.1...v0.3.0) (2026-05-31)


### Features

* **triage:** add structured triage guidance ([aec2da5](https://github.com/rochecompaan/patchmill/commit/aec2da5da8da71e70b6da0a7d5c76c66f70c041c))


### Bug Fixes

* **nix:** update release npm deps hash ([539b493](https://github.com/rochecompaan/patchmill/commit/539b49316502dce7ed4295b02385a2f5d2b109ad))
* **release:** update nix hash in release workflow ([5b1aaf8](https://github.com/rochecompaan/patchmill/commit/5b1aaf8bf71a23823a8cde28153269f69b63c7d4))

## [0.2.1](https://github.com/rochecompaan/patchmill/compare/v0.2.0...v0.2.1) (2026-05-31)


### Bug Fixes

* **nix:** update npm deps hash ([2999d82](https://github.com/rochecompaan/patchmill/commit/2999d824c2d1e9c2e22bae7f39e32b2b6fa734a3))
* **release:** use plain version tags ([ec43aa9](https://github.com/rochecompaan/patchmill/commit/ec43aa96deac01798f14f33d8451bedaf7621304))

## [0.2.0](https://github.com/rochecompaan/patchmill/compare/patchmill-v0.1.0...patchmill-v0.2.0) (2026-05-30)


### Features

* bootstrap patchmill ([fd803df](https://github.com/rochecompaan/patchmill/commit/fd803df6f2852d6f9ee838678a4d465c1f2c4f79))
* **cleanup:** replace tilt cleanup with hooks ([0a56588](https://github.com/rochecompaan/patchmill/commit/0a56588292afa470c91e3a5df3f85939b862ce00))
* **cli:** add init and doctor commands ([cd691cf](https://github.com/rochecompaan/patchmill/commit/cd691cf2bb9459de29cbcea2f7c82065f18fafea))
* **cli:** add patchmill command dispatcher tests ([d9462f7](https://github.com/rochecompaan/patchmill/commit/d9462f7b3848da1aaff589af89201918f092ae9b))
* **config:** add patchmill defaults ([b8502d5](https://github.com/rochecompaan/patchmill/commit/b8502d5840e234366e67734ba15af04ca0ecc837))
* **config:** load patchmill project config ([ac0cf84](https://github.com/rochecompaan/patchmill/commit/ac0cf84b6624618d99056652ac2f3f0c022b99f4))
* **config:** load skills settings ([2325c43](https://github.com/rochecompaan/patchmill/commit/2325c43584ee50e72cdf84a48b0c0b8872a46fb3))
* **config:** prefer patchmill environment variables ([ca91dfb](https://github.com/rochecompaan/patchmill/commit/ca91dfbbb288bcb01609078f8485f440fcb9bfa8))
* **config:** wire patchmill config into workflows ([a37d6d7](https://github.com/rochecompaan/patchmill/commit/a37d6d7c31be112118e0b1768693da51c0a76029))
* **doctor:** add read-only readiness checks ([52ae07a](https://github.com/rochecompaan/patchmill/commit/52ae07ab4b98426f6065e04544d1498abf457f34))
* **doctor:** wire readiness command ([1c33e67](https://github.com/rochecompaan/patchmill/commit/1c33e67201739fd223270f3c126632cf96e2cada))
* **git:** add configurable worktree strategy ([7cab075](https://github.com/rochecompaan/patchmill/commit/7cab07527f91282d602f70e9f919d17f4c77f4db))
* **host:** add forgejo tea provider ([2516e25](https://github.com/rochecompaan/patchmill/commit/2516e2586d0b137899c44c70b9eee39aed107dd7))
* **host:** split visual evidence upload from policy ([610d149](https://github.com/rochecompaan/patchmill/commit/610d1491bf6452167684ae1f0100e7e223b645e4))
* **init:** hand off pi provider setup ([24d89a5](https://github.com/rochecompaan/patchmill/commit/24d89a506f4a41471f4a485d0f551f448668cd8a))
* **init:** write minimal patchmill config ([9cdb213](https://github.com/rochecompaan/patchmill/commit/9cdb213eb3b81a63d10978a5e102e2b4569ac2f2))
* install project-local default skills ([#2](https://github.com/rochecompaan/patchmill/issues/2)) ([e05d8d9](https://github.com/rochecompaan/patchmill/commit/e05d8d98d6424d04162ceec3af2c7bcb5a81ceb6))
* **nix:** add patchmill package derivation ([9950762](https://github.com/rochecompaan/patchmill/commit/9950762c4bbd3af5a7b92d295a26c6ae6bca13cc))
* **nix:** expose patchmill flake package ([6c51681](https://github.com/rochecompaan/patchmill/commit/6c51681c3aa45ddeeb84f54fa81d7f476c0553b8))
* **paths:** use patchmill state and log paths ([e77bd24](https://github.com/rochecompaan/patchmill/commit/e77bd245e2ee47f3060a0f582841b839dada5cd0))
* **pi:** add concrete pi runner ([1a6512a](https://github.com/rochecompaan/patchmill/commit/1a6512ad8ada41830cd5e72397d71cf65bc3e1fd))
* **policy:** define configurable project workflow policy ([28588f9](https://github.com/rochecompaan/patchmill/commit/28588f98ec13bf4b5da8b3ccb718fec1ef03a11a))
* **policy:** document pi task contracts ([f356fe0](https://github.com/rochecompaan/patchmill/commit/f356fe009750a441dce77dd145348ac7972b3a67))
* **policy:** generalize triage taxonomy ([9e4117b](https://github.com/rochecompaan/patchmill/commit/9e4117bd4de5fa7ff1d2d79d9106a64a2f7c319c))
* **prompts:** render prompts from configured skills ([dfb3857](https://github.com/rochecompaan/patchmill/commit/dfb38571a519d5d8394ab57b282f1a5c4eda1ad3))
* **providers:** add github gh host support ([c275164](https://github.com/rochecompaan/patchmill/commit/c2751645f4937e06c5cc28168ebe51660dc603bd))
* **run-once:** honor triage state blockers ([47daa08](https://github.com/rochecompaan/patchmill/commit/47daa08b68bd8d8c1bad0b79bb8705725c2e7a92))
* **runtime:** bundle Pi todo extension ([ce0afd8](https://github.com/rochecompaan/patchmill/commit/ce0afd82c95d74a306ea700e5ff430e5cf34938a))
* **skills:** add default issue triage skill ([ab1e0ea](https://github.com/rochecompaan/patchmill/commit/ab1e0eae1d10c23033efa558fdb21cf52728b163))
* **triage:** add change reporting helpers ([d47f87e](https://github.com/rochecompaan/patchmill/commit/d47f87ec61b77fb85d94a2d11bd30d74a5b13c07))
* **triage:** add configurable state map ([5f9ca22](https://github.com/rochecompaan/patchmill/commit/5f9ca22d5aedad23ab147b94d958e046e225996a))
* **triage:** add skill preview agent ([e037de3](https://github.com/rochecompaan/patchmill/commit/e037de3f53e93abab1fa604b27ef9b6c31df5db1))
* **triage:** execute by default ([8531466](https://github.com/rochecompaan/patchmill/commit/8531466efa2e2d246cbda4dbcd437d7269cb3770))
* **triage:** integrate skill-managed pipeline ([dab05c3](https://github.com/rochecompaan/patchmill/commit/dab05c3b73d6a6567c66ce293857dcfd834b3823))
* **triage:** run skill-managed execution ([8c0591e](https://github.com/rochecompaan/patchmill/commit/8c0591e4dc6cf9ac96d6012b27580e37868ef337))
* **triage:** use configured triage skill ([41cbe7e](https://github.com/rochecompaan/patchmill/commit/41cbe7ee7f086256547ba08d18d10fe9c62d203b))
* **triage:** wire state map into cli policies ([53f0eb3](https://github.com/rochecompaan/patchmill/commit/53f0eb3a159ff54223e2ac060296b8d39ad2b63d))
* **workflow:** add direct skills config ([b5e85d3](https://github.com/rochecompaan/patchmill/commit/b5e85d3b3e58c67e519bdecb755be8963531d23a))


### Bug Fixes

* **cli:** update run-once triage imports ([33776df](https://github.com/rochecompaan/patchmill/commit/33776df564f72dc7e8431aedcae82227e9128454))
* **cli:** update triage references after move ([426b00e](https://github.com/rochecompaan/patchmill/commit/426b00e989f84520757993c760d9ba8e827752aa))
* **config:** enforce approval and triage thinking ([15f5a3e](https://github.com/rochecompaan/patchmill/commit/15f5a3ea0994f737d4e6cb42ab8e546d752e4c2e))
* **doctor:** honor configured readiness paths ([9d2d6e6](https://github.com/rochecompaan/patchmill/commit/9d2d6e66e97f712be325ad1118faed9ed97a1821))
* **init:** clarify pi setup handoff failures ([582f726](https://github.com/rochecompaan/patchmill/commit/582f726cc8f9f345127be46150450939a3f1c7d7))
* **nix:** pin patchmill npm dependencies ([f0e63af](https://github.com/rochecompaan/patchmill/commit/f0e63af7ed2a3c5c148501d2f8741837bfd0f8b7))
* **nix:** run patchmill outside node_modules ([90f2253](https://github.com/rochecompaan/patchmill/commit/90f225385d2471dd84dfc8161059878880b91433))
* **onboarding:** validate skills and gate pi handoff ([9ff8606](https://github.com/rochecompaan/patchmill/commit/9ff86069f0686adbaf37e152cd5e68df037f3856))
* **pipeline:** require landing skill for direct land ([3c3388e](https://github.com/rochecompaan/patchmill/commit/3c3388e37f41b482d7e8f21460972d8a12a24ca0))
* **prompts:** preserve skills landing safeguards ([92fb5da](https://github.com/rochecompaan/patchmill/commit/92fb5daf4696b1d3c41f34380f19a6fde4d4b339))
* **run-once:** load bundled pi-subagents ([d0b92c7](https://github.com/rochecompaan/patchmill/commit/d0b92c7e5bffefa919d5543717be74d657c5e679))
* **run-once:** preserve state blockers with custom exclusions ([8a80b60](https://github.com/rochecompaan/patchmill/commit/8a80b6084b9e8a70823b662066e9105444cd5c0a))
* **triage:** clean up dry-run prompt temp files ([b44cb83](https://github.com/rochecompaan/patchmill/commit/b44cb83946498f85b1d0d8be698c0a2d84008de4))
* **triage:** finish classifier cleanup ([abffbf1](https://github.com/rochecompaan/patchmill/commit/abffbf1ca6698118ea49db24f805609399af30c1))
* **triage:** harden change reporting ([4b9d7ad](https://github.com/rochecompaan/patchmill/commit/4b9d7ad17d6418648d671d41103b0bdc97979bca))
* **triage:** include state map in execute prompt ([79d1cb7](https://github.com/rochecompaan/patchmill/commit/79d1cb7ed919d53ea2dec45b71b5612c8a3bdb88))
* **triage:** load bundled dry-run skill ([eb6842c](https://github.com/rochecompaan/patchmill/commit/eb6842c8dceea41ba89009a9631eca5d76a8532f))
* **triage:** pass configured skills to agent ([b8998ad](https://github.com/rochecompaan/patchmill/commit/b8998ad149a5c634791953f37a2fbd809bf86fc8))
* **triage:** remove classifier policy remnants ([786553b](https://github.com/rochecompaan/patchmill/commit/786553bafdc4689e1a99f8f5a7dbaa562e6c78b3))
* **triage:** remove stale classifier remnants ([fd14108](https://github.com/rochecompaan/patchmill/commit/fd14108d5a850441e38baf17a920fee848398da3))
* **triage:** update bundled skill for execution ([bf534c6](https://github.com/rochecompaan/patchmill/commit/bf534c6e96e58b277c470b463db2d010df5e3563))
* **workflow:** preserve default skills when merging ([3e37650](https://github.com/rochecompaan/patchmill/commit/3e37650ba431a61ce6c853d7270d89152ac61494))

## 0.1.0

Initial development release.
