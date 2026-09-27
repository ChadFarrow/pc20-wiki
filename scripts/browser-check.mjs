#!/usr/bin/env node
/**
 * Drives the built wiki in a real browser.
 *
 * The unit tests cover what the build produces; this covers what the page does.
 * Search and the graph are the two things markup inspection cannot verify —
 * whether the index actually loads, whether the canvas actually draws — and
 * they are exactly the parts a reader notices when they break.
 *
 * Starts its own static server and headless Chrome, then cleans both up.
 *
 *   npm run check:browser
 *   npm run check:browser -- --shots            # also write screenshots
 *   npm run check:browser -- --host https://…   # drive a deployment instead
 *
 * The server and CDP plumbing follow pc20-timeline/scripts/browser-check.mjs.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { extname, join, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = resolve(ROOT, 'public');
const SHOTS = resolve(ROOT, 'shots');
const PORT = 8129;
const CDP_PORT = 9339;
const PROFILE = '/tmp/pc20-wiki-browser-check';
const shots = process.argv.includes('--shots');

// --host lets the same checks run against a deployment instead of the local
// build, which is how a deploy gets verified rather than assumed.
const hostArg = process.argv.indexOf('--host');
const HOST = hostArg !== -1 ? process.argv[hostArg + 1].replace(/\/$/, '') : null;
const ORIGIN = HOST ?? `http://localhost:${PORT}`;

const CHROME = [
  // An explicit path first, so this runs somewhere other than a Mac desktop —
  // a container or CI has Chrome, just never where a Mac keeps it.
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

/**
 * The transcript search is the one route that is not a file. Locally it is
 * answered by the real function in api/search.js, reading the real corpus, so
 * the check drives the same code Vercel runs.
 */
