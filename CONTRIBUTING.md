# Contributing

Thanks for considering a contribution to `@thefehr/foundry-playwright`.

## Setup

```bash
git clone https://github.com/TheFehr/foundry-playwright.git
cd foundry-playwright
npm install
```

Node 24.x is expected (matches CI). `npm install` also sets up a pre-commit
hook (husky + lint-staged) that auto-formats and lints whatever you've
staged.

## Making a change

Branch off `main`, make your change, and run the same checks CI runs before
opening a PR:

```bash
npm run build    # tsc
npm run lint     # oxlint
npm run format   # oxfmt --check (npm run format:fix to auto-fix)
npm test         # unit tests (vitest)
```

The Playwright E2E suite (`npm run test:e2e`) and the Docker-based
compatibility verifier (`npm run verify:local`) both need a licensed
FoundryVTT account and Docker, and aren't expected for most contributions -
CI only requires the build/lint/format/unit-test suite above to pass.

## Commit messages and PR titles

This repo only allows **squash-merge**, and keeps the PR title as the squash
commit's entire message (body is dropped). That means **your PR title is
what actually lands in history and drives the release pipeline** -
individual commits on your branch can be as messy as you like.

Use a [Conventional Commits](https://www.conventionalcommits.org/) title:

```
<type>(<scope>): <description>
```

- `feat:` / `fix:` trigger a release (minor / patch respectively).
- `chore:` / `docs:` / `ci:` / `test:` / `refactor:` / `style:` / `build:`
  do not trigger a release.
- A breaking change uses `!` right after the type/scope, e.g.
  `fix(docker)!: ...` - this only works in the **title**, not in a commit
  body footer (which gets squashed away).
- If your change is confined to `scripts/`, `.github/workflows/`, `docs/`,
  or the compatibility registry (`verified-versions.json`,
  `verification-report.md`) - i.e. nothing under `src/`, which is the only
  thing that ships to consumers - add `[no-release]` to the title even if
  you used `fix:`/`feat:`, e.g. `fix(ci): ... [no-release]`. Without it, the
  change still won't ship anything to consumers, but it will cut a
  needless version bump.

## Signed commits

`main` requires verified commit signatures. Set up
[commit signing](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits)
(GPG or SSH) before opening a PR - an unsigned commit on your branch can
block the squash-merge even though GitHub itself signs the final squash
commit.

## Opening a PR

- Target `main`.
- CI (build/lint/format/test, CodeQL) must pass.
- [CodeRabbit](https://coderabbit.ai) reviews automatically; please address
  or respond to its comments before requesting a merge.

## Reporting bugs vs. vulnerabilities

Found a bug? Open a [GitHub issue](https://github.com/TheFehr/foundry-playwright/issues).

Found a security vulnerability? See [SECURITY.md](./SECURITY.md) - please
don't open a public issue for it.

## License

By contributing, you agree your contribution is licensed under this
project's [MIT license](./LICENSE.md).
