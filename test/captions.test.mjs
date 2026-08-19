// test/captions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSrt, captionEpisode, CAPTION_MIN_CUES, densest, DWELL_WINDOW, isReadout, collectCaptions, buildTranscriptMentions, DWELL_FLOOR, LIFT_MIN, TRANSCRIPT_EPISODE_CAP } from '../scripts/captions-lib.mjs';
import { formsFor, matchesForm } from '../scripts/mentions-lib.mjs';

const SRT = `1
00:00:01,000 --> 00:00:04,120
Adam Curry: Podcasting 2.0

2
00:19:07,500 --> 00:19:11,000
an ln address attribute. An ln
address attribute would be

3
01:02:03,000 --> 01:02:05,000
   `;

test('parseSrt reads the start time as whole seconds', () => {
  // The third cue in SRT has no words, so it never becomes a cue — see below.
  const cues = parseSrt(SRT);
  assert.deepEqual(cues.map((c) => c.seconds), [1, 1147]);
});

test('parseSrt reads an hour off the clock', () => {
  assert.equal(parseSrt('1\n01:02:03,000 --> 01:02:05,000\nlate in the show')[0].seconds, 3723);
});

test('parseSrt joins a wrapped cue into one line', () => {
  // A cue split across two lines must match as one string, or a form landing on
  // the break is invisible.
  assert.equal(parseSrt(SRT)[1].text, 'an ln address attribute. An ln address attribute would be');
});

test('parseSrt keeps a cue whose text is only whitespace out of the way', () => {
  // The third cue has no words. It must not become an empty candidate that
  // squashes to '' and matches nothing but still costs a comparison.
  assert.equal(parseSrt(SRT).length, 2);
});

test('parseSrt survives a file with no cues at all', () => {
  assert.deepEqual(parseSrt('Transcript is Processing …'), []);
  assert.deepEqual(parseSrt(''), []);
});

test('captionEpisode reads the episode from the file name', () => {
  // Single digits are zero-padded on the server: PC20-7 is a 404, PC20-07 is not.
  assert.equal(captionEpisode('PC20-07-Captions.srt'), 7);
  assert.equal(captionEpisode('PC20-266-Captions.srt'), 266);
  assert.equal(captionEpisode('PC20-100-Chapters.json'), null);
  assert.equal(captionEpisode('notes.txt'), null);
});

test('CAPTION_MIN_CUES is what tells a stub from a transcript', () => {
  // E46 and E86 come back as 60-byte "Transcript is Processing" files.
  assert.equal(typeof CAPTION_MIN_CUES, 'number');
  assert.ok(CAPTION_MIN_CUES > 0);
});

test('densest finds the busiest five minutes, not the whole episode', () => {
  // Lightning Address in E120: 11 hits between 19m and 24m. That is a segment.
  const clustered = [1140, 1200, 1320, 1380, 1440];
  assert.deepEqual(densest(clustered), { peak: 5, at: 1140 });
});

test('densest is unimpressed by hits spread across the hour', () => {
  // Boost in E100: said constantly, nowhere in particular.
  const scattered = [600, 1800, 3000, 4200, 5400];
  assert.equal(densest(scattered).peak, 1);
});

test('densest counts a hit on the window boundary as inside it', () => {
  assert.equal(densest([0, 300]).peak, 2);
  assert.equal(densest([0, 301]).peak, 1);
});

test('densest handles one hit and no hits', () => {
  assert.deepEqual(densest([100]), { peak: 1, at: 100 });
  assert.deepEqual(densest([]), { peak: 0, at: null });
});

test('DWELL_WINDOW is five minutes', () => {
  assert.equal(DWELL_WINDOW, 300);
});

test('isReadout drops the boostagram readout, which no frequency count can see', () => {
  // Every episode ends with half an hour of reading boostagrams aloud. It is
  // the densest passage in the episode, so the dwell floor SELECTS for it. And
  // denyForms cannot catch it: every line carries a different amount and a
  // different name, so no two are the same text.
  assert.ok(isReadout('boob boost which did come through 808 CELTA Crayon 7'));
  assert.ok(isReadout('at 100,100 SATs happy 100 show thank you very much.'));
  assert.ok(isReadout("of the future starship boost with 1701 Satoshi's."));
  assert.ok(isReadout('Gene been 1337 elite booster cast Matic and he says'));
  assert.ok(isReadout('Got some booster grams.'));
});

