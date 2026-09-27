/**
 * The transcript search page.
 *
 * Unlike the header search in site.js, this cannot ship its index: the text is
 * 27 MB. Each query goes to /api/search/ (api/search.js) and comes back as rows
 * — a timestamp, the cue with its neighbours, and where the query sits in it.
 *
 * Four things keep the load on that function small:
 *   - a query runs after typing pauses, not on every key;
 *   - it needs three letters or digits, the same floor the function enforces;
 *   - a newer query aborts the one in flight;
 *   - the first answer is the newest 100 rows, and the rest come 500 at a time
 *     (`&from=`) only when the reader presses "Show more" at the end of the list.
 *
 * Every piece of caption text goes into the page through textContent. It is the
 * show's words, not markup, and it contains `<`, `&` and quotes.
 *
 * A timestamp plays in the page, in one shared player docked at the bottom, rather
 * than navigating to the MP3. The link stays a real link to `<mp3>#t=<seconds>`, so
 * a modified click (new tab, new window) and a page with no JavaScript still work.
 * mp3s.nashownotes.com answers range requests, which is what lets the player seek
 * into a two-hour file without downloading it first.
 *
 * A row opens, on a click anywhere but its timestamp, into the passage around the
 * match: about 40 seconds each side, with "Earlier" and "Later" for 80 more. The
 * cues come from the same function (`&cues=<from>-<to>`, by the row's `n`) and are
 * joined here into short paragraphs, each with a timestamp that plays.
 */

