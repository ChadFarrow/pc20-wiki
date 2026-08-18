---
type: tool
status: seed
tags: [lightning, infra]
related: ["[[LND]]", "[[Lightning Address]]", "[[LNURL]]"]
---

# LNbits

LNbits is an account and extension layer that sits in front of a Lightning node, splitting one node's funds into many separate wallets with their own keys and APIs.

## Why it matters

A raw node gives you one balance and one credential. LNbits turns that into per-project wallets, each with scoped API keys, plus extensions that supply common functionality without custom code.

The point is blast radius. An [[LND]] admin macaroon handed to a hobby project controls the whole node. An LNbits wallet key controls one wallet holding what you put in it, so a leaked key costs that balance and nothing more.

## How it works

It connects to a backend funding source — [[LND]], Core Lightning, a third-party service — and keeps its own ledger of wallets on top. Each wallet issues two keys. The admin key (`adminkey`) can spend. The invoice or read key (`inkey`) can only create invoices and read the balance, which is the one a public-facing site should hold.

Extensions add features on top of that ledger: [[Lightning Address]] hosting, [[LNURL]] pay and withdraw endpoints, paywalls, point-of-sale, subscription tools. Each runs against the same wallet API rather than against the node.

The tradeoff follows from the design. Wallet balances are rows in the LNbits database, not channels on the Lightning Network. LNbits is the custodian for every account it hosts, and the node's real liquidity has to cover the total.

## Open questions

- Internal balances are an accounting layer, not channels: reconciliation matters

## Sources

- https://docs.lnbits.org/
