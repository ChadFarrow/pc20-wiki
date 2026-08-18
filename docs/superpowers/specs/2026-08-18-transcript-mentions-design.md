# Transcripts as a fifth source for episode mentions

**Status:** design approved 2026-08-18, not yet implemented.

## Why

`data/mentions.json` answers "which episodes discussed this note" from four curated
sources. All four run out early: chapter titles stop at **E145**, show notes at **E100**,
the timeline milestones and the clip checklist are sparse by nature. The show is at
**E266**. So the back half of the run cites nothing, and 22 of the 56 matchable notes have
no mentions at all — `Tor`, `NIP`, `Reverse Proxy`, `Lightning.Pub` and the rest.

`CLAUDE.md` records that transcripts are the only source reaching past E145, and that
adding them "does not change the plumbing but does change the shape of the feature". This
is that shape, decided before anything is generated.

The captions are reachable at `https://mp3s.nashownotes.com/PC20-<NN>-Captions.srt`, and
they run to **E266** — further than the 249 files `pc20-clips/app/search.py` measured off
the NAS. The NAS share `/Volumes/pc20-archive` is not mounted on the author's Mac.

## What the measurements say

Probed against 8 real episodes — E7, E100, E120, E145, E180, E200, E230, E251. E46 and
E86 returned 60-byte "Transcript is Processing" stubs, exactly as `search.py` documents.

**The volume is the whole problem.** Under today's matching rules, 8 episodes produce
**774 transcript hits**. The entire curated corpus is 772 mentions across 180 episodes.
Scaled to the full run that is roughly **24,000 hits — about 31× the existing dataset.**

**The hits are correct and mostly worthless.** Both of these are true matches:

```
Boost, E100 — 64 hits scattered over 80 minutes
   113m  "I boosted like,"
    38m  "boost for me. But then he sees other people just listening"

Lightning Address, E120 — 11 hits inside five minutes (19m–24m)
    22m  "an ln address attribute. An ln address attribute would be"
    23m  "this extra attribute ln address. But if you have type equals"
```

The first is a word occurring in conversation. The second is the show working through the
tag. A chapter title is somebody deciding "this bit is about X"; a transcript line is only
somebody saying the word.

**Tightness does not separate them.** Three consecutive "boost"s span four seconds and
score as tight a cluster as any real segment. Cue spacing is ~4s, so consecutive repetition
in speech always looks dense.

**Dwell over a five-minute window does separate them, partly.** `Podping E251` scores peak
15; `NIP` scores peak 1 in both episodes it appears in. But `Boost E100` still scores peak
12, so dwell alone does not hold back a word the show says constantly.

**The two forms the squash threshold exists to kill behave differently here, and the
difference is measurable.**

```
Tor,  E251 — 4 hits inside one minute, all real
    69m  "I access helipad over Tor."
    69m  "my vault warden server right over Tor,"
  → Tor has ZERO mentions today. This is the gap, filled correctly.

NIP,  E120 and E230 — 1 hit each, both false
     1m  "like nip the inside of my lip"
    10m  "You got to nip it in the bud."

Reverse Proxy, E230 — 2 hits, both real. Also zero mentions today.
```

**The dominant noise is the boostagram readout.** Every episode ends with roughly thirty
minutes of reading boostagrams aloud. It is the densest passage in the episode, so a dwell
floor actively *selects* for it:

```
Boost,         E180  112m  "boob boost which did come through 808 CELTA Crayon 7"
Sats,          E100   83m  "at 100,100 SATs happy 100 show thank you very much."
Podcast Index, E145  114m  "30 3015. Through fountain he says howdy podcast inde"
```

**The show's spoken intro is the same enemy `STRUCTURAL_BOILERPLATE` already fights**, and
the existing detector misses it, because it is tuned to the written feed line
(`Podcasting 2.0 for <date> Episode N: <title>`) and the spoken form has a comma and no
title:

```
isStructural("Podcasting 2.0 for August 15th, 2025, episode")  →  false
```

**The transcription is rough.** "booster gram" for boostagram, "streaming sets" for
streaming sats, "pod ping" for podping up to ~E203, "V COMM", "CELTA Crayon". Quoting a
line puts that on the page.

