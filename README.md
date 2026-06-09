# Midas PoR — CRE Workflows

Chainlink CRE workflows for the SAVE Proof of Reserves framework. Implements NAV-based overcollateralization attestation and verification for Midas tokens.

## Workflows

### Attestation (`cre/por_attestation/`)

Listens for `NewClaim` events (ops claim type) on the SaveRegistryWithClaim contract. Fetches the ops claim from IPFS, reads on-chain oracle price, optionally verifies the fund manager email via Vlayer TLS Notary, runs the overcollateralization check, builds a signed SAVE attestation, and pushes it on-chain.

**Flow:**
`NewClaim` event → Fetch ops claim from IPFS → Read oracle price (Chainlink) → [Vlayer TLS verification] → Fetch 1token report → Overcollateralization check → Build & sign attestation → Upload to IPFS → `setAttestation` on-chain

### Verification (`cre/por_verification/`)

Listens for `AttestationSet` events. Fetches the attestation from IPFS, verifies all claims using the SAVE framework (`@save/core`), re-verifies Vlayer TLS proofs for tokens with offchain data, and pushes the verification result on-chain.

**Flow:**
`AttestationSet` event → Fetch attestation from IPFS → Verify claims (SAVE) → [Vlayer re-verification] → Upload verification → `setVerification` on-chain

---

## Supported Tokens

| Token | proofId | Vlayer (offchain data) |
|---|---|---|
| mFONE | `0x9701c16c2aa2589b3fef161e3d13f4b38a9e0c8ad4b827bff12cf65a6a3ef234` | Yes (Fasanara email) |
| mHyperBTC | `0xf77ebd862996bb55a1c85ab27e4c554e0e77f691d74e8b63bf4849007db4cbc9` | No |
| mHYPER | `0xac9a528065afb4290ab62fb0ee1a9110d48ed834454d2d04ab369b4832bbda7a` | No |
| mGLOBAL | `0x5f683091c2cfe327b5ea0efc5588908d6873b0675d43b6ba78da908b87f05121` | No |
| mWIN | `0xbe8475503cd12f05ff022cc2d2525157086e3d603f4429c6bbc524b676d109fb` | No |

proofIds are computed as `sha256(proofName)` (SHA-256, not keccak256).

---

## Attestation Claims

All `cre_consensus` claims are produced by the Chainlink DON and trusted as-is by verifiers.

| Claim ID | Type | Description |
|---|---|---|
| `ops_claim` | object / cre_consensus | Ops team data: token, NAV, supply, oracle address |
| `oracle_price` | object / cre_consensus | Chainlink oracle price (`priceRaw`, `oracleLastUpdatedAt`, `oracleLastUpdatedAtISO`) |
| `oracle_price_usd` | numeric / source-backed | Resolved from `oracle_price#/priceRaw` |
| `onetoken_report` | object / cre_consensus | 1token portfolio report (`assets`, `liabilities`, `equity`, optional `navBase`, optional `pendingRedemptionMillionsUSD`). `_metadata.anchorRule` is `vlayer_email_date_plus_1h` (token with fund-manager email) or `ops_created_at_minus_3h` (token without). `_metadata.anchorISO` is the resolved ISO timestamp used for the 1token snapshot query — verifiers can re-fetch the exact same snapshot |
| `onetoken_total_nav` | numeric / source-backed | Resolved from `onetoken_report#/equity/total` |
| `onchain_supply` | object / cre_consensus | ERC-20 `totalSupply()` at attestation time + `readAt` timestamp |
| `overcollateralization` | object / cre_consensus | Check result. Fields: `overcollateralizationType` (`method-1` / `method-2`), `aumSource` (`1token+fasanara_vlayer` / `1token` / `vlayer_total` / `ops_claim`), `supplySource` (`method-1` / `method-2`), `oneTokenAUM`, `pendingRedemptionUSD` (subtracted from both AUM and supply), `supplyTokens` (net cross-chain supply), `totalSupplyCrossChainReportedByOps`, `totalSupplyTokens`, `navPerToken`, `oraclePriceFormatted`, `threshold`, `ratio`, `passed`. Optional: `oneTokenOnchainAUM`, `fundManagerNavUSD` |
| `overcollateralization_ratio` | numeric / source-backed | Resolved from `overcollateralization#/ratio` |
| `fund_manager_claim` | object / tls_notary | Vlayer TLS proof of fund manager email (offchain tokens only) |
| `email_nav` | object / cre_consensus | Extracted NAV from email: `{ navUSD, navIsTotal, navFields }`. `navIsTotal=false` = additive fund-manager-reported portion (CEX, OTC, fund shares — whatever surfaced in the email); `navIsTotal=true` = full NAV cross-check. `navFields` lists the email line labels that were summed — verifiers can re-extract the same value from the vlayer email proof |
| `fund_manager_total_nav` | numeric / source-backed | Resolved from `email_nav#/navUSD` (id preserved for backward compatibility) |
| `fund_manager_email_sender_verification` | string / source-backed | Email sender verification (offchain tokens only) |
| `fund_manager_email_receiver_verification` | string / source-backed | Email receiver verification (offchain tokens only) |

