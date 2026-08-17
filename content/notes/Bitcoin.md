---
type: protocol
status: seed
tags: [bitcoin]
related: ["[[Lightning Network]]", "[[Sats]]"]
---

# Bitcoin

Bitcoin is a peer-to-peer network that maintains a shared ledger without an operator, using proof of work to agree on which transactions happened and in what order.

## Why it matters

For [[Value 4 Value]] the relevant property is not ideology but permission: nobody has to approve a payment, and no payment processor can decide a podcast is unacceptable. That is the whole reason payments can be part of an open feed spec rather than a platform feature.

The constraint that matters just as much is cost. Settlement is deliberately expensive and slow, which is why paying a podcaster three sats per minute has to happen somewhere else — see [[Lightning Network]].

## How it works

Transactions are broadcast, collected into blocks roughly every ten minutes, and chained together so that rewriting history means redoing the work. Balances are not accounts; they are unspent outputs, each locked to a condition the spender must satisfy.

Running a node — see [[StartOS]] for the packaged route — means verifying all of that yourself instead of asking someone whether your money is real.

## Open questions

- How much of the stack a listener can be expected to run before they simply use a custodial app; see [[Custody]]
