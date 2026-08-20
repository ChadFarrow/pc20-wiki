# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`pc20-wiki` is a public reference for **Podcasting 2.0** — the namespace, the payments, and
the plumbing underneath — built as a static site from the *PC 2.0 hivemind* Obsidian vault.
Live at **https://pc20-wiki.vercel.app**; the repo is public and Vercel builds `main` on
every push.

A hand-rolled static site generator: ~3,100 lines of plain ESM Node scripts, two runtime
dependencies (`js-yaml`, `marked`), no framework and no build step for the client. 60 notes
today. `README.md` is written for the human and is unusually complete — read it first; this
file covers what a session working on the *code* needs and would otherwise get wrong.

The site is three things layered:

1. **The wiki** — notes, wikilinks, backlinks, stub pages, a link graph, client-side search.
2. **Episode mentions** — each note lists the episodes of the show that discussed its subject
   (`data/mentions.json`, generated from three sibling repos plus the show's captions).
3. **The timeline** — `/timeline/` publishes the show's curated history era by era
   (`data/timeline.json`, from `pc20-timeline`).

## Commands

```sh
npm run build            # compile content/ → public/. This is what deploys.
npm run build:strict     # warnings fatal (same as lint:notes)
npm test                 # node --test — 219 tests, ~4s
npm run serve            # http://127.0.0.1:8088
npm run check:browser    # headless Chrome against the built site
npm run sync             # mirror the vault into content/ (needs the vault)
npm run update:apps      # data/apps.json   ← Podcast Index apps directory (network)
npm run update:mentions  # data/mentions.json ← the sibling repos
npm run update:timeline  # data/timeline.json ← pc20-timeline's milestones
npm run fetch:captions   # captions/ ← the show's SRTs (network, gitignored, ~39 MB)
```

`node --test` must be bare — `node --test test/` fails to resolve modules.

## Sibling repos

Read-only sources, all expected at `../`. None of them is needed to `build` or `test`; they
are needed only to regenerate.

| Repo | What this takes from it |
|---|---|
| `pc20-archive` | 2,631 chapter titles with timestamps (eps 12, 23, 68–145) and 100 episodes of show notes (E1–100) |
| `pc20-timeline` | 204 curated milestones, the era/kind/tag vocabulary in `content/eras.yml`, and `data/episodes.json` (E1–E266) |
| `pc20-clips` | `pc2-clip-checklist.md` (65 flagged moments after dedupe) — and the matching algorithm, ported from `app/search.py` |

## Architecture

### Content is a mirror, not the source

`content/` is a one-way copy of an iCloud Obsidian vault, produced by `npm run sync` and
committed because Vercel has no iCloud. **Never edit `content/` directly** — the next sync
destroys it. Note title = filename = H1 = the wikilink target; slug is `slugify(title)`.

Some of a note does not publish: `dropSections` in `wiki-lib.mjs` drops `## Open questions`
(36 notes today) on the way in, so it lives in Obsidian and never renders, gets outlined or
gets indexed. `loadNotes` therefore carries two bodies — `note.body`, the vault's, which
`buildGraph` and `validateNote` read, and `note.published`, which `render.mjs` and the search
index read. **Keep the graph on the raw body**: three notes reach `Custody` and `NIP-46` only
from an open question, and stripping first would delete those edges silently.

A launchd agent on the author's Mac watches the vault and runs sync → build → commit → push
to `main` with no review step. Consequences worth holding in mind: a note is published about
a minute after it is saved, and **the agent never runs the generators**, so generated data
goes stale silently unless something warns (see *Staleness*).

### Modules

| File | Role |
|---|---|
| `scripts/wiki-lib.mjs` | frontmatter, slugs, wikilinks, the graph, `validateNote`, `adoption` |
| `scripts/render.mjs` | every page, as template literals. No template engine |
| `scripts/build.mjs` | orchestration: load → validate → render → search index → sitemap |
| `scripts/sync-lib.mjs` / `sync.mjs` | the vault mirror: allowlist, drift, deletions |
| `scripts/source-lib.mjs` | shared by both generators: overridable paths, provenance, missing-source policy |
| `scripts/mentions-lib.mjs` | the matching rules — the risky part of this repo |
| `scripts/captions-lib.mjs` | the transcript tier: SRT → cues, dwell, lift, the four gates |
| `scripts/fetch-captions.mjs` | fills `captions/`. The only script here that uses the network |
| `scripts/update-mentions.mjs` | CLI: five sources → `data/mentions.json` |
| `scripts/timeline-lib.mjs` | eras, date placement, entry → note linking |
| `scripts/update-timeline.mjs` | CLI: milestones → `data/timeline.json` |
| `scripts/browser-check.mjs` | drives the real built site over CDP |

`*-lib.mjs` files are pure functions over strings and plain objects — no filesystem — so
every rule has a test naming the behaviour. Keep it that way; it is what makes the matching
rules testable at all.

### Generated but committed

`data/apps.json`, `data/mentions.json` (123 KB), `data/timeline.json` (92 KB). All three are
regenerated by hand and committed, because the Vercel builder has neither the sibling
checkouts nor a guarantee of network access. A wiki that silently lost its episode citations
on deploy would be worse than one that never had them.

Each is **optional at build time**: ENOENT is a warning, not an error, and the site builds
without it. Adding a fourth follows the same shape.

**Both generators must be deterministic** — same inputs, byte-identical output. Everything is
sorted explicitly for this reason. `--dry-run` on either is the guard; it should report
"no change" immediately after a real run.

**Keep both diffs comparing whole records.** They did not. The timeline's compared title and
episode, the mentions' compared list lengths, and a run that dropped 34 milestone bodies
reported "no change" — a guard that cannot see the loss it exists to catch is worse than
none, because it is believed. Both rules now live in the `*-lib.mjs` files with tests naming
that failure. Narrowing either one re-opens it.

A real run writes nothing when nothing moved: `writeGenerated` in `source-lib.mjs` keeps the
previous `generated` date rather than stamping today's, so the launchd agent does not commit
a one-line diff every day. `generated` therefore means "the day this data last changed".

## The matching rules (`mentions-lib.mjs`)

This is where the repo is easiest to break subtly. Every rule below was measured against the
real archive, and the numbers are the argument.

### `squash()` and the five-character threshold

`squash()` reduces text to lowercase letters and digits — ported from
`pc20-clips/app/search.py:_squash`. It exists because the show's own text does not agree with
itself: `PodcastIndex.org` / `Podcast Index`, `Boostagrams` / `Boostagram`, `value4value` /
`Value 4 Value`, `pod ping` / `podping`.

Squashing is applied **only when the search form is 5+ squashed characters**; shorter forms
match on word boundaries instead (`SQUASH_MIN`). Without that threshold:

- `Tor` matched ~80 moments and **every one was false** — "Podfather **stor**y time", "Art
  Gener**ator** Splits", "Weathering the **stor**m"
- `NIP` matched six, all false — "mi**nip**ub", "ma**nip**ulation", "a**NIP**hone"

while `RSS`, `Sats`, `LND` and `LNURL` match identically under either rule. The cost of
squashing is concentrated entirely in short forms, where it is total; the gains are all at
ten characters or more. **Do not lower this threshold**, and if you raise it, re-check that
`Boost` (5) still matches "Boostagrams".

### Where aliases live

A note's search forms are its **title + `aliases:` from the vault frontmatter +
`EXTRA_ALIASES`**.

`aliases:` in the vault is the real home: Obsidian owns that key and means the same thing by
it, an alias is a property of the concept, and `sync-lib.mjs` copies note bytes verbatim so
it survives. `validateNote` requires it to be a list of non-empty strings — a typo there would
otherwise cost a note its citations in silence.

`EXTRA_ALIASES` in `mentions-lib.mjs` is the bootstrap and escape hatch, not the default.
**Never add aliases by editing `content/`** — sync will delete them.

Aliases matter more than they look: `Podcast Namespace` matched **zero** moments until
`namespace` was added, because nobody on the show says "Podcast Namespace".

### Two deny mechanisms, for two different problems

1. **Frequency-derived** (`denyForms`, `DENY_EPISODE_THRESHOLD = 4`): any text appearing in
   four or more distinct episodes is furniture. Derived rather than hand-listed because the
   real boilerplate is not guessable — it currently derives 74 forms, including
   `Show Notes` ×97, `Download the mp3` ×81, `Preservepodcasting.com` ×62 and the weekly
   app-list block that would otherwise have handed the Podverse note 22 episodes' worth of
   mentions that are really a footer link. It self-maintains as episodes are added.
2. **Structural** (`STRUCTURAL_BOILERPLATE`): the feed's own template lines — `Podcasting 2.0
   for <date> Episode N: <title>` and `Adam & Dave discuss the week's developments…`. Each
   instance carries a different date and title, so **no frequency count can ever catch them**.
   Left in, they were 144 of 914 mentions, and the Podcasting 2.0 note was 100 copies of its
   own feed header.

`EXTRA_DENY` is the third, per-note and hand-written, for things only reading the report
finds — hosting companies that share a name with a protocol (`RSS.com`, `RSS Blue`).

**`denied()` must be applied by every matcher.** `notesForEntry` in `timeline-lib.mjs`
originally was not, and produced five RSS links on the timeline that were all RSS Blue.

### The report is the quality gate, not the tests

```sh
node scripts/update-mentions.mjs --report            # every matched moment, grouped by note
node scripts/update-mentions.mjs --report --only rss
```

Matching thousands of hand-written labels against 60 titles goes wrong in ways only reading
the output catches. The tests pin the cases already found; the report finds the next one.
Run it and read it after any change to the rules, then tune `EXTRA_DENY` or vault aliases.

Current output: **949 mentions across 44 of 60 notes and 220 episodes** — 772 curated and
**177 from the transcripts**, the second tier described below.

### The transcript tier (`captions-lib.mjs`)

The captions are a **fifth source and a worse one**, and every rule here exists because of
that. A chapter title is somebody deciding "this bit is about X"; a caption line is only
somebody saying the word. Under the plain matching rules above, 481,956 cues from 256
episodes produce roughly **24,000 hits — about 31× the entire curated dataset**, and almost
all of them are worthless. Four gates cut that to 177.

**Two cue counts appear below, and they are not a contradiction.** Every calibration number
in this section was measured over **481,956 cues from 256 episodes** — every file that was
not a stub, before the duplicate rule existed. The generator now reads **473,986 cues from
252 episodes**, because four files (50, 51, 248, 249) are two duplicated pairs it drops. The
calibration figures stay on the set they were measured over; `data/mentions.json` is the
authority for what is read today.

Read the calibration report before touching any number here:

```sh
node scripts/update-mentions.mjs --report --only relay
```

**Gate 1 — gap only.** A note that already has a curated mention in an episode never
consults the transcript for that episode. The better source is therefore never diluted by
the worse one, and the tier can only ever add coverage.

**Gate 2 — furniture, by frequency and by shape.** `denyForms` runs over cue text exactly as
it runs over chapter titles. It cannot touch the boostagram readout — thirty minutes at the
end of every episode, where every line carries a different amount and a different name, so no
two are the same text. `TRANSCRIPT_BOILERPLATE` catches that by shape instead.

**The 3-digit rule is the blunt one, and it stays.** `/\d{3,}/` drops any cue with a run of
three or more digits, which would also drop a line naming TLV record `7629169` or a port —
the exact kind of fact this wiki is for. Measured across the full **481,956**-cue set: **12,187**
carry such a run (2.53%), and **766** of those both match a note and are not obviously a
payment being read aloud. Every one of the 766 belongs to one of the twelve **best**-covered
notes — Podcasting 2.0 246, Boost 171, Bitcoin 82, Podverse 66, Podcast Index 46, Value 4
Value 27, then Splits, Chapters, RSS, Enclosure, Podcast Namespace, Transcripts. **Not one
thin note appears in that list**, and many of the 766 are the show's spoken intro, which the
second pattern catches anyway. So the rule's whole cost lands where citations are already
plentiful and gate 4 caps them regardless, and is **zero** where coverage was the point.
**Do not loosen it.**

**Gate 3 — dwell. `DWELL_FLOOR = 2` hits inside `DWELL_WINDOW = 300` seconds.** This stops a
single passing mention and **nothing else**. It does *not* stop rapid repetition: cues are
about four seconds apart, so three consecutive "boost"s sit well inside a 300-second window
and clear a floor of 2 comfortably. Separating a habit from a segment is gate 4's job.

The floor was tried at 3, 4 and 5 against the whole archive. **3 costs four notes their only
citation — BoostCLI, NIP, Payment Channel, StartOS — and every one of those citations is
true**: NIP's is "Look at your nip 50 sevens" (NIP-57), which is also the answer to whether
`SQUASH_MIN`'s old enemy came back. It did not; NIP gained exactly one transcript mention in
the whole run and it is correct. A floor that deletes the feature's entire purpose to tidy
notes that already have twenty citations is the wrong trade. **It stays at 2.**

**Gate 4 — lift, then rank and cap. `LIFT_MIN = 1`, `TRANSCRIPT_EPISODE_CAP = 6`.** Lift is
a *filter*: a note keeps only the episodes where its hit count is at least `LIFT_MIN` times
its own mean over the episodes that cleared the dwell floor. Because max ≥ mean always, lift
can never empty a note, and where counts tie — which a floor of 2 makes the ordinary outcome
— it does nothing at all and the cap decides alone. Ties go to the **newer** episode, because
E146–E266 is what nothing else cites.

Raising lift to 1.5 costs ten notes their only citation, including `Reverse Proxy`, whose one
line — "reverse proxy on it to basically proxy those WebSocket from Dobby" — is the case the
design named as the feature working. **It stays at 1.** The cap governs the *data*, not just
the page, because 819 note-episode pairs clear lift and an uncapped file helps nobody; the
page shows 4 (`MENTION_TRANSCRIPT_CAP`), so 6 in the data leaves "and N more episodes"
something true to say. Reading all 41 notes at the cap, **none is flooded** — the sixth
citation is still a real one, e.g. Boost E183 "a boost UU ID. Yeah, as an optional value on
the TLV". **It stays at 6.**

**`Sats` is the weakest note that survives the gates, and it was left that way knowingly.**
Its six transcript lines are the show using the word rather than discussing it — E201 36:46
"sats in there so I can, so I" is the clearest example. Nothing was moved for it because
every lever that would reach it is blunt: a higher floor or a tighter lift cutoff deletes a
thin note's *only* true citation long before it touches `Sats`, which already carries 18
curated mentions that gate 1 protects. If it ever reads badly on the page, the lever is
`EXTRA_DENY`, per-note and hand-written — the same remedy as `RSS Blue`, and for the same
reason: a per-note problem needs a per-note rule, not a global threshold.

**Two senses of one word is the failure mode left, and `EXTRA_DENY` is the only lever for
it.** `Relay` E264 is forty seconds of Adam wiring a garage door — five hits in one window,
the densest Relay passage in the entire run. No floor and no lift cutoff can reach a passage
that dense. Three phrases (`micro switch`, `relay was activated`, `relay is deactivated`)
remove it, and the note keeps its Nostr citations. Same shape as `RSS Blue` above.

**The server serves one transcript at two URLs.** `PC20-50`/`PC20-51` and
`PC20-248`/`PC20-249` are byte-identical pairs — confirmed against the origin, not a fetch
bug. One of each pair is not that episode's transcript and **nothing in the file says which**,
so `collectCaptions` drops both copies and names them, the same treatment a stub gets. Left
in, `Sats` and `StartOS` each cited the same words at the same timestamp under two
consecutive episodes. The spoken intro looks like an arbiter and is not: six of 258 files
name an episode in their opening cues that differs from the file name, and only those two are
real — the other four are the transcriber splitting a number, as in E152's "episode 150 to
drop the talk".

### Coverage is the ceiling, not vocabulary

This held for the curated sources and the transcripts moved it, but only so far. 23 notes had
no mentions; probing all of them turned up exactly one recoverable by alias (StartOS ←
`start9`), because chapter titles stop at **E145** and show notes at **E100** and most of
those tools came up after that. The transcripts reach E266, which is why 41 notes now carry
one and **40 episodes are cited by nothing else**. **12 of the 56 matchable notes still have
nothing** — Lightning.Pub, RaspiBlitz, extractlv, NIP-46 and the rest are simply not in any
source. Do not go hunting for more aliases expecting a yield.

## The timeline

`/timeline/` renders `data/timeline.json`: 204 milestones, oldest first, grouped into the 9
eras that have entries, with an era index at the top. 117 link to a note; 69 carry a body.

**The entries are primary evidence.** They came from someone relistening to the whole run
from E1 and marking what mattered — not from compiling feeds. A milestone title therefore
**outranks any chapter title annotating it**: the 69 bodies are written from chapter titles
and show notes, so a body adds context and must never correct the entry.

**Coverage is uneven on purpose.** About 0.5 entries per episode across 2020–22 against 1.2
across 2023–24, because that early relisten skipped a great deal that had already been
overtaken by the time it was heard again. A thin era means "less was still standing", never
"less happened". **Do not try to even it out by inferring entries from chapter titles.**

Placement is by **date**, not episode range — the last era whose `start` is on or before the
entry's date — which is what makes the eras gapless. An entry that cannot be dated is dropped
and named on stderr rather than guessed at.

**The milestone text lives in `pc20-timeline`, not here.** `data/timeline.json` is generated
from those files, so a body that exists only in the generated copy is one regeneration away
from deletion — and `--dry-run` will not warn you, unless the comparison stays as wide as it
now is. If a body has to be recovered from `data/timeline.json`, it goes back into the
milestone file; the entry's `id` is that file's name.

Only the seeded `TODO: add context for this milestone` line is dropped at generation, not the
whole body: nine milestones write which episodes of the relisten the entry spans underneath
it, and dropping the body wholesale deleted that. 135 milestones still have nothing but the
seed. Most of them cannot be written from the archive at all — chapter titles stop at E145
and show notes at E100, so 117 of them sit outside both sources, and of the 53 that were in
range, 24 were probed and had nothing worth adding.

**Ordering differs from the mentions section on purpose.** The timeline is oldest-first
because it is a history; a note's mentions are newest-first because that list is capped
(8 episodes × 3 moments) and the recent end is the useful slice.

## Client-side search

The whole index ships as `public/data/search-index.json` (107 KB) and is scored in the
browser — no library, no server. Lazily fetched on first focus. Scoring ladder in
`public/assets/site.js`:

```
title === term      100
title.startsWith     60
title.includes       40
tags.includes        25
headings.includes    18
text.includes         6
moments.includes      4   ← mention text, squashed
```

Any term scoring 0 zeroes the note, so extra words narrow rather than broaden.

**Mention text is deliberately the bottom rung.** It is the show's vocabulary, not the wiki's;
ranked higher, a common word like "fountain" or "alby" would flood an eight-row dropdown.
Ranked here it only ever adds notes that would otherwise return nothing — `steno` now reaches
Transcripts, `hypercatcher` reaches Chapters.

`squash()` is applied **only** to the `moments` comparison. Squashing the other fields would
silently re-rank every existing result to fix a problem only the show's own text has.

`.search__eps` (the "27 episodes" count) is a **sibling** of `.search__title`, never inside
it — `browser-check.mjs` asserts on that element's exact text.

## Staleness

The launchd agent now runs both generators on every publish, before the build, so an alias
added in Obsidian reaches the site on the same run. A sibling that is not checked out is
logged and skipped, and the committed data stands. This is why `writeGenerated` in
`source-lib.mjs` keeps the previous `generated` date when nothing else moved — on a timer,
that stamp would otherwise be the only line that ever changed.

The warnings below still matter, because a checkout somewhere else may have no siblings at
all, and because `npm run update:apps` is still run by hand.

`data/mentions.json` records a `notes` fingerprint of the forms each note was matched on, and
`build.mjs` warns in both directions: when a note's current forms differ from the recorded
ones, and when a matchable note has no record at all. Both are warnings, so `build:strict`
fails on them — which is the point.

**The captions have no git revision to record, and what stands in for one is weaker than it
looks.** Their provenance entry holds the usable episode count, the newest episode, the stub
list, the duplicate list and `records` — a **cue count, not a content hash**. That catches a
cache that is short, stale at the top end, or has gained stubs. It does not catch an episode
re-transcribed in place with the same number of cues. `npm run fetch:captions --force` is the
only way to be certain of that case; a hash over the cue text is the fix if it ever matters.

A **stub heals on an ordinary run**, so `--force` is not needed for one. `fetch-captions.mjs`
reads each file before it decides to skip it, and a file holding fewer than `CAPTION_MIN_CUES`
cues counts as absent. The cost is one read per episode and one request per stub. Before this,
an existence test skipped a stub for ever, and eight episodes stayed out of the cache no matter
how often the fetcher ran.

## Conventions & gotchas

- **`build.mjs` calls `await main()` at module scope.** It exports `loadNotes`, but importing
  it runs a build. `update-mentions.mjs` reads notes itself for this reason.
- **A new generated output directory needs three edits**, not one: the `rm` cleanup list in
  `build.mjs` (so a rename cannot leave an orphan URL), the sitemap array, and `.gitignore`.
  `public/timeline/` was committed as build output once because the third was missed.
- **`public/` is generated except** `assets/`, `robots.txt` and `sitemap.xml`, which are
  committed. JS and CSS edits are live on refresh; `.mjs` changes need a rebuild.
- **`check:browser` is macOS-first.** `CHROME=<path>` and `CHROME_FLAGS=--no-sandbox` make it
  run in a container. In a sandbox that blocks Google Fonts it still fails the search
  assertions — the page's fetch of the search index stalls behind the blocked font requests,
  and `document.readyState` never leaves `interactive`. **This is not a regression**; confirm
  against a clean `HEAD` worktree before believing otherwise, and drive the page with the
  font `<link>`s stripped to test search behaviour.
- **Milestone and chapter text is external content.** It contains `&`, `<`, `?`, apostrophes
  and emoji. Everything goes through `escapeHtml`, and the timeline's bodies through the same
  `marked` instance as notes, which escapes raw HTML rather than executing it.
- **No escape sentinels in string literals.** A `'\0'` written as a real NUL byte made
  `update-mentions.mjs` binary to `grep` and `git diff`. If a value can be absent, branch on
  it.
- **Tests are plain `node --test`** against `tmp_path`-style temp dirs, no mocking library.
  `site.test.mjs` spawns the real `build.mjs` and asserts against the built HTML; assertions
  are **derived from the data**, never pinned to today's episode numbers, because the archive
  changes. Watch for substring collisions when counting classes — `entry__notes` contains
  `entry__note`.

## Transcripts are a source now, and still not in git

They were not, and the section that said so is what the transcript tier replaced. What
changed is only the matching; **the constraints that kept them out have not moved.**

- **Still not in git.** 264 SRTs, **39 MB**, and `captions/` is in `.gitignore`. Vercel never
  sees them. What ships is the derived `data/mentions.json`, as before.
- **Still fetched by hand.** `npm run fetch:captions` fills the cache from
  `https://mp3s.nashownotes.com/PC20-<NN>-Captions.srt` (single digits zero-padded — `PC20-7`
  is a 404, `PC20-07` is not), skipping what is present **and usable** — a stub is asked for
  again, and the run says how many cleared; `--force` refetches everything. It is the only
  script here that touches the network, and it prefers `/Volumes/pc20-archive` if that share
  is mounted.
- **The generator still reads only files.** `update-mentions.mjs` reads `captions/` exactly
  as it reads the four sibling checkouts, behind `--captions` / `PC20_CAPTIONS`, and fails
  the same way when it is absent. No network, ever.
- **Transcript text stays out of the search index; transcript episodes do not.** `build.mjs`
  builds each note's `moments` (the text a search match is scored against) from mention text
  filtered to exclude source `t`, and builds `episodes` (the count shown beside a result) from
  the full mention list. Moment text is deliberately the bottom rung of the scoring ladder so
  a common word cannot flood the dropdown, and transcript text is the show's vocabulary at its
  noisiest — importing it would roughly double the index and every transcription error with
  it. The episode count carries no such risk, and leaving transcript episodes out of it would
  make a note's page and its own search result disagree — `Tor`'s page says six episodes, so
  search must not say zero. Adding transcript text to `moments` later is easy — the report now
  shows what the text looks like — but it is not in this version.

The prediction that the *shape* of the feature had to change was right, and the four gates in
*The transcript tier* above are that shape. So is the two-tier page cap: the page shows up to
8 curated episodes and then up to 4 transcript ones (`MENTION_EPISODE_CAP` and
`MENTION_TRANSCRIPT_CAP`), because transcript-only episodes are by definition the newest ones
and a single newest-first cap would let the weaker source evict the better one.

`pc20-clips/app/search.py:_squash` was ported and is the reason `squash()` exists. Its
`Index.variants` — which catches the transcriber's mis-hearings, "pod ping" for podping,
"wavelake" for wavlake — was **not**, deliberately. `squash()` already handles "pod ping",
and the report does not show a mis-hearing costing a note a citation. If that changes, this
is where to start.
