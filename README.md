# Midas PoR - CRE Workflows

Chainlink CRE workflows for the SAVE Proof of Reserves framework. Implements NAV-based overcollateralization attestation and verification for Midas tokens.

## Workflows

### Attestation (`cre/por_attestation/`)

Listens for `NewClaim` events (ops claim type) on the SaveRegistryWithClaim contract. Fetches the ops claim from IPFS, reads on-chain oracle price, optionally verifies the fund manager email via Vlayer TLS Notary (offchain data, CEX positions), runs the overcollateralization check, builds a signed SAVE attestation, and pushes it on-chain.

**Flow:**
`NewClaim` event → Fetch ops claim from IPFS → Read oracle price (Chainlink) → [Vlayer TLS verification] → Fetch 1token report → Overcollateralization check → Build & sign attestation → Upload to IPFS → `setAttestation` on-chain

### Verification (`cre/por_verification/`)

Listens for `AttestationSet` events. Fetches the attestation from IPFS, verifies all claims using the SAVE framework (`@save/core`), re-verifies Vlayer TLS proofs for tokens with a vlayer claim, and pushes the verification result on-chain.

**Flow:**
`AttestationSet` event → Fetch attestation from IPFS → Verify claims (SAVE) → [Vlayer re-verification] → Upload verification → `setVerification` on-chain

---

## Supported Tokens

| Token | Chain | proofId | vlayer claim (offchain data, CEX) |
|---|---|---|---|
| mFONE | ethereum-mainnet | `0x9701c16c2aa2589b3fef161e3d13f4b38a9e0c8ad4b827bff12cf65a6a3ef234` | Yes - Fasanara |
| mHyperBTC | ethereum-mainnet | `0xf77ebd862996bb55a1c85ab27e4c554e0e77f691d74e8b63bf4849007db4cbc9` | No |
| mHYPER | ethereum-mainnet | `0xac9a528065afb4290ab62fb0ee1a9110d48ed834454d2d04ab369b4832bbda7a` | No - 1token tracks Hyperithm CEX positions directly |
| mGLOBAL | ethereum-mainnet | `0x5f683091c2cfe327b5ea0efc5588908d6873b0675d43b6ba78da908b87f05121` | Yes - JTC |
| mWIN | ethereum-mainnet | `0xbe8475503cd12f05ff022cc2d2525157086e3d603f4429c6bbc524b676d109fb` | Yes - Northern Trust |
| mM1-USD | ethereum-mainnet | `0x841873ae10361a9ba4491910af9a3794603a7d543889cec3e007571f495a0a23` | Yes - M1 Capital |
| mTBILL | ethereum-mainnet | `0xf65e876f459439e78365c92eb3d47ff358d41b7bec69c9ffb9e624010fb47805` | No |
| mGLO | ethereum-mainnet-base-1 | `0x31d6a336f57a665c1010b680ca88509ba3184edb8425c4e20789cf0697af5dee` | Yes - JTC |
| mAPOLLO | ethereum-testnet-sepolia | `0x1b9375422132ca573ec8343d9828d51ad384bfe3ccb803b61afac74fb3c629be` | No (testnet) |

proofIds are computed as `sha256(proofName)` where `proofName` is the lowercase canonical form (e.g. `mfone-por`, `mhyperbtc-por`, `mm1-usd-por`) - SHA-256, not keccak256.

---

## Attestation Claims

All `cre_consensus` claims are produced by the Chainlink DON and trusted as-is by verifiers.