test('isReadout drops the spoken intro, which the written isStructural misses', () => {
  // The written rule is tuned to "Podcasting 2.0 for <date> Episode N: <title>".
  // Spoken, it has a comma and no title, so that rule returns false for it.
  assert.ok(isReadout('Podcasting 2.0 for August 15th, 2025, episode'));
  assert.ok(isReadout('Podcasting 2.0 for February 27th, 2026, episode'));
});

test('isReadout leaves the real lines alone', () => {
  // Measured: 0 of 12 real lines caught. "2.0" is not a run of three digits.
  assert.ok(!isReadout('an ln address attribute. An ln address attribute would be'));
  assert.ok(!isReadout('I access helipad over Tor.'));
  assert.ok(!isReadout('alternate enclosure, none of this stuff.'));
  assert.ok(!isReadout('another hero of podcasting 2.0 The Revolution'));
  assert.ok(!isReadout('You need pod ping.'));
  assert.ok(!isReadout('RSS is a content distribution standard.'));
});

test('isReadout knowingly swallows a line naming a long number', () => {
  // This is the rule's cost, recorded so nobody rediscovers it as a surprise:
  // the TLV record Boostagram.md is written around cannot survive it.
  assert.ok(isReadout('the TLV record is 7629169'));
});

test('isReadout matches the literal first cue of episode 7', () => {
  // This is the real shape of the spoken intro in the captions, not the
  // invented fixtures above. The "Oh," prefix and the run-on ending are what
  // the real line has, so the pattern must match this or a future edit can
  // regress silently.
  assert.ok(isReadout('Oh, podcasting 2.0 for October 16 2020 This is episode number'));
});

const cue = (n, s) => `${n}\n00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000 --> 00:00:00,000\nline ${n}`;
const full = (count) => Array.from({ length: count }, (_, i) => cue(i + 1, i * 10)).join('\n\n');

test('collectCaptions produces the same candidate shape the other sources do', () => {
  const { candidates } = collectCaptions([{ name: 'PC20-07-Captions.srt', text: full(12) }]);
  assert.equal(candidates.length, 12);
  assert.deepEqual(candidates[0], { source: 't', episode: 7, seconds: 0, text: 'line 1' });
});

test('collectCaptions reports a processing stub instead of publishing it', () => {
  // A note with no transcript mentions must be tellable from an episode with no
  // transcript. E46 and E86 come back as 60-byte stubs.
  const { candidates, stubs } = collectCaptions([
    { name: 'PC20-46-Captions.srt', text: 'Transcript is Processing …' },
    { name: 'PC20-86-Captions.srt', text: full(3) },
    { name: 'PC20-07-Captions.srt', text: full(12) },
  ]);
  assert.deepEqual(stubs, [46, 86]);
  assert.deepEqual([...new Set(candidates.map((c) => c.episode))], [7]);
});

test('collectCaptions ignores a file that is not a caption file', () => {
  const { candidates, stubs } = collectCaptions([{ name: 'README.md', text: full(12) }]);
  assert.deepEqual(candidates, []);
  assert.deepEqual(stubs, []);
});

test('collectCaptions sorts the stub list, so the output is deterministic', () => {
  const { stubs } = collectCaptions([
    { name: 'PC20-86-Captions.srt', text: '' },
    { name: 'PC20-09-Captions.srt', text: '' },
  ]);
  assert.deepEqual(stubs, [9, 86]);
});

