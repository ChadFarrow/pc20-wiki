---
type: tool
status: seed
tags: [podcasting, nostr]
related: ["[[Boost]]", "[[Boostagram]]", "[[Nostr]]", "[[Nostr Event]]", "[[Relay]]"]
---

# OnlyBoosts

OnlyBoosts is a Nostr client that shows nothing but podcast boosts, collected from across the network and ranked into feeds.

## Why it matters

A [[Boost]] is normally visible only to the podcaster who received it, sitting in whatever tool reads their node. Once apps started publishing boosts to [[Nostr]] as public notes, the boosts became a shared record — one that can be browsed, searched and replied to by anyone, not just the recipient.

## How it works

A handful of Podcasting 2.0 apps publish each boost as a kind-1 [[Nostr Event]]. OnlyBoosts collects those notes from relays across the network and assembles them into feeds — by episode or by boost, scoped globally or to who you follow — with search, replies and boosting back. It runs at onlyboosts.social.

## Open questions

- Only some apps publish to Nostr, so the picture is partial by construction

## Sources

- https://podcasting2.org/docs/podcast-namespace/examples/value/blip-0010
