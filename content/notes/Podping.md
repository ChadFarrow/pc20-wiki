---
type: protocol
status: seed
element: Podping
tags: [podcasting]
related: ["[[RSS]]", "[[Podcast Index]]"]
---

# Podping

Podping is a notification system that announces when a podcast feed has been updated, so clients can stop polling every feed on a timer.

## Why it matters

Polling is wasteful and slow. Thousands of apps hitting millions of feeds hourly burns bandwidth to discover almost nothing, and a listener still waits for the next poll. A push signal collapses that latency.

## How it works

When a publisher updates a feed, a notification carrying the feed URL is broadcast over a shared medium that any consumer can watch. Consumers see the URL and fetch that one feed immediately.

## Open questions

- Trust and spam: what stops a bad actor announcing feeds constantly