test('candidates stay grouped by episode, because the straddle matcher walks them in order', () => {
  // Task 5 pairs each cue with its successor to catch a form split across a
  // caption break. That pairing is positional and assumes: (1) within one
  // episode, candidates are in ascending time order, and (2) one episode's
  // candidates never interleave with another's. This must hold regardless of
  // input order, so we test both.
  const files1 = [
    { name: 'PC20-07-Captions.srt', text: full(12) },
    { name: 'PC20-09-Captions.srt', text: full(8) },
  ];
  const files2 = [
    { name: 'PC20-09-Captions.srt', text: full(8) },
    { name: 'PC20-07-Captions.srt', text: full(12) },
  ];

  const { candidates: result1 } = collectCaptions(files1);
  const { candidates: result2 } = collectCaptions(files2);

  // Verify both orders produce identical candidate sequences.
  assert.deepEqual(result1, result2);

  const candidates = result1;
  // Group candidates by episode.
  const byEpisode = new Map();
  for (const c of candidates) {
    if (!byEpisode.has(c.episode)) byEpisode.set(c.episode, []);
    byEpisode.get(c.episode).push(c);
  }

  // Assert contiguity: no episode's candidates can have another episode between them.
  const episodes = Array.from(byEpisode.keys()).sort((a, b) => a - b);
  let lastEpisode = null;
  let lastIndex = -1;
  for (const episode of episodes) {
    const start = candidates.findIndex((c) => c.episode === episode);
    const end = candidates.findLastIndex((c) => c.episode === episode);
    // There should be no gap between end of last episode and start of this one.
    assert.ok(start <= end + 1, `episode ${episode} is not contiguous`);
    if (lastEpisode !== null) {
      const lastEnd = candidates.findLastIndex((c) => c.episode === lastEpisode);
      assert.ok(lastEnd < start, `episode ${episode} interleaves with ${lastEpisode}`);
    }
    lastEpisode = episode;
  }

  // Assert time order within each episode.
  for (const [episode, cues] of byEpisode) {
    for (let i = 1; i < cues.length; i++) {
      assert.ok(
        cues[i - 1].seconds <= cues[i].seconds,
        `episode ${episode} seconds not ascending at index ${i - 1}`
      );
    }
  }
});

const note = (title, slug, data = {}) => ({ title, slug, data: { type: 'concept', ...data } });
const hit = (episode, seconds, text) => ({ source: 't', episode, seconds, text });

test('the prepared matcher agrees with the library, form for form', () => {
  // buildTranscriptMentions prepares each cue once instead of calling
  // matchesForm 28 million times. If the two ever disagree, the transcript tier
  // scores by a different rule than the curated one and nothing says so.
  //
  // Compare against formsFor(note), NOT against the title alone: a note's forms
  // are its title plus its aliases, and EXTRA_ALIASES gives Lightning Address
  // `lnaddress`, which is the only reason "an ln address attribute" matches at
  // all. Comparing to the bare title would test a rule neither path uses.
  const titles = ['Tor', 'NIP', 'Boost', 'Podping', 'Lightning Address', 'RSS'];
  const lines = [
    'I access helipad over Tor.',
    'You got to nip it in the bud.',
    'Podfather story time',
    'when y\'all put in pod ping all of a sudden',
    'an ln address attribute',
    'RSS is a content distribution standard',
    'Weathering the storm',
  ];
  for (const title of titles) {
    const one = note(title, title.toLowerCase());
    for (const line of lines) {
      const viaLib = formsFor(one).some((form) => matchesForm(form, line));
      const mentions = buildTranscriptMentions([one], [hit(1, 0, line)], {}, { floor: 1 });
      assert.equal(Boolean(mentions[title.toLowerCase()]), viaLib, `${title} vs ${line}`);
    }
  }
});

test('gate 1: a transcript never competes with a curated mention', () => {
  const notes = [note('Podping', 'podping')];
  const candidates = [hit(200, 100, 'podping is great'), hit(200, 140, 'podping again')];
  const curated = { podping: [{ e: 200, s: 'c', x: 'Podping' }] };
  assert.deepEqual(buildTranscriptMentions(notes, candidates, curated), {});
});

test('gate 3: two hits in five minutes survive, one does not', () => {
  // Tor, E251: real hits inside a minute, and Tor has no mentions at all today.
  // NIP, E120: one hit, "nip it in the bud" — the false positive SQUASH_MIN
  // exists for, which a dwell floor catches where a length rule cannot.
  const notes = [note('Tor', 'tor'), note('NIP', 'nip')];
  const candidates = [
    hit(251, 4140, 'I access helipad over Tor.'),
    hit(251, 4150, 'my vault warden server right over Tor,'),
    hit(120, 60, 'like nip the inside of my lip'),
  ];
  const out = buildTranscriptMentions(notes, candidates, {});
  // One moment per episode, not one per hit — the two Tor hits are one passage.
  assert.equal(out.tor.length, 1);
  assert.equal(out.tor[0].e, 251);
  assert.equal(out.tor[0].t, 4140, 'the moment is where the densest window opens');
  assert.ok(!out.nip, 'a single passing mention is not a moment');
});

