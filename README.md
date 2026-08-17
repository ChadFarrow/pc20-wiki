# PC 2.0 Wiki

A public reference for Podcasting 2.0 — the namespace, the payments, and the plumbing
underneath — built as a static site from the **PC 2.0 hivemind** Obsidian vault.

## How the content flows

```
iCloud Obsidian vault          <- you edit here, this is the source of truth
  PC 2.0 hivemind/
        |
        |  npm run sync         (one way, local only, never writes to the vault)
        v
  content/                      <- a mirror, committed to git
        |
        |  npm run build
        v
  public/                       <- the site, deployed by Vercel
```

The vault stays where it is and Obsidian stays set up exactly as it was. `sync` only ever
reads the vault and only ever writes under `content/`.

`content/` is committed on purpose: Vercel has no access to iCloud, so the deploy builds
from what is in the repo. That is also the cost of this arrangement — the repo can fall
behind the vault. `npm run sync:check` reports drift and fails if the repo is stale.

### Writing loop

There isn't one. Write in Obsidian and stop thinking about it — a launchd agent
publishes the change about a minute later. To publish immediately:

```sh
scripts/auto-publish.sh --now
```

Two things keep the copies together:

**A pre-commit hook** (`hooks/pre-commit`, enabled with `git config core.hooksPath hooks`)
syncs and stages `content/` before every commit, so a stale `content/` cannot be committed
even by hand.

**A launchd agent** (`launchd/com.chadfarrow.pc20-wiki-sync.plist.template`) watches the vault,
waits 45 seconds for edits to settle, then syncs, builds, commits and pushes. It also runs
every 15 minutes as a backstop, because an in-place write does not always disturb the
directory kqueue is watching; a run with nothing to do exits in about half a second.

```sh
./scripts/install-agent.sh          # generate the plist and load it
./scripts/install-agent.sh --check  # is the installed agent current?

launchctl unload ~/Library/LaunchAgents/com.chadfarrow.pc20-wiki-sync.plist   # stop
tail -f ~/Library/Logs/pc20-wiki-sync.log                                     # what it did
```

The plist is generated rather than committed: it has to name absolute paths, and
this repo is public.

**Saving a note publishes it.** The agent pushes to `main`, Vercel builds `main`, and
the page is public about two minutes after you stop typing — there is no review step.
To keep a note out of the site, put `publish: false` in its frontmatter; the sync
skips it and reports that it did. To retract something already live, delete or
unpublish it and the next run removes the page.

If a note fails validation the agent publishes nothing, leaves the note alone, and raises a
notification. Fix the note and the next run picks it up — including a change that was
synced but never committed, which it will find and finish.

## What gets published

An allowlist, because the vault is personal and the site is not:

| Published            | Not published                                       |
| -------------------- | --------------------------------------------------- |
| `notes/**/*.md`      | `templates/`, `daily/`, `README - Setup.md`          |
| `Home.md`            | `.obsidian/`, anything dotted                        |
| `attachments/**`     | any note with `publish: false` in its frontmatter    |

## Commands

| Command                  | What it does                                                  |
| ------------------------ | ------------------------------------------------------------- |
| `npm run sync`           | Mirror the vault into `content/`                               |
| `npm run sync:check`     | Report drift without changing anything (no-ops with no vault)  |
| `npm run build`          | Build `public/` — this is what deploys                         |
| `npm run publish:site`   | `sync` then `build`                                            |
| `npm run lint:notes`     | Build with warnings fatal — a deliberate tidy-up pass          |
| `npm test`               | Unit tests plus an end-to-end build with a link check          |
| `npm run check:browser`  | Drives the built site in headless Chrome (`-- --shots` for PNGs) |
| `npm run serve`          | Serve `public/` at http://127.0.0.1:8088                       |

The vault path defaults to the iCloud location and can be overridden with `--vault` or
`PC20_VAULT`.

## What the build enforces

Every problem in every note is reported in one pass, then the build fails — a reference
that quietly drops a note with a typo'd key is how a wiki rots.

- Frontmatter must parse and must be a mapping
- `type` and `status` must be in the vocabulary `Home.md` documents
- The H1 must match the filename, because the filename is what wikilinks resolve against
- Slugs must be unique

Warnings — a note under 40 words, or a note nothing links to — are printed but do not stop
a build. Both describe every note on the day it is written, so making them fatal would mean
the tooling blocks the writing. `npm run lint:notes` makes them fatal when you want to go
looking for them.

## Wiki features

- **Wikilinks** — `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, plus `related:` in
  frontmatter, all resolved at build time
- **Backlinks** — every page lists what links to it
- **Stub pages** — a link to an unwritten note gets a real page saying so, listing what
  links to it. Links never 404, and `/queue/` publishes the writing queue, most-linked first
- **Search** — the whole index ships as JSON and is scored in the browser; `/` focuses it
- **Graph** — `/graph/` draws the link graph on canvas, no external libraries

## Structure

```
content/          synced from the vault (committed)
scripts/
  sync-lib.mjs    the mirror: allowlist, drift, deletions
  sync.mjs        its CLI
  wiki-lib.mjs    frontmatter, slugs, wikilinks, the graph, validation
  render.mjs      HTML generation and the markdown pipeline
  build.mjs       orchestration
  browser-check.mjs
  update-apps.mjs the Podcast Index apps directory, for adoption counts
  auto-publish.sh what launchd runs
data/apps.json    the apps directory, trimmed and committed
public/assets/    hand-written CSS and JS (committed)
public/**         everything else is generated
test/             node --test
```

## Deploying

Live at **https://pc20-wiki.vercel.app**.

Vercel builds `main` on every push, configured by `vercel.json` (`npm run build` →
`public/`, `cleanUrls`, `trailingSlash`). Canonical URLs come from `SITE_URL`, falling
back to the Vercel production host — so a custom domain needs `SITE_URL` set, and
nothing else.

The build never touches the vault. It reads `content/` and `data/apps.json`, both
committed, which is why a Vercel builder with no iCloud and no `~/Vibe` checkout
produces the same site this machine does.

## Licence

Code is MIT. The notes under `content/` are CC BY 4.0. See `LICENSE`.
