---
type: concept
status: seed
tags: [lightning, bitcoin]
related: ["[[LND]]", "[[LNbits]]", "[[Lightning Address]]"]
---

# Custody

Custody is the question of who actually holds the keys to the sats — the user, or a service acting on their behalf.

## Why it matters

It is the honest tension in [[Value 4 Value]]. Self-custody is the point of the whole exercise: keys you hold cannot be frozen, and no provider can decide your podcast is a policy violation. But running [[LND]], keeping channels open and backing up channel state is a real job, and the number of listeners willing to do it is small.

Custodial apps are why boosting works for normal people at all. They are also a re-centralisation, quietly rebuilding the intermediary the model was meant to remove.

## How it works

At one end, a user runs their own node and holds their own channel state. At the other, a hosted wallet holds funds for many users and credits balances internally — [[LNbits]] does this deliberately, splitting one node into many accounts.

In between sits most of podcasting: a podcaster self-custodying receipts while their audience pays from custodial apps, meeting in the middle over a [[Lightning Address]].

## Open questions

- Whether the split above is a stable equilibrium or just where the tooling happens to be