async function searchApi(req, res) {
  const { GET } = await import(pathToFileURL(join(ROOT, 'api', 'search.js')).href);
  const response = await GET(new Request(new URL(req.url, 'http://localhost')));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/search')) return await searchApi(req, res);
      // Decide this before joining — join() drops the trailing slash that says
      // "this is a directory".
      const pathname = decodeURIComponent(url.pathname);
      const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      const path = join(SITE, normalize(relative));
      if (!path.startsWith(SITE)) throw Object.assign(new Error('outside the site'), { code: 'ENOENT' });
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

async function findChrome() {
  for (const path of CHROME) {
    try {
      await readFile(path);
      return path;
    } catch {
      /* keep looking */
    }
  }
  throw new Error(`no Chrome found; looked in:\n  ${CHROME.join('\n  ')}`);
}

/** Minimal CDP client — one WebSocket, request/response, nothing else. */
async function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let id = 0;

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const msgId = ++id;
      pending.set(msgId, (msg) => {
        const failure = msg.result?.exceptionDetails || msg.error;
        if (failure) rej(new Error(failure.exception?.description || failure.message || 'cdp failed'));
        else res(msg.result);
      });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  return {
    send,
    close: () => ws.close(),
    evaluate: async (expression) =>
      (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
        ?.result?.value,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTarget(url) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const targets = await (await fetch(`http://localhost:${CDP_PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes(url));
      if (page) return page;
    } catch {
      /* browser still starting */
    }
    await sleep(250);
  }
  throw new Error('browser never opened the page');
}

async function main() {
  const chrome = await findChrome();
  // No local server needed when driving a remote host.
  const server = HOST ? null : await serve();
  await rm(PROFILE, { recursive: true, force: true });
  if (shots) await mkdir(SHOTS, { recursive: true });

  const browser = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      // Chrome refuses to start as root without --no-sandbox, which is exactly
      // the case in a container. CHROME_FLAGS keeps that out of the default.
      ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(/\s+/) : []),
      '--window-size=1280,900',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE}`,
      `${ORIGIN}/`,
    ],
    { stdio: 'ignore' },
  );

  const results = [];
  const check = (name, pass, detail = '') => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let client;
  try {
    const target = await waitForTarget(HOST ? new URL(HOST).host : `localhost:${PORT}`);
    client = await connect(target.webSocketDebuggerUrl);
    const { evaluate, send } = client;
    await send('Page.enable');
    // Records an uncaught error or rejection on every page loaded after this, so
    // the "no errors" checks below have something to read.
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__err = false;
        addEventListener('error', () => { window.__err = true; });
        addEventListener('unhandledrejection', () => { window.__err = true; });`,
    });

    const go = async (path) => {
      await send('Page.navigate', { url: `${ORIGIN}${path}` });
      for (let attempt = 0; attempt < 60; attempt++) {
        if (await evaluate('document.readyState === "complete"')) break;
        await sleep(100);
      }
      await sleep(250);
    };

    const shoot = async (name) => {
      if (!shots) return;
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
    };

    // ---- home ----
    // Counted from the built data, not hard-coded: the wiki grows.
    const noteCount = HOST
      ? (await (await fetch(`${ORIGIN}/data/search-index.json`)).json()).length
      : JSON.parse(await readFile(join(SITE, 'data', 'search-index.json'), 'utf8')).length;

    await go('/');
    check(
      'home lists every note in the markup',
      (await evaluate('document.querySelectorAll(".notegrid__item").length')) === noteCount,
      `${noteCount} notes`,
    );
    check('the four maps of content are the entry point', (await evaluate('document.querySelectorAll(".moc").length')) === 4);
    check('no console errors on load', !(await evaluate('window.__err === true')));
    await shoot('home');

    // ---- search ----
    const type = (text) =>
      evaluate(`{
        const box = document.getElementById('search-input');
        box.focus();
        box.value = ${JSON.stringify(text)};
        box.dispatchEvent(new Event('input', { bubbles: true }));
      }`);

    await type('keysend');
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await evaluate('document.querySelectorAll("#search-results li[role=option]").length > 0')) break;
      await sleep(100);
    }
    const first = await evaluate('document.querySelector("#search-results .search__title")?.textContent');
    check('search ranks the note named for the query first', first === 'Keysend', `got "${first}"`);
    check(
      'search results link to real pages',
      (await evaluate('document.querySelector("#search-results a").getAttribute("href")')) === '/notes/keysend/',
    );
    await shoot('search');

    // A word that appears only in prose, never in a title — otherwise this
    // tests title matching again, which the previous check already covers.
    await type('payroll');
    await sleep(200);
    const body = await evaluate('document.querySelector("#search-results .search__title")?.textContent');
    check('search finds a note by a word in its body', body === 'Value 4 Value', `got "${body}"`);

    await type('zzzznothingmatches');
    await sleep(200);
    check('an empty result says so', await evaluate('!!document.querySelector(".search__empty")'));

    await type('podping');
    await sleep(200);
    check(
      'the header search offers the transcripts',
      (await evaluate('document.querySelector("#search-results .search__transcripts a")?.getAttribute("href")')) ===
        '/transcripts/?q=podping',
    );

    await evaluate('document.getElementById("search-input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await sleep(100);
    check('escape closes the results', await evaluate('document.getElementById("search-results").hidden'));

    // ---- a note page ----
    await go('/notes/value-4-value/');
    check('the note renders its prose', (await evaluate('document.querySelector(".note p").textContent.length')) > 80);
    check(
      'wikilinks in the prose are real links',
      (await evaluate('document.querySelectorAll(".note a.wikilink").length')) > 0,
    );
    check(
      'the page says what links to it',
      (await evaluate(
        '[...document.querySelectorAll(".panel h2")].some(h => h.textContent === "Linked from")',
      )) &&
        (await evaluate('document.querySelectorAll(".panel .linklist a").length')) > 0,
    );
    check('the outline lists the note\'s sections', (await evaluate('document.querySelectorAll(".outline li").length')) >= 2);
    await shoot('note');

    // A heading anchor has to land somewhere, or [[Note#Heading]] is a lie.
    check(
      'headings have the ids that anchors point at',
      await evaluate('!!document.getElementById("how-it-works")'),
    );

    // ---- transcript mentions ----
    // Keysend has both curated and transcript mentions, so this is the page
    // where a transcript moment's label and timestamp link actually render.
    await go('/notes/keysend/');
    check(
      'a transcript moment renders its label and its timestamp link',
      await evaluate(`
        [...document.querySelectorAll('.mentions__moments li')].some((li) =>
          li.querySelector('.mentions__from')?.textContent === 'transcript' &&
          li.querySelector('a.mentions__at')
        )
      `),
    );

    // ---- the expansion under the caps ----
    // Boost is the worst case the caps produce: 125 moments across 72 episodes,
    // of which the digest shows 15. The <details> is the only route to the rest,
    // so it is worth driving rather than asserting in a string test.
    await go('/notes/boost/');
    const capped = await evaluate('document.querySelectorAll(".mentions__list:not(.mentions__list--all) .mentions__text").length');
    const promised = await evaluate('Number(document.querySelector(".mentions__count strong").textContent)');
    check(
      'the section says how many moments it has, and the digest shows fewer',
      capped > 0 && promised > capped,
      `${capped} of ${promised} shown before expanding`,
    );

    await evaluate('document.querySelector(".mentions__all summary").click()');
    await sleep(150);
    const opened = await evaluate('document.querySelectorAll(".mentions__list--all .mentions__text").length');
    check(
      'expanding reaches every moment the section counted',
      opened === promised,
      `${opened} of ${promised} after expanding`,
    );

    // The summary is a control on a phone too. WCAG 2.5.8 wants 24 by 24 CSS px,
    // and it is not a link inside a sentence, so the exemption does not apply.
    const box = await evaluate(
      'JSON.stringify(document.querySelector(".mentions__all summary").getBoundingClientRect())',
    );
    const rect = JSON.parse(box ?? '{}');
    check(
      'the expand control clears the 24px touch target',
      rect.height >= 24,
      `${Math.round(rect.height)}px tall`,
    );

    // Offset past the sticky header, or the shot cuts the control off the top.
    await evaluate('document.querySelector(".mentions__all").scrollIntoView({block:"start"}); window.scrollBy(0, -90)');
    await sleep(150);
    await shoot('mentions-expanded');

    // ---- adoption ----
    await go('/notes/cross-app-comments/');
    await evaluate('document.querySelector(".adoption").scrollIntoView({block:"center"})');
    await sleep(150);
    const adoptionText = await evaluate('document.querySelector(".adoption__count")?.textContent.replace(/\\s+/g," ").trim()');
    check(
      'a feature note reports how many apps implement it',
      /^\d+ of \d+ apps in the Podcast Index directory/.test(adoptionText ?? ''),
      adoptionText,
    );
    check(
      'the adoption block names apps and cites its source',
      (await evaluate('document.querySelectorAll(".adoption__apps li").length')) > 0 &&
        (await evaluate('!!document.querySelector(".adoption__source a")')),
    );
    await shoot('adoption');

    // ---- graph ----
    await go('/graph/');
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await evaluate('document.getElementById("graph-canvas").classList.contains("ready")')) break;
      await sleep(100);
    }
    check('the graph loads its data', await evaluate('document.getElementById("graph-canvas").classList.contains("ready")'));
    await sleep(1200);

    // A canvas that drew nothing is still a canvas, so look at the pixels.
    const painted = await evaluate(`(() => {
      const c = document.getElementById('graph-canvas');
      const ctx = c.getContext('2d');
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
      return opaque;
    })()`);
    check('the graph actually draws', painted > 500, `${painted} painted pixels`);
    check(
      'the fallback message is hidden once the canvas works',
      await evaluate('getComputedStyle(document.querySelector(".graph__fallback")).display === "none"'),
    );
    await shoot('graph');

    // ---- queue ----
    await go('/queue/');
    check('the writing queue page renders', (await evaluate('document.querySelectorAll(".queue__item").length')) > 0);
    await shoot('queue');

    // ---- transcripts ----
    await go('/transcripts/');
    const waitFor = async (expression, tries = 80) => {
      for (let attempt = 0; attempt < tries; attempt++) {
        if (await evaluate(expression)) return true;
        await sleep(100);
      }
      return false;
    };
    const tsearch = (text) =>
      evaluate(`{
        document.getElementById('tsearch-q').value = ${JSON.stringify(text)};
        document.getElementById('tsearch').requestSubmit();
      }`);
    const status = () => evaluate('document.getElementById("tsearch-status").textContent');

    await tsearch('podping');
    // The first query pays for loading the whole corpus.
    await waitFor('document.querySelectorAll(".tsearch__episode").length > 0', 150);
    const groups = await evaluate('document.querySelectorAll(".tsearch__episode").length');
    check('the transcript search returns episodes', groups > 0, `${groups} episodes shown`);
    check('the status counts every match, not just the rows shown', /^[\d,]+ matches in [\d,]+ episodes/.test(await status()), await status());
    // "showing the newest 0" once passed the check above.
    const showing = Number(((await status()).match(/showing the newest ([\d,]+)/)?.[1] ?? '').replace(/,/g, ''));
    const onPage = await evaluate('document.querySelectorAll(".tsearch__moments > li").length');
    check('the status names the rows the page shows', showing === onPage, `says ${showing}, shows ${onPage}`);
    const at = await evaluate('document.querySelector(".tsearch__at")?.getAttribute("href")');
    check('a transcript result opens the audio at its moment', /^https:\/\/.+\.mp3#t=\d+$/.test(at ?? ''), at);
    const marks = await evaluate('[...document.querySelectorAll(".tsearch__text mark")].map((m) => m.textContent.toLowerCase().replace(/[^a-z0-9]/g, ""))');
    check(
      'every highlight is the query as the transcriber wrote it',
      marks.length > 0 && marks.every((m) => m === 'podping'),
      `${marks.length} marks`,
    );
    check('the address carries the query, so a result can be shared', (await evaluate('location.search')) === '?q=podping');
    await shoot('transcripts');

    // A timestamp plays in the page, not by navigating to the MP3.
    const before = await evaluate('location.href');
    const clicked = await evaluate(`(() => {
      const a = document.querySelector('.tsearch__at[data-src]');
      a.click();
      return { src: a.dataset.src, t: Number(a.dataset.t) };
    })()`);
    await sleep(200);
    check('a timestamp plays in the page instead of leaving it', (await evaluate('location.href')) === before);
    check(
      'the player opens on the clicked episode',
      (await evaluate('!document.querySelector(".tplayer").hidden && document.querySelector(".tplayer audio").getAttribute("src")')) ===
        clicked.src,
    );
    check('the row being played is marked', await evaluate('!!document.querySelector(".tsearch__moments li.is-playing")'));
    // The seek waits for the file's metadata, which comes from the real audio host.
    await waitFor('document.querySelector(".tplayer audio").readyState >= 1', 150);
    const position = await evaluate('document.querySelector(".tplayer audio").currentTime');
    check(
      'the player starts at the clicked moment',
      Math.abs(position - clicked.t) < 2,
      `${position.toFixed(1)}s for ${clicked.t}s`,
    );
    await shoot('transcripts-player');

    const more = await evaluate('document.querySelector(".tsearch__more")?.textContent ?? null');
    if (more) {
      await evaluate('document.querySelector(".tsearch__more").click()');
      await waitFor('/ in E\\d+\\. /.test(document.getElementById("tsearch-status").textContent)');
      const episodes = await evaluate('new Set([...document.querySelectorAll(".tsearch__ep strong")].map((e) => e.textContent)).size');
      check('one episode can be opened in full', episodes === 1, `${more} → ${await status()}`);
    } else {
      check('one episode can be opened in full', false, 'no episode offered "Show all"');
    }

    // Every match can be reached, a page at a time, not only the first hundred.
    // After the one-episode check, because loading everything fills in every
    // episode and takes their "Show all" buttons away.
    await tsearch('podping');
    await waitFor('/ in [\\d,]+ episodes/.test(document.getElementById("tsearch-status").textContent)', 150);
    const rowCount = () => evaluate('document.querySelectorAll(".tsearch__moments > li").length');
    await evaluate('document.querySelector(".tsearch__next")?.scrollIntoView({ block: "center" })');
    await shoot('transcripts-more');
    let clicks = 0;
    while (clicks < 20 && (await evaluate('!!document.querySelector(".tsearch__next:not(:disabled)")'))) {
      const before = await rowCount();
      await evaluate('document.querySelector(".tsearch__next").click()');
      clicks++;
      await waitFor(`document.querySelectorAll(".tsearch__moments > li").length > ${before}`, 150);
    }
    const listed = await rowCount();
    const total = Number(((await status()).match(/^([\d,]+) matches/)?.[1] ?? '').replace(/,/g, ''));
    check(
      'the show-more button reaches every match',
      clicks > 0 && listed === total && !/showing/.test(await status()),
      `${listed} of ${total} rows after ${clicks} click${clicks === 1 ? '' : 's'}`,
    );
    const heads = await evaluate('[...document.querySelectorAll(".tsearch__ep strong")].map((e) => e.textContent)');
    check('a page that continues an episode adds to its group', heads.length === new Set(heads).size, `${heads.length} headings`);
    check(
      'no episode offers "Show all" once every row is listed',
      (await evaluate('document.querySelectorAll(".tsearch__more").length')) === 0,
    );

    // A row opens into the passage around its match. A row a few minutes in, so
    // there is text before it for "Earlier" to reach.
    await evaluate(`{
      const row = [...document.querySelectorAll('.tsearch__moments > li.is-openable')].find((r) => Number(r.dataset.t) > 300);
      row.id = 'check-row';
      row.scrollIntoView({ block: 'center' });
      row.querySelector(':scope > .tsearch__text').click();
    }`);
    await waitFor('document.querySelectorAll("#check-row .tsearch__paras > li").length > 0', 150);
    const passage = await evaluate(`(() => {
      const row = document.getElementById('check-row');
      const text = row.querySelector(':scope > .tsearch__text');
      return {
        open: row.classList.contains('is-open'),
        paras: row.querySelectorAll('.tsearch__paras > li').length,
        hits: row.querySelectorAll('.tsearch__paras > li.is-hit').length,
        marked: row.querySelectorAll('.tsearch__paras > li.is-hit mark').length > 0,
        snippetHidden: text.getClientRects().length === 0,
        expanded: text.getAttribute('aria-expanded'),
      };
    })()`);
    check(
      'a click on a result opens the passage around it',
      passage.open && passage.paras >= 3 && passage.hits === 1 && passage.marked && passage.snippetHidden && passage.expanded === 'true',
      JSON.stringify(passage),
    );
    await shoot('transcripts-passage');

    const edge = (which) =>
      evaluate(`(() => {
        const times = [...document.querySelectorAll('#check-row .tsearch__paras > li > .tsearch__at')].map((a) => Number(a.dataset.t));
        return ${which === 'first' ? 'times[0]' : 'times[times.length - 1]'};
      })()`);
    const stepButton = (label) =>
      `[...document.querySelectorAll('#check-row .tsearch__step')].find((b) => b.textContent === '${label}')`;
    const passageTop = 'document.querySelector("#check-row .tsearch__passage").getBoundingClientRect().top';

    const firstBefore = await edge('first');
    const topBefore = await evaluate(passageTop);
    await evaluate(`${stepButton('Earlier')}.click()`);
    await waitFor(`Number(document.querySelector('#check-row .tsearch__paras > li > .tsearch__at').dataset.t) < ${firstBefore}`, 150);
    const firstAfter = await edge('first');
    const topAfter = await evaluate(passageTop);
    check(
      '"Earlier" adds the text before, and the passage holds still',
      firstAfter < firstBefore && Math.abs(topAfter - topBefore) <= 2,
      `${firstBefore}s → ${firstAfter}s, top moved ${Math.round(topAfter - topBefore)}px`,
    );

    const lastBefore = await edge('last');
    await evaluate(`${stepButton('Later')}.click()`);
    await waitFor(`(() => { const a = [...document.querySelectorAll('#check-row .tsearch__paras > li > .tsearch__at')]; return Number(a[a.length - 1].dataset.t) > ${lastBefore}; })()`, 150);
    const lastAfter = await edge('last');
    check('"Later" adds the text after', lastAfter > lastBefore, `${lastBefore}s → ${lastAfter}s`);

    const hereBefore = await evaluate('location.href');
    const para = await evaluate(`(() => {
      const a = document.querySelector('#check-row .tsearch__paras > li:not(.is-hit) > .tsearch__at[data-src]');
      a.click();
      return { src: a.dataset.src };
    })()`);
    await sleep(200);
    check(
      'a paragraph timestamp plays in the page and marks its paragraph',
      (await evaluate('location.href')) === hereBefore &&
        (await evaluate('document.querySelector(".tplayer audio").getAttribute("src")')) === para.src &&
        (await evaluate('!!document.querySelector("#check-row .tsearch__paras > li.is-playing")')),
    );

    await evaluate(`${stepButton('Show less')}.click()`);
    const shut = await evaluate(`(() => {
      const row = document.getElementById('check-row');
      const text = row.querySelector(':scope > .tsearch__text');
      return !row.classList.contains('is-open') && text.getClientRects().length > 0 && text.getAttribute('aria-expanded') === 'false';
    })()`);
    check('"Show less" closes the passage and shows the snippet again', shut);

    await evaluate('document.querySelector("#check-row > .tsearch__text").focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(100);
    check(
      'Enter on a focused result opens it too',
      await evaluate('document.getElementById("check-row").classList.contains("is-open")'),
    );

    await tsearch('ab');
    await sleep(100);
    check('a query too short to run says why', /at least 3/.test(await status()), await status());

    await tsearch('zzqxjkvw');
    await waitFor('/No matches/.test(document.getElementById("tsearch-status").textContent)');
    check('a transcript search with no matches says so', /No matches/.test(await status()), await status());
    check('no errors on the transcripts page', !(await evaluate('window.__err === true')));

    // A phone, emulated properly: --window-size only crops a desktop layout.
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await go('/transcripts/?q=value%20for%20value');
    await waitFor('document.querySelectorAll(".tsearch__episode").length > 0', 150);
    // With the player open, since it is the widest thing that can appear, and one
    // passage open, since its buttons and paragraph timestamps are tapped too.
    await evaluate('document.querySelector(".tsearch__at[data-src]").click()');
    await evaluate('document.querySelector(".tsearch__moments > li.is-openable > .tsearch__text").click()');
    await waitFor('document.querySelectorAll(".tsearch__paras > li").length > 0', 150);
    await sleep(300);
    await shoot('transcripts-passage-phone');
    const overflow = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    // Name the culprits, innermost first, so a failure says where to look.
    const wide = await evaluate(`[...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
      .filter((el) => ![...el.children].some((c) => c.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5))
      .slice(0, 3)
      .map((el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' "' + el.textContent.trim().slice(0, 20) + '"')`);
    check('the transcripts page fits a phone with no sideways scroll', overflow <= 0, `${overflow}px over${wide.length ? `: ${wide.join(', ')}` : ''}`);
    // WCAG 2.5.8: 24 × 24 CSS px for anything tapped on its own.
    const small = await evaluate(`[...document.querySelectorAll('.masthead__nav a, .tsearch__go, .tsearch__more, .tsearch__next, .tsearch__step, .tsearch__at, .tplayer__close')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => [el.textContent.trim(), el.getBoundingClientRect()])
      .filter(([, r]) => r.width < 24 || r.height < 24)
      .map(([text, r]) => text + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))`);
    check('the transcripts page has no tap target under 24px', small.length === 0, small.slice(0, 4).join(', '));
    await shoot('transcripts-phone');
    const searchWidth = await evaluate('document.querySelector(".masthead .search").getBoundingClientRect().width');
    // A fourth nav link once squeezed this to 0px. The design leaves it ~73px at
    // 390px; 48px is the floor below which it stops being a place to type.
    check('the header search is not squeezed out on a phone', searchWidth >= 48, `${Math.round(searchWidth)}px wide`);
    await send('Emulation.clearDeviceMetricsOverride');
  } finally {
    client?.close();
    server?.close();

    // Chrome needs a moment to let go of its profile directory; deleting it
    // too early throws ENOTEMPTY and would fail an otherwise passing run.
    browser.kill();
    await Promise.race([new Promise((r) => browser.once('exit', r)), sleep(3000)]);
    await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(`browser check failed: ${err.message}`);
  process.exit(1);
});
