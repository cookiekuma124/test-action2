# GitHub Actions Cache Canonicalization Lab

This isolated lab compares representation drift between:

- `actions/cache`
- direct `@actions/cache` toolkit calls
- GitHub's runtime cache backend
- GitHub's REST cache API
- workflow logs and `cache-hit` output

Keep this repository disposable. Do not put secrets, credentials, tokens, proprietary dependencies, or generated production artifacts in any cached path.

## What This Lab Records

The manual workflow writes structured observations to `lab-observations/` and uploads them as a workflow artifact:

- resolved key as JSON, UTF-8 hex, and code points
- resolved path list as JSON, UTF-8 hex, and code points
- raw predicted cache version
- action-trim predicted cache version
- `actions/cache` restore outputs
- direct `@actions/cache` matched key and exact-match comparisons
- REST API cache entries: `id`, `ref`, `key`, `version`, timestamps, and size

The local cache-version prediction mirrors current `@actions/cache` 6.1.0 source: SHA-256 of `paths`, compression method, optional Windows marker, and salt `1.0`. Treat this as a diagnostic mirror, not an API contract.

## Setup

Create an empty GitHub repository, then push this directory:

```bash
git add .
git commit -m "Add cache canonicalization lab"
git remote add origin git@github.com:OWNER/REPO.git
git push -u origin main
```

Then open `Actions` -> `Cache Canonicalization Lab` -> `Run workflow`.

## Automated GitHub Setup

For automation, use two sandbox accounts:

- Account A owns the upstream repository.
- Account B is a fork/PR actor and should not be added as a collaborator.

Recommended token setup for fully automated disposable testing:

- A token: classic PAT with `repo`, `workflow`, and `delete_repo` if you want automated cleanup.
- B token: classic PAT with `public_repo` for a public lab repo. Use `repo` if you make the lab private.

Run automation from this directory with tokens in environment variables:

```bash
export GH_A_TOKEN='...'
export GH_B_TOKEN='...'
export LAB_REPO_NAME='cache-canon-lab'

npm run github:lab -- setup
npm run github:lab -- smoke
npm run github:lab -- drift
npm run github:lab -- rest-delete
npm run github:lab -- pr
```

Modes:

- `setup`: commit local lab files, create A's repo, and push `main`.
- `smoke`: setup plus one roundtrip cache run and one REST list run.
- `drift`: setup plus path, case, and Unicode drift probes.
- `rest-delete`: setup plus two disposable cache seeds, a REST prefix list, and a REST delete-by-key prefix attempt.
- `pr`: setup plus B fork, branch, marker commit, and PR against A.
- `all`: run `drift`, `rest-delete`, then `pr`.
- `cleanup`: delete A's lab repo.

The script reads tokens from environment variables and does not write them to the repository.

## Main Workflow

Use `.github/workflows/cache-canonicalization.yml` for controlled manual tests.

Important inputs:

- `operation`: `roundtrip`, `save`, `lookup`, `restore`, `list`, or `delete-key`
- `driver`: `action`, `toolkit`, `both`, or `api`
- `key_variant`: case, Unicode, whitespace, URL-like, or invalid-key variants
- `path_variant`: relative, absolute, normalized, symlink, glob, ordered multi-path, case, or whitespace variants
- `toolkit_path_parse_mode`: `raw` or `action-trim`
- `api_ref`: optional REST ref filter such as `refs/heads/main` or `refs/pull/1/merge`

## High-Value Trials

Use a fresh base key for each trial.

### 1. Path Version Drift

Seed:

- `operation`: `roundtrip`
- `driver`: `both`
- `cache_key`: `path-001`
- `key_variant`: `literal`
- `path_variant`: `relative`

Probe the same key with:

- `operation`: `lookup`
- `driver`: `both`
- `cache_key`: `path-001`
- `path_variant`: `dot-relative`, `workspace-absolute`, `parent-normalized`, `symlink`, `glob-fixture`, `trailing-space`, `multi-b-a`

Compare REST `version` with `rawPredictedVersion` and `actionTrimPredictedVersion`.

### 2. `cache-hit` Case Drift

Seed:

- `operation`: `roundtrip`
- `driver`: `action`
- `cache_key`: `case-001`
- `key_variant`: `case-pair-lower`

Probe:

- `operation`: `lookup`
- `driver`: `both`
- `cache_key`: `case-001`
- `key_variant`: `case-pair-upper`
- `restore_keys`: `case-001-`

If the backend returns the lowercase key through a restore-key match but `actions/cache` reports `cache-hit=true`, the log/output layer is treating case-only differences as exact.

### 3. Unicode Normalization Drift

Seed:

- `operation`: `roundtrip`
- `driver`: `action`
- `cache_key`: `unicode-001`
- `key_variant`: `nfc-e-acute`

Probe:

- `operation`: `lookup`
- `driver`: `both`
- `cache_key`: `unicode-001`
- `key_variant`: `nfd-e-acute`
- `restore_keys`: `unicode-001-`

Compare REST key bytes/code points with `actions/cache` `cache-hit` and toolkit `strictExactMatch`.

### 4. REST Prefix/List/Delete Behavior

List by prefix:

- `operation`: `list`
- `driver`: `api`
- `cache_key`: a short prefix such as `case`
- `key_variant`: `literal`

Delete by key only in the disposable lab:

- `operation`: `delete-key`
- `driver`: `api`
- `cache_key`: exact or prefix candidate
- `api_ref`: set this when you want to narrow deletion to one ref

The REST list API documents `key` as an explicit key or prefix. The delete-by-key workflow is included to test whether deletion behaves the same way in your lab repository.

## Ref Scope Workflow

`.github/workflows/cache-ref-scope.yml` runs on `push`, `pull_request`, tags, and manual dispatch. It uses the shared key `scope-lab-shared-v1` by default and records:

- `GITHUB_REF`
- `GITHUB_BASE_REF`
- `GITHUB_HEAD_REF`
- `cache-hit`
- `cache-matched-key`

Use it to compare:

- `refs/heads/main`
- feature branches
- `refs/pull/<number>/merge`
- tag refs
- default-branch fallback behavior

For REST comparison, run the main workflow with `operation=list`, `driver=api`, the same key, and `api_ref` set to the exact ref you want to inspect.

## Source Notes

Current official behavior to verify against:

- cache matching searches key/version in the current branch, then prefix/restore keys, then retries on default branch subject to scope restrictions
- REST list entries expose `ref`, `key`, and `version`
- `actions/cache` trims multiline path input before passing paths to `@actions/cache`
- `@actions/cache` computes cache version from raw paths passed to it, compression method, Windows/cross-OS marker, and salt
- `actions/cache` exact-key output uses locale comparison with accent sensitivity, so case-only and some Unicode-normalization differences need explicit testing

References:

- GitHub dependency caching reference: <https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching>
- GitHub Actions cache REST API: <https://docs.github.com/en/rest/actions/cache>
- `actions/cache`: <https://github.com/actions/cache>
- `@actions/cache` toolkit package: <https://github.com/actions/toolkit/tree/main/packages/cache>
