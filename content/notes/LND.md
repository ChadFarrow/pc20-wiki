---
type: tool
status: seed
tags: [lightning, infra]
related: ["[[Lightning Network]]", "[[StartOS]]", "[[Macaroon]]"]
---

# LND

LND is a widely used implementation of a Lightning node, providing [[Payment Channel|channel]] management, routing, and a gRPC/REST API for applications to build on.

## Why it matters

It is the assumed backend for a large share of Lightning tooling. Running it yourself means holding your own keys and channels rather than trusting a [[Custody|custodian]] with them.

It is also the node most podcasting tools expect. [[Helipad]] polls it for boosts, [[LNbits]] sits on top of it, and [[Keysend]] support has to be enabled there before a [[Boostagram|boostagram]] can arrive at all.

## How it works

LND connects to a [[Bitcoin]] backend for chain data — either its own Neutrino light client or a full bitcoind — manages channel state, and exposes an API. gRPC listens on port `10009` by default and REST on `8080`.

Access is guarded by TLS and by [[Macaroon|macaroons]], which are bearer credentials rather than passwords. LND writes three at startup: `admin.macaroon` with no restrictions at all, `readonly.macaroon` limited to methods that do not change state, and `invoice.macaroon` for creating and reading invoices. Anything that can read the admin file has full control of the node, which is why a boost reader wants the narrowest one that works.

A pruned bitcoind backend needs care. The node cannot validate old channel opens from blocks it no longer holds, so the graph never finishes syncing unless `routing.assumechanvalid=true` is set.

## Open questions

- Backup discipline: channel state is not recoverable from a seed phrase alone

## Sources

- https://docs.lightning.engineering/
- https://github.com/lightningnetwork/lnd/blob/master/docs/macaroons.md
