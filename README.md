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
| `npm run update:mentions`| Rebuild `data/mentions.json` from the sibling repos            |
| `npm run update:timeline`| Rebuild `data/timeline.json` from the curated milestones       |
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
- **Heard on the show** — each note lists the episodes its subject came up on, deep-linked
  into the audio at the timestamp. See *Episode mentions* below
- **Timeline** — `/timeline/` publishes the show's history era by era, each milestone
  linked to the episode it happened on and the notes it is about
- **Graph** — `/graph/` draws the link graph on canvas, no external libraries
- **Unpublished sections** — an `## Open questions` section stays in the vault and never
  reaches the site: the heading asks for an answer a static wiki has no way to take. Any
  wikilink written there still counts in the graph

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
  source-lib.mjs     reading the sibling checkouts: paths, provenance, absence
  mentions-lib.mjs   matching a note against what the show said
  update-mentions.mjs which episodes discussed each note
  timeline-lib.mjs   eras, placement and the chronology
  update-timeline.mjs the curated history
  auto-publish.sh what launchd runs
data/apps.json     the apps directory, trimmed and committed
data/mentions.json episode mentions per note (generated, committed)
data/timeline.json the curated history (generated, committed)
public/assets/    hand-written CSS and JS (committed)
public/**         everything else is generated
test/             node --test
```

## Episode mentions

Every note can say which episodes of the show discussed its subject, deep-linked into the
audio at the moment it came up. That is **949 mentions across 44 of the 60 notes and 220
episodes**, generated and committed:

```sh
npm run update:mentions                        # rewrite data/mentions.json
node scripts/update-mentions.mjs --report      # every matched moment, grouped by note
node scripts/update-mentions.mjs --dry-run     # what a regenerate would change
```

**The list has two tiers, and the page labels them.**

*Curated* — **772 mentions** from four sources, all read from a git checkout and never from
the network: chapter titles and show notes from `../pc20-archive`, curated milestones from
`../pc20-timeline`, and the clip checklist from `../pc20-clips`. Somebody decided each of
these was about its subject, which is what makes them the better tier.

*Transcript* — **177 mentions**, quoted and labelled `transcript`, from the show's own
captions. The curated sources stop early: chapter titles reach E145 and show notes E100,
while the show is at E266. Captions are the only source that reaches, so **40 of the cited
episodes are cited by nothing else**, and ten notes — `Tor`, `Reverse Proxy`, `Macaroon`,
`Payment Channel` and six more — have a citation for the first time. They are also the weakest source — a caption line is only
somebody saying the word — so four gates cut roughly 24,000 raw hits down to 177, and the
page shows at most 4 transcript episodes under at most 8 curated ones. The rules and the
measurements behind each threshold are in `CLAUDE.md`.

**The captions are not in the repo.** `npm run fetch:captions` fills a gitignored `captions/`
cache (264 files, ~39 MB) from the show's server; `update-mentions` then reads it as a plain
directory of files, like every other source. Each path is overridable by flag or environment
variable, and every one is printed before it is read.

**Regeneration runs on every publish.** The launchd agent now runs `update:mentions` and
`update:timeline` before it builds, so an alias added in Obsidian reaches the site on the
same run. A sibling checkout that is missing is logged and skipped, and the committed data
stands; the build still warns when it notices drift.

To change what a note matches, add `aliases:` to the note **in the vault** (Obsidian's own
key, so the quick-switcher benefits too). Rules that belong to the archive rather than to
the concept — the boilerplate threshold, per-note deny phrases, the timeline tag map — live
in `scripts/mentions-lib.mjs`, where each one can carry the reason it exists.

## The timeline

`/timeline/` is the show's history: 204 curated milestones — firsts, launches, specs,
shutdowns — grouped into the ten eras `pc20-timeline` defines, each linked to the episode
it happened on and to the notes that explain it.

```sh
npm run update:timeline                        # rewrite data/timeline.json
node scripts/update-timeline.mjs --dry-run     # what a regenerate would change
```

The entries and the era vocabulary come from `../pc20-timeline`, which is private and
undeployed — so this is where that work becomes readable. Placement is by **date**, not by
episode range, which is what makes the eras gapless: every entry falls in the last era that
had started. An entry whose episode cannot be dated is dropped and named on stderr rather
than guessed at.

**The entries are first-hand, and deliberately not exhaustive.** They came from relistening
to the run from E1 and marking what was worth marking — so a milestone title is primary
evidence, and outranks any chapter title annotating it. It also means coverage is uneven by
design: roughly 0.5 entries per episode across 2020–22 against 1.2 across 2023–24, because
that early pass skipped a great deal that had already been overtaken by the time it was
heard again. Read a thin era as "less was still standing", never as "less happened", and
do not try to even it out by inferring entries from chapter titles.

**Milestones only.** The mention data on each note already answers "when did they talk
about this", and folding 770 chapter titles in here would turn a history into a log.

An entry publishes its body where one has been written — 69 of the 204 so far, each written
from a chapter title or a show-note line in `pc20-archive`. Those are a *weaker* source than
the title they sit under, which came from the audio, so a body adds context and never
corrects the entry. The rest still hold the seeded `TODO: add context for this milestone`,
which is dropped rather than published: a placeholder on the page is worse than a bare
entry. Most of those cannot be written from the archive at all, since chapter titles stop
at E145 and show notes at E100, and 117 milestones fall outside both.

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
