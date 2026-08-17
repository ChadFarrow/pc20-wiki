---
type: spec
status: seed
element: Soundbite
tags: [podcasting, spec]
related: ["[[Podcast Namespace]]", "[[Enclosure]]"]
---

# Soundbites

A soundbite is a marked span of an episode — a start time and a duration declared with `<podcast:soundbite>` — that apps can play, share, or turn into a clip.

## Why it matters

It is the cheapest possible clip format. No new audio file, no hosting, no re-encoding: the publisher points at a range inside the audio that already exists, and any app can cut it locally.

That makes the interesting part of an episode quotable, which is the thing podcasting has always been worst at compared to text or video.

## How it works

`<podcast:soundbite>` is item-level and may appear many times per episode. `startTime` and `duration` are both required, in seconds with decimals allowed. The audio source is the item's [[Enclosure|enclosure]] — the tag never names a file of its own.

The element's text content is an optional title, capped at 128 characters so aggregators do not truncate it. The spec recommends soundbites of 15 to 120 seconds.

## Related

- [[Chapters]] — divides the whole episode; a soundbite marks one interesting piece of it

## Sources

- https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/soundbite.md
