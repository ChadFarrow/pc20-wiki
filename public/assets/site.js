/**
 * Search.
 *
 * Sixty notes is small enough that the whole index ships as one JSON file
 * and scoring happens here — no search library, no server, no network round
 * trip per keystroke. The index is fetched lazily on first focus so a reader
 * who never searches never pays for it.
 */

(() => {
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  if (!input || !results) return;

  let index = null;
  let loading = null;
  let active = -1;

  function load() {
    if (loading) return loading;
    loading = fetch('/data/search-index.json')
      .then((response) => response.json())
      .then((data) => {
        index = data;
        return data;
      })
      .catch(() => {
        index = [];
        return index;
      });
    return loading;
  }

  /**
   * Lowercase, letters and digits only — the twin of squash() in
   * scripts/mentions-lib.mjs, applied to mention text only.
   *
   * The show does not agree with itself about compounds: "pod ping" and
   * "podping" are the same thing, "PodcastIndex.org" and "Podcast Index" are
   * the same thing. Squashing finds both. It is deliberately NOT applied to the
   * other fields — doing that would re-rank every existing result to fix a
   * problem only the show's own vocabulary has.
   */
  function squash(text) {
    return text.replace(/[^a-z0-9]/g, '');
  }

  /**
   * Scoring is weighted by where a term matched, because a note titled
   * "Keysend" is a better answer to "keysend" than a note that mentions it in
   * passing. Every term has to appear somewhere, so extra words narrow rather
   * than broaden.
   */
  function score(note, terms) {
    const title = note.title.toLowerCase();
    const headings = note.headings.join(' ').toLowerCase();
    const tags = note.tags.join(' ').toLowerCase();
    const text = note.text.toLowerCase();
    const moments = squash((note.moments ?? '').toLowerCase());

    let total = 0;
    for (const term of terms) {
      let best = 0;
      if (title === term) best = 100;
      else if (title.startsWith(term)) best = 60;
      else if (title.includes(term)) best = 40;
      else if (tags.includes(term)) best = 25;
      else if (headings.includes(term)) best = 18;
      else if (text.includes(term)) best = 6;
      // Last rung on purpose. Mention text is the show's vocabulary, not the
      // wiki's, and a common word lights up many notes at once — ranked higher
      // it would push real answers out of an eight-row dropdown. Ranked here it
      // only ever adds notes that would otherwise have returned nothing.
      else if (moments && squash(term) && moments.includes(squash(term))) best = 4;

      if (!best) return 0;
      total += best;
    }
    return total;
  }

  function render(matches, query) {
    active = -1;
    if (!query) {
      results.hidden = true;
      results.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    if (!matches.length) {
      results.innerHTML = `<li class="search__empty">No note matches “${query.replace(/[<&]/g, '')}”.</li>`;
    } else {
      results.innerHTML = matches
        .map(
          (note) => `<li role="option"><a href="/notes/${note.slug}/">
            <span class="search__row"><span class="search__title">${escape(note.title)}</span>${
              // Beside the title rather than inside it, so .search__title's text
              // stays exactly the note's name — which browser-check asserts on.
              note.episodes?.length
                ? `<span class="search__eps">${note.episodes.length} episode${
                    note.episodes.length === 1 ? '' : 's'
                  }</span>`
                : ''
            }</span>
            <span class="search__summary">${escape(note.summary)}</span>
          </a></li>`,
        )
        .join('');
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function escape(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
  }

  function search() {
    const query = input.value.trim();
    if (!query) return render([], '');
    if (!index) return void load().then(search);

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = index
      .map((note) => ({ note, score: score(note, terms) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title))
      .slice(0, 8)
      .map((hit) => hit.note);

    render(matches, query);
  }

  function options() {
    return [...results.querySelectorAll('li[role="option"]')];
  }

  function highlight(next) {
    const items = options();
    if (!items.length) return;
    active = (next + items.length) % items.length;
    items.forEach((item, i) => item.setAttribute('aria-selected', String(i === active)));
    items[active].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('focus', load, { once: true });
  input.addEventListener('input', search);

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(active - 1);
    } else if (event.key === 'Enter') {
      const items = options();
      const target = items[active] ?? items[0];
      if (target) {
        event.preventDefault();
        target.querySelector('a').click();
      }
    } else if (event.key === 'Escape') {
      input.value = '';
      render([], '');
      input.blur();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search')) render([], '');
  });

  // "/" focuses search from anywhere, the way every reference site worth using does.
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      event.preventDefault();
      input.focus();
    }
  });
})();