| Claim ID | Type | Description |
|---|---|---|
| `ops_claim` | object / cre_consensus | Ops team data: token, NAV, supply, oracle address |
| `oracle_price` | object / cre_consensus | Chainlink oracle price (`priceRaw`, `oracleLastUpdatedAt`, `oracleLastUpdatedAtISO`) |
| `oracle_price_usd` | numeric / source-backed | Resolved from `oracle_price#/priceRaw` |
| `onetoken_report` | object / cre_consensus | 1token portfolio report (`assets`, `liabilities`, `equity`, optional `navBase`, optional `pendingRedemptionMillionsUSD`). `_metadata.anchorRule` is `vlayer_email_date_plus_1h` (token with fund-manager email) or `ops_created_at_minus_3h` (token without). `_metadata.anchorISO` is the resolved ISO timestamp used for the 1token snapshot query - verifiers can re-fetch the exact same snapshot |
| `onetoken_total_nav` | numeric / source-backed | Resolved from `onetoken_report#/equity/total` |
| `onchain_supply` | object / cre_consensus | ERC-20 `totalSupply()` at attestation time + `readAt` timestamp |
| `overcollateralization` | object / cre_consensus | Overcollateralization verification result. Formula: `ratio = totalReserveNetUSD / (supplyTokensNet × oraclePriceUSD)`; passes when `ratio > threshold` (default `0.995`). **Frontend-facing fields:** `totalReserveGrossUSD` (reserve including pending redemption commitment, for display), `totalReserveNetUSD` (reserve used in the ratio), `supplyTokensNet` (supply used in the ratio), `oraclePriceFormatted`, `ratio`, `passed`, `threshold`, `overcollateralizationType` (opaque label - internal audit only). **Breakdown fields (optional, present when the underlying source is available):** `oneTokenOnchainAUM`, `fundManagerNavUSD`, `onchainReserveWalletsUSD` (sum of USDC + priced-token balances added to reserve via balanceOf at attestation time), `supplyExclusionsOnchainTokens` (sum of primary-token balances subtracted from raw supply via balanceOf), `pendingRedemptionUSD`, `navPerToken`, `totalSupplyCrossChainReportedByOps`, `totalSupplyTokens`. **Legacy aliases (kept for backward compat):** `totalReserveUSD` (=`totalReserveNetUSD`), `supplyTokens` (=`supplyTokensNet`), `oneTokenAUM` (=`totalReserveNetUSD`). |
| `overcollateralization_ratio` | numeric / source-backed | Resolved from `overcollateralization#/ratio` |
| `fund_manager_claim` | object / tls_notary | Vlayer TLS proof of fund manager email (tokens with a vlayer claim only) |
| `email_nav` | object / cre_consensus | Extracted NAV from email: `{ navUSD, navIsTotal, navFields }`. `navIsTotal=false` = additive fund-manager-reported portion (CEX, OTC, fund shares - whatever surfaced in the email); `navIsTotal=true` = full NAV cross-check. `navFields` lists the email line labels that were summed - verifiers can re-extract the same value from the vlayer email proof |
| `fund_manager_total_nav` | numeric / source-backed | Resolved from `email_nav#/navUSD` (id preserved for backward compatibility) |
| `fund_manager_email_sender_verification` | string / source-backed | Email sender verification (tokens with a vlayer claim only) |
| `fund_manager_email_receiver_verification` | string / source-backed | Email receiver verification (tokens with a vlayer claim only) |

### Overcollateralization formula

The formula is the same across every product; only the composition of `totalReserveNetUSD` and `supplyTokensNet` varies by token config.

```
ratio  =  totalReserveNetUSD  /  (supplyTokensNet × oraclePriceUSD)
passed =  ratio > threshold        (default threshold = 0.995)
```

Per-token composition (external check when data is available):

- **mFONE** - Reserve = `1token_equity_total + vlayer_email_nav + Σ USDC(reserveOnchainWallets.usdcWallets)`; Supply = `midas_endpoint_supply − pending_tokens_from_email − Σ balanceOf(supplyExclusionWallets)`. `vlayer_email_nav = Total Notional Amount + Net Accrued Interest`.
- **mGLOBAL, mGLO** - Reserve = `1token_equity_total + vlayer_email_nav`; Supply = `midas_endpoint_supply − pending_tokens`. `vlayer_email_nav = Fund Value + Pending Subscription` (Pending Subscription tokens are already minted; cash-in-transit is counted as a receivable to keep the ratio consistent with circulating supply). `pending_tokens` is derived from `Pending Redemption`.
- **mM1-USD** - Reserve = `vlayer_email_nav` (navIsTotal=true → 1token used as cross-check only); Supply = `midas_endpoint_supply − pending_tokens`.
- **mWIN** - Reserve = `1token_equity_total + vlayer_email_nav` (Northern Trust email); Supply = `midas_endpoint_supply − pending_tokens`.
- **mHyperBTC** - Reserve = `1token_navBase × oraclePriceUSD`; Supply = `midas_endpoint_supply − pending_tokens`.
- **mHYPER, mTBILL** - Reserve = `1token_equity_total × 1e6`; Supply = `midas_endpoint_supply − pending_tokens`.

Where `pending_tokens = pendingRedemptionUSD / oraclePriceUSD` and `pendingRedemptionUSD` is the sum of the `pendingRedemptionSource` (1token wallet pattern + vlayer email fields).

---

## Verifying an attestation

Attestations are designed to be **independently auditable end-to-end** - nothing in the trust chain requires our infrastructure. Two paths:

### Path A - deploy the SAVE verifier workflow

