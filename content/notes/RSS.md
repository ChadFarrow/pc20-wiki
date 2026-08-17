---
type: spec
status: growing
tags: [podcasting, rss, xml]
related: ["[[Podcast Namespace]]", "[[Podcasting 2.0]]"]
---

# RSS

RSS is an XML document format that describes a list of items published over time, letting any client poll a URL and detect what is new.

## Why it matters

A podcast is an RSS feed whose items carry audio [[Enclosure|enclosures]]. Nothing more. This is why podcasting stayed open while nearly every other media format consolidated onto platforms: distribution needs no permission, only a URL.

## How it works

A feed is a `<channel>` with metadata and a series of `<item>` elements. Each episode item points at its audio file via an `<enclosure>` tag with a URL, length, and MIME type. Clients fetch the feed on a schedule and diff it against what they have already seen.

XML namespaces let publishers add tags the base spec never defined without breaking older clients, which ignore what they do not recognize. That extension mechanism is the whole basis of [[Podcast Namespace]].

## Related

- [[Podcast Namespace]] — the modern extension set
- [[Podping]] — replaces polling with notification