test('gate 3: hits further apart than the window do not add up', () => {
  const notes = [note('Tor', 'tor')];
  const candidates = [hit(251, 0, 'over Tor'), hit(251, 4000, 'over Tor')];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}), {});
});

test('gate 2: the readout is dropped before anything is counted', () => {
  const notes = [note('Sats', 'sats')];
  const candidates = [
    hit(100, 5000, 'at 100,100 SATs happy 100 show thank you very much.'),
    hit(100, 5010, 'and 1000 SATs from Ben'),
  ];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}), {});
});

test('gate 4: a note keeps only its densest episodes, up to the cap', () => {
  const notes = [note('Boost', 'boost')];
  const candidates = [];
  // Six episodes, each qualifying, with descending density. The text has to
  // differ per episode: identical text in four or more episodes is what
  // denyForms calls furniture, and it would drop every one of these.
  for (let ep = 1; ep <= 6; ep += 1) {
    for (let i = 0; i < 8 - ep; i += 1) candidates.push(hit(ep, i * 10, `boost ${'a'.repeat(ep)}`));
  }
  const out = buildTranscriptMentions(notes, candidates, {}, { cap: 2 });
  assert.deepEqual([...new Set(out.boost.map((m) => m.e))], [1, 2]);
});

test('one moment per episode: the densest window is what gets linked', () => {
  const notes = [note('Podping', 'podping')];
  const candidates = [
    hit(230, 100, 'podping in passing'),
    hit(230, 2400, 'podping the first of a run'),
    hit(230, 2440, 'podping again'),
    hit(230, 2480, 'podping a third time'),
  ];
  const out = buildTranscriptMentions(notes, candidates, {});
  assert.equal(out.podping.length, 1);
  assert.equal(out.podping[0].t, 2400);
  assert.equal(out.podping[0].x, 'podping the first of a run');
  assert.equal(out.podping[0].s, 't');
});

test('a MOC or an opted-out note is never matched', () => {
  const notes = [note('Nostr MOC', 'nostr-moc', { type: 'moc' }), note('Podping', 'podping', { mentions: false })];
  const candidates = [hit(1, 0, 'nostr moc'), hit(1, 10, 'podping'), hit(1, 20, 'podping')];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}), {});
});

test('the output is sorted, so a rerun is byte-identical', () => {
  const notes = [note('Tor', 'tor'), note('Podping', 'podping')];
  const candidates = [
    hit(251, 20, 'over Tor'), hit(251, 10, 'over Tor'),
    hit(200, 10, 'podping'), hit(200, 20, 'podping'),
  ];
  const out = buildTranscriptMentions(notes, candidates, {});
  assert.deepEqual(Object.keys(out), ['podping', 'tor']);
});

test('a form split across a caption break is found, and counted once', () => {
  // The captions wrap mid-sentence BETWEEN cues, not only inside them:
  //   "…This is episode number" / "seven. Tag your"
  // 41 of 815 matches on the sample live only across a break, all multi-word.
  const notes = [note('Lightning Address', 'lightning-address')];
  const candidates = [
    hit(200, 100, 'he gave me his lightning'),
    hit(200, 104, 'address, which resolves to a node'),
    hit(200, 130, 'the lightning address spec is simple'),
  ];
  const out = buildTranscriptMentions(notes, candidates, {}, { floor: 2 });
  assert.equal(out['lightning-address'].length, 1, 'one moment per episode');
  assert.equal(out['lightning-address'][0].t, 100, 'the straddle opens the densest window');
});