Run the CRE verifier in your own DON or on a self-hosted node. It automates the full check: fetches the attestation from IPFS, verifies every claim via `@save/core`, re-runs the vlayer TLS proofs against the vlayer API, then writes the verification result back on-chain.

See [Deploy](#deploy) below to run your own instance. Requires: a `SaveCreReceiverProxy` deployed in your name and authorized on the registry for the proofIds you want to verify (see [SaveCreReceiverProxy](#savecrereceiverproxy)).

### Path B - verify manually, no CRE dependency

Everything you need is public. Steps for a given attestation hash (bytes32 on-chain):

**1. Fetch the attestation from IPFS**

```javascript
// bytes32 → CIDv0 → gzip JSON
const cid = bytes32ToCid(attestationHash)             // helper below
const gz  = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`)
const attestation = JSON.parse(await new Response(gz.body.pipeThrough(new DecompressionStream('gzip'))).text())
```

**2. Verify the attester signature**

The attestation is signed by the attester wallet. Recover the signer from `attestation.signature` over the canonical JSON of `attestation.metadata + attestation.claims` (using `@save/core`'s `canonicalizeAttestationForSigning`), then check it matches the attester public key published at `https://midas.app/public/attestation-engine/pubkeys.json`.

**3. Verify each claim by type**

| Claim mechanism | How to verify without CRE |
|---|---|
| `signature` | Recover signer from `proof.signature` and check against `proof.signerPublicKey`. |
| `source_backed` | Follow `dataPointer` (e.g. `overcollateralization#/ratio`) inside the attestation; the resolved value must equal the numeric/string claim. |
| `zk_tls_notary` (vlayer) | POST `proof.proof` (only `{data, version, meta: {notaryUrl}}`) to `proof.verificationEndpoint` with an `Authorization: Bearer <VLAYER_API_KEY>` header. Compare vlayer's returned `data` against `claim.data` after stripping the legacy `success` key from `expectedData`. Vlayer keys are free to obtain from vlayer directly. |
| `cre_consensus` | Trust-on-DON: the value was aggregated by the Chainlink DON via identical-consensus. To double-check without the DON, re-fetch the underlying source at the timestamp/block referenced in the claim (see next section). |

**4. Re-derive each `cre_consensus` value from its source**

Every DON-produced value has a documented source; anyone can reproduce it independently.

