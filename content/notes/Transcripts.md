---
type: spec
status: seed
element: Transcript
tags: [podcasting, spec]
related: ["[[Podcast Namespace]]", "[[Chapters]]"]
---

# Transcripts

A transcript is a text version of an episode, linked from the feed with `<podcast:transcript>` so any app can display, search, or read along with it.

## Why it matters

Transcripts are the feature that makes podcast audio addressable. Audio cannot be searched, quoted, or skimmed; text can. They are also the accessibility floor — a deaf listener has no way into a show without one.

Because the transcript is a URL in the feed rather than a platform feature, the same file serves every app at once. This is [[Podcasting 2.0]]'s argument in miniature: publish the artifact openly and let clients compete on what they do with it.

## How it works

`<podcast:transcript>` is item-level and may appear multiple times, once per format. `url` and `type` are required, where `type` is a mime type — `text/vtt`, `application/json`, `application/x-subrip`, `text/html` or `text/plain`. `language` is optional and defaults to the feed's language. `rel="captions"` marks the file as closed captions regardless of its mime type, meaning time codes are present.

Timed formats are what allow read-along highlighting; a plain text file only supports search.

## Sources

- https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/transcript.md
