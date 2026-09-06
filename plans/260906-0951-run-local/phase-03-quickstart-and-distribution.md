---
phase: 3
title: "Quickstart And Distribution"
status: pending
priority: P2
effort: "3h"
dependencies: [1]
---

# Phase 3: Quickstart And Distribution

## Overview

Make "run this on your machine" a documented, verified two-step path, and give
people without git a way to get the same thing.

## Requirements

- Functional: clone to reading in one documented command; a downloadable archive
  for non-git users; documented prerequisites.
- Non-functional: verified on a clean checkout with no npm cache; instructions
  correct on Windows and POSIX.

## Architecture

**Running needs no `npm install`.** After Phase 1 the server uses only Node
built-ins, and the site itself has no runtime dependencies. So:

```
git clone https://github.com/hong4rc/book
cd book
node scripts/serve.mjs          # -> http://localhost:8080
```

`npm install` stays a **maintainer** step, needed only to rebuild or run the
test suite (`ajv`, `fflate`, `jsdom` are all devDependencies). The README must
separate those two audiences clearly; conflating them is what makes projects
feel heavier than they are.

**Clone size** is ~13MB today (`docs/` 6.2MB + `data/` 6.7MB). The other plan's
Phase 7 adds the book text, which measurement puts near 20MB compressed, so the
realistic end state is ~35MB. Worth stating in the README so nobody is surprised
— and worth revisiting only if it grows past a few hundred MB.

**For people without git**, GitHub's "Download ZIP" already produces a working
copy, because nothing needs to be built. The README should say so explicitly
rather than assuming git; that is the difference between "developers can run it"
and "someone can run it".

**Node is the one prerequisite.** Stating the minimum (20+) and where to get it
matters more than it seems for a non-developer audience.

## Related Code Files

- Modify: `README.md` — a Quickstart section at the top
- Modify: `package.json` — `start` alias
- Create: `scripts/check-local.mjs` — verify a clean checkout can run

## Implementation Steps

1. README Quickstart at the very top: prerequisites, the two commands, the URL.
2. Separate "Run it" from "Develop it"; only the latter mentions `npm install`.
3. Document the ZIP path for people without git.
4. Note the download size and that no book files are included, with a pointer to
   how downloads work.
5. `check-local.mjs`: assert `docs/index.html`, `docs/data/index.json` and the
   shard directory exist and are non-empty, and that `serve.mjs` needs no
   `node_modules` — catching a broken clone before the user hits it.
6. **Verify on a genuinely clean checkout**: clone to a temp directory, no
   `npm install`, start the server, load a page, search.
7. Document how to unregister the service worker if a stale cache is ever
   suspected.

## Success Criteria

- [ ] Clone to reading in two commands, verified on a fresh clone
- [ ] No `npm install` required to run
- [ ] ZIP download path documented and tested
- [ ] Prerequisites and Node minimum stated
- [ ] Download size stated honestly
- [ ] `check-local.mjs` catches a broken or partial checkout
- [ ] Instructions correct on Windows and POSIX

## Risk Assessment

- **Instructions drift from reality.** Documentation rots faster than code.
  Signal: the clean-checkout verification fails. Response: `check-local.mjs`
  runs in CI so the quickstart is tested, not merely written.
- **Assuming a developer audience.** Signal: someone cannot get past step one.
  Response: state the Node prerequisite and the ZIP path explicitly; do not
  assume git, a terminal habit, or a populated npm cache.
- **Clone grows uncomfortable.** Signal: past a few hundred MB. Response: text
  shards can move to a release asset fetched on first run — the shard boundary
  makes that a contained change rather than a redesign.
- **Windows-only or POSIX-only instructions.** Signal: a path or command fails
  on the other. Response: both are verified; the project is developed on Windows
  and deployed on Linux, so both paths are real.
