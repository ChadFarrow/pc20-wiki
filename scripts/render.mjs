/**
 * HTML generation.
 *
 * Every page is rendered at build time with its prose already in the markup.
 * A wiki has to be readable, linkable and unfurlable without JavaScript, and 23
 * notes is small enough that shipping them all costs nothing. Script only adds
 * search and the graph on top.
 */

import { Marked } from 'marked';
import { slugify, headings } from './wiki-lib.mjs';
import { toStamp } from './mentions-lib.mjs';
import { groupByEra } from './timeline-lib.mjs';

export const SITE_NAME = 'PC 2.0 Wiki';
export const SITE_TAGLINE = 'A working reference for Podcasting 2.0 — the namespace, the payments, and the plumbing underneath.';

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only these schemes become links. Anything else renders as plain text. */
function safeUrl(href) {
  const url = String(href ?? '').trim();
  return /^(https?:|mailto:|#|\/)/i.test(url) ? url : null;
}

/**
 * A markdown renderer bound to one link resolver.
 *
 * `resolve(title)` returns `{ slug, stub, title }`. Binding it here is what lets
 * a wikilink know at render time whether the note it points at exists, so a
 * link to something unwritten can be styled as a stub rather than silently
 * looking like every other link.
 *
 * Raw HTML is disabled at the tokenizer: notes are prose, and a stray `<` in a
 * note should never be able to produce markup.
 */
export function createMarkdown(resolve) {
  const marked = new Marked({ gfm: true });

  const wikilink = {
    name: 'wikilink',
    level: 'inline',
    start(src) {
      return src.indexOf('[[');
    },
    tokenizer(src) {
      const match = /^\[\[([^\][|#]+)(?:#([^\][|]+))?(?:\|([^\][]+))?\]\]/.exec(src);
      if (!match) return undefined;
      const target = match[1].trim();
      if (!target) return undefined;
      return {
        type: 'wikilink',
        raw: match[0],
        target,
        heading: match[2]?.trim() || null,
        alias: match[3]?.trim() || null,
      };
    },
    renderer(token) {
      const { slug, stub, title } = resolve(token.target);
      const fragment = token.heading ? `#${slugify(token.heading)}` : '';
      const label = token.alias ?? token.target;
      const className = stub ? 'wikilink wikilink--stub' : 'wikilink';
      const hint = stub ? ` title="${escapeHtml(`${title} — not written yet`)}"` : '';
      return `<a class="${className}" href="/notes/${slug}/${fragment}"${hint}>${escapeHtml(label)}</a>`;
    },
  };

  marked.use({
    extensions: [wikilink],
    renderer: {
      // marked 12 passes renderer arguments positionally.
      heading(text, level, raw) {
        return `<h${level} id="${escapeHtml(slugify(raw))}">${text}</h${level}>\n`;
      },
      link(href, title, text) {
        const url = safeUrl(href);
        if (!url) return text;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(url)}"${titleAttr} rel="noopener">${text}</a>`;
      },
      image(href, title, text) {
        const url = safeUrl(href);
        if (!url) return escapeHtml(text ?? '');
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text ?? '')}"${titleAttr} loading="lazy">`;
      },
      // Notes are prose. Markup written into a note is shown, never executed —
      // which also means a tag like <podcast:value> survives being typed
      // outside backticks instead of vanishing into the DOM.
      html(html) {
        return escapeHtml(html);
      },
    },
  });

  return (body) => marked.parse(String(body ?? ''), { async: false }).trim();
}

export function pageShell({ title, description, canonical, body, ogType = 'website', extraHead = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..800,0..100,0..1&family=IBM+Plex+Mono:wght@400;500&family=Newsreader:opsz,ital,wght@6..72,0,300..600;6..72,1,300..500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
${extraHead}</head>
<body>
${body}
<script src="/assets/site.js" defer></script>
</body>
</html>
`;
}

/** The header is identical on every page: identity, search, and the two views. */
function siteHeader() {
  return `<header class="masthead">
  <a class="masthead__home" href="/"><span class="masthead__name">${escapeHtml(SITE_NAME)}</span></a>
  <div class="search" role="search">
    <input type="search" id="search-input" class="search__input" placeholder="Search the wiki" autocomplete="off"
      aria-label="Search the wiki" aria-controls="search-results" aria-expanded="false">
    <ul class="search__results" id="search-results" role="listbox" hidden></ul>
  </div>
  <nav class="masthead__nav">
    <a href="/timeline/">Timeline</a>
    <a href="/graph/">Graph</a>
    <a href="/queue/">Queue</a>
  </nav>
</header>`;
}

function siteFooter() {
  return `<footer class="footer">
  <p>${escapeHtml(SITE_NAME)} — written in the open, one note at a time.</p>
  <p class="footer__meta">Notes carry a status: <em>seed</em> is a stub, <em>growing</em> is in progress, <em>evergreen</em> holds up on reread.</p>
</footer>`;
}

function noteLink(node) {
  const className = node.stub ? 'notelink notelink--stub' : 'notelink';
  return `<a class="${className}" href="/notes/${node.slug}/">${escapeHtml(node.title)}</a>`;
}

function typeBadge(type) {
  return `<span class="type type--${escapeHtml(type)}">${escapeHtml(type)}</span>`;
}

function tagList(tags) {
  if (!tags?.length) return '';
  return `<ul class="tags">${tags
    .map((tag) => `<li class="tag">${escapeHtml(tag)}</li>`)
    .join('')}</ul>`;
}

/**
 * The first sentence of a note.
 *
 * The vault's house rule is that every note opens with a one-sentence
 * definition, which makes the first sentence exactly the right thing for a
 * meta description, a link preview and a search result.
 */
export function summarise(plain, limit = 180) {
  const text = String(plain ?? '').trim();
  const sentence = text.match(/^(.*?[.!?])(\s|$)/)?.[1] ?? text;
  if (sentence.length <= limit) return sentence;
  return `${sentence.slice(0, limit).replace(/\s+\S*$/, '')}…`;
}

function backlinkSection(backlinks, nodesBySlug) {
  if (!backlinks.length) {
    return `<section class="panel panel--empty">
  <h2>Linked from</h2>
  <p>Nothing links here yet.</p>
</section>`;
  }
  return `<section class="panel">
  <h2>Linked from</h2>
  <ul class="linklist">${backlinks
    .map((slug) => `<li>${noteLink(nodesBySlug.get(slug))}</li>`)
    .join('')}</ul>
</section>`;
}

function outboundSection(outbound, nodesBySlug) {
  if (!outbound.length) return '';
  return `<section class="panel">
  <h2>Links to</h2>
  <ul class="linklist">${outbound
    .map((slug) => `<li>${noteLink(nodesBySlug.get(slug))}</li>`)
    .join('')}</ul>
</section>`;
}

function outline(body) {
  const sections = headings(body);
  if (sections.length < 2) return '';
  return `<nav class="outline" aria-label="On this page">
  <h2>On this page</h2>
  <ul>${sections
    .map((h) => `<li><a href="#${escapeHtml(slugify(h))}">${escapeHtml(h)}</a></li>`)
    .join('')}</ul>
</nav>`;
}

/**
 * Who actually implements this feature.
 *
 * Rendered from the Podcast Index apps directory rather than written into the
 * note, because the number changes and prose does not. The date is shown for
 * the same reason: a reader should be able to tell how old the claim is.
 */
function adoptionSection(adoption) {
  if (!adoption) return '';

  const share = Math.round((adoption.count / adoption.total) * 100);
  const listed = adoption.apps.slice(0, 12);
  const rest = adoption.apps.length - listed.length;

  return `<section class="adoption">
  <h2>Who implements it</h2>
  <p class="adoption__count">
    <strong>${adoption.count}</strong> of ${adoption.total} apps in the Podcast Index directory
    support <code>${escapeHtml(adoption.element)}</code> — ${share}%.
  </p>
  ${
    adoption.count
      ? `<ul class="adoption__apps">${listed
          .map((app) => `<li>${escapeHtml(app)}</li>`)
          .join('')}${rest > 0 ? `<li class="adoption__more">and ${rest} more</li>` : ''}</ul>`
      : ''
  }
  <p class="adoption__source">From the <a href="https://podcastindex.org/apps" rel="noopener">Podcast Index apps directory</a>${
    adoption.updated ? `, as of ${escapeHtml(adoption.updated)}` : ''
  }.</p>
</section>`;
}

/** How many episodes and moments a note's section shows before it says "and N more". */
export const MENTION_EPISODE_CAP = 8;
export const MENTION_MOMENT_CAP = 3;

/**
 * Transcript episodes are shown under the curated ones and capped separately.
 *
 * Not cosmetic. The transcript tier exists precisely where the curated sources
 * stop, which is the back half of the run — the newest episodes. Episodes sort
 * newest-first, so one shared cap of 8 would fill entirely with transcripts and
 * push every curated episode below the fold. The better source would be evicted
 * by the worse one.
 */
export const MENTION_TRANSCRIPT_CAP = 4;

const MENTION_SOURCES = { c: 'chapter', n: 'show notes', m: 'timeline', k: 'clip note', t: 'transcript' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2023-02-24` → `24 Feb 2023`, without parsing it as a date and losing a day to UTC. */
function shortDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!match) return '';
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** A moment's link: into the audio at the timestamp, or at the episode if there is none. */
function momentLink(audioUrl, seconds) {
  if (!audioUrl) return null;
  return seconds == null ? audioUrl : `${audioUrl}#t=${seconds}`;
}

/**
 * Which episodes discussed this note's subject.
 *
 * The twin of adoptionSection, and for the same reason: it is a measurement
 * rather than prose, taken from sources the reader can go and check.
 *
 * Newest episode first, because a cap is unavoidable — "Boost" spans 67
 * episodes — and once you are capping, the oldest eight is the least useful
 * slice and would freeze permanently as the archive grows. The "and N more"
 * line carries the *oldest* episode so the cap does not hide the depth.
 *
 * The source footer is load-bearing. Chapter titles stop at E145 and show notes
 * at E100, so a thin section usually means the sources run out rather than that
 * nobody ever discussed it, and a reference that lets you conclude the latter
 * is worse than one that says nothing.
 */
export function mentionsSection(mentions) {
  if (!mentions?.episodes?.length) return '';

  // .every() rather than .some(): an episode is either fully curated-sourced or
  // fully transcript-sourced, never mixed. That holds only because gate 1 in
  // mentions-lib.mjs never consults the transcript for an episode a curated
  // source already covers. If that gate is ever relaxed, this stops being
  // equivalent to .some() silently — no test here would catch it.
  const isTranscript = (episode) => episode.moments.every((moment) => moment.source === 't');
  const curated = mentions.episodes.filter((episode) => !isTranscript(episode));
  const heard = mentions.episodes.filter(isTranscript);

  const shown = [...curated.slice(0, MENTION_EPISODE_CAP), ...heard.slice(0, MENTION_TRANSCRIPT_CAP)];
  // With two independent caps there are two ways to be over, and `shown` is the
  // union of two tier prefixes rather than one prefix of the combined list. The
  // "back to E<x>" line has to be derived from what is actually hidden — not
  // from the two tiers' overflow counts and the combined array's tail computed
  // separately — because that split is exactly what let the two drift: the
  // globally-oldest episode can sit in the tier that did NOT overflow, land in
  // `shown`, and still get named as the reason to go back further. It did, on
  // four live pages, before this fix.
  const hidden = [...curated.slice(MENTION_EPISODE_CAP), ...heard.slice(MENTION_TRANSCRIPT_CAP)];
  const rest = hidden.length;
  const oldest = hidden.length ? hidden.reduce((a, b) => (b.number < a.number ? b : a)) : null;

  const episodes = shown
    .map((episode) => {
      const moments = episode.moments.slice(0, MENTION_MOMENT_CAP);
      const spare = episode.moments.length - moments.length;
      const date = shortDate(episode.date);

      return `<li class="mentions__episode">
      <p class="mentions__ep">E${episode.number}${date ? ` · ${escapeHtml(date)}` : ''}${
        episode.title ? ` · ${escapeHtml(episode.title)}` : ''
      }</p>
      <ul class="mentions__moments">${moments
        .map((moment) => {
          const href = momentLink(episode.audioUrl, moment.seconds);
          const stamp = moment.seconds == null ? '' : toStamp(moment.seconds);
          const label = stamp
            ? href
              ? `<a class="mentions__at" href="${escapeHtml(href)}">${escapeHtml(stamp)}</a>`
              : `<span class="mentions__at">${escapeHtml(stamp)}</span>`
            : '';
          return `<li>${label}<span class="mentions__text">${escapeHtml(moment.text)}</span>` +
            `<span class="mentions__from">${escapeHtml(MENTION_SOURCES[moment.source] ?? moment.source)}</span></li>`;
        })
        .join('')}${
        spare > 0 ? `<li class="mentions__more">and ${spare} more in this episode</li>` : ''
      }</ul>
    </li>`;
    })
    .join('');

  const more =
    rest > 0 && oldest
      ? `<p class="mentions__more-eps">and ${rest} more episode${rest === 1 ? '' : 's'}, back to E${
          oldest.number
        }${oldest.date ? ` (${escapeHtml(shortDate(oldest.date))})` : ''}.</p>`
      : '';

  const coverage = mentions.coverage;
  const scope = coverage?.episodes
    ? ` ${coverage.withSources} of ${coverage.episodes} episodes have curated notes` +
      `${coverage.transcripts ? `; ${coverage.transcripts} moment${coverage.transcripts === 1 ? '' : 's'} come from transcripts` : ''}.`
    : '';

  return `<section class="mentions">
  <h2>Heard on the show</h2>
  <p class="mentions__count">
    <strong>${mentions.total}</strong> moment${mentions.total === 1 ? '' : 's'} across
    ${mentions.episodes.length} episode${mentions.episodes.length === 1 ? '' : 's'}.
  </p>
  <ol class="mentions__list">${episodes}</ol>
  ${more}
  <p class="mentions__source">From chapter titles, show notes, the PC 2.0 Timeline and the clip
    notes. Where those say nothing, from the episode transcript — which reaches further but
    only records that a word was said.${scope}</p>
</section>`;
}

export function renderNotePage({ note, node, graph, nodesBySlug, markdown, baseUrl, adoption, mentions }) {
  const description = summarise(note.plain);
  const body = `${siteHeader()}
<main class="page page--note">
  <article class="note">
    <div class="note__meta">${typeBadge(node.type)}${tagList(node.tags)}</div>
    ${markdown(note.published)}
    ${adoptionSection(adoption)}
    ${mentionsSection(mentions)}
  </article>
  <aside class="sidebar">
    ${outline(note.published)}
    ${outboundSection(graph.outbound.get(note.slug) ?? [], nodesBySlug)}
    ${backlinkSection(graph.backlinks.get(note.slug) ?? [], nodesBySlug)}
    <p class="sidebar__graph"><a href="/graph/?focus=${encodeURIComponent(note.slug)}">See this note in the graph</a></p>
  </aside>
</main>
${siteFooter()}`;

  return pageShell({
    title: `${note.title} — ${SITE_NAME}`,
    description,
    canonical: `${baseUrl}/notes/${note.slug}/`,
    ogType: 'article',
    body,
  });
}

/**
 * A page for a note that does not exist yet.
 *
 * The vault treats unresolved links as its writing queue. Publishing them keeps
 * every link on the site working, and turns the queue into something a reader
 * can see — including what the note is expected to cover, judged by what links
 * to it.
 */
export function renderStubPage({ node, graph, nodesBySlug, baseUrl }) {
  const backlinks = graph.backlinks.get(node.slug) ?? [];
  const body = `${siteHeader()}
<main class="page page--stub">
  <article class="note">
    <h1>${escapeHtml(node.title)}</h1>
    <p class="stub__notice">This note has not been written yet. It is linked from ${backlinks.length} ${
      backlinks.length === 1 ? 'note' : 'notes'
    }, which is why it is in the <a href="/queue/">writing queue</a>.</p>
  </article>
  <aside class="sidebar">
    ${backlinkSection(backlinks, nodesBySlug)}
  </aside>
</main>
${siteFooter()}`;

  return pageShell({
    title: `${node.title} — not written yet — ${SITE_NAME}`,
    description: `${node.title} is referenced by ${backlinks.length} notes in the PC 2.0 Wiki but has not been written yet.`,
    canonical: `${baseUrl}/notes/${node.slug}/`,
    body,
  });
}

/**
 * The show's history, era by era.
 *
 * Rendered whole into the markup like every other page here: it has to read
 * with JavaScript blocked, and a chronology whose entries arrive by fetch is a
 * chronology nothing can link into or quote.
 *
 * Oldest first, because it is a history. Each entry names the episode it came
 * from and links into the audio at the moment it happened, so a claim on this
 * page can always be checked against the recording that supports it.
 *
 * The entries are a first-hand record — someone relistened to the run from E1
 * and marked what was worth marking — which is why the page says so rather than
 * presenting itself as an index. It is deliberately not exhaustive, and the
 * density says so: about 0.5 entries per episode through 2020-22 against 1.2
 * through 2023-24, because the early pass skipped what had since been overtaken.
 * Do not "fix" that imbalance by inferring entries from chapter titles.
 */
export function renderTimelinePage({ timeline, markdown, baseUrl }) {
  const eras = groupByEra(timeline.eras ?? [], timeline.entries ?? []);
  const entries = timeline.entries ?? [];
  const span =
    entries.length > 1 ? `${shortDate(entries[0].date)} to ${shortDate(entries.at(-1).date)}` : '';

  const jump = `<nav class="eras" aria-label="Jump to an era">
    <ol>${eras
      .map(
        (era) => `<li><a href="#era-${escapeHtml(era.id)}">
        <span class="eras__no">${String(era.index).padStart(2, '0')}</span>
        <span class="eras__title">${escapeHtml(era.title)}</span>
        <span class="eras__n">${era.entries.length}</span>
      </a></li>`,
      )
      .join('')}</ol>
  </nav>`;

  const body = `${siteHeader()}
<main class="page page--timeline">
  <article class="timeline">
    <h1>Timeline</h1>
    <p class="timeline__lede">
      ${entries.length} milestone${entries.length === 1 ? '' : 's'} from the Podcasting 2.0 podcast${
        span ? `, ${escapeHtml(span)}` : ''
      }. Each one names the episode it came from; where a timestamp is known, the
      link opens the audio at that moment.
    </p>
    ${jump}
    ${eras.map((era) => renderEra(era, markdown)).join('')}
    <p class="timeline__source">Compiled by relistening to the whole run from the first
      episode. What is marked here is what was judged worth marking on that pass, so the
      early years are thinner than the later ones — much of what was said then had already
      been overtaken by the time it was heard again, not because less was happening. Eras
      are assigned by date, so every entry falls inside one.</p>
  </article>
</main>
${siteFooter()}`;

  return pageShell({
    title: `Timeline — ${SITE_NAME}`,
    description: `${entries.length} milestones from the Podcasting 2.0 podcast${
      span ? `, ${span}` : ''
    } — the firsts, launches, specs and shutdowns, each linked to the episode it happened on.`,
    canonical: `${baseUrl}/timeline/`,
    body,
  });
}

function renderEra(era, markdown) {
  return `<section class="era" id="era-${escapeHtml(era.id)}">
    <header class="era__head">
      <p class="era__no">${String(era.index).padStart(2, '0')}</p>
      <h2>${escapeHtml(era.title)}</h2>
      <p class="era__from">from ${escapeHtml(shortDate(era.start))} · ${era.entries.length} entr${
        era.entries.length === 1 ? 'y' : 'ies'
      }</p>
      ${era.blurb ? `<p class="era__blurb">${escapeHtml(era.blurb)}</p>` : ''}
    </header>
    <ol class="entries">${era.entries.map((entry) => renderEntry(entry, markdown)).join('')}</ol>
  </section>`;
}

function renderEntry(entry, markdown) {
  const href = entry.audioUrl
    ? entry.seconds == null
      ? entry.audioUrl
      : `${entry.audioUrl}#t=${entry.seconds}`
    : null;
  const at = entry.seconds == null ? '' : ` · ${escapeHtml(toStamp(entry.seconds))}`;
  const cite = `E${entry.episode}${at}`;

  return `<li class="entry" id="${escapeHtml(entry.id)}">
    <p class="entry__when">
      <time datetime="${escapeHtml(entry.date)}">${escapeHtml(shortDate(entry.date))}</time>
    </p>
    <div class="entry__body">
      <p class="entry__title"><span class="entry__kind entry__kind--${escapeHtml(entry.kind)}">${escapeHtml(
        KIND_LABELS[entry.kind] ?? entry.kind,
      )}</span>${escapeHtml(entry.title)}</p>
      <p class="entry__cite">${
        href ? `<a href="${escapeHtml(href)}">${escapeHtml(cite)}</a>` : escapeHtml(cite)
      }${entry.episodeTitle ? ` · ${escapeHtml(entry.episodeTitle)}` : ''}</p>
      ${
        // Written from the same chapter titles and show notes the rest of the
        // page cites, so it belongs with the citation rather than above it.
        entry.body && markdown ? `<div class="entry__note">${markdown(entry.body)}</div>` : ''
      }
      ${
        entry.notes?.length
          ? `<p class="entry__notes">${entry.notes
              .map((note) => `<a href="/notes/${note.slug}/">${escapeHtml(note.title)}</a>`)
              .join('')}</p>`
          : ''
      }
    </div>
  </li>`;
}

const KIND_LABELS = {
  first: 'First',
  launch: 'Launch',
  death: 'Shut down',
  spec: 'Spec',
  event: 'Event',
};

/** Notes grouped by the MOC that maps them, then everything else A–Z. */
export function renderHome({ home, mocs, nodes, markdown, baseUrl }) {
  const written = nodes.filter((node) => !node.stub && node.type !== 'home').sort((a, b) => a.title.localeCompare(b.title));

  const body = `${siteHeader()}
<main class="page page--home">
  <div class="hero">
    <h1>${escapeHtml(SITE_NAME)}</h1>
    <p class="hero__tagline">${escapeHtml(SITE_TAGLINE)}</p>
  </div>

  <section class="mocs">
    <h2>Start here</h2>
    <ul class="mocs__list">${mocs
      .map(
        (moc) => `<li>
      <a class="moc" href="/notes/${moc.slug}/">
        <span class="moc__title">${escapeHtml(moc.title.replace(/\s+MOC$/, ''))}</span>
        <span class="moc__summary">${escapeHtml(summarise(moc.plain, 120))}</span>
      </a>
    </li>`,
      )
      .join('')}</ul>
  </section>

  <section class="all-notes">
    <h2>Every note</h2>
    <ul class="notegrid">${written
      .map(
        (node) => `<li class="notegrid__item">
      <a href="/notes/${node.slug}/">${escapeHtml(node.title)}</a>
      ${typeBadge(node.type)}
    </li>`,
      )
      .join('')}</ul>
  </section>

  <section class="colophon">
    ${markdown(home.body.replace(/^#\s+.*$/m, '').replace(/^##\s+Maps of Content[\s\S]*?(?=^##\s)/m, ''))}
  </section>
</main>
${siteFooter()}`;

  return pageShell({
    title: `${SITE_NAME} — Podcasting 2.0, explained note by note`,
    description: SITE_TAGLINE,
    canonical: `${baseUrl}/`,
    body,
  });
}

/** The writing queue: what is linked but unwritten, most-wanted first. */
export function renderQueue({ nodes, graph, nodesBySlug, baseUrl }) {
  const stubs = nodes
    .filter((node) => node.stub)
    .sort((a, b) => b.inbound - a.inbound || a.title.localeCompare(b.title));

  const thin = nodes
    .filter((node) => !node.stub && node.status === 'seed')
    .sort((a, b) => b.inbound - a.inbound || a.title.localeCompare(b.title));

  const stubList = stubs.length
    ? `<ul class="queue">${stubs
        .map(
          (node) => `<li class="queue__item">
      <a href="/notes/${node.slug}/">${escapeHtml(node.title)}</a>
      <span class="queue__count">${node.inbound} inbound</span>
      <span class="queue__from">from ${(graph.backlinks.get(node.slug) ?? [])
        .map((slug) => noteLink(nodesBySlug.get(slug)))
        .join(', ')}</span>
    </li>`,
        )
        .join('')}</ul>`
    : `<p class="queue__empty">Nothing is linked but unwritten — every link on the wiki lands on a real note.</p>`;

  const body = `${siteHeader()}
<main class="page page--queue">
  <h1>Writing queue</h1>
  <p class="lede">Unresolved links are the queue. A note linked from several places is worth writing before one linked from none.</p>

  <section>
    <h2>Not written yet</h2>
    ${stubList}
  </section>

  <section>
    <h2>Written, still seeds</h2>
    <p class="lede">These exist but are short enough to still be stubs in practice.</p>
    <ul class="queue">${thin
      .map(
        (node) => `<li class="queue__item">
      <a href="/notes/${node.slug}/">${escapeHtml(node.title)}</a>
      <span class="queue__count">${node.inbound} inbound</span>
    </li>`,
      )
      .join('')}</ul>
  </section>
</main>
${siteFooter()}`;

  return pageShell({
    title: `Writing queue — ${SITE_NAME}`,
    description: 'What the PC 2.0 Wiki is linked to but has not written yet.',
    canonical: `${baseUrl}/queue/`,
    body,
  });
}

export function renderGraphPage({ baseUrl }) {
  const body = `${siteHeader()}
<main class="page page--graph">
  <h1>Graph</h1>
  <p class="lede">Every note, and what links to what. Drag to move a note, scroll to zoom, click to open it.</p>
  <ul class="legend">
    <li><span class="legend__dot legend__dot--note"></span>A note. Bigger means more connected.</li>
    <li><span class="legend__dot legend__dot--moc"></span>A map of content — a good place to start.</li>
    <li><span class="legend__dot legend__dot--stub"></span>Linked, but not written yet.</li>
  </ul>
  <div class="graph" id="graph">
    <canvas id="graph-canvas" aria-label="Link graph of the wiki" role="img"></canvas>
    <p class="graph__fallback">The graph needs JavaScript. <a href="/">Every note is listed on the home page</a>.</p>
  </div>
</main>
${siteFooter()}`;

  return pageShell({
    title: `Graph — ${SITE_NAME}`,
    description: 'The PC 2.0 Wiki as a link graph: every note and every connection between them.',
    canonical: `${baseUrl}/graph/`,
    body,
    extraHead: '<script src="/assets/graph.js" defer></script>\n',
  });
}