---

## Prerequisites

- [Chainlink CRE CLI](https://docs.chain.link/cre)
- Node.js 22+ with [Corepack](https://nodejs.org/api/corepack.html) (enables yarn@4.13.0)
- An Ethereum RPC endpoint (mainnet for both targets; Sepolia for dev target)
- Pinata account for IPFS pinning
- Vlayer API access for tokens with offchain data (`auth_token`)
- Your attester/verifier address must be authorized on the registry for each proofId
- A `SaveCreReceiverProxy` deployed and configured — **each party running a workflow needs their own instance** (see below)

---

## Setup

```bash
corepack enable
yarn install
```

Create your environment files (gitignored):
```bash
cp cre/.env.example cre/.env.dev
cp cre/.env.example cre/.env.prod
# Fill in your values
```

Configure your RPC endpoints in `cre/project.yaml`.

Prod config files (`*.prod.json`) are gitignored — create them locally from the dev configs and fill in mainnet addresses.

---

## Deploy

From the `cre/` directory.

Three environments:
- `dev` — Sepolia trigger, Sepolia write (full testnet)
- `test` — Mainnet trigger, Sepolia write (real-data dry-run)
- `prod` — Mainnet trigger, Mainnet write

```bash
# Dev (Sepolia → Sepolia)
cre workflow deploy ./por_attestation --target por-attester-dev -e .env.dev
cre workflow deploy ./por_verification --target por-verifier-dev -e .env.dev

# Test (Mainnet → Sepolia)
cre workflow deploy ./por_attestation --target por-attester-test -e .env.dev
cre workflow deploy ./por_verification --target por-verifier-test -e .env.dev

# Prod (Mainnet → Mainnet)
cre workflow deploy ./por_attestation --target por-attester-prod -e .env.prod
cre workflow deploy ./por_verification --target por-verifier-prod -e .env.prod
```

Adding a token does **not** require re-deploy if your config uses `tokenRegistry` — the workflow fetches the registry at every trigger. See [Token registry](#token-registry-dynamic-no-re-deploy) above.

For other config changes (threshold, RPC, addresses…) re-deploy with `--wasm ./por_attestation/binary.wasm.br.b64` to skip recompilation:

```bash
cre workflow deploy ./por_attestation \
  --target por-attester-prod \
  --wasm ./por_attestation/binary.wasm.br.b64 \
  -e .env.prod --yes
```

---

## Secrets

Defined in `cre/.env.dev` / `cre/.env.prod` (gitignored). See `cre/.env.example` for the template.

| Secret (env var) | CRE secret name | Used by | Description |
|---|---|---|---|
| `CRE_ETH_PRIVATE_KEY` | — | CLI only | Ethereum key for CRE CLI deploy operations |
| `PINATA_JWT` | `pinatajwt` | Both | Pinata JWT for IPFS pinning |
| `ATTESTATION_PINATA_GROUP` | `attestationpinatagroupid` | Attestation | Optional Pinata group ID for attestation uploads |
| `VERIFICATION_PINATA_GROUP` | `verificationpinatagroupid` | Verification | Optional Pinata group ID for verification uploads |
| `VLAYER_AUTH_TOKEN` | `vlayerauthtoken` | Both | Vlayer API authentication token |
| `ATTESTER_PRIVATE_KEY` | `attesterprivatekey` | Attestation | Key for signing SAVE attestation documents |
| `VERIFIER_PRIVATE_KEY` | `verifierprivatekey` | Verification | Key for signing SAVE verification documents |
| `IPFS_PASSWORD` | `ipfspassword` | Both | IPFS Kubo RPC Basic Auth password — only needed for Kubo deployments. Removed from default `secrets.yaml` (Pinata-only). Add back if using Kubo. |

### Creating CRE secrets

Secrets must be created in the Vault DON before the workflow can `getSecret()` them. This is a separate step from `cre workflow deploy`.

```bash
# from cre/ directory
cre secrets create secrets.yaml -e .env.dev   # first time
cre secrets update secrets.yaml -e .env.dev   # update existing values
cre secrets list -e .env.dev                  # verify
```

Use [`./check-secrets.sh .env.dev`](./cre/check-secrets.sh) to validate all required values are set before running `cre secrets create` (it fails loudly otherwise on empty fields).

---

## Config

Each workflow has a JSON config file per environment. Key fields:

- `attester.publicKey` / `verifier.publicKey` — full ECDSA public key (65 bytes, `0x04...`) of the signing wallet
- `tokenRegistry` — URL of the public token registry JSON (recommended)
- `tokens` — inline token map (fallback / override)

### Token registry (dynamic, no re-deploy)

Tokens are defined in [`tokens.json`](./tokens.json) at the repo root. The workflow fetches it at every trigger via the configured `tokenRegistry.url` (DON consensus on the response).

```json
"tokenRegistry": {
  "url": "https://raw.githubusercontent.com/midas-apps/midas-por-v2/main/tokens.json",
  "fallbackUrl": "https://cdn.jsdelivr.net/gh/midas-apps/midas-por-v2@main/tokens.json"
}
```

**To add a new token**: open a PR updating `tokens.json`. Once merged on `main`, the next workflow run picks it up. **No re-deploy needed, `workflow_hash` stays stable.**

Branch protection + required PR reviews on `tokens.json` provides multi-sig-like governance for the registry.

If the remote fetch fails (network / CDN outage), the workflow falls back to the inline `tokens` map declared in the config.

### Token config fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Token name (used in filenames and logs) |
| `oneTokenApi.tokenName` | Yes | Token name as used in the 1token API |
| `oneTokenApi.useNavBase` | No | Use `pv_base.total` (base currency) instead of `equity.total × 1e6` (USD) |
| `fundManager` | No | Vlayer TLS email config — enables offchain NAV verification |
| `fundManager.navFields` | If fundManager | Array of email line labels to sum (e.g. `["Total Notional Amount", "Net Accrued Interest"]`) |
| `fundManager.navIsTotal` | If fundManager | `false` = additive (email = OTC portion, used alongside 1token). `true` = email is total NAV (cross-check against 1token) |
| `supplyToken` | No | On-chain token address for `onchain_supply` claim |
| `pendingRedemptionSource.oneTokenWalletPattern` | No | Case-insensitive substring matched against 1token `nav_by_wallet` keys to sum pending redemption |
| `pendingRedemptionSource.emailFields` | No | Email line labels summed for pending redemption from the vlayer fund-manager email |
| `anchorRule.source` | No | `vlayer_email_date` or `ops_created_at`. Default: `vlayer_email_date` if token has `fundManager`, else `ops_created_at` |
| `anchorRule.offsetHours` | No | Signed integer hours offset applied to the anchor source for the 1token snapshot timestamp. Default: `+1` for vlayer email, `-3` for ops |

---

## Attester public key

Attestations are signed by the attester wallet. The public key is embedded in each attestation along with a `publicKeySource` URL pointing to:

```
https://midas.app/public/attestation-engine/pubkeys.json
```

This file should list the attester public key so that anyone can independently verify attestation signatures without contacting Midas.

---

## SaveCreReceiverProxy

The Chainlink DON cannot write directly to the registry. It calls `onReport()` on a `SaveCreReceiverProxy`, which decodes the report and forwards it to the registry as `setAttestation` or `setVerification`.

**Each party running a workflow must deploy their own proxy instance** and have it authorized on the registry for the relevant proofId.

| Who | Workflow | Registry authorization needed |
|---|---|---|
| Midas | Attestation | `setAttestor(proofId, proxyAddress)` |
| Any verifier (Midas, LlamaRisk, auditor…) | Verification | `authorizeVerifiers(proofId, [proxyAddress])` |

To run the verification workflow independently:
1. Deploy your own `SaveCreReceiverProxy` (source: `@save/core/contracts/src/save-cre-receiver-proxy/SaveCreReceiverProxy.sol`)
2. Contact Midas to authorize your proxy address on the registry for the proofIds you want to verify
3. Set `verifierProxy.address` in your config to your proxy address

Constructor parameters:

| Parameter | Value |
|---|---|
| `_registry` | `0x2D6e9F608807436DE5D9603B00Abe3FEd1Bc809d` (mainnet) |
| `_workflowId` | `bytes32(0)` |
| `_expectedForwarder` | `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885` (mainnet KeystoneForwarder) |
| `_expectedAuthor` | Your CRE workflow deployer address |
| `_expectedWorkflowName` (attestation) | `sha256("midas_por_attestation_prod")[0:5 bytes]` as bytes10 |
| `_expectedWorkflowName` (verification) | `sha256("midas_por_verification_prod")[0:5 bytes]` as bytes10 |
| `_isReportWriteSecured` | `true` (recommended for production) |
| `_initialOwner` | Your admin address |

---

## Registry

| Network | Address |
|---|---|
| Mainnet | [`0x2D6e9F608807436DE5D9603B00Abe3FEd1Bc809d`](https://etherscan.io/address/0x2D6e9F608807436DE5D9603B00Abe3FEd1Bc809d) |
| Sepolia | [`0x4AbE1936AEc4aAC8177eC65e437A1f8726Bc7F10`](https://sepolia.etherscan.io/address/0x4AbE1936AEc4aAC8177eC65e437A1f8726Bc7F10) |

---

## Reading on-chain data

All IPFS content (ops claims, attestations, verifications) is stored as gzip-compressed JSON. To read it from a bytes32 hash:

```javascript
// 1. Convert bytes32 → IPFS CID
function bytes32ToCid(bytes32) {
  const hex = bytes32.replace('0x', '')
  const multihash = '1220' + hex
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let num = BigInt('0x' + multihash)
  let result = ''
  while (num > 0n) { result = ALPHABET[Number(num % 58n)] + result; num = num / 58n }
  return result
}

// 2. Fetch + decompress (browser)
async function fetchFromIpfs(cid) {
  const res = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`)
  const ds = new DecompressionStream('gzip')
  const decompressed = res.body.pipeThrough(ds)
  return JSON.parse(await new Response(decompressed).text())
}
```
