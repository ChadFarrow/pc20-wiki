---
type: spec
status: seed
element: Chapters
tags: [podcasting, spec]
related: ["[[Podcast Namespace]]", "[[Transcripts]]"]
---

# Chapters

Chapters divide an episode into titled segments, linked from the feed with `<podcast:chapters>` as an external JSON file rather than baked into the audio.

## Why it matters

The external file is the whole point. Chapters have historically lived in ID3 tags inside the mp3, which means fixing a typo requires re-encoding and re-uploading the episode, and anything that cannot read ID3 — a browser, a web player — sees nothing.

Pulling them into a JSON file means chapters can be corrected after publishing, and chapter images can be fetched during playback instead of inflating the download.

## How it works

`<podcast:chapters>` is item-level and appears once per episode. Both attributes are required: `url` pointing at the file, and `type`, where `application/json+chapters` is the preferred value.

The file itself is a JSON document listing chapters with start times, titles, and optional images and links. It coexists with ID3 chapters rather than replacing them, so a publisher can ship both.

## Open questions

- Adoption is uneven: writing the file is easy, but few publishing tools generate one automatically

## Sources

- https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/chapters.md
