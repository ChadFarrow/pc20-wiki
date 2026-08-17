---
type: tool
status: seed
tags: [podcasting, nostr, rss]
related: ["[[Nostr]]", "[[Nostr Event]]", "[[RSS]]", "[[Enclosure]]", "[[Podcasting 2.0]]"]
---

# Castr.me

Castr.me turns a Nostr identity into a podcast feed by collecting the audio and video someone has already posted.

## Why it matters

Plenty of people publish audio to [[Nostr]] without ever thinking of themselves as podcasters, and podcast apps cannot subscribe to an npub. Generating a feed from what is already there bridges the two without asking anyone to change how they post.

## How it works

It scans a profile's kind-1 events — see [[Nostr Event]] — for links to media files, and emits a valid Podcasting 2.0 [[RSS]] feed where each of those links becomes an [[Enclosure]]. A profile that has never posted media produces an empty feed. It runs at castr.me.

## Open questions

- A kind-1 note is not an episode; what gets lost turning a timeline into a feed
