---
type: tool
status: seed
tags: [lightning, infra]
related: ["[[LND]]", "[[Lightning Address]]"]
---

# LNbits

LNbits is an account and extension layer that sits in front of a Lightning node, splitting one node's funds into many separate wallets with their own keys and APIs.

## Why it matters

A raw node gives you one balance and one credential. LNbits turns that into per-project wallets, each with scoped API keys, plus extensions that supply common functionality without custom code.

## How it works

It connects to a backend node such as [[LND]], tracks balances internally, and exposes wallets over an API. Extensions add features on top — [[Lightning Address]] hosting, [[LNURL]] endpoints, paywalls, point-of-sale.

## Open questions

- Internal balances are an accounting layer, not channels: reconciliation matters
