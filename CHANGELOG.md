# Changelog

## [1.3.1](https://github.com/TheFehr/foundry-playwright/compare/v1.3.0...v1.3.1) (2026-08-30)

### Bug Fixes

- Windows compatibility for process.getuid/getgid ([#88](https://github.com/TheFehr/foundry-playwright/issues/88)) ([635d029](https://github.com/TheFehr/foundry-playwright/commit/635d0298f1a35aec079925d06546b37e1660a74c))

# [1.3.0](https://github.com/TheFehr/foundry-playwright/compare/v1.2.1...v1.3.0) (2026-08-30)

### Features

- **state:** add createEmbeddedDocument(s), mixed manifest+registry module install ([#85](https://github.com/TheFehr/foundry-playwright/issues/85)) ([47a29d0](https://github.com/TheFehr/foundry-playwright/commit/47a29d070d74a157952c5a77851d9375af1dff59))

## [1.2.1](https://github.com/TheFehr/foundry-playwright/compare/v1.2.0...v1.2.1) (2026-08-26)

### Bug Fixes

- **deps:** bump @playwright/test peer/dev dependency floor to 1.51.0 ([#83](https://github.com/TheFehr/foundry-playwright/issues/83)) ([0e17cdf](https://github.com/TheFehr/foundry-playwright/commit/0e17cdfa3538c632a18192267031eaa71d3b235d))

# [1.2.0](https://github.com/TheFehr/foundry-playwright/compare/v1.1.4...v1.2.0) (2026-08-26)

### Features

- **setup:** add Foundry V12 support ([#80](https://github.com/TheFehr/foundry-playwright/issues/80)) ([de9b6c5](https://github.com/TheFehr/foundry-playwright/commit/de9b6c50ffaf2229a96a622bc4ea027b70e71af2))

## [1.1.4](https://github.com/TheFehr/foundry-playwright/compare/v1.1.3...v1.1.4) (2026-08-23)

## [1.1.3](https://github.com/TheFehr/foundry-playwright/compare/v1.1.2...v1.1.3) (2026-08-22)

## [1.1.2](https://github.com/TheFehr/foundry-playwright/compare/v1.1.1...v1.1.2) (2026-08-22)

## [1.1.1](https://github.com/TheFehr/foundry-playwright/compare/v1.1.0...v1.1.1) (2026-08-21)

### Bug Fixes

- **setup:** support FVTT 14.366's join-form login change ([#71](https://github.com/TheFehr/foundry-playwright/issues/71)) ([a6836da](https://github.com/TheFehr/foundry-playwright/commit/a6836da997d9ae51cde4fc67a9a7d90379a54e64))

# [1.1.0](https://github.com/TheFehr/foundry-playwright/compare/v1.0.1...v1.1.0) (2026-08-19)

### Features

- **verify:** make verification failures self-diagnosing ([#69](https://github.com/TheFehr/foundry-playwright/issues/69)) ([55d5f83](https://github.com/TheFehr/foundry-playwright/commit/55d5f830fb58ed9d3684b2cdd55157562fabe72c))

## [1.0.1](https://github.com/TheFehr/foundry-playwright/compare/v1.0.0...v1.0.1) (2026-08-19)

# [1.0.0](https://github.com/TheFehr/foundry-playwright/compare/v0.7.5...v1.0.0) (2026-08-18)

- fix(systems)!: throw on unregistered system IDs instead of defaulting to dnd5e (#57) ([a7afa3d](https://github.com/TheFehr/foundry-playwright/commit/a7afa3d478f33ec2ef382504fdcbf2fd914e8725)), closes [#57](https://github.com/TheFehr/foundry-playwright/issues/57)

### Bug Fixes

- **index:** export RegistryEntry as a type-only re-export ([#59](https://github.com/TheFehr/foundry-playwright/issues/59)) ([816060f](https://github.com/TheFehr/foundry-playwright/commit/816060f5aac4103f05d312d3c674b8af89771fcc))
- **registry:** publish verified-versions.json, export getVerificationRegistry ([#52](https://github.com/TheFehr/foundry-playwright/issues/52)) ([0015a69](https://github.com/TheFehr/foundry-playwright/commit/0015a69695480af14b4d3913717c834a86ac4d22))
- **screen:** don't detach the CDP session that owns the active override ([#58](https://github.com/TheFehr/foundry-playwright/issues/58)) ([1d1d73e](https://github.com/TheFehr/foundry-playwright/commit/1d1d73e12732bfad4f97d31389a80cf555b33598)), closes [#50](https://github.com/TheFehr/foundry-playwright/issues/50)

### Features

- **cli:** add --module-dir flag to foundry-playwright test --docker ([#51](https://github.com/TheFehr/foundry-playwright/issues/51)) ([df8ee81](https://github.com/TheFehr/foundry-playwright/commit/df8ee8101fd06c3b14fec5d6fd2f453afdcb09d1))
- **screen:** add withScreenSize/setScreenSize (screen.width vs. viewport) ([#50](https://github.com/TheFehr/foundry-playwright/issues/50)) ([dafc757](https://github.com/TheFehr/foundry-playwright/commit/dafc75794d87fa8ee30a8bdfaab7b6185c38eaf0))
- **state:** add setActorOwnership, clarify assignActorToUser ([#48](https://github.com/TheFehr/foundry-playwright/issues/48)) ([f78e205](https://github.com/TheFehr/foundry-playwright/commit/f78e20523daa2b82fb3f0322c17c204758795d49))
- **state:** document and optionally handle setSetting's reload gap ([#49](https://github.com/TheFehr/foundry-playwright/issues/49)) ([dae1ad3](https://github.com/TheFehr/foundry-playwright/commit/dae1ad3f53c073ab31c63c38cd188d524e60660b))

### BREAKING CHANGES

- getSystemStateAdapter() now throws for unregistered system IDs instead of silently falling back to the dnd5e adapter. Consumers testing a system other than dnd5e/pf2e must call registerSystemStateAdapter first.

[no-release]

## [0.7.5](https://github.com/TheFehr/foundry-playwright/compare/v0.7.4...v0.7.5) (2026-08-15)

## [0.7.4](https://github.com/TheFehr/foundry-playwright/compare/v0.7.3...v0.7.4) (2026-08-14)

### Bug Fixes

- **canvas:** allow FoundryCanvas to be subclassed ([#45](https://github.com/TheFehr/foundry-playwright/issues/45)) ([49e9a69](https://github.com/TheFehr/foundry-playwright/commit/49e9a6959a3c5a62b46dbf7f9cd8d8bef3dc56e7))

## [0.7.3](https://github.com/TheFehr/foundry-playwright/compare/v0.7.2...v0.7.3) (2026-08-11)

### Bug Fixes

- **ci:** give Monitor Releases' gh calls the App token ([#43](https://github.com/TheFehr/foundry-playwright/issues/43)) ([15dcaec](https://github.com/TheFehr/foundry-playwright/commit/15dcaeccb46f3431392483b6722256ce8e429533))

## [0.7.2](https://github.com/TheFehr/foundry-playwright/compare/v0.7.1...v0.7.2) (2026-08-05)

### Bug Fixes

- **verify:** include failed pairings in verification-report.md ([#41](https://github.com/TheFehr/foundry-playwright/issues/41)) ([04516d5](https://github.com/TheFehr/foundry-playwright/commit/04516d522eefed8cf8d61811b5b8a230276f827d))

## [0.7.1](https://github.com/TheFehr/foundry-playwright/compare/v0.7.0...v0.7.1) (2026-08-03)

# [0.7.0](https://github.com/TheFehr/foundry-playwright/compare/v0.6.1...v0.7.0) (2026-08-03)

### Bug Fixes

- **ci:** avoid argv-size limit when building the release commit payload ([#34](https://github.com/TheFehr/foundry-playwright/issues/34)) ([80c1e23](https://github.com/TheFehr/foundry-playwright/commit/80c1e23d134bd76b8a3ece7a82e282ddc229c5d0))
- **ci:** create the release commit via the GraphQL API so it's signed ([#33](https://github.com/TheFehr/foundry-playwright/issues/33)) ([866a8f0](https://github.com/TheFehr/foundry-playwright/commit/866a8f0e4706b3626eb13ab6e718f0ef6def214d))
- **ci:** drop ungranted issues permission from release workflow token ([#31](https://github.com/TheFehr/foundry-playwright/issues/31)) ([ba1f0f4](https://github.com/TheFehr/foundry-playwright/commit/ba1f0f493a6d9375a81b5d2007ae055c067e3285))
- **ci:** route automated registry commits through PRs, not direct pushes ([4ee1440](https://github.com/TheFehr/foundry-playwright/commit/4ee14401415eda1c0f6afb9739ee7cd6f1e693b1))
- **ci:** run format:fix on the release-it bump before committing ([#36](https://github.com/TheFehr/foundry-playwright/issues/36)) ([80c01c7](https://github.com/TheFehr/foundry-playwright/commit/80c01c7db7391f026b3045e3841ccade3833b937))
- **ci:** use a GitHub App token so Monitor Releases can create PRs ([630930f](https://github.com/TheFehr/foundry-playwright/commit/630930fc9007a1bf34033dd0d3c7db7a4baf9334))
- **cli:** clean up temp data dirs and use shared cache ([#23](https://github.com/TheFehr/foundry-playwright/issues/23)) ([a7c9b08](https://github.com/TheFehr/foundry-playwright/commit/a7c9b086ed091a42508f96fbf2771212728a7c7f))
- **monitor:** suppress re-queuing already-incompatible minors ([f767e1d](https://github.com/TheFehr/foundry-playwright/commit/f767e1d30d07095fc68368cdb42faae1ea559b1b))

### Features

- automate nightly compatibility verification on a standalone VM ([2bd67e9](https://github.com/TheFehr/foundry-playwright/commit/2bd67e9e8c0acad75fc696f5257c9805b1087d3b))
- **ci:** add Renovate config and a fully-automatic release pipeline ([#30](https://github.com/TheFehr/foundry-playwright/issues/30)) ([706ce78](https://github.com/TheFehr/foundry-playwright/commit/706ce78ca352f7e6f22b7df833b3120f4391ba06))

## [0.6.1](https://github.com/TheFehr/foundry-playwright/compare/v0.6.0...v0.6.1) (2026-06-10)

### Bug Fixes

- **setup:** V13 setup fixes, dnd5e deprecation handling, and system version verification ([#21](https://github.com/TheFehr/foundry-playwright/issues/21)) ([6ccd9fd](https://github.com/TheFehr/foundry-playwright/commit/6ccd9fd86d392495ba644f06b6d616321a24fbe7))

# [0.6.0](https://github.com/TheFehr/foundry-playwright/compare/v0.5.0...v0.6.0) (2026-06-05)

### Features

- useBaseWorld fixture and minor-version verification matrix ([#15](https://github.com/TheFehr/foundry-playwright/issues/15)) ([e8c08f2](https://github.com/TheFehr/foundry-playwright/commit/e8c08f24dc7a62e15f64e2bd902a46912b5a22e2))

# [0.5.0](https://github.com/TheFehr/foundry-playwright/compare/v0.4.1...v0.5.0) (2026-05-25)

### Features

- **cli:** auto-inject root directory as module in docker tests ([4f443c2](https://github.com/TheFehr/foundry-playwright/commit/4f443c270a61546d4373bb5eb82a30b2ecf00749))

## [0.4.1](https://github.com/TheFehr/foundry-playwright/compare/v0.3.1...v0.4.1) (2026-05-25)

## [0.4.0](https://github.com/TheFehr/foundry-playwright/compare/v0.3.1...v0.4.0) (2026-05-23)

### Features

- improve V13 reliability, docker port orchestration, and detailed failure reporting ([8f57958](https://github.com/TheFehr/foundry-playwright/commit/8f579588590ad00dfb83e78ead6acc36c5147d94))

## [0.3.1](https://github.com/TheFehr/foundry-playwright/compare/v0.3.0...v0.3.1) (2026-05-17)

# [0.3.0](https://github.com/TheFehr/foundry-playwright/compare/v0.2.2...v0.3.0) (2026-05-17)

### Features

- implement direct API world shutdown via game.shutDown() ([904f7de](https://github.com/TheFehr/foundry-playwright/commit/904f7dea2febf3937afae83601f49ab1721e3956))

## [0.2.2](https://github.com/TheFehr/foundry-playwright/compare/v0.2.1...v0.2.2) (2026-05-16)

## [0.2.1](https://github.com/TheFehr/foundry-playwright/compare/0.2.0...v0.2.1) (2026-05-16)

# 0.2.0 (2026-05-16)

### Bug Fixes

- **ci:** fix permission error and deprecation in monitor-releases ([b835a01](https://github.com/TheFehr/foundry-playwright/commit/b835a01d5d4b9cf00bfd2a90900dedbd0cac7eb9))
- **v13:** improve adapter reliability ([c164194](https://github.com/TheFehr/foundry-playwright/commit/c164194e4f1154ead188ba3cbe6d5b5cd5c9c365))
- **v13:** resolve recursion and type errors in adapter ([73b2e0c](https://github.com/TheFehr/foundry-playwright/commit/73b2e0ca7765d05a3161d9aac564538b01bcf5bb))
- **v14:** resolve recursion and type errors in adapter ([b1b9511](https://github.com/TheFehr/foundry-playwright/commit/b1b95117e3723de82ada2b78599aeba27e5d73d7))

### Features

- add manifest-based package installation and refactor installation logic ([1e8cf62](https://github.com/TheFehr/foundry-playwright/commit/1e8cf62075b31e979304b2fb3b04deb4900a3a08))
- add post-commit hook for non-blocking health checks and improve test coverage ([d888bce](https://github.com/TheFehr/foundry-playwright/commit/d888bce3b6dda504adf835cc9ad107f5939f7960))
- **cli:** add CLI for Foundry VTT E2E testing with Playwright ([47d473b](https://github.com/TheFehr/foundry-playwright/commit/47d473b4fc8c88436ea7cefac816b5d8e50dfe8e))
- **cli:** refactor verify-local to use Commander ([41bd2ce](https://github.com/TheFehr/foundry-playwright/commit/41bd2ced29870f0a3b5229be123b118c3ff8d600))
- **core:** enforce explicit versioning and improve setup flow ([1f0fd9a](https://github.com/TheFehr/foundry-playwright/commit/1f0fd9ad21700ad0ac3c2c8de5d7f0f82bf08f1a))
- **fake-module:** enhance FP_VERIFY with hook interception and improved sanitization ([bc3c902](https://github.com/TheFehr/foundry-playwright/commit/bc3c902e2c334df0cba299930645fe54ab652cd2))
- implement core helpers and playwright fixtures ([3c26eff](https://github.com/TheFehr/foundry-playwright/commit/3c26eff6554747735b614815334919c78628b6e0))
- implement direct state manipulation and system adapters ([5c1166b](https://github.com/TheFehr/foundry-playwright/commit/5c1166b39217585c3c104dc6deb2796a001be1a7))
- implement docker orchestration and internal verification suite ([7e76101](https://github.com/TheFehr/foundry-playwright/commit/7e76101399484f1d6d6bf66285a1ebbd47a347a0))
- implement modular deprecation tracking and system state adapters ([1f6006f](https://github.com/TheFehr/foundry-playwright/commit/1f6006f1cf5f5f3492328fc4546ccfb6190c67df))
- implement multi-version foundry setup and authentication ([23c0b81](https://github.com/TheFehr/foundry-playwright/commit/23c0b815178e68cfc9b882803e8aa29937af4a49))
- implement UI adapters and canvas interaction utilities ([c332ef6](https://github.com/TheFehr/foundry-playwright/commit/c332ef6449b5eef997e59036611a82a452abed05))
- implement version-aware system adapters for Foundry ([c306156](https://github.com/TheFehr/foundry-playwright/commit/c306156f8c8ddfb4598beaae7d7ba056d16c04d2))
- **registry:** enhance verification reports and stable registry ([1488bfe](https://github.com/TheFehr/foundry-playwright/commit/1488bfe74f4780803ad7f343aed3ab7139e504f4))
- **registry:** implement multi-dimensional verification matrix ([09a885a](https://github.com/TheFehr/foundry-playwright/commit/09a885ac28e64065a4ad879df57e82deb16e7d39))
- **release:** configure GitHub Actions for NPM publishing with provenance ([7b64a8f](https://github.com/TheFehr/foundry-playwright/commit/7b64a8f9268d7fb6267202489b49259ad72ca4e6))
- **report:** implement cumulative summary table in verification-report.md ([75b0ad0](https://github.com/TheFehr/foundry-playwright/commit/75b0ad02f51ad3814dc068094ab235678f0f5cb8))
- **verify:** silence deprecation warnings and sanitize logged data ([1058af5](https://github.com/TheFehr/foundry-playwright/commit/1058af589b9210a8e8137d361638cab000f3fdae))

# 0.2.0 (2026-05-16)

### Bug Fixes

- **ci:** fix permission error and deprecation in monitor-releases ([b835a01](https://github.com/TheFehr/foundry-playwright/commit/b835a01d5d4b9cf00bfd2a90900dedbd0cac7eb9))
- **v13:** improve adapter reliability ([c164194](https://github.com/TheFehr/foundry-playwright/commit/c164194e4f1154ead188ba3cbe6d5b5cd5c9c365))
- **v13:** resolve recursion and type errors in adapter ([73b2e0c](https://github.com/TheFehr/foundry-playwright/commit/73b2e0ca7765d05a3161d9aac564538b01bcf5bb))
- **v14:** resolve recursion and type errors in adapter ([b1b9511](https://github.com/TheFehr/foundry-playwright/commit/b1b95117e3723de82ada2b78599aeba27e5d73d7))

### Features

- add manifest-based package installation and refactor installation logic ([1e8cf62](https://github.com/TheFehr/foundry-playwright/commit/1e8cf62075b31e979304b2fb3b04deb4900a3a08))
- add post-commit hook for non-blocking health checks and improve test coverage ([d888bce](https://github.com/TheFehr/foundry-playwright/commit/d888bce3b6dda504adf835cc9ad107f5939f7960))
- **cli:** add CLI for Foundry VTT E2E testing with Playwright ([47d473b](https://github.com/TheFehr/foundry-playwright/commit/47d473b4fc8c88436ea7cefac816b5d8e50dfe8e))
- **cli:** refactor verify-local to use Commander ([41bd2ce](https://github.com/TheFehr/foundry-playwright/commit/41bd2ced29870f0a3b5229be123b118c3ff8d600))
- **core:** enforce explicit versioning and improve setup flow ([1f0fd9a](https://github.com/TheFehr/foundry-playwright/commit/1f0fd9ad21700ad0ac3c2c8de5d7f0f82bf08f1a))
- **fake-module:** enhance FP_VERIFY with hook interception and improved sanitization ([bc3c902](https://github.com/TheFehr/foundry-playwright/commit/bc3c902e2c334df0cba299930645fe54ab652cd2))
- implement core helpers and playwright fixtures ([3c26eff](https://github.com/TheFehr/foundry-playwright/commit/3c26eff6554747735b614815334919c78628b6e0))
- implement direct state manipulation and system adapters ([5c1166b](https://github.com/TheFehr/foundry-playwright/commit/5c1166b39217585c3c104dc6deb2796a001be1a7))
- implement docker orchestration and internal verification suite ([7e76101](https://github.com/TheFehr/foundry-playwright/commit/7e76101399484f1d6d6bf66285a1ebbd47a347a0))
- implement modular deprecation tracking and system state adapters ([1f6006f](https://github.com/TheFehr/foundry-playwright/commit/1f6006f1cf5f5f3492328fc4546ccfb6190c67df))
- implement multi-version foundry setup and authentication ([23c0b81](https://github.com/TheFehr/foundry-playwright/commit/23c0b815178e68cfc9b882803e8aa29937af4a49))
- implement UI adapters and canvas interaction utilities ([c332ef6](https://github.com/TheFehr/foundry-playwright/commit/c332ef6449b5eef997e59036611a82a452abed05))
- implement version-aware system adapters for Foundry ([c306156](https://github.com/TheFehr/foundry-playwright/commit/c306156f8c8ddfb4598beaae7d7ba056d16c04d2))
- **registry:** enhance verification reports and stable registry ([1488bfe](https://github.com/TheFehr/foundry-playwright/commit/1488bfe74f4780803ad7f343aed3ab7139e504f4))
- **registry:** implement multi-dimensional verification matrix ([09a885a](https://github.com/TheFehr/foundry-playwright/commit/09a885ac28e64065a4ad879df57e82deb16e7d39))
- **release:** configure GitHub Actions for NPM publishing with provenance ([7b64a8f](https://github.com/TheFehr/foundry-playwright/commit/7b64a8f9268d7fb6267202489b49259ad72ca4e6))
- **report:** implement cumulative summary table in verification-report.md ([75b0ad0](https://github.com/TheFehr/foundry-playwright/commit/75b0ad02f51ad3814dc068094ab235678f0f5cb8))
- **verify:** silence deprecation warnings and sanitize logged data ([1058af5](https://github.com/TheFehr/foundry-playwright/commit/1058af589b9210a8e8137d361638cab000f3fdae))
