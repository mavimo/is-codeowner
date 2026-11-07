# is-codeowner

[![CI](https://github.com/mavimo/is-codeowner/actions/workflows/ci.yml/badge.svg)](https://github.com/mavimo/is-codeowner/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A composite GitHub Action that checks whether a user owns **every** changed file according to the
repository's `CODEOWNERS`, either directly (`@user`) or through team membership (`@org/team`,
including child teams).

Typical uses: auto-approve or enable auto-merge on PRs whose author owns all touched files, or gate a
job (deploy, label, notify) on ownership.

This repository is private and the action is consumed directly from it
(`uses: mavimo/is-codeowner@<ref>`); it is not published on the Marketplace.

## Quick start

```yaml
permissions:
  contents: read

jobs:
  ownership:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<full-sha> # pin by SHA
        with:
          fetch-depth: 0 # needed so changed files can be detected
          persist-credentials: false
      - id: owner
        uses: mavimo/is-codeowner@<full-sha>
        with:
          user: ${{ github.event.pull_request.user.login }}
      - run: echo "owns everything: $RESULT"
        env:
          RESULT: ${{ steps.owner.outputs.result }}
```

`actions/checkout` must run first (the action reads CODEOWNERS from the workspace). The action sets up
Node 24 itself.

## Inputs

| Input        | Required | Default        | Description                                                                                                                                       |
| ------------ | -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`       | yes      |                | GitHub login to check. A leading `@` is stripped; comparison is case-insensitive.                                                                 |
| `files`      | no       | `''`           | Newline-separated list, or a JSON array of strings. If empty, changed files are auto-detected with `tj-actions/changed-files` (deleted included). |
| `codeowners` | no       | `''`           | CODEOWNERS content. If empty, the file is read from the workspace (see [resolution](#codeowners-resolution)).                                     |
| `token`      | no       | `github.token` | Token for team lookups. Only used when a matching rule names a team; see [team handling](#team-handling-and-tokens).                              |

Duplicate and blank entries in `files` are dropped. If the explicit `files` value starts with `[` it is
parsed as a JSON array (the step fails if it is not valid JSON), so use the JSON form for names such
as `[id]/page.tsx`. Auto-detected files are never parsed as JSON. On `push` events there is no PR
author, so pass `user` explicitly there.

## Outputs

| Output            | Description                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `result`          | `"true"` if the user owns every file (also when there are no files), otherwise `"false"`.           |
| `unowned-files`   | Newline-separated files matched by no CODEOWNERS rule.                                              |
| `not-owned-files` | Newline-separated files owned by someone else (including files whose winning rule lists no owners). |

The step fails on errors: no CODEOWNERS found, malformed `files` JSON, or a failed team lookup (for
example an insufficient token). A failed ownership check is not an error; it yields `result=false`.

## Examples

Pass untrusted values (PR author, file names) through `with:` / `env:`, never interpolate them into a
`run:` script.

### Check the PR author against the changed files

```yaml
on: pull_request

permissions:
  contents: read

jobs:
  ownership:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<full-sha>
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: mavimo/is-codeowner@<full-sha>
        id: owner
        with:
          user: ${{ github.event.pull_request.user.login }}
      - name: Report
        env:
          NOT_OWNED: ${{ steps.owner.outputs.not-owned-files }}
          UNOWNED: ${{ steps.owner.outputs.unowned-files }}
        run: |
          printf 'not owned:\n%s\nunowned:\n%s\n' "$NOT_OWNED" "$UNOWNED"
```

### Explicit file list

```yaml
- uses: mavimo/is-codeowner@<full-sha>
  with:
    user: octocat
    files: |
      src/app.ts
      docs/guide.md
    # or as JSON: files: '["src/app.ts", "docs/guide.md"]'
```

### Inline CODEOWNERS

```yaml
- uses: mavimo/is-codeowner@<full-sha>
  with:
    user: octocat
    files: src/app.ts
    codeowners: |
      *      @acme/maintainers
      /src/  @octocat
```

### Enable auto-merge when the author owns everything

```yaml
name: auto-merge-owned
on: pull_request

permissions:
  contents: read

jobs:
  ownership:
    runs-on: ubuntu-latest
    outputs:
      owner: ${{ steps.owner.outputs.result }}
    steps:
      - uses: actions/checkout@<full-sha>
        with:
          fetch-depth: 0
          persist-credentials: false
      - id: owner
        uses: mavimo/is-codeowner@<full-sha>
        with:
          user: ${{ github.event.pull_request.user.login }}
          token: ${{ secrets.ORG_READ_TOKEN }} # only needed for team owners

  automerge:
    needs: ownership
    if: needs.ownership.outputs.owner == 'true'
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: write
    steps:
      - env:
          GH_TOKEN: ${{ github.token }}
          PR_URL: ${{ github.event.pull_request.html_url }}
        run: gh pr merge --auto --squash "$PR_URL"
```

Auto-approval (`gh pr review --approve "$PR_URL"`) works the same way and needs the repository setting
"Allow GitHub Actions to create and approve pull requests". Runs triggered by PRs from forks get a
read-only token, so write steps only work for same-repository PRs. Auto-merge also has to be enabled in
the repository settings.

### Gate a job

```yaml
deploy:
  needs: ownership
  if: needs.ownership.outputs.owner == 'true'
```

## CODEOWNERS resolution

When `codeowners` is empty, the first existing file wins, in GitHub's priority order:

1. `.github/CODEOWNERS`
2. `CODEOWNERS`
3. `docs/CODEOWNERS`

If none exists the step fails. Files over 3 MB are rejected (GitHub does not load them either).

Like GitHub, **the last matching rule wins**. If the winning rule lists no owners, the file is
reported in `not-owned-files` (nobody owns it, including the user).

Supported syntax: comments (`# ...`, also trailing), `*`, `**`, `?`, leading `/` anchoring, trailing
`/` for directories, backslash escapes (`\#` for a literal leading `#`, `\ ` for a space), and owners
written as `@user`, `@org/team` or an email address.

Deviations and unsupported features (most mirror GitHub itself):

- No negation: `!pattern` lines are ignored.
- No `[a-z]` character ranges: brackets are literal characters.
- No GitLab sections: `[Section]` / `^[Section]` are treated as literal patterns, not headers.
- Lines containing an invalid owner are skipped entirely (as GitHub does), so a typo can leave files
  unowned or owned by an earlier, broader rule.
- Owner names are compared case-insensitively; file paths are matched case-sensitively and are
  normalised first (`\` becomes `/`, a leading `./` is dropped).
- Bot accounts such as `dependabot[bot]` cannot be owners (the brackets make the line invalid, so it
  is skipped).
- An email owner only matches if the `user` input is literally that string, so in practice it never
  matches a login.
- This is a local reimplementation; it does not reproduce GitHub's own CODEOWNERS error reporting or
  branch-protection logic.

## Team handling and tokens

For `@org/team` owners the action asks the GitHub API whether the user is an **active** member of the
team, and also walks its child teams (up to 10 levels, cycle-safe, bounded concurrency, memoised).

- **User-only CODEOWNERS needs no special token.** No API call is made.
- **Team owners need a token that can read organisation team membership.** The default `GITHUB_TOKEN`
  cannot. Use a classic PAT with `read:org`, a fine-grained PAT with organisation "Members" read
  permission, or a GitHub App installation token with the same permission, stored as a secret and
  passed via `token:`.
- A 401/403 fails the step with an explanatory message; rate limits are reported as such. A 404
  (team or membership not found, or invisible to the token) counts as "not a member", so a token with
  insufficient visibility can produce a false `result=false`.

## Empty file list and `fetch-depth`

With no files to check the result is `true` (vacuously); a warning is logged when files were
auto-detected. A misconfiguration can therefore silently pass:

- Use `fetch-depth: 0` in `actions/checkout`. With a shallow clone changed files may be missing or
  incomplete.
- Auto-detection depends on the event (pull requests, pushes). On other events, or on force pushes
  and new branches where the base is unclear, pass `files`.
- Renames: only what `tj-actions/changed-files` reports is checked (typically the new path), so make
  sure moves out of directories you do not own are covered by your review rules.
- If you auto-approve or auto-merge on `result`, make sure the file list is not unexpectedly empty
  (for example by passing `files` yourself).
- Very large PRs may exceed the ~128 KiB environment variable limit and the step fails (safe). Split
  the check across several steps with smaller `files` lists.

## Security notes

- Inputs reach the action's script only through environment variables, never by interpolation into
  shell code. Do the same in your own `run:` steps with outputs, PR author, branch and file names.
- Pin every action by full commit SHA, including this one. Tags are mutable.
- The action uses `tj-actions/changed-files` pinned to a full SHA of a release published after the
  March 2025 compromise (CVE-2025-30066). If you bump it, keep the SHA pin and review the diff.
- CODEOWNERS globs are matched without regular expressions, so a hostile CODEOWNERS file cannot cause
  catastrophic backtracking.
- **CODEOWNERS is read from the checked-out workspace.** On `pull_request` that is the PR merge
  commit, so a PR can edit CODEOWNERS to grant its author ownership of everything. Before
  auto-approving or auto-merging, take CODEOWNERS from the base branch (check out `github.base_ref`
  into a second path and pass its content via `codeowners:`), and protect the CODEOWNERS file itself
  with a rule that someone else owns.
- Auto-merge is only a meaningful gate when the target branch has required checks or reviews;
  `gh pr merge --auto` may merge immediately otherwise.
- Secrets (such as a `read:org` token) are empty on PRs from forks. An empty `token:` makes team
  lookups fail or report `false`; skip the job for fork PRs.
- Use a least-privilege `permissions:` block. This action needs only `contents: read` (for checkout);
  grant `pull-requests: write` / `contents: write` only to the job that acts on the result.
- Prefer `pull_request` over `pull_request_target`. If you must use `pull_request_target`, never
  check out or run PR head code with a write token.
- Use `persist-credentials: false` on checkout unless the job needs to push.
- The `token` input is masked in logs and used only for team lookups. Give it the minimum scope.
- To use this private action from other repositories, allow access under **Settings > Actions >
  General > Access** in this repository.

## Limitations

- Local reimplementation of CODEOWNERS semantics; edge cases may differ from GitHub's evaluation.
- Only the paths reported by `tj-actions/changed-files` are checked; file names containing newlines
  are split into separate entries (pass a JSON `files` list if that matters).
- Team lookups need a privileged token and one or more API calls per distinct team.

## Development

Requires Node 24 (see `.node-version`).

```sh
npm ci --ignore-scripts
npm run all   # format:check, lint, typecheck, test (with coverage), package
```

Other scripts: `format`, `format:check`, `lint`, `typecheck`, `test`, `build`, `package`.

`dist/` **must be committed**: the action runs `dist/index.js` directly. The `check-dist` CI job fails
when `dist/` differs from the output of `npm run package`, so rebuild and commit it after changing
`src/` or dependencies.

### Releasing

1. Merge to `main` with an up-to-date `dist/`.
2. Tag the commit, e.g. `git tag v1.2.3 && git push origin v1.2.3`.
3. Optionally move a major tag (`v1`) to the same commit. Consumers needing strong guarantees should
   reference the commit SHA.

There is no Marketplace step because the repository stays private.

## License

[MIT](LICENSE)
