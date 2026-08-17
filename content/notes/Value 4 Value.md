---
type: concept
status: growing
element: Value
tags: [podcasting, lightning, v4v]
related: ["[[Lightning Network]]", "[[Keysend]]", "[[Podcast Namespace]]"]
---

# Value 4 Value

Value 4 Value is a model where content is given away freely and supported afterward by whatever value the audience chooses to return — money, time, or talent.

## Why it matters

It sidesteps both advertising and paywalls. No sponsor shapes the content, no gate blocks the audience. The tradeoff is real: income is voluntary and unpredictable, which suits independent creators more than it suits anyone with fixed costs and payroll.

## How it works

In podcasting, V4V is expressed in the feed. A `<podcast:value>` block declares recipients and their [[Splits|split]] percentages. Apps supporting it send payments over the [[Lightning Network]] two ways: [[Streaming Sats|streaming sats]] per minute of listening, and [[Boost|boosts]], which are one-off payments that can carry a message.

The splits are the interesting part — a host, a co-host, an app, and a music artist can each be paid automatically from the same stream without any of them invoicing anyone.

## Related

- [[Keysend]] — how payments reach recipients without an invoice
- [[Lightning Address]] — a friendlier recipient type
