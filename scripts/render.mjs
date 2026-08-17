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

export function renderNotePage({ note, node, graph, nodesBySlug, markdown, baseUrl, adoption }) {
  const description = summarise(note.plain);
  const body = `${siteHeader()}
<main class="page page--note">
  <article class="note">
    <div class="note__meta">${typeBadge(node.type)}${tagList(node.tags)}</div>
    ${markdown(note.body)}
    ${adoptionSection(adoption)}
  </article>
  <aside class="sidebar">
    ${outline(note.body)}
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
