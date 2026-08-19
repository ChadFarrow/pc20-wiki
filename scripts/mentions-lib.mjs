/**
 * Finding which episodes of the show discussed a note's subject.
 *
 * The wiki explains what a thing *is*. Three sibling repos know when it came
 * up: pc20-archive holds chapter titles and show notes, pc20-timeline holds
 * curated milestones, pc20-clips holds a hand-flagged clip checklist. This
 * module is the join — pure functions over strings and plain objects, same rule
 * as wiki-lib.mjs, so every matching decision has a test naming the behaviour.
 *
 * Deliberately NOT a source: pc20-clips/pc2-relisten-timeline.md. Its 83
 * bullets were already absorbed into pc20-timeline's milestones by
 * seed-from-relisten.mjs, six of them name episode *ranges* that cannot cite a
 * single episode, and the handful that are genuinely new name two episodes in
 * one string ("Helipad talk → E64 Helipad on Umbrel released"). The clip
 * checklist is a different story and is read — see collectClips.
 *
 * Also deliberately not a source: the transcripts. They live on a NAS, not in
 * git, so a build that needed them could not run on Vercel. Everything here is
 * curated text somebody wrote on purpose.
 */

/**
 * Lowercase, letters and digits only — the form matching mostly runs on.
 *
 * Ported from pc20-clips/app/search.py:_squash, where it was measured against
 * the real archive. The show's own text does not agree with itself about where
 * a word ends: "PodcastIndex.org" vs "Podcast Index", "Boostagrams" vs
 * "Boostagram", "value4value" vs "Value 4 Value", "pod ping" vs "podping".
 * Dropping separators makes all of that irrelevant, and because the removal
 * preserves order and contiguity it can only ADD matches, never lose one.
 */
