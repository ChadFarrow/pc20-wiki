---
type: spec
status: seed
tags: [podcasting, spec, nostr]
related: ["[[Podcast Namespace]]", "[[Nostr]]"]
---

# Cross-app Comments

Cross-app comments point every podcast app at the same canonical discussion thread using `<podcast:socialInteract>`, so a conversation about an episode is not trapped inside whichever app the listener happens to use.

## Why it matters

Comments are the classic platform lock-in: whoever hosts the thread owns the audience. Naming the thread in the feed inverts that — the discussion has an address, and any client can read it and post back into it.

It is also where [[Podcasting 2.0]] and [[Nostr]] meet in practice. A podcaster can root the thread in a Nostr note and let listeners reply from any Nostr client or podcast app that speaks it.

## How it works

`<podcast:socialInteract>` can appear at channel or item level, more than once. `protocol` and `uri` are required — `uri` is the root post of the thread, `protocol` names the system it lives in. `accountId` is recommended, with `accountUrl` and `priority` optional; lower `priority` wins when several tags are present.

`protocol="disabled"` is a deliberate signal that public comments are off, which apps should honour rather than inventing their own thread.

## Sources

- https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/social-interact.md
