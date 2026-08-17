---
type: concept
status: seed
tags: [lightning]
related: ["[[Payment Channel]]", "[[Lightning Network]]"]
---

# Liquidity

Liquidity is the balance sitting on each side of a [[Payment Channel]], and it decides the only thing that matters in practice: which direction money can move.

## Why it matters

This is the recurring failure mode for anyone trying to *receive* [[Value 4 Value]] payments. A newly funded node can spend immediately and cannot be paid at all, because being paid requires someone else's sats already sitting on the far side of a channel — inbound capacity.

A podcaster who sets up a node, publishes a `<podcast:value>` block and waits will often find the boosts simply fail. Nothing is misconfigured; there is just nowhere for the money to land.

## How it works

Opening a channel with 100,000 sats gives you 100,000 outbound and zero inbound. Inbound arrives when you spend, when someone opens a channel to you, or when you buy it — a liquidity provider opens a channel pointed at you for a fee.

Routing nodes face the same problem in both directions at once, which is most of what channel management in [[LND]] actually is.

## Open questions

- Whether receiving reliably will ever be simple enough for a podcaster who is not also an operator
