---
type: concept
status: seed
tags: [lightning, infra, keys]
related: ["[[LND]]", "[[LNbits]]"]
---

# Macaroon

A macaroon is a bearer credential that can be narrowed after it is issued — anyone holding one can produce a weaker version of it, but never a stronger one.

## Why it matters

It is how [[LND]] answers "which of my applications is allowed to spend?" without handing every one of them full control of the node. The admin macaroon can do anything; an invoice macaroon can only create invoices. Giving a public-facing service the second one means a compromise costs you nothing but noise.

The bearer part is the trap. A macaroon is not tied to a user or a device — whoever has the file has the authority, so a macaroon in a screenshot or a config repo is a spent key.

## How it works

The credential carries caveats — conditions that must hold, such as which operations are permitted or when it expires — chained together with HMACs. Adding a caveat is cheap and requires no contact with the issuer; removing one would require forging an HMAC, which is the security property.

[[LNbits]] exists partly to avoid distributing these at all: it holds the node credentials itself and issues per-wallet API keys instead.

## Open questions

- Rotation in practice: most setups issue a macaroon once and never change it again
