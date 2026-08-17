---
type: spec
status: seed
tags: [podcasting, rss, xml]
related: ["[[RSS]]", "[[Soundbites]]"]
---

# Enclosure

An enclosure is the `<enclosure>` element inside an [[RSS]] item that points at the episode's audio file — the single tag that turns a feed into a podcast.

## Why it matters

Everything else in podcasting is metadata around this one URL. Because the audio is addressed directly, hosting is a commodity: move the files, update the feed, and every subscriber follows without asking permission from anyone.

It is also why podcast statistics are what they are. A download is an HTTP request for this URL, which is why the industry measures requests rather than listening, and why nobody can tell you whether anyone finished the episode.

## How it works

The element carries three attributes: `url` for the file, `length` in bytes, and `type` as a mime type such as `audio/mpeg`. One enclosure per item.

Later [[Podcast Namespace]] tags lean on it rather than replacing it — [[Soundbites|soundbites]] mark a span inside the enclosure's audio, and [[Chapters|chapters]] annotate the same file from outside.

## Related

- [[RSS]] — the format the enclosure lives in