| Claim | Reproduction |
|---|---|
| `oracle_price` | `AggregatorV3Interface(oracle_price#/oracleAddress).latestRoundData()` at the block whose timestamp matches `oracleLastUpdatedAt`. |
| `onetoken_report` | Query `https://api-prod.midas.app/api/transparency/by-timestamp?asset=<name>&ts=<_metadata.anchorISO>` - the response `reports` field must be byte-identical to `onetoken_report#/`. |
| `onchain_supply` | `IERC20(tokenAddress).totalSupply()` at the block whose timestamp matches `readAt`. |
| `overcollateralization` | Recompute using the formula in [Overcollateralization formula](#overcollateralization-formula) and the token's `oneTokenApi.offchainEquityKeys`, `supplyExclusionWallets`, `reserveOnchainWallets`, `pendingRedemptionSource` from the [token registry](https://raw.githubusercontent.com/midas-apps/midas-por-v2/main/tokens.json). |

**5. Re-derive on-chain balance queries**

For tokens using `supplyExclusionWallets` or `reserveOnchainWallets`, the workflow calls `balanceOf(token, wallet)` at the attestation block. To reproduce:

```bash
# Get the block number from the tx that emitted setAttestation
BLOCK=<block-of-setAttestation-tx>

# Balance of the primary token at an excluded wallet
cast call <TOKEN_ADDRESS> "balanceOf(address)(uint256)" <WALLET> \
  --block $BLOCK --rpc-url <ETH_RPC>

# Sum should match `supplyExclusionsOnchainTokens` (scaled by 1e18)
```

Same pattern for `reserveOnchainWallets.usdcWallets` (USDC has 6 decimals) and `reserveOnchainWallets.otherTokens` (multiply by the Chainlink oracle price at the same block for the USD contribution).

**6. Verify vlayer TLS-notarised claims (fund_manager_claim, fund_inflight_claim)**

Each vlayer claim is a full TLS Notary presentation of a specific HTTPS session (Gmail API fetch of a fund-manager email). Anyone can re-verify by POSTing the proof back to vlayer:

```bash
# Extract the presentation and POST it to vlayer /verify
curl -sX POST https://web-prover.production.vlayer.xyz/api/v2.0/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VLAYER_API_KEY" \
  -d "$(jq '{data: .proof.proof.data, version: .proof.proof.version, meta: {notaryUrl: .proof.proof.meta.notaryUrl}}' fund_manager_claim.json)"
# Response `data` (post-strip of legacy `success` key) must deep-equal fund_manager_claim.data
```

### CIDv0 helper (for step 1)

```javascript
function bytes32ToCid(bytes32) {
  const hex = bytes32.replace('0x', '')
  const multihash = '1220' + hex
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let num = BigInt('0x' + multihash), result = ''
  while (num > 0n) { result = ALPHABET[Number(num % 58n)] + result; num = num / 58n }
  return result
}
```

Public IPFS gateways that serve our pinned attestations:
- `https://gateway.pinata.cloud/ipfs/<CID>`
- `https://ipfs.io/ipfs/<CID>`
- `https://cloudflare-ipfs.com/ipfs/<CID>`

---

## Prerequisites

- [Chainlink CRE CLI](https://docs.chain.link/cre)
- Node.js 22+ with [Corepack](https://nodejs.org/api/corepack.html) (enables yarn@4.13.0)
- An Ethereum RPC endpoint (mainnet for both targets; Sepolia for dev target)
- Pinata account for IPFS pinning
- Vlayer API access for tokens with a vlayer claim (`auth_token`)
- Your attester/verifier address must be authorized on the registry for each proofId
- A `SaveCreReceiverProxy` deployed and configured - **each party running a workflow needs their own instance** (see below)

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

Prod config files (`*.prod.json`) are gitignored - create them locally from the dev configs and fill in mainnet addresses.

---

## Deploy

From the `cre/` directory.

Three environments:
- `dev` - Sepolia trigger, Sepolia write (full testnet)
- `test` - Mainnet trigger, Sepolia write (real-data dry-run)
- `prod` - Mainnet trigger, Mainnet write

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

Adding a token or updating any per-token field (navFields, `supplyExclusionWallets`, `reserveOnchainWallets`, `pendingRedemptionSource`, `anchorRule`, etc.) does **not** require re-deploy - the workflow fetches the registry at every trigger. See [Token registry](#token-registry-dynamic-no-re-deploy) above.

Redeploy is required only for changes to workflow **code** (Zod schema additions, new claim types, new on-chain query logic) or top-level config (threshold, RPC endpoints, trigger addresses). Use `--wasm ./por_attestation/binary.wasm.br.b64` to skip recompilation:

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
| `CRE_ETH_PRIVATE_KEY` | - | CLI only | Ethereum key for CRE CLI deploy operations |
| `PINATA_JWT` | `pinatajwt` | Both | Pinata JWT for IPFS pinning |
| `ATTESTATION_PINATA_GROUP` | `attestationpinatagroupid` | Attestation | Optional Pinata group ID for attestation uploads |
| `VERIFICATION_PINATA_GROUP` | `verificationpinatagroupid` | Verification | Optional Pinata group ID for verification uploads |
| `VLAYER_AUTH_TOKEN` | `vlayerauthtoken` | Both | Vlayer v1 API token (legacy - kept while older deployed workflows still call v1) |
| `VLAYER_AUTH_TOKEN_V2` | `vlayerauthtokenv2` | Both | Vlayer v2 API key (used by current attester / verifier code) |
| `ATTESTER_PRIVATE_KEY` | `attesterprivatekey` | Attestation | Key for signing SAVE attestation documents |
| `VERIFIER_PRIVATE_KEY` | `verifierprivatekey` | Verification | Key for signing SAVE verification documents |
| `IPFS_PASSWORD` | `ipfspassword` | Both | IPFS Kubo RPC Basic Auth password - only needed for Kubo deployments. Removed from default `secrets.yaml` (Pinata-only). Add back if using Kubo. |

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

- `attester.publicKey` / `verifier.publicKey` - full ECDSA public key (65 bytes, `0x04...`) of the signing wallet
- `tokenRegistry` - URL of the public token registry JSON (source of truth)
- `tokens` - inline token map (fallback only, used when the registry fetch fails)

### Token registry (dynamic, no re-deploy)

Tokens are defined in [`tokens.json`](./tokens.json) at the repo root. The workflow fetches it at every trigger via the configured `tokenRegistry.url` (DON consensus on the response).

```json
"tokenRegistry": {
  "url": "https://raw.githubusercontent.com/midas-apps/midas-por-v2/main/tokens.json",
  "fallbackUrl": "https://cdn.jsdelivr.net/gh/midas-apps/midas-por-v2@main/tokens.json"
}
```

**Merge precedence**: the registry is the source of truth. When both are set, values fetched from the registry override the inline `tokens` map for the same `proofId`. Inline entries are only used for tokens the registry doesn't return (or if the fetch fails entirely).

**To add a new token or change any per-token field** (navFields, wallets, redemption source, anchor…): open a PR updating `tokens.json`. Once merged on `main`, the next workflow run picks it up. **No re-deploy needed, `workflow_hash` stays stable.**

Branch protection + required PR reviews on `tokens.json` provides multi-sig-like governance for the registry.

If the remote fetch fails (network / CDN outage), the workflow falls back to the inline `tokens` map declared in the config.

### Token config fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Token name (used in filenames and logs) |
| `address` | No | Primary ERC-20 token contract address (used for `balanceOf` queries and the Midas supply endpoint) |
| `chainSelectorName` | No | Chainlink chain selector name for the primary chain the token lives on. Default: `ethereum-mainnet` |
| `oneTokenApi.tokenName` | Yes (if 1token) | Token name as used in the 1token API |
| `oneTokenApi.useNavBase` | No | Use 1token `navBase` (fund base currency, e.g. BTC) × oracle price instead of `equity.total × 1e6`. Default `false` |
| `oneTokenApi.offchainEquityKeys` | No | Sub-keys of `assets_by_protocol.equity` to subtract from `equity.total` to isolate the strictly on-chain AUM (defence against 1token schema drift where an off-chain synthetic entry leaks into equity). Default `["general_wallet"]` - no-op with the current 1token schema (`general_wallet` is not in `equity`); kept as a safe guard against regressions |
| `oneTokenApi.timestampOffsetHoursBack` | No | Hours-back list to try when fetching the 1token snapshot. Default `[0, 1, 2, 3, 4]` - resilient to the endpoint's occasional 2-3h publication lag |
| `fundManager` | No | Vlayer TLS-notarised email config - enables the fund-manager NAV vlayer claim |
| `fundManager.navFields` | If fundManager | Array of email line labels to **sum** (e.g. `["Total Notional Amount", "Net Accrued Interest"]`) |
| `fundManager.navIsTotal` | If fundManager | `false` = additive (email = a portion, summed with 1token equity). `true` = email is the total fund NAV (cross-check only, not summed with 1token) |
| `fundInflight` | No | Second vlayer TLS-notarised email (in-flight investment / redemption flows). Parallel structure to `fundManager` but with `fields: { <key>: "<email label>" }` (per-key extraction rather than summed). When present, ops includes `vlayerInflightHash` in `ops_claim` and the workflow verifies the second proof |
| `supplyToken` | No | On-chain token address for the `onchain_supply` claim (defaults derived from `address` if unset) |
| `pendingRedemptionSource.oneTokenWalletPattern` | No | Case-insensitive substring matched against 1token `nav_by_wallet` keys to sum pending redemption |
| `pendingRedemptionSource.emailFields` | No | Email line labels summed for pending redemption from the vlayer fund-manager email |
| `supplyExclusionWallets` | No | List of addresses whose primary-token `balanceOf` is subtracted from `midas_endpoint_supply` to obtain the circulating supply used in the ratio (redemption vault, LP with pending burn, non-circulating team wallets) |
| `reserveOnchainWallets.usdcWallets` | No | List of addresses; USDC `balanceOf` at each is summed and added to the external gross reserve (Settlement Funds in Process, Fee Recipient, etc.) |
| `reserveOnchainWallets.usdcAddress` | No | USDC contract address. Default: mainnet USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| `reserveOnchainWallets.otherTokens` | No | Array of `{ wallet, token, priceOracle, priceDecimals?, label? }` - each entry contributes `balanceOf × oraclePrice` (in USD) to the reserve. Used e.g. for mTBILL holdings priced via Chainlink |
| `anchorRule.source` | No | `vlayer_email_date` or `ops_created_at`. Default: `vlayer_email_date` if token has `fundManager`, else `ops_created_at` |
| `anchorRule.offsetHours` | No | Signed integer hours offset applied to the anchor source for the 1token snapshot timestamp. Default: `+1` for vlayer email, `-3` for ops |
| `opsNavIsNetOfPending` | No | `true` if ops's `navReportedByOps` already excludes pending redemption (e.g. mFONE, mGLOBAL). Controls whether the deviation check subtracts pending from ops's NAV to stay apples-to-apples with the external net |

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