export function squash(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Lowercase, every run of non-alphanumerics to one space, space-wrapped. */
export function norm(text) {
  return ` ${String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * Below this many squashed characters, a form matches on word boundaries only.
 *
 * Squashing's documented cost is cross-word false positives, and measured over
 * this corpus that cost is concentrated entirely in short forms — where it is
 * also total. "Tor" squash-matched ~80 moments and every one was false
 * ("Podfather STORy time", "Art GenerATOR Splits", "Origin STORy"); "NIP"
 * matched six, all false ("miNIPub", "maNIPulation"). Meanwhile every large
 * legitimate win is ten characters or more, and "Sats", "LND" and "LNURL" match
 * identically either way. So the threshold buys back all the precision and
 * costs nothing real — no hand-written stop list required.
 */
export const SQUASH_MIN = 5;

/** Does `form` appear in `text`, by whichever rule the form's length earns? */
export function matchesForm(form, text) {
  const squashed = squash(form);
  if (!squashed) return false;
  if (squashed.length >= SQUASH_MIN) return squash(text).includes(squashed);
  return norm(text).includes(norm(form));
}

/**
 * A candidate is boilerplate if the same words show up in this many episodes.
 *
 * Derived rather than hand-written, because the recurring furniture is not
 * guessable. A list somebody typed would have caught "Boostagrams" and "Intro";
 * it would have missed "Shownotes" (96 episodes), "Download the mp3" (81),
 * "Preservepodcasting.com" (62) and the block of app names the show notes
 * repeat verbatim every week — which would otherwise have handed the Podverse
 * note 22 mentions that are really a link in a footer. Deriving it also means
 * it keeps working as episodes are added.
 */
export const DENY_EPISODE_THRESHOLD = 4;

/**
 * The feed's own template lines, which no frequency threshold can catch.
 *
 * Every episode's show notes open with two boilerplate lines: a header
 * ("Podcasting 2.0 for September 11th 2020 Episode 2: We Have Liftoff!") and a
 * standing blurb ("Adam & Dave discuss the week's developments on
 * podcastindex.org…"). Both carry the episode's date and title inline, so every
 * instance is a *different string* and denyForms — which counts exact repeats —
 * never sees them as recurring. Left in, they contributed 144 of 914 mentions:
 * the Podcasting 2.0 note was 100 copies of its own feed header.
 *
 * The episode title inside the header is real signal, but it is already shown
 * as the episode's title on the rendered section, where it belongs.
 */
export const STRUCTURAL_BOILERPLATE = [
  /^podcasting 2\.0 for .+ episode \d+/i,
  /^adam (?:&|and) dave discuss the week/i,
  /^last modified \d/i,
];

/** Is this the feed's furniture rather than something somebody said? */
export function isStructural(text) {
  return STRUCTURAL_BOILERPLATE.some((pattern) => pattern.test(String(text ?? '').trim()));
}

/**
 * Extra forms that match a note beyond its title.
 *
 * The real home for these is `aliases:` in the vault note's own frontmatter —
 * Obsidian owns that key and means the same thing by it, and an alias is a
 * property of the concept rather than of this pipeline. This table is the
 * bootstrap (the vault has none yet) and the escape hatch; the two are unioned.
 *
 * Every entry here exists because the show says something the note title does
 * not: nobody on the podcast says "Podcast Namespace", they say "the
 * namespace", which is why that note matched exactly zero moments before this.
 */
export const EXTRA_ALIASES = {
  'Podcast Namespace': ['namespace'],
  'Value 4 Value': ['v4v', 'value for value', 'value4value'],
  'Podcasting 2.0': ['pc20', 'podcasting20'],
  'Lightning Address': ['lnaddress', 'lightning addy'],
  'Podcast Index': ['podcastindex'],
  Soundbites: ['soundbite'],
  Splits: ['value time split', 'value split'],
  Chapters: ['chapter'],
  Transcripts: ['transcript'],
  'Streaming Sats': ['streaming payments'],
  'Cross-app Comments': ['cross app comment'],
  Boostagram: ['boostagrams'],
  // The show says "Start9" — the company, and the box on the desk — where the
  // note is named for the OS running on it. Not the RSS Blue case: Start9 makes
  // StartOS, so "Adam gets his Start9" really is about this.
  StartOS: ['start9', 'embassyos'],
};

/**
 * Forms that match a note but should not, found by reading `--report`.
 *
 * Kept in code rather than in the generated JSON because each one needs a
 * reason, and JSON cannot carry one — the same argument that keeps TYPES and
 * STATUSES in wiki-lib.mjs instead of a data file.
 */
export const EXTRA_DENY = {
  // Hosting companies, not the protocol — "Welcome RSS.com", "RSS Blue adds
  // music". Every RSS hit on the timeline was one of these before this existed.
  RSS: ['rss com', 'rsscom', 'rss blue', 'rssblue'],
  // An electrical relay, not a Nostr one. E264 34:46 is forty seconds of Adam
  // describing wiring a garage door — "we would hook the micro switch up to a
  // relay.", "when the relay was activated, click, it grabs the slip", "The
  // relay is deactivated. It opens". Five hits in one window made it the
  // densest Relay passage in the whole run, so neither the dwell floor nor
  // lift could ever reach it; only a phrase can. Same shape as RSS Blue above:
  // one word, two senses.
  Relay: ['micro switch', 'relay was activated', 'relay is deactivated'],
};

/** Does a per-note deny phrase rule this text out for this note? */
export function denied(title, text) {
  const squashed = squash(text);
  return (EXTRA_DENY[title] ?? []).some((phrase) => squashed.includes(squash(phrase)));
}

/**
 * pc20-timeline tags that name a wiki note.
 *
 * A curator tagging a milestone `podping` is stronger evidence than a substring
 * ever is, so tags are a second, additive match path — applied to milestones
 * only, since no other source carries them. Tags with no corresponding note
 * (music, wallets, people, events, business, ai, stablecoins, community, apps,
 * hosting) are absent on purpose, not by oversight.
 */
export const TIMELINE_TAG_NOTES = {
  podping: 'Podping',
  keysend: 'Keysend',
  v4v: 'Value 4 Value',
  namespace: 'Podcast Namespace',
  nostr: 'Nostr',
  chapters: 'Chapters',
  transcripts: 'Transcripts',
  splits: 'Splits',
  'value-time-splits': 'Splits',
  lnaddress: 'Lightning Address',
  'podcast-index': 'Podcast Index',
  'self-hosting': 'Self-hosting',
  boosts: 'Boost',
  lightning: 'Lightning Network',
};

/**
 * Checks the tag map against both vocabularies it straddles.
 *
 * A typo on either side fails silently and forever otherwise — the note simply
 * never gets those mentions, which reads as "they never discussed it". This is
 * the same guard build.mjs already puts on `element:` against the apps
 * directory, and it exists for the same reason.
 */
export function validateTagMap(timelineTags, noteTitles) {
  const problems = [];
  for (const [tag, title] of Object.entries(TIMELINE_TAG_NOTES)) {
    if (timelineTags.size && !timelineTags.has(tag)) {
      problems.push(`TIMELINE_TAG_NOTES: '${tag}' is not a tag in the timeline's eras.yml`);
    }
    if (!noteTitles.has(title)) {
      problems.push(`TIMELINE_TAG_NOTES: '${tag}' maps to '${title}', which is not a note`);
    }
  }
  return problems;
}