## The rule

Four gates, in order. A transcript hit must pass all four.

### 1. Gap only

If the note already has a curated mention in that episode, the transcript is not consulted
for that note-episode pair. Curated data never competes with transcript data, so the
existing signal cannot be diluted.

Measured on the sample: 119 note-episode pairs have transcript hits, and 107 of them are
gaps the curated sources do not cover.

### 2. Furniture — two mechanisms, for two different problems

This mirrors the design the written sources already use, and for the same reason.

**2a. Frequency-derived.** Run the existing `denyForms` over transcript cue text, exactly as
it already runs over chapter titles: any text recurring across `DENY_EPISODE_THRESHOLD` (4)
or more distinct episodes is furniture. This catches the stock phrases that repeat
word-for-word — *"Got some booster grams."*, *"Value for value."*, *"Thank you very much."*

**2b. Structural.** Frequency alone **cannot** catch the boostagram readout, and this was an
error in an earlier draft of this spec. `denyForms` keys on the whole cue text squashed, and
no two readout lines are the same: *"808 CELTA Crayon"*, *"1701 Satoshi's"*, *"1337 elite
booster"*. Each carries a different amount and a different name, which is exactly what
`CLAUDE.md` says about the feed's template lines — *"no frequency count can ever catch
them"*.

So a new `TRANSCRIPT_BOILERPLATE`, matched by shape:

| Pattern | Catches |
|---|---|
| a run of **3 or more digits** | the readout's amounts — *"with 1000 SATs and he"*, *"was 233 threes"* |
| `podcasting 2.0 for … episode` | the spoken intro, which the written `isStructural` misses because the spoken form has a comma and no title |
| `boostagram` / `booster gram` / `boost gram` | the readout's own name for itself |

Measured on the sample: the 3-digit rule caught 10 of 10 readout lines and 0 of 12 real
ones. *"another hero of podcasting 2.0"* survives, because `2.0` is not a 3-digit run.

**The risk it carries.** A 3-digit rule would also drop a line naming TLV record `7629169`
or a port number — the exact kind of specific fact this wiki is for. The sample is 22 lines.
This rule above all others must be checked against the full report before it ships, and the
report should be read specifically for real lines it swallowed.

`EXTRA_DENY` stays available for what only reading the report finds.

### 3. Dwell floor

A note-episode pair needs **2 or more hits inside a 5-minute window**.

Measured: this drops both `NIP` false positives and the marginal `Tor E180` name-drop,
while keeping `Tor E251` (4 hits in one minute) and `Reverse Proxy E230` (2 hits). Both of
those notes have no mentions at all today.

### 4. Rank by lift, then cap

Rank a note's surviving episodes by how unusually present the note is in that episode
against its own average across the whole run, then keep at most **K** episodes per note.

Lift is what holds `Boost` back: on the sample its ordinary episodes score 0.3 and 0.5
while its genuine ones score 2.6. The cap is what guarantees a bounded output whatever lift
turns out to do on the full corpus.

**Starting values, to be moved after reading the report:** floor 2 hits per 5 minutes, lift
at or above 1.0 (the note is at least as present as its own average), **K = 6**.

K caps the *data*, which is a departure — for the curated sources `data/mentions.json` holds
everything and only the page caps. Transcripts are capped in the data because the volume is
31× and an uncapped file helps nobody. K = 6 against a page that shows 4 leaves the
renderer's existing "and N more episodes" line something true to say.

### Thresholds are not final

The floor, the lift cutoff and K are three knobs, and eight episodes cannot calibrate them.
Calibration means fetching all of them and reading
`node scripts/update-mentions.mjs --report`, which this repo already treats as the quality
gate rather than a formality. **Expect at least one of the three to move.** The
implementation is not done until the report has been read.

## Where the captions come from

**The generator still never touches the network.** That contract is unchanged. A separate
script fetches:

```sh
node scripts/fetch-captions.mjs           # fill the cache, skip what is present
node scripts/fetch-captions.mjs --force   # refetch everything
```

- Writes to `captions/` in the repo root, **gitignored**. About 250 files at ~165 KB is
  roughly **41 MB**, and none of it is ever committed.
