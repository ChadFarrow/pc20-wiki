---
type: source
status: seed
tags: [podcasting, reference]
related: ["[[Podcast Namespace]]", "[[Podcasting 2.0]]", "[[Value 4 Value]]"]
---

# podcasting2.org

podcasting2.org is the documentation site for Podcasting 2.0, presenting the podcast namespace as a browsable reference rather than a directory of markdown files.

## Why it matters

The [[Podcast Namespace]] is specified in a GitHub repository, which is the right home for a spec under active change but an awkward one to read: each tag is a separate file, navigation is a directory listing, and examples sit apart from the tag they illustrate. The same material with a table of contents and cross-links is meaningfully easier to work from, which matters because the audience for a namespace tag is often a publisher, not a developer.

## How it works

It is an open source Next.js site under GPL-3.0, maintained by Daniel J. Lewis, that renders the tag documentation at stable URLs of the form `/docs/podcast-namespace/tags/<tag>`. The specification itself still lives in the `podcast-namespace` repository; this presents it. Most notes here that cover a namespace tag cite the podcasting2.org page first and the repository second.

## Open questions

- A rendering is downstream of the spec: how quickly does it track namespace changes

## Sources

- https://podcasting2.org/docs/podcast-namespace
- https://github.com/thedanieljlewis/podcasting2.org
