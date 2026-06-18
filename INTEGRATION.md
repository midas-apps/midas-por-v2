# Midas PoR — Partner Integration Guide

This document explains how to retrieve and independently audit a Midas Proof-of-Reserves attestation. No code required to read it through; pointers to addresses and IPFS content only.

Each Midas token shown on the Midas website carries a small PoR badge. The badge links to the Ethereum transaction that anchors the latest signed attestation for that token. From that single transaction you can recover the full attestation document and verify the data yourself — Midas supply, CEX exposure, fund-manager NAV, oracle price — without trusting any centralized API.

---

## What the badge points to

The badge links to a mainnet transaction calling:

```
SaveRegistryWithClaim.setAttestation(bytes32 proofId, bytes32 attestationHash)
```

| Item | Value |
|---|---|
| Registry contract | [`0x2D6e9F608807436DE5D9603B00Abe3FEd1Bc809d`](https://etherscan.io/address/0x2D6e9F608807436DE5D9603B00Abe3FEd1Bc809d) |
| Event emitted | `AttestationSet(proofId, attestorAddress, attestationHash, timestamp)` |
| Token registry (proofId → token) | [`tokens.json`](./tokens.json) on this repo |

The two arguments are all you need:

- `proofId` — identifies the token (cross-reference with `tokens.json`)
- `attestationHash` — content hash of the attestation JSON stored on IPFS

---

## Step 1 — Recover the attestation from IPFS

`attestationHash` is the SHA-256 multihash digest of a gzipped JSON document pinned on IPFS. To turn it into a CID:

1. Prefix the hash with `0x1220` (multihash header: SHA-256 + 32 bytes)
2. Base58-encode the result → you get a CIDv0 starting with `Qm…`
3. Fetch from any public IPFS gateway:
   - `https://gateway.pinata.cloud/ipfs/<CID>`
   - `https://ipfs.io/ipfs/<CID>`
   - `https://cloudflare-ipfs.com/ipfs/<CID>`
4. Gunzip the response → you get the attestation JSON

A reference snippet (browser, no dependency) is in the [README](./README.md#reading-on-chain-data).

---

## Step 2 — Verify the signature

Every attestation is signed by the Midas attester key. The document contains:

- `issuer.identity` — the attester public key
- `publicKeySource` — `https://midas.app/public/attestation-engine/pubkeys.json`
- `signature` — ECDSA signature over the canonicalized claims

The official public key list at `publicKeySource` is the trust anchor. Match `issuer.identity` against it before reading further.

---

## Step 3 — Read the claims

The attestation is a list of independently-sourced claims. Each one tells you where the value came from so you can re-check it from the original source.

| Claim | What it tells you | How to audit it yourself |
|---|---|---|
| `onchain_supply` | ERC-20 `totalSupply()` of the Midas token at the attestation time, plus the chain and block reference | Call `totalSupply()` directly on the token contract at the same block |
| `ops_claim` | Cross-chain supply and NAV reported by Midas ops | Cross-check against your own chain indexer |
| `onetoken_report` | Full 1token portfolio breakdown — `assets`, `liabilities`, `equity`, and `_metadata.anchorISO` (the exact snapshot timestamp). Contains per-wallet balances including CEX, custody, OTC | Inspect the wallet list, hit each CEX/custody address directly and confirm the balances |
| `oracle_price` | Chainlink oracle price + last-updated timestamp | Query the Chainlink aggregator directly |
| `fund_manager_email` | Vlayer TLS-Notary proof of the NAV email sent by the fund manager (offchain-data tokens only — mFONE, mM1-USD) | Verify the vlayer proof independently with the vlayer SDK; the proof commits to sender domain, receiver, and email body |
| `email_nav` | NAV value extracted from the fund-manager email, listing which lines were summed | Re-extract from the vlayer-proven email body |
| `overcollateralization` | The computed coverage ratio + which sources were used (`method-1`, `method-2`), threshold, pass/fail | Recompute from the inputs above |

All `cre_consensus` claims are produced by the Chainlink DON. A claim is only included in the attestation if all DON nodes independently agreed on the value.

---

## Step 4 — Independent verifications

Each attestation can be re-verified on-chain by independent verifiers. Multiple parties (Midas, LlamaRisk, anyone you authorize) can publish a verification result for the same `proofId`.

Query the registry directly:

```
SaveRegistryWithClaim.getAllVerifications(bytes32 proofId)
→ [{ verificationHash, verifier, timestamp }, …]
```

Each `verificationHash` resolves the same way as `attestationHash`: base58-encode `0x1220 || hash`, fetch from IPFS, gunzip, read.

To run your own verifier and publish on-chain, see the [Verification workflow](./README.md#verification-crepor_verification) and [Proxy setup](./README.md#savecrereceiverproxy) sections of the README.

---

## Step 5 — Where the off-chain data lives

For tokens whose NAV depends on data outside the chain:

| Source | Tokens | What it produces | Anchored on-chain via |
|---|---|---|---|
| Fund-manager email (vlayer TLS-Notary) | mFONE (Fasanara), mM1-USD (M1 Capital) | Signed NAV + accrued interest / pending redemption lines | `fund_manager_email` + `email_nav` claims |
| 1token portfolio API | All tokens | Per-wallet asset breakdown (CEX, custody, OTC), equity, navBase | `onetoken_report` claim |
| Midas supply endpoint | All tokens | Cross-chain `totalSupply` at the attestation timestamp | `ops_claim` + `onchain_supply` |
| Chainlink oracle | All tokens with a published price feed | Token price USD | `oracle_price` claim |

If you only trust an EVM RPC, the `onchain_supply` and `oracle_price` claims are fully reproducible from chain state. The 1token and email claims carry their own cryptographic proof (DON consensus and TLS notary, respectively) so they can be re-checked without trusting Midas.

---

## Token registry

Mapping of `proofId` → token metadata (name, contract address, fund manager, anchoring rules) is public:

```
https://raw.githubusercontent.com/midas-apps/midas-por-v2/main/tokens.json
```

Mirrored on jsDelivr: `https://cdn.jsdelivr.net/gh/midas-apps/midas-por-v2@main/tokens.json`

Adding a token requires a PR on this repo — branch protection and required reviews are the registry's governance.

---

## Contact

- Repo issues: [github.com/midas-apps/midas-por-v2/issues](https://github.com/midas-apps/midas-por-v2/issues)
- For verifier onboarding (authorize your `SaveCreReceiverProxy` on the registry): reach out via Midas official channels
