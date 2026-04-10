---
name: update-changelog
description: >-
  Updates [VERSION](VERSION) and [CHANGELOG.md](CHANGELOG.md) for this repo using
  its established format. Use when the user ships or summarizes notable work,
  asks to update the changelog, cut a release, or after completing a feature or
  fix that should be recorded; also when the user mentions changelog, release
  notes, or versioning for rfd-fyi.
---

# Update changelog (rfd-fyi)

## When to apply

After **notable** changes (features, removals, breaking behavior, ops/infra changes users care about). Skip typo-only or internal refactors unless the user asks.

## Steps

1. Read [VERSION](VERSION) and the top of [CHANGELOG.md](CHANGELOG.md).
2. **Version bump** (semver):
   - **MAJOR** — breaking API or behavior users rely on
   - **MINOR** — new features or meaningful additions (default for most user-visible work)
   - **PATCH** — bug fixes and small corrections only
3. Set [VERSION](VERSION) to the new number (single line, no `v` prefix), e.g. `0.3.0`.
4. Add a **new section** at the top of the changelog (below the intro paragraph), before the previous release:

   ```markdown
   ## [x.y.z] - YYYY-MM-DD

   ### Added
   - ...

   ### Changed
   - ...

   ### Removed
   - ...
   ```

5. Use **today’s date** from the session (user info) for `YYYY-MM-DD`.
6. Group bullets under **Added** / **Changed** / **Removed** as in existing entries. Write for humans: what changed and why it matters, not file names unless helpful.
7. If the user is **committing a release**, follow [AGENTS.md](AGENTS.md): commit [VERSION](VERSION) and [CHANGELOG.md](CHANGELOG.md) together in one commit.

## Conventions (this repo)

- Headings: `## [version] - date` (brackets around version).
- Prefer complete sentences or sentence-style bullet phrases; stay concise.
- JSON/API routes and env vars may appear in backticks (e.g. `` `/html` ``).

## Do not

- Edit the changelog intro line (`All notable changes...`) unless the user asks.
- Duplicate the same release twice or leave an old version number in [VERSION](VERSION).
