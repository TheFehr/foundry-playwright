// JS, not JSON: ignoreCommits below needs to be a real RegExp - the
// conventional-changelog git client calls `.test()` on it directly - which a
// JSON config file can't express.
export default {
  git: {
    commitMessage: "chore(release): v${version}",
    tagName: "v${version}",
    requireBranch: "main",
    requireCleanWorkingDir: true,
  },
  github: {
    release: true,
  },
  npm: {
    publish: false,
  },
  plugins: {
    "@release-it/conventional-changelog": {
      preset: {
        // Not "angular": its whatBump.js hardcodes `level = 2` (patch) as an
        // unconditional floor and only ever escalates from there - a commit
        // history containing nothing but chore/docs/ci-type commits still
        // "recommends" a patch bump instead of reporting nothing releasable
        // (confirmed live 2026-10-13: v1.8.2 was cut this way, with a
        // completely empty changelog section - echoing an identical v1.6.8
        // incident referenced elsewhere in this repo's history). Its
        // headerPattern also can't parse a `!` breaking-change marker at all
        // (`feat!: ...` parses with `type: undefined`), so the documented
        // "breaking change needs '!' in the PR title" convention silently
        // never worked under it either.
        //
        // conventionalcommits' whatBump starts `level = null` and only sets
        // one for commit types actually marked bump-worthy (feat/fix/perf/
        // revert by default; chore/docs/ci/style/test/refactor/build are
        // "hidden", non-bump) - an all-chore history correctly yields no
        // release. Its headerPattern/breakingHeaderPattern correctly handle
        // `!`. Verified empirically against a scratch clone before adopting:
        // chore-only -> nothing released; fix: -> patch; feat: -> minor;
        // feat!: -> major.
        name: "conventionalcommits",
        // Makes the existing `[no-release]` convention actually effective at
        // the library level, regardless of commit type - confirmed live
        // 2026-10-13: a `fix(monitor-releases): ... [no-release]` commit
        // (#224) still got bundled into a real release (v1.8.1) the next
        // time an unrelated untagged push ran this job, because `[no-release]`
        // was never anything more than inert text as far as release-it's own
        // commit scan was concerned - the job-level `if:` guard in
        // release.yml only ever protected that commit's own triggering push,
        // not any later one. Verified this regex closes that gap: a
        // `[no-release]`-tagged fix: commit no longer bumps, while an
        // untagged one in the same history still does.
        ignoreCommits: /\[no-release\]/,
      },
      infile: "CHANGELOG.md",
    },
  },
};
