/**
 * The one User-Agent that every request from this repo's scripts sends:
 *
 *   pc20-wiki/<package.json version> (+https://pc20-wiki.vercel.app/)
 *
 * Until 2026-11-27 the two network scripts sent Node's default `node`. On that
 * day mp3s.nashownotes.com (captions and a 404), chadfarrow.github.io
 * (pc20-archive's captions) and raw.githubusercontent.com (the apps directory)
 * answered this name exactly as they answered `node`.
 *
 * package.json is found next to this file, not in the working directory, because
 * the launchd agents do not start in the repo.
 */
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const APP_NAME = 'pc20-wiki';
export const APP_URL = 'https://pc20-wiki.vercel.app/';
export const USER_AGENT = `${APP_NAME}/${version} (+${APP_URL})`;
