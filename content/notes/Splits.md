---
type: spec
status: seed
tags: [podcasting, v4v, lightning]
related: ["[[Value 4 Value]]", "[[Podcast Namespace]]", "[[Keysend]]"]
---

# Splits

A split is one recipient's share of a payment, declared in the feed with `<podcast:valueRecipient>`, so a single boost or stream pays several people at once without anyone invoicing anyone.

## Why it matters

Splits are the part of [[Value 4 Value]] that does something no payment button can. A host, a co-host, a producer, the app that played the episode and the artist whose music ran under the intro can each be paid automatically, in the right proportion, from the same payment.

They also move the accounting into the feed, in public. Anyone can read who gets what — which is a very different arrangement from a platform reporting revenue after the fact.

## How it works

Each `<podcast:valueRecipient>` inside a `<podcast:value>` block carries a required `type` (`node` for a Lightning pubkey, `lnaddress` for a [[Lightning Address]]), an `address`, and a `split` — a number of shares, not a percentage. Shares are summed across recipients and the payment is divided proportionally, so shares of 90 and 10 and 10 mean ninths, not a broken 110%.

`name` is recommended. `fee="true"` marks a recipient whose cut comes off the top, typically an app. `customKey` and `customValue` carry routing information for shared nodes, which is how a recipient behind a hosted wallet is told which account the sats belong to.

## Sources

- https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/value-recipient.md
