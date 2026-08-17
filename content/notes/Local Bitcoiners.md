---
type: project
status: seed
tags: [podcasting, nostr, lightning]
related: ["[[Boost]]", "[[Nostr]]", "[[Nostr Event]]", "[[Value 4 Value]]"]
---

# Local Bitcoiners

Local Bitcoiners is a podcast site that publishes its own boost activity, pairing a public website with Nostr bots that announce incoming payments.

## Why it matters

Most shows treat [[Value 4 Value]] payments as private accounting. Publishing them turns support into something visible — a public record of who boosted and what they said, which is both a social feature and an argument that the payments are real.

## How it works

The site at localbitcoiners.com serves the show's episodes, feeds, boosts and stats as static pages. Alongside it run Nostr publishing bots that watch for incoming Lightning payments through Alby Hub and publish each one as a kind-1 [[Nostr Event]], which is how the boosts reach clients like [[OnlyBoosts]].

## Open questions

- Publishing every [[Boost]] publishes the boosters too; what is the opt-out