- URL is `https://mp3s.nashownotes.com/PC20-<NN>-Captions.srt`. Single-digit episodes must
  be zero-padded — `PC20-7` returns 404, `PC20-07` returns the file. Three digits go plain.
- If `/Volumes/pc20-archive` is mounted, prefer it and fetch nothing.
- Overridable by `--captions` and `PC20_CAPTIONS`, the shape `source-lib.mjs` gives every
  source.

**Stubs are counted, not silently skipped.** Anything under a cue threshold is a
"Transcript is Processing" placeholder. The generator drops it and names the episode, so a
note with no transcript mentions can be told apart from an episode with no transcript.

**Provenance takes a different shape.** The other four sources record a git revision.
Captions are not in git, so the record is the episode count, the newest episode and a
content fingerprint — same purpose, which is that a stale number should read as stale.

## Modules

| File | Change |
|---|---|
| `scripts/captions-lib.mjs` | **new.** Pure: SRT → cues, densest window, lift, the four gates. No filesystem, like every other `*-lib.mjs` |
| `scripts/fetch-captions.mjs` | **new.** The only thing here that uses the network |
| `scripts/update-mentions.mjs` | a fifth source, with the same `--allow-missing` and provenance handling |
| `scripts/mentions-lib.mjs` | `denyForms` applied to cue text; source label `t` |
| `scripts/render.mjs` | the two-tier cap, the `transcript` label, two lines of prose |
| `.gitignore` | `captions/` |

Determinism is unchanged: same cache in, byte-identical JSON out. `--dry-run` is a real
guard now that both diffs compare whole records.

**`data/mentions.json` grows.** It is 96 KB today at ~124 bytes a mention. The four gates
should land in the low thousands of new mentions, so expect **200–350 KB**. It stays
committed, for the reason it already is: the Vercel builder has neither the siblings nor a
guarantee of network access.

## The page

**Cap the two tiers separately: up to 8 curated episodes, then up to 4 transcript
episodes** (`MENTION_EPISODE_CAP` and a new `MENTION_TRANSCRIPT_CAP`).

This is not cosmetic. Episodes sort newest-first and the page shows 8
(`MENTION_EPISODE_CAP`). Transcript-only episodes are by definition the ones the curated
sources miss — mostly E146–E266, the newest. Without separate caps, `Nostr` would show
eight transcript episodes and push all 18 of its curated episodes below the fold. The
weaker source would evict the better one.

**The line is quoted, labelled `transcript`.** The renderer already prints a source label
per moment (`chapter`, `show notes`, `timeline`, `clip note`); this is the fifth. Quoting is
what makes it useful. It leans hard on gate 2: if the report shows garbage reaching the
page, tighten gate 2 rather than stop quoting.

**Two sentences of prose change.** The footer says *"curated sources only, not the show's
transcripts"* — that becomes a statement of the two tiers. The coverage sentence gains the
transcript count, because the shape of the gap is what a reader most needs to understand.

## Search

**Transcripts stay out of `search-index.json` in this version.**

Moment text is deliberately the bottom rung of the scoring ladder, so a common word cannot
flood an eight-row dropdown. Transcript text is the show's vocabulary at its noisiest, and
adding it would roughly double the index while importing every transcription error into it.

It is also the easiest thing to add later, once the report has shown what the text actually
looks like. Not in v1.

## Testing

- `captions-lib.mjs` gets a unit test per rule, each named for the case that produced it:
  `NIP` must not survive "nip it in the bud"; `Tor` must survive "I access helipad over
  Tor"; three consecutive cues must not clear the dwell floor on their own.
- `site.test.mjs` asserts the two-tier cap against the built HTML, derived from the data
  rather than pinned to episode numbers, because the archive changes.
- `browser-check.mjs` gains one assertion that a transcript moment renders with its label.
- `npm run build:strict` stays at zero warnings.

## What this does not do

- **No transcript text in the search index.** See above.
- **No variants.** `pc20-clips`'s `Index.variants` catches the transcriber's mishearings —
  "pod ping" for podping, "wavelake" for wavlake. `squash()` already handles the first of
  those. Variants are a separate, later question, and the report is what should decide
  whether they are needed.
- **No new episodes.** This cites episodes; it does not extend `data/episodes.json`.