/** `h:mm:ss`, `mm:ss` or bare seconds → seconds. Anything else → null. */
export function toSeconds(stamp) {
  if (stamp == null) return null;
  const parts = String(stamp).trim().split(':');
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** Seconds → `1:04:00` or `4:00`, for display next to a moment. */
export function toStamp(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const pad = (n) => String(n).padStart(2, '0');
  const mins = `${Math.floor((s % 3600) / 60)}`;
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${pad(Number(mins))}:${pad(s % 60)}`
    : `${mins}:${pad(s % 60)}`;
}

/** Strips HTML to the text a reader would see. Show notes are HTML in CDATA. */
export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chapter JSON → candidates. `startTime` is already integer seconds. */
export function collectChapters(files) {
  const out = [];
  for (const { name, json } of files) {
    const episode = Number(/PC20-0*(\d+)-Chapters\.json$/i.exec(name)?.[1]);
    if (!Number.isInteger(episode)) continue;
    for (const chapter of json?.chapters ?? []) {
      const text = String(chapter?.title ?? '').trim();
      if (!text) continue;
      out.push({ source: 'c', episode, seconds: toSeconds(chapter.startTime), text });
    }
  }
  return out;
}

/**
 * The archive feed → candidates, one per show-note line.
 *
 * Joined on <itunes:episode>, never guid: guid is inconsistent across this feed
 * (ep 1 is a podcastindex.org URL, ep 97 the mp3 URL). Show notes are a list of
 * one-line <p> topic labels — "Block Tag", "PodPing new version" — which is
 * what makes them good matching text and why they are split rather than kept as
 * one blob. No timestamps exist at this granularity.
 */
export function collectShowNotes(xml) {
  const out = [];
  for (const item of String(xml ?? '').match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const episode = Number(/<itunes:episode>(\d+)<\/itunes:episode>/.exec(item)?.[1]);
    if (!Number.isInteger(episode)) continue;
    const cdata = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(item)?.[1];
    if (!cdata) continue;
    for (const block of cdata.match(/<p>[\s\S]*?<\/p>/g) ?? []) {
      const text = stripHtml(block);
      if (text.length < 4 || text.length > 120) continue;
      if (isStructural(text)) continue;
      out.push({ source: 'n', episode, seconds: null, text });
    }
  }
  return out;
}

/**
 * Milestone frontmatter → candidates.
 *
 * Frontmatter only, never the body. The title carries the signal and is worth
 * trusting: these were written while relistening to the run from E1, so a
 * milestone title is somebody's account of what happened rather than a label
 * scraped off a feed. `tags` is a second signal — see TIMELINE_TAG_NOTES.
 */
export function collectMilestones(entries) {
  const out = [];
  for (const { data } of entries) {
    const episode = Number(data?.episode);
    const text = String(data?.title ?? '').trim();
    if (!Number.isInteger(episode) || !text) continue;
    out.push({
      source: 'm',
      episode,
      seconds: toSeconds(data.timestamp),
      text,
      tags: Array.isArray(data.tags) ? data.tags : [],
    });
  }
  return out;
}

const CLIP_LINE = /^\s*-\s*\[[ x]\]\s*\*\*E(\d+)\s*·\s*([\d:]+)\*\*\s*—\s*(.+?)\s*$/;

/** `- [ ] **E46 · 1:05:00** — ⭐ First-ever boost` → a candidate. */
export function collectClips(markdown) {
  const out = [];
  for (const line of String(markdown ?? '').split('\n')) {
    const match = CLIP_LINE.exec(line);
    if (!match) continue;
    const text = match[3].replace(/⭐/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push({ source: 'k', episode: Number(match[1]), seconds: toSeconds(match[2]), text });
  }
  return out;
}

/** How close two flags of the same moment can be and still be the same moment. */
export const CLIP_DEDUPE_SECONDS = 120;

/**
 * Drops checklist items the timeline already carries.
 *
 * The two overlap but nowhere near completely: only 36 of the 101 checklist
 * items reached the milestones, because seed-from-clips.mjs imported a flagged
 * moment only once the clip had actually been *cut*, gated on a workbench.json
 * that lives on the NAS. The other 65 are real, carry real timestamps, and are
 * exactly the moments the other sources miss. Matching the sibling seeder, a
 * duplicate is the same episode within ±120s, or the same title outright.
 */
export function dedupeClips(clips, milestones) {
  const byEpisode = new Map();
  for (const milestone of milestones) {
    if (!byEpisode.has(milestone.episode)) byEpisode.set(milestone.episode, []);
    byEpisode.get(milestone.episode).push(milestone);
  }

  return clips.filter((clip) => {
    for (const milestone of byEpisode.get(clip.episode) ?? []) {
      if (squash(milestone.text) === squash(clip.text)) return false;
      if (
        clip.seconds != null &&
        milestone.seconds != null &&
        Math.abs(milestone.seconds - clip.seconds) <= CLIP_DEDUPE_SECONDS
      ) {
        return false;
      }
    }
    return true;
  });
}

/** Every candidate text appearing in DENY_EPISODE_THRESHOLD or more episodes. */
export function denyForms(candidates, threshold = DENY_EPISODE_THRESHOLD) {
  const episodes = new Map();
  for (const candidate of candidates) {
    const key = squash(candidate.text);
    if (!key) continue;
    if (!episodes.has(key)) episodes.set(key, new Set());
    episodes.get(key).add(candidate.episode);
  }

  const denied = new Set();
  for (const [key, seen] of episodes) if (seen.size >= threshold) denied.add(key);
  return denied;
}

/** Title + vault aliases + bootstrap aliases, minus anything EXTRA_DENY names. */
export function formsFor(note) {
  const aliases = [
    ...(Array.isArray(note.data?.aliases) ? note.data.aliases : []),
    ...(EXTRA_ALIASES[note.title] ?? []),
  ];
  const seen = new Set();
  return [note.title, ...aliases]
    .map((form) => String(form).trim())
    .filter((form) => form && !seen.has(squash(form)) && seen.add(squash(form)));
}

/**
 * Is this a note worth looking for on the show?
 *
 * A map of content is not — asking which episodes discussed "Nostr MOC" is
 * meaningless — and a note can opt out with `mentions: false` in the vault.
 */
export function isMatchable(note) {
  return note.data?.type !== 'moc' && note.data?.mentions !== false;
}

/**
 * Orders two mentions within a note: episode, then timestamp, then source,
 * then text.
 *
 * Four keys, not three. Ties on episode, timestamp and source are real: some
 * are show-notes mentions with no timestamp that differ only in their text.
 * Without the fourth key those ties come out in whatever order they arrived
 * in — stable only because of upstream ordering this sort does not control.
 * `data/mentions.json` is committed and determinism is a stated constraint,
 * so this is written out once here and imported everywhere a mention list is
 * merged or sorted, so the two call sites cannot drift apart.
 */
export const compareMentions = (a, b) =>
  a.e - b.e ||
  (a.t ?? Infinity) - (b.t ?? Infinity) ||
  a.s.localeCompare(b.s) ||
  a.x.localeCompare(b.x);

/**
 * Matches every candidate against every note.
 *
 * Notes are excluded when they are a map of content (asking which episodes
 * discussed "Nostr MOC" is meaningless) or when the vault says `mentions:
 * false`. Returns mentions grouped by slug, sorted so a re-run with unchanged
 * sources produces a byte-identical file.
 */
export function buildMentions(notes, candidates) {
  const boilerplate = denyForms(candidates);
  const matchable = notes.filter(isMatchable);
  const terms = matchable.map((note) => ({ note, forms: formsFor(note) }));

  const mentions = {};
  for (const candidate of candidates) {
    if (boilerplate.has(squash(candidate.text))) continue;
    const tagged = new Set(
      (candidate.tags ?? []).map((tag) => TIMELINE_TAG_NOTES[tag]).filter(Boolean),
    );

    for (const { note, forms } of terms) {
      if (denied(note.title, candidate.text)) continue;
      const hit = tagged.has(note.title) || forms.some((form) => matchesForm(form, candidate.text));
      if (!hit) continue;

      (mentions[note.slug] ??= []).push({
        e: candidate.episode,
        ...(candidate.seconds == null ? {} : { t: candidate.seconds }),
        s: candidate.source,
        x: candidate.text,
      });
    }
  }

  for (const list of Object.values(mentions)) {
    list.sort(compareMentions);
  }

  return Object.fromEntries(Object.entries(mentions).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * One note's mentions, joined to their episodes and ready to render.
 *
 * The twin of adoption() in wiki-lib.mjs, and null for the same reason: a note
 * nothing was ever said about renders no section at all, rather than an empty
 * panel repeating that the archive is incomplete.
 */
export function mentionsFor(doc, slug) {
  const list = doc?.mentions?.[slug];
  if (!list?.length) return null;

  const episodes = new Map();
  for (const mention of list) {
    if (!episodes.has(mention.e)) {
      const episode = doc.episodes?.[String(mention.e)] ?? {};
      episodes.set(mention.e, {
        number: mention.e,
        date: episode.d ?? null,
        title: episode.t ?? null,
        audioUrl: episode.a ?? null,
        moments: [],
      });
    }
    episodes.get(mention.e).moments.push({
      seconds: mention.t ?? null,
      source: mention.s,
      text: mention.x,
    });
  }

  return {
    total: list.length,
    episodes: [...episodes.values()].sort((a, b) => b.number - a.number),
    coverage: doc.coverage ?? null,
  };
}

/** One moment, identified by everything that makes it that moment. */
export const mentionKey = (mention) => `${mention.e}|${mention.t ?? ''}|${mention.x}`;

/**
 * What a regeneration would change, moment by moment.
 *
 * Comparing list lengths — which is what this did — hides a swap: a mention
 * whose text, episode or timestamp changed leaves the count alone, so the run
 * reports "no change" while the citation under a note points somewhere else.
 * The same blind spot in the timeline's diff cost 34 bodies.
 */
export function diffMentions(next, previous) {
  const slugs = [...new Set([...Object.keys(next), ...Object.keys(previous ?? {})])].sort();
  const changes = [];

  for (const slug of slugs) {
    const before = previous?.[slug] ?? [];
    const after = next[slug] ?? [];
    if (before.map(mentionKey).join('\n') === after.map(mentionKey).join('\n')) continue;

    const kept = new Set(after.map(mentionKey));
    const seen = new Set(before.map(mentionKey));
    changes.push({
      slug,
      before: before.length,
      after: after.length,
      added: after.filter((mention) => !seen.has(mentionKey(mention))),
      removed: before.filter((mention) => !kept.has(mentionKey(mention))),
    });
  }

  return changes;
}