(() => {
  const form = document.getElementById('tsearch');
  const input = document.getElementById('tsearch-q');
  const status = document.getElementById('tsearch-status');
  const list = document.getElementById('tsearch-results');
  if (!form || !input || !status || !list) return;

  const QUERY_MIN = 3; // TRANSCRIPT_QUERY_MIN in scripts/transcripts-lib.mjs
  const MORE = 500; // TRANSCRIPT_MORE_CAP in scripts/transcripts-lib.mjs
  const DEBOUNCE_MS = 400;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let timer = null;
  let inflight = null;
  let paging = null;
  let shown = '';
  // The query on the page and how far down it the list has got, so a later page
  // adds to the list instead of redrawing it. Null when nothing is listed.
  let view = null;

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

  /**
   * A timestamp that plays episode `e` from `t` in the page player, or plain
   * text when the episode has no audio link.
   */
  function timeLink(e, t, fact) {
    if (!fact?.a) return el('span', 'tsearch__at', stamp(t));
    const time = el('a', 'tsearch__at', stamp(t));
    time.href = `${fact.a}#t=${t}`;
    time.setAttribute('aria-label', `Play E${e} from ${stamp(t)}`);
    time.dataset.src = fact.a;
    time.dataset.t = String(t);
    time.dataset.label = `E${e}${fact.t ? ` · ${fact.t}` : ''} · ${stamp(t)}`;
    return time;
  }

  const plural = (n, one, many) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

  function say(message) {
    status.textContent = '';
    status.append(message);
  }

  function clear() {
    view = null;
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

    if (!data.total) {
      say(`No matches for “${data.query}”.`);
      return;
    }

    view = {
      query: data.query,
      episode,
      counts,
      facts: {},
      total: data.total,
      // Every row this query can page through: the archive, or one episode.
      scope: episode == null ? data.total : (counts[episode] ?? 0),
      rows: 0,
      groups: new Map(),
      tail: null,
    };

    append(data);

    if (episode == null) {
      tell();
    } else {
      const back = el('button', 'tsearch__back', 'Back to all episodes');
      back.type = 'button';
      back.addEventListener('click', () => run(input.value, null));
      status.textContent = `${plural(counts[episode] ?? 0, 'match', 'matches')} in E${episode}. `;
      status.append(back);
    }
  }

  function tell() {
    const { total, counts, rows, scope } = view;
    say(
      `${plural(total, 'match', 'matches')} in ${plural(Object.keys(counts).length, 'episode', 'episodes')}` +
        (rows < scope ? ` — showing the newest ${rows.toLocaleString('en')}.` : '.'),
    );
  }

  /**
   * Add one page of rows to the list.
   *
   * Rows arrive newest episode first, then by time, so an episode is a run of
   * consecutive rows — but a page can end partway through one, and the next page
   * then continues that episode's group rather than starting a second heading.
   */
  function append(data) {
    Object.assign(view.facts, data.facts);
    const { counts, facts, groups } = view;
    const touched = new Set();
    let first = null;

    for (const row of data.results) {
      let group = groups.get(row.e);
      if (!group) {
        const fact = facts[row.e];
        const item = el('li', 'tsearch__episode');
        const head = el('p', 'tsearch__ep');
        head.append(
          el('strong', null, `E${row.e}`),
          fact?.t ? ` · ${fact.t}` : '',
          fact?.d ? ` · ${shortDate(fact.d)}` : '',
          el('span', 'tsearch__count', ` · ${plural(counts[row.e] ?? 0, 'match', 'matches')}`),
        );
        group = { item, moments: el('ol', 'tsearch__moments'), rows: 0, more: null };
        item.append(head, group.moments);
        list.insertBefore(item, view.tail?.item ?? null);
        groups.set(row.e, group);
      }

      const li = el('li');
      const text = marked(row.x, row.ranges ?? []);
      // The row opens into the passage around it (see open()). An answer from
      // before rows carried `n` cannot say where the cue is, so it stays shut.
      if (Number.isInteger(row.n)) {
        li.dataset.e = String(row.e);
        li.dataset.n = String(row.n);
        li.dataset.t = String(row.t);
        li.classList.add('is-openable');
        text.setAttribute('role', 'button');
        text.setAttribute('aria-expanded', 'false');
        text.tabIndex = 0;
      }
      li.append(timeLink(row.e, row.t, facts[row.e]), text);
      group.moments.append(li);
      group.rows++;
      view.rows++;
      touched.add(row.e);
      first ??= li;
    }

    // An episode the list shows only part of offers the rest on its own; the
    // offer goes once a later page has filled it in.
    for (const e of touched) {
      const group = groups.get(e);
      const whole = group.rows >= (counts[e] ?? 0);
      if (view.episode == null && !whole && !group.more) {
        group.more = el('button', 'tsearch__more', `Show all ${counts[e]} in E${e}`);
        group.more.type = 'button';
        group.more.addEventListener('click', () => run(input.value, e));
        group.item.append(group.more);
      } else if (whole && group.more) {
        group.more.remove();
        group.more = null;
      }
    }

    // `truncated` is the server's word on whether more remain; an empty page
    // must not leave a button that asks for the same empty page again.
    if (data.truncated && data.results.length > 0) {
      offer(view.scope - view.rows);
    } else if (view.tail) {
      const focused = view.tail.item.contains(document.activeElement);
      view.tail.item.remove();
      view.tail = null;
      // The button a keyboard reader pressed is gone; carry them to what it loaded.
      if (focused) first?.querySelector('a')?.focus();
    }
  }

  /** The end of a list that has more: a button for the next page, and how many are left. */
  function offer(left) {
    if (!view.tail) {
      const item = el('li', 'tsearch__cap');
      const button = el('button', 'tsearch__next');
      button.type = 'button';
      button.addEventListener('click', () => more());
      const note = el('span', 'tsearch__left');
      item.append(button, note);
      list.append(item);
      view.tail = { item, button, note };
    }
    const count = Math.max(0, left);
    view.tail.button.textContent = count <= MORE ? `Show the other ${count.toLocaleString('en')}` : `Show ${MORE} more`;
    view.tail.note.textContent =
      count <= MORE
        ? ''
        : `${count.toLocaleString('en')} not shown yet. ` +
          (view.episode == null ? 'Add a word to narrow the search, or open one episode above.' : 'Add a word to narrow the search.');
  }

  /** The next page of the query on the page, added below what is there. */
  async function more() {
    if (!view?.tail) return;
    const current = view;
    const { button, note } = current.tail;
    if (paging) paging.abort();
    paging = new AbortController();

    const params = new URLSearchParams({ q: current.query });
    if (current.episode != null) params.set('e', String(current.episode));
    params.set('from', String(current.rows));
    button.disabled = true;
    button.textContent = 'Loading…';
    note.textContent = '';
    list.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(`/api/search/?${params}`, { signal: paging.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || response.status);
      // A newer query replaced the list while this page was on its way.
      if (view !== current) return;
      append(data);
      if (current.episode == null) tell();
    } catch (err) {
      if (view !== current || !current.tail) return;
      offer(current.scope - current.rows);
      if (err.name !== 'AbortError') current.tail.note.textContent = 'Could not load more. Try again.';
    } finally {
      button.disabled = false;
      list.removeAttribute('aria-busy');
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

  // ---- a result opened into the passage around it ----

  const AROUND = 12; // cues each side of the match when a row opens: ~40 s at 3.5 s a cue
  const STEP = 24; // cues that "Earlier" or "Later" adds: ~80 s
  const PARAGRAPH_MIN = 3; // a sentence end breaks a paragraph only once it has this many cues
  const PARAGRAPH_MAX = 8; // and nothing runs longer; 90% of sentences fit in 8
  const passages = new WeakMap();

  /**
   * Cues → paragraphs. A caption is a few seconds of speech and often stops
   * mid-sentence, so a column of them reads badly. Built here, over every cue
   * loaded so far, so a step "Earlier" leaves no seam where two answers meet.
   */
  function paragraphs(cues, hit) {
    const out = [];
    let current = null;
    for (const cue of cues) {
      if (!current) {
        current = { t: cue.t, x: '', ranges: [], size: 0, hit: false };
        out.push(current);
      }
      const offset = current.x ? current.x.length + 1 : 0;
      current.x = current.x ? `${current.x} ${cue.x}` : cue.x;
      for (const [from, to] of cue.ranges ?? []) {
        const last = current.ranges[current.ranges.length - 1];
        // A match split across a caption break reads as one mark, not two.
        if (from === 0 && last && last[1] === offset - 1) last[1] = to + offset;
        else current.ranges.push([from + offset, to + offset]);
      }
      current.size++;
      if (cue.n === hit) current.hit = true;
      if (current.size >= PARAGRAPH_MAX || (current.size >= PARAGRAPH_MIN && /[.?!]["')\]]?$/.test(cue.x))) {
        current = null;
      }
    }
    return out;
  }

  function draw(state) {
    const t = playing && state.paras.contains(playing) ? playing.dataset.t : null;
    state.paras.replaceChildren(
      ...paragraphs(state.cues, state.n).map((p) => {
        const li = el('li', p.hit ? 'is-hit' : null);
        li.append(timeLink(state.e, p.t, state.fact), marked(p.x, p.ranges));
        return li;
      }),
    );
    // The paragraph in the player was redrawn; mark its successor.
    if (t != null) mark(state.paras.querySelector(`a.tsearch__at[data-t="${t}"]`));
    state.earlier.hidden = state.from <= 0;
    state.later.hidden = state.to >= state.count;
  }

  /** Load cues on one side of what the passage holds — or, the first time, around the match. */
  async function grow(state, side) {
    if (state.busy) return;
    let a;
    let b;
    if (!state.loaded) [a, b] = [Math.max(0, state.n - AROUND), state.n + AROUND + 1];
    else if (side === 'earlier') [a, b] = [Math.max(0, state.from - STEP), state.from];
    else [a, b] = [state.to, Math.min(state.count, state.to + STEP)];
    if (a >= b) return;

    state.busy = true;
    state.earlier.disabled = state.later.disabled = true;
    state.note.textContent = 'Loading…';
    const params = new URLSearchParams({ e: String(state.e), cues: `${a}-${b}` });
    if (state.query) params.set('q', state.query);

    try {
      const response = await fetch(`/api/search/?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || response.status);
      const top = state.passage.getBoundingClientRect().top;
      if (!state.loaded) state.cues = data.lines;
      else if (side === 'earlier') state.cues = data.lines.concat(state.cues);
      else state.cues = state.cues.concat(data.lines);
      if (!state.loaded || side === 'earlier') state.from = data.from;
      if (!state.loaded || side !== 'earlier') state.to = data.to;
      state.count = data.count;
      state.loaded = true;
      state.note.textContent = '';
      draw(state);
      // The new text goes in above what the reader was looking at. Hold the
      // passage still, so it appears under the button they pressed.
      if (side === 'earlier') window.scrollBy(0, state.passage.getBoundingClientRect().top - top);
    } catch {
      state.note.textContent = 'Could not load this passage. Try again.';
    } finally {
      state.busy = false;
      state.earlier.disabled = state.later.disabled = false;
    }
  }

  function open(row) {
    let state = passages.get(row);
    if (!state) {
      const e = Number(row.dataset.e);
      state = {
        e,
        n: Number(row.dataset.n),
        fact: view?.facts[e],
        query: view?.query ?? '',
        cues: [],
        from: 0,
        to: 0,
        count: 0,
        loaded: false,
        busy: false,
      };
      state.passage = el('div', 'tsearch__passage');
      state.passage.tabIndex = -1;
      state.passage.setAttribute('aria-label', `E${e} around ${stamp(Number(row.dataset.t))}`);
      state.earlier = el('button', 'tsearch__step', 'Earlier');
      state.later = el('button', 'tsearch__step', 'Later');
      const less = el('button', 'tsearch__step', 'Show less');
      for (const button of [state.earlier, state.later, less]) button.type = 'button';
      state.earlier.hidden = state.later.hidden = true;
      state.earlier.addEventListener('click', () => grow(state, 'earlier'));
      state.later.addEventListener('click', () => grow(state, 'later'));
      less.addEventListener('click', () => shut(row));
      state.paras = el('ol', 'tsearch__paras');
      state.note = el('p', 'tsearch__note');
      state.note.setAttribute('role', 'status');
      const foot = el('div', 'tsearch__foot');
      foot.append(state.later, less);
      state.passage.append(state.earlier, state.paras, state.note, foot);
      row.append(state.passage);
      passages.set(row, state);
    }

    row.classList.add('is-open');
    row.querySelector(':scope > .tsearch__text').setAttribute('aria-expanded', 'true');
    state.passage.hidden = false;
    // The snippet that had the focus is hidden now; the passage takes it.
    state.passage.focus({ preventScroll: true });
    if (!state.loaded) grow(state);
  }

  function shut(row) {
    const state = passages.get(row);
    const inside = state.passage.contains(document.activeElement);
    const text = row.querySelector(':scope > .tsearch__text');
    row.classList.remove('is-open');
    state.passage.hidden = true;
    text.setAttribute('aria-expanded', 'false');
    if (inside) text.focus({ preventScroll: true });
    // A long passage closing can leave its row above the screen.
    if (row.getBoundingClientRect().top < 0) row.scrollIntoView({ block: 'start' });
  }

  const toggle = (row) => (row.classList.contains('is-open') ? shut(row) : open(row));

  list.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) return;
    const row = event.target.closest('.tsearch__moments > li.is-openable');
    if (!row) return;
    // A reader who dragged across a line to copy it is not asking to open or close it.
    if (!(window.getSelection()?.isCollapsed ?? true)) return;
    toggle(row);
  });

  list.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const text = event.target.closest('.tsearch__moments > li.is-openable > .tsearch__text');
    if (!text) return;
    event.preventDefault();
    toggle(text.parentElement);
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
    // A page still loading for the old query would only be thrown away.
    if (paging) paging.abort();
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