test('a form wholly inside the next cue is not also charged to this one', () => {
  // Without the second check, the cue before every real mention would score a
  // straddle of its own and every dwell measure would double.
  const notes = [note('Podping', 'podping')];
  const candidates = [
    hit(200, 100, 'and then he said'),
    hit(200, 104, 'podping handles it'),
    hit(200, 108, 'which is neat'),
  ];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}, { floor: 2 }), {});
});

test('cues from different episodes are never joined across the seam', () => {
  const notes = [note('Lightning Address', 'lightning-address')];
  const candidates = [
    hit(200, 3000, 'he gave me his lightning'),
    hit(201, 0, 'address, which resolves to a node'),
  ];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}, { floor: 1 }), {});
});

test('the starting thresholds are the ones the spec names', () => {
  assert.equal(DWELL_FLOOR, 2);
  assert.equal(LIFT_MIN, 1);
  assert.equal(TRANSCRIPT_EPISODE_CAP, 6);
});

test('a deny phrase split across a caption break still denies', () => {
  // RSS Blue is a hosting company, not the protocol. The deny list exists
  // for it, and CLAUDE.md records it once producing five wrong RSS links.
  const notes = [note('RSS', 'rss')];
  const candidates = [
    hit(300, 10, 'a new host called RSS'),
    hit(300, 14, 'Blue just launched today'),
    hit(300, 20, 'and RSS'),
    hit(300, 24, 'Blue again'),
  ];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}), {});
});

test('deny reads the neighbour even when the match did not need it', () => {
  // "RSS" matches this cue on its own — it is below SQUASH_MIN, so it
  // matches on word boundaries. "RSS Blue" only exists once the next cue is
  // joined. Tying the deny context to the straddle branch let it through.
  const notes = [note('RSS', 'rss')];
  const candidates = [
    hit(300, 10, 'a new host called RSS'),
    hit(300, 14, 'Blue just launched today'),
    hit(300, 40, 'and RSS'),
    hit(300, 44, 'Blue again'),
  ];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}), {});
});

test('gate 1 is scoped to the episode, not the note', () => {
  // A curated mention in E200 must not stop the same note gaining a
  // transcript mention in E210 — the gap is per episode, so a note that is
  // already covered somewhere in the run can still gain the episodes it is
  // not covered in.
  const notes = [note('Podping', 'podping')];
  const candidates = [
    hit(210, 100, 'podping is great'),
    hit(210, 140, 'podping again'),
  ];
  const curated = { podping: [{ e: 200, s: 'c', x: 'Podping' }] };
  const out = buildTranscriptMentions(notes, candidates, curated);
  assert.equal(out.podping.length, 1);
  assert.equal(out.podping[0].e, 210);
});

test('lift drops an episode that is thin next to the note\'s own average', () => {
  // Lift is a filter over the episodes that cleared the dwell floor, not a
  // tiebreak: without it, a note would keep every episode that merely
  // dwelled, even one that barely scraped past the floor next to a real
  // segment elsewhere in the run.
  const notes = [note('Boost', 'boost')];
  const candidates = [];
  for (let i = 0; i < 6; i += 1) candidates.push(hit(1, i * 10, 'boost segment one'));
  for (let i = 0; i < 2; i += 1) candidates.push(hit(2, i * 10, 'boost segment two'));
  const out = buildTranscriptMentions(notes, candidates, {});
  assert.deepEqual(out.boost.map((m) => m.e), [1]);
});

test('a cue that is the show\'s furniture is skipped, not just deny-checked', () => {
  // denyForms flags text repeated across four or more episodes as furniture.
  // Without the skip on the cue itself, "Boost the show" said identically in
  // four episodes would still dwell and pass every other gate.
  const notes = [note('Boost', 'boost')];
  const candidates = [];
  for (let ep = 1; ep <= 4; ep += 1) {
    candidates.push(hit(ep, 0, 'Boost the show'), hit(ep, 10, 'Boost the show'));
  }
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}), {});
});

test('a straddle is not built across a readout neighbour', () => {
  // Without the guard, joining a readout cue onto its neighbour would invent
  // a match nobody said: "he gave me his lightning" plus a readout cue that
  // happens to contain "address" reads as "lightning address" only because
  // the two were pasted together.
  const notes = [note('Lightning Address', 'lightning-address')];
  const candidates = [
    hit(200, 100, 'he gave me his lightning'),
    hit(200, 104, 'address 123 which resolves to a node'),
  ];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}, { floor: 1 }), {});
});

