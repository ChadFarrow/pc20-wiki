---
type: tool
status: seed
tags: [lightning, infra]
related: ["[[Lightning Network]]", "[[StartOS]]"]
---

# LND

LND is a widely used implementation of a Lightning node, providing [[Payment Channel|channel]] management, routing, and a gRPC/REST API for applications to build on.

## Why it matters

It is the assumed backend for a large share of Lightning tooling. Running it yourself means holding your own keys and channels rather than trusting a [[Custody|custodian]] with them.

## How it works

LND connects to a [[Bitcoin]] backend for chain data, manages channel state, and exposes an API guarded by [[Macaroon|macaroon]] credentials and TLS. Applications like [[LNbits]] sit on top and expose friendlier interfaces.

## Open questions

- Backup discipline: channel state is not recoverable from a seed phrase alone
