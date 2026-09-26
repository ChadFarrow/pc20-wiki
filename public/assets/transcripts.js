/**
 * The transcript search page.
 *
 * Unlike the header search in site.js, this cannot ship its index: the text is
 * 27 MB. Each query goes to /api/search/ (api/search.js) and comes back as rows
 * — a timestamp, the cue with its neighbours, and where the query sits in it.
 *
 * Three things keep the load on that function small:
 *   - a query runs after typing pauses, not on every key;
 *   - it needs three letters or digits, the same floor the function enforces;
 *   - a newer query aborts the one in flight.
 *
 * Every piece of caption text goes into the page through textContent. It is the
 * show's words, not markup, and it contains `<`, `&` and quotes.
 *
 * A timestamp plays in the page, in one shared player docked at the bottom, rather
 * than navigating to the MP3. The link stays a real link to `<mp3>#t=<seconds>`, so
 * a modified click (new tab, new window) and a page with no JavaScript still work.
 * mp3s.nashownotes.com answers range requests, which is what lets the player seek
 * into a two-hour file without downloading it first.
 */

(() => {
  const form = document.getElementById('tsearch');
  const input = document.getElementById('tsearch-q');
  const status = document.getElementById('tsearch-status');
  const list = document.getElementById('tsearch-results');
  if (!form || !input || !status || !list) return;

  const QUERY_MIN = 3; // TRANSCRIPT_QUERY_MIN in scripts/transcripts-lib.mjs
  const DEBOUNCE_MS = 400;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let timer = null;
  let inflight = null;
  let shown = '';

  const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

  /** `2023-02-24` → `24 Feb 2023`, the twin of shortDate() in render.mjs. */
  function shortDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
    return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : '';
  }

  /** Seconds → `1:04:00` or `4:00`, the twin of toStamp() in mentions-lib.mjs. */
  function stamp(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const pad = (n) => String(n).padStart(2, '0');
    const mins = Math.floor((s % 3600) / 60);
    return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(mins)}:${pad(s % 60)}` : `${mins}:${pad(s % 60)}`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** The row's text with each match wrapped in <mark>. Ranges are `[from, to)` into `text`. */
  function marked(text, ranges) {
    const span = el('span', 'tsearch__text');
    let at = 0;
    for (const [from, to] of ranges) {
      if (from < at) continue;
      span.append(text.slice(at, from), el('mark', null, text.slice(from, to)));
      at = to;
    }
    span.append(text.slice(at));
    return span;
  }

  const plural = (n, one, many) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

  function say(message) {
    status.textContent = '';
    status.append(message);
  }

  function clear() {
    list.replaceChildren();
  }

  /** Keep the address shareable: /transcripts/?q=podping&e=203 opens the same result. */
  function remember(query, episode) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (episode != null) params.set('e', String(episode));
    const search = params.toString();
    history.replaceState(null, '', search ? `?${search}` : location.pathname);
  }

  function render(data, episode) {
    clear();
    const counts = data.episodes ?? {};
    const episodeCount = Object.keys(counts).length;

    if (!data.total) {
      say(`No matches for “${data.query}”.`);
      return;
    }

    if (episode == null) {
      say(
        `${plural(data.total, 'match', 'matches')} in ${plural(episodeCount, 'episode', 'episodes')}` +
          (data.truncated ? ` — showing the newest ${data.results.length}.` : '.'),
      );
    } else {
      const back = el('button', 'tsearch__back', 'Back to all episodes');
      back.type = 'button';
      back.addEventListener('click', () => run(input.value, null));
      status.textContent = `${plural(counts[episode] ?? 0, 'match', 'matches')} in E${episode}. `;
      status.append(back);
    }

    // Rows arrive newest episode first, then by time, so a group is a run of
    // consecutive rows with the same episode.
    let group = null;
    let groupEpisode = null;
    for (const row of data.results) {
      if (row.e !== groupEpisode) {
        groupEpisode = row.e;
        const facts = data.facts?.[row.e];
        const item = el('li', 'tsearch__episode');
        const head = el('p', 'tsearch__ep');
        head.append(
          el('strong', null, `E${row.e}`),
          facts?.t ? ` · ${facts.t}` : '',
          facts?.d ? ` · ${shortDate(facts.d)}` : '',
          el('span', 'tsearch__count', ` · ${plural(counts[row.e] ?? 0, 'match', 'matches')}`),
        );
        item.append(head);
        group = el('ol', 'tsearch__moments');
        item.append(group);
        list.append(item);

        // The default view is capped, so an episode can have more than it shows.
        const onPage = data.results.filter((r) => r.e === row.e).length;
        if (episode == null && (counts[row.e] ?? 0) > onPage) {
          const more = el('button', 'tsearch__more', `Show all ${counts[row.e]} in E${row.e}`);
          more.type = 'button';
          more.addEventListener('click', () => run(input.value, row.e));
          item.append(more);
        }
      }

      const facts = data.facts?.[row.e];
      const li = el('li');
      const time = facts?.a ? el('a', 'tsearch__at', stamp(row.t)) : el('span', 'tsearch__at', stamp(row.t));
      if (facts?.a) {
        time.href = `${facts.a}#t=${row.t}`;
        time.setAttribute('aria-label', `Play E${row.e} from ${stamp(row.t)}`);
        time.dataset.src = facts.a;
        time.dataset.t = String(row.t);
        time.dataset.label = `E${row.e}${facts.t ? ` · ${facts.t}` : ''} · ${stamp(row.t)}`;
      }
      li.append(time, marked(row.x, row.ranges ?? []));
      group.append(li);
    }

    if (episode == null && data.truncated) {
      list.append(
        el(
          'li',
          'tsearch__cap',
          `Only the newest ${data.results.length} are listed. Add a word to narrow the search, or open one episode above.`,
        ),
      );
    }
  }

  // ---- the player ----

  let player = null;
  let playing = null;

  /** Built on first use, so a reader who never presses play never gets a bar. */
  function ensurePlayer() {
    if (player) return player;
    const bar = el('div', 'tplayer');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Player');
    const now = el('p', 'tplayer__now');
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    const close = el('button', 'tplayer__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close the player');
    close.addEventListener('click', () => {
      audio.pause();
      bar.hidden = true;
      document.body.classList.remove('has-player');
      mark(null);
    });
    bar.append(now, audio, close);
    document.body.append(bar);
    player = { bar, now, audio };
    return player;
  }

  /** The row being played, so a reader can see where the audio came from. */
  function mark(link) {
    playing?.closest('li')?.classList.remove('is-playing');
    playing = link;
    link?.closest('li')?.classList.add('is-playing');
  }

  function play(link) {
    const { bar, now, audio } = ensurePlayer();
    const src = link.dataset.src;
    const at = Number(link.dataset.t);

    now.textContent = link.dataset.label;
    bar.hidden = false;
    document.body.classList.add('has-player');
    mark(link);

    // A new file has no duration until its metadata arrives, and a seek before
    // then is lost. The same file seeks at once.
    if (audio.getAttribute('src') !== src) {
      audio.setAttribute('src', src);
      audio.addEventListener('loadedmetadata', () => (audio.currentTime = at), { once: true });
    } else {
      audio.currentTime = at;
    }
    // Called inside the click, so the browser counts it as the reader's choice.
    audio.play().catch(() => {});
  }

  list.addEventListener('click', (event) => {
    const link = event.target.closest('a.tsearch__at');
    if (!link?.dataset.src) return;
    // New tab, new window, download: the reader asked for the file itself.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    play(link);
  });

  async function run(raw, episode = null) {
    const query = raw.trim();
    clearTimeout(timer);
    if (inflight) inflight.abort();

    if (!query) {
      shown = '';
      say('');
      clear();
      remember('', null);
      return;
    }
    if (squash(query).length < QUERY_MIN) {
      say(`Type at least ${QUERY_MIN} letters or digits.`);
      return;
    }

    const key = `${query}|${episode ?? ''}`;
    if (key === shown) return;

    inflight = new AbortController();
    const params = new URLSearchParams({ q: query });
    if (episode != null) params.set('e', String(episode));
    say('Searching…');
    list.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(`/api/search/?${params}`, { signal: inflight.signal });
      const data = await response.json();
      if (!response.ok && data.error !== 'too-short') throw new Error(data.error || response.status);
      shown = key;
      remember(query, episode);
      render(data, episode);
      if (episode != null) window.scrollTo({ top: form.offsetTop, behavior: 'smooth' });
    } catch (err) {
      if (err.name === 'AbortError') return;
      shown = '';
      clear();
      say('The search is not available right now. Try again in a minute.');
    } finally {
      list.removeAttribute('aria-busy');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run(input.value);
  });

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value), DEBOUNCE_MS);
  });

  // A shared link: /transcripts/?q=…[&e=…]
  const params = new URLSearchParams(location.search);
  const initial = params.get('q');
  if (initial) {
    input.value = initial;
    const e = Number(params.get('e'));
    run(initial, Number.isInteger(e) && e > 0 ? e : null);
  }
})();
