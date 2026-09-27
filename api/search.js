/**
 * GET /api/search/?q=<query>[&e=<episode>][&from=<row>]
 * GET /api/search/?e=<episode>&cues=<from>-<to>[&q=<query>]
 *
 * The transcript search. The whole site is static except this: the text is
 * 27 MB, so it is searched here and only the matching rows go to the browser.
 * The rules live in scripts/transcripts-lib.mjs; this file only loads the
 * corpus and speaks HTTP.
 *
 * The second form is what a result opens into on the page: the cues of one
 * episode by their place in it (each row's `n`), with the query marked. The
 * presence of `cues` selects it.
 *
 * The corpus is read once per instance and kept. On Vercel an instance serves
 * many requests, so only the first search after an idle spell pays the load —
 * about 0.4 s on an M4. vercel.json's `includeFiles` is what puts
 * data/transcripts/ inside the function; a readdir is invisible to Vercel's
 * file tracing, so without it the function would deploy empty.
 *
 * Responses are cacheable at the CDN for a day. The corpus only changes with a
 * deploy, and a new deploy starts with an empty cache.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildIndex,
  parseCorpus,
  corpusEpisode,
  searchTranscripts,
  transcriptContext,
  TRANSCRIPT_CONTEXT_MAX,
} from '../scripts/transcripts-lib.mjs';

let loading = null;

function load() {
  loading ??= (async () => {
    const dir = process.env.PC20_TRANSCRIPTS_DIR ?? join(process.cwd(), 'data', 'transcripts');
    const names = (await readdir(dir)).filter((name) => corpusEpisode(name) !== null);
    const episodes = await Promise.all(
      names.map(async (name) => ({
        episode: corpusEpisode(name),
        cues: parseCorpus(await readFile(join(dir, name), 'utf8')),
      })),
    );
    const meta = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
    return { index: buildIndex(episodes), facts: meta.episodes ?? {} };
  })();
  // A failed load must not be cached for the life of the instance.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

const json = (body, status, cache) =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': cache ? 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400' : 'no-store',
    },
  });

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const rawEpisode = params.get('e');
  const episode = rawEpisode === null || rawEpisode === '' ? null : Number(rawEpisode);
  if (episode !== null && !Number.isInteger(episode)) return json({ error: 'bad-episode' }, 400, true);
  // The row a later page starts at. Each page is its own address, so the CDN caches it too.
  const rawFrom = params.get('from');
  const from = rawFrom === null || rawFrom === '' ? 0 : Number(rawFrom);
  if (!Number.isInteger(from) || from < 0) return json({ error: 'bad-from' }, 400, true);

  const rawCues = params.get('cues');
  let span = null;
  if (rawCues !== null) {
    if (episode === null) return json({ error: 'bad-episode' }, 400, true);
    const found = /^(\d+)-(\d+)$/.exec(rawCues);
    span = found && [Number(found[1]), Number(found[2])];
    if (!span || span[0] >= span[1] || span[1] - span[0] > TRANSCRIPT_CONTEXT_MAX) {
      return json({ error: 'bad-cues' }, 400, true);
    }
  }

  let loaded;
  try {
    loaded = await load();
  } catch (err) {
    console.error(`transcript corpus failed to load: ${err.message}`);
    return json({ error: 'unavailable' }, 503, false);
  }

  if (span) {
    const context = transcriptContext(loaded.index, episode, span[0], span[1], params.get('q') ?? '');
    if (!context.count) return json({ error: 'no-episode' }, 404, true);
    return json(context, 200, true);
  }

  const result = searchTranscripts(loaded.index, params.get('q') ?? '', { episode, from });
  if (result.error) return json(result, 400, true);

  // Titles, dates and audio links for the episodes that matched — the page needs
  // them to label each group and to open the audio at the moment.
  const facts = Object.fromEntries(
    Object.keys(result.episodes).map((e) => [e, loaded.facts[e] ?? null]),
  );
  return json({ ...result, facts }, 200, true);
}
