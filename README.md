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

```sh
# edit notes in Obsidian as usual, then:
npm run publish:site      # sync + strict build
git add -A && git commit -m "…" && git push
```

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
| `npm run build`          | Build `public/`                                                |
| `npm run build:strict`   | Build, failing on warnings too — this is what deploys          |
| `npm run publish:site`   | `sync` then `build:strict`                                     |
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
- Warnings (fatal under `--strict`): a note under 40 words, or a note nothing links to

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
public/assets/    hand-written CSS and JS (committed)
public/**         everything else is generated
test/             node --test
```

## Deploying

Vercel, configured by `vercel.json` (`npm run build` → `public/`, `cleanUrls`,
`trailingSlash`). Canonical URLs come from `SITE_URL`, falling back to the Vercel
production host.