test('the newer episode wins a tie, not the older one', () => {
  // DWELL_FLOOR is only 2, so ties on peak and count are the ordinary
  // outcome. This source exists to reach the episodes after 145 that the
  // curated sources cannot, so a tie must keep the newer episode.
  //
  // Text differs per episode (denyForms would call identical text furniture)
  // and carries no 3+ digit run (that is the readout rule, unrelated here —
  // an episode number folded into the cue text would trip it by accident).
  const notes = [note('Boost', 'boost')];
  const labels = { 250: 'alpha', 251: 'beta', 252: 'gamma' };
  const candidates = [];
  for (const ep of [250, 251, 252]) {
    candidates.push(hit(ep, 0, `boost segment ${labels[ep]}`), hit(ep, 10, `boost segment ${labels[ep]}`));
  }
  const out = buildTranscriptMentions(notes, candidates, {}, { cap: 2 });
  assert.deepEqual(out.boost.map((m) => m.e), [251, 252]);
});

test('collectCaptions drops every copy of a file the server served twice', () => {
  // Measured on the whole cache: PC20-50 and PC20-51 are byte-identical, and so
  // are PC20-248 and PC20-249 — one transcript at two URLs, twice in 258 files.
  // Left in, Sats and StartOS each cited the same words at the same timestamp
  // under two consecutive episodes: "sats or we got 1% of them." at E248 1:22:34
  // and again at E249 1:22:34. Nothing in the file says which episode it is, so
  // both copies go and both are named — the same treatment a stub gets.
  const shared = full(12);
  const { candidates, duplicates, stubs } = collectCaptions([
    { name: 'PC20-249-Captions.srt', text: shared },
    { name: 'PC20-248-Captions.srt', text: shared },
    { name: 'PC20-07-Captions.srt', text: full(11) },
  ]);
  assert.deepEqual(duplicates, [248, 249]);
  assert.deepEqual(stubs, []);
  assert.deepEqual([...new Set(candidates.map((c) => c.episode))], [7]);
});

test('collectCaptions counts a duplicate apart from a stub', () => {
  // "E86 has no transcript yet" and "E249 has one that is not its own" are
  // different facts and the report says which. A stub is short; a duplicate is
  // a whole file, so it must not be reported as still processing.
  const shared = full(12);
  const { duplicates, stubs } = collectCaptions([
    { name: 'PC20-51-Captions.srt', text: shared },
    { name: 'PC20-86-Captions.srt', text: 'Transcript is Processing …' },
    { name: 'PC20-50-Captions.srt', text: shared },
  ]);
  assert.deepEqual(duplicates, [50, 51]);
  assert.deepEqual(stubs, [86]);
});

test('an electrical relay is not a Nostr relay', () => {
  // E264 34:46 — forty seconds of Adam describing wiring a garage door, and
  // five hits in one window, which made it the densest Relay passage in the
  // whole run. No dwell floor or lift cutoff can reach a passage that dense, so
  // EXTRA_DENY is the only lever. These are the real caption lines.
  const notes = [note('Relay', 'relay')];
  const garage = [
    hit(264, 2086, 'we would hook the micro switch up to a relay.'),
    hit(264, 2089, "So we'd... We would get big relays, you know, the"),
    hit(264, 2110, 'edge of it was running through the relay. And so'),
    hit(264, 2113, 'when the relay was activated, click, it grabs the slip'),
    hit(264, 2124, 'switch clicks off. Boom. The relay is deactivated. It opens'),
  ];
  assert.deepEqual(buildTranscriptMentions(notes, garage, {}), {});

  // The deny phrases must not cost the note the sense it is about. E157 and
  // E235 are the real lines that stayed.
  const nostr = [
    hit(157, 4743, 'Adam Curry: And it has it runs on relays. So you know,'),
    hit(157, 4760, 'When it comes to running relays, you guys'),
  ];
  assert.deepEqual(buildTranscriptMentions(notes, nostr, {}).relay?.map((m) => m.e), [157]);
});
