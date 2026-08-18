# Midas Attestation Engine : Token Onboarding Runbook

Everything needed to bring every Midas mToken into the PoR attestation engine. Copy-paste operational.

## How it works (30 sec)

- **SAVE registry** (on-chain contract): holds proofs, claims, attestations, verifications per token.
- **Ops** push a signed `ops_claim` (NAV, supply, oracle) each price-update cycle.
- **Attester** (CRE workflow) reads the ops claim, cross-checks reserves, and writes a signed attestation on-chain + to IPFS.
- **Verifier** (CRE workflow) independently re-checks the attestation.
- **Reserve sources**:
  - **On-chain / CEX** tokens: reserve read from **1token** (`equityOnchain`).
  - **Off-chain fund** tokens: reserve read from a **vlayer-notarized fund-manager email**, added on top of the 1token on-chain part.

Registry (mainnet): `0x2D6e9F608807436DE5D9603B00Abe3FEd1Bc809d` (owner/ops `0x8003544D32eE074aA8A1fb72129Fa8Ef7fe02E5f`)
Registry (sepolia): `0x4AbE1936AEc4aAC8177eC65e437A1f8726Bc7F10`
Attester/verifier (mainnet): `0x230f0b2e321d0E32eA50696710a98Ca84503A391`
Config format: `0` · Claim type: `midas-ops-claim`
proofId = `sha256(lowercase-alnum(token) + "-por")` : e.g. `printf 'mtbill-por' | shasum -a 256`
Token registry served to the workflow: `https://cdn.jsdelivr.net/gh/midas-apps/midas-por-v2@main/tokens.json`

## Token inventory

**Off-chain (vlayer fund manager)** : reserve proven from the fund admin email. Needs `fundManager` config + the fund to send a notarized email to `midas@vlayer.xyz`.

| Token | Fund manager | expectedEmail | proofId |
|---|---|---|---|
| mFONE | Fasanara | `@fasanara.com` | `0x9701c16c2aa2589b3fef161e3d13f4b38a9e0c8ad4b827bff12cf65a6a3ef234` |
| mGLOBAL | JTC | `@jtcgroup.com` | `0x5f683091c2cfe327b5ea0efc5588908d6873b0675d43b6ba78da908b87f05121` |
| mGLO | JTC | `@jtcgroup.com` | `0x31d6a336f57a665c1010b680ca88509ba3184edb8425c4e20789cf0697af5dee` |
| mM1-USD | M1 Capital | `@m1-capital.com` | `0x841873ae10361a9ba4491910af9a3794603a7d543889cec3e007571f495a0a23` |
| mRe7YIELD | Re7 | `@?` (TODO) | `0xdcf290c7e95e3b8b9c2ec6e17ac08edd9067ee6bf3223830d4f0982db5c819a9` |
| mRe7BTC | Re7 | `@?` (TODO) | `0xd065c6b9167f9a8bd8dab081cd79fdbe44835ef3291ab4a4bcd4d936dea57efd` |
| mWIN | Northern Trust | `@ntrs.com` (confirm) | `0xbe8475503cd12f05ff022cc2d2525157086e3d603f4429c6bbc524b676d109fb` |

**On-chain / CEX (1token)** : reserve from 1token.

| Token | proofId | in 1token? |
|---|---|---|
| mTBILL | `0xf65e876f459439e78365c92eb3d47ff358d41b7bec69c9ffb9e624010fb47805` | yes |
| mBASIS | `0xed5f715b073f7ebc8b3a207ff4614ffb5fa710ef0a23c6e00fa7fe30ec279d5d` | yes |
| mBTC | `0xea21b1646fee2bfc28d60968f8b1b7f9e590bc3e33ecd9f5521802190ed57b24` | yes |
| mEDGE | `0xb1b49742a34a257c0102062f37c5d8c4c4407d79e20569397fcdb10f9a5b4db1` | yes |
| mMEV | `0x80fa1d9dc99a17c76cb751d1dc2b2efa6ea4c8519f3ceca44679384ccf11cbe8` | yes |
| mSL | `0x13f8f649fe25fa70b6b9e6ec312b1ea75979d6e8b6bd045641fffe18f4dbf433` | yes |
| mHYPER | `0xac9a528065afb4290ab62fb0ee1a9110d48ed834454d2d04ab369b4832bbda7a` | yes |
| mHyperBTC | `0xf77ebd862996bb55a1c85ab27e4c554e0e77f691d74e8b63bf4849007db4cbc9` | **add** |
| mHyperETH | `0x5e423e797f2738750166cbffcf53bb6ebd2acac0df7f6a8327fe3f5dbe03a2f5` | **add** |
| mM1BTC | `0xbca3e665154352e2431b54e70c1a72cde5e82cce667910125fead51e3afcf746` | **add** |
| mEVUSD | `0x0a5518e20d481330631d2d8216321aacc2817913b313e3841bb689d172f69816` | **add** |
| mEVETH | `0x70fb1ba617f06c0661d6636adeb75adc23c208f39d921b913280281ad5618160` | **add** |
| mFARM | `0x55a5cc16cbe18af63ab9a18a84b13e9241e6ec5d860b042118a8f6976aa1464f` | **add** |
| mKRalpha | `0xd61a6e1ac3f9ce5749f83158f76bd7eaff40e3af9265176b47655ce24088c1a1` | **add** |
| mLIQUIDITY | `0xa10947ff66473070ca7dda1a102f90765d96faacad3d2b826b409336841f1493` | yes (`mLIQUID`?) |
| mPortofino | `0x18f74cc4a3e8de18959105071d2fd5852a73d78b80abe225a10843c55f7f8867` | **add** |
| mROX | `0xb3f48598510546cee92f5a9e0acacd7ff7a7442b7042ca3ec1d507984e67ec70` | **add** |
| mTU | `0xc5ec4d68be6473cf3ba635b9904218790bf363d18c962999e166d771f49e3319` | **add** |
| mWildUSD | `0xc39cb7714c5f2463bf1d11a23dad22b15f13340c1bad627b9d3ada0a025010a6` | **add** |
| mXRP | `0xdedcb3fa6587c74717d6b033296dd835590d78ef7d4a2fd8c681509855155dcf` | **add** |
| mRE7SOL | `0x94fd53b911957da10843a999639b3a105e4847813dfc463f48a9c0efcf735c9a` | yes |
| mRe7ETH | `0xdfae167a531afca8ec76917f7dc996eabe3a61a5868f63cceb4a478479e0adce` | yes |
| mAPOLLO (testnet) | `0x1b9375422132ca573ec8343d9828d51ad384bfe3ccb803b61afac74fb3c629be` | yes |

> Off-chain tokens ALSO need a 1token entry (for their on-chain USDC/reserve portion). mRe7YIELD (`mRE7`) and mRe7BTC are already in 1token; mWIN needs adding.
> The 1token "in?" column is based on the enum seen in workflow logs (possibly truncated). **Confirm against the live 1token API before relying on it.**

**To add to 1token** (send to the 1token team): `mHyperBTC, mM1BTC, mEVETH, mKRalpha, mPortofino, mROX, mTU, mWIN`

**Deprecated (Withdraw Funds : do NOT onboard, remove if present):** `mBTC, mFARM, mEVUSD, mHyperETH, mWildUSD, mXRP, mRe7SOL` (plus payment tokens `mevBTC, msyrupUSD, msyrupUSDp` which were never mTokens).

## Onboarding one token: the 6 steps

### Step 0 : prerequisites
- **On-chain token** → confirm it is tracked in 1token (`GET .../transparency/by-timestamp?token=<name>&timestamp=<round hour>` returns data, not `{}`).
- **Off-chain token** → the fund must send a vlayer-notarized email to `midas@vlayer.xyz`; you need the sender **domain** and the exact **NAV line labels** in the email.

### Step 1 : register on the SAVE registry
Use `tools/attestation-console.html` (open in a browser, connect the ops/owner wallet via Fordefi). Onboard tab, pick the token, then run the 4 steps (the status panel shows what's already done):
1. `addProof` (proofName auto, format 0)
2. `authorizeClaimProvider` (ops address, prefilled)
3. `setAttestor` (prefilled `0x230f0b2e…`)
4. `authorizeVerifiers` (prefilled `0x230f0b2e…`)

Or "Run all remaining steps". Each has Simulate (eth_call) + a `cast` fallback.

Owner-only: on mainnet these must be sent from `0x8003544D32eE074aA8A1fb72129Fa8Ef7fe02E5f`.

### Step 2 : add the token to `tokens.json`
Edit `tokens.json` in `midas-por-v2`, keyed by proofId.

**On-chain template:**
```json
"<proofId>": {
  "name": "mBTC",
  "address": "0x<token>",
  "chainSelectorName": "ethereum-mainnet",
  "oracleQuoteFeed": "0x<BASE/USD feed, ONLY if the oracle is not USD-denominated>",
  "oneTokenApi": {
    "tokenName": "mBTC",
    "useNavBase": false,
    "timestampOffsetHoursBack": [0, 1, 2, 3, 4],
    "offchainEquityKeys": ["general_wallet"]
  },
  "pendingRedemptionSource": { "oneTokenWalletPattern": "Redemption_Vault" }
}
```
`useNavBase` stays `false` for every token (the `navBase`/`pv_base` path is deprecated - unreliable for multi-chain tokens). For a **non-USD-denominated oracle** (BTC/ETH/EUR…), add `oracleQuoteFeed` = the `<BASE>/USD` Chainlink feed (e.g. BTC/USD `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c` for mHyperBTC); the workflow then converts both the oracle price and the ops NAV to USD. USD oracles need neither field.

**Off-chain template:**
```json
"<proofId>": {
  "name": "mRe7YIELD",
  "address": "0x<token>",
  "chainSelectorName": "ethereum-mainnet",
  "fundManager": {
    "expectedEmail": "@re7.xyz",
    "requiredReceiverEmail": "midas@vlayer.xyz",
    "allowedReceiverEmails": [],
    "tokenName": "mRe7YIELD",
    "navFields": ["<exact NAV line label(s) from the email>"],
    "navIsTotal": false
  },
  "oneTokenApi": {
    "tokenName": "mRE7",
    "useNavBase": false,
    "timestampOffsetHoursBack": [0, 1, 2, 3, 4],
    "offchainEquityKeys": ["general_wallet"]
  },
  "pendingRedemptionSource": { "emailFields": ["<pending line label>"] },
  "opsNavIsNetOfPending": true,
  "anchorRule": { "source": "ops_created_at", "offsetHours": -1 }
}
```
`navIsTotal: true` if the one email line already IS the full fund NAV; `false` if navFields are summed and ADD to the 1token on-chain part. Add `anchorRule` when the fund emails monthly/biweekly (so 1token is queried around the ops timestamp, not the email date).

### Step 3 : publish + bust the CDN
```bash
# after the tokens.json PR is merged to main:
curl -sS "https://purge.jsdelivr.net/gh/midas-apps/midas-por-v2@main/tokens.json"
curl -sS "https://cdn.jsdelivr.net/gh/midas-apps/midas-por-v2@main/tokens.json" | grep -A2 '"<name>"'
```
No workflow redeploy needed: the attester fetches tokens.json each run.

### Step 4 : push the first ops claim
`tools/attestation-console.html`, Push ops claim tab: fill the fields, paste Pinata JWT, Upload (computes claimHash), then Send addClaim tx.

### Step 5 : trigger the attester + verify
```bash
cd midas-por/cre && cre workflow list -e .env.prod    # get the current attester workflowId
# then, from midas-por/:
export CRE_ETH_PRIVATE_KEY=$(grep '^CRE_ETH_PRIVATE_KEY=' cre/.env.prod | cut -d= -f2 | tr -d '"')
HTTP_TRIGGER_PRIV_KEY="$CRE_ETH_PRIVATE_KEY" node cre_trigger.mjs <workflowId> <proofId> <claimHash>
```
Check the run logs: `1token AUM`, `Email NAV extracted` (off-chain), `Overcollateralization passed`. Then read the attestation:
```bash
cast call 0x2D6e9F608807436DE5D9603B00Abe3FEd1Bc809d \
  "proofIdToLatestAttestation(bytes32)(bytes32,address,uint48)" <proofId> \
  --rpc-url https://ethereum-rpc.publicnode.com
```
CID = `1220 + hash → base58` (or use `tools/read-attestation.html`).

## Per-token checklist

| Token | 1token | addProof | provider | attestor | verifier | tokens.json | 1st claim | attested |
|---|---|---|---|---|---|---|---|---|
| mFONE | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| mGLOBAL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| mGLO | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ☐ | ☐ |
| mM1-USD | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ☐ | ☐ |
| mHYPER | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| mHyperBTC | ☐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| mWIN | ☐ | ✓ | ✓ | ✓ | ✓ | ✓ | ☐ | ☐ |
| mRe7YIELD | ✓ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mRe7BTC | ✓ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mTBILL | ✓ | ☐ | ☐ | ☐ | ☐ | ✓ | ☐ | ☐ |
| mBASIS | ✓ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mBTC | ✓ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mEDGE | ✓ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mMEV | ✓ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mSL | ✓ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mHyperETH | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mM1BTC | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mEVUSD | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mEVETH | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mFARM | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mKRalpha | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mLIQUIDITY | ✓ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mPortofino | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mROX | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mTU | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mWildUSD | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mRE7SOL | ✓ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mRe7ETH | ✓ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| mXRP | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

> The ✓ marks above are a best-effort snapshot: re-run the console status panel per token to get the live truth.

## Suggested sequencing to finish next week

1. **Now** : send the 1token team the "to add" list (13 tokens). This is the long-pole external dependency.
2. **Parallel** : batch-register all on-chain tokens on the registry (console → Run all). No external dependency, can do today.
3. **Config** : add every on-chain token to tokens.json (all `useNavBase: false`; add `oracleQuoteFeed` = `<BASE>/USD` feed for non-USD oracles like BTC/ETH/EUR). Merge + purge.
4. **Off-chain** : chase the Re7 email domain + NAV labels, confirm mWIN (Northern Trust) email cadence. These unblock mRe7YIELD, mRe7BTC, mWIN.
5. **Per token** : first ops claim → trigger → confirm attested. Tick the checklist.

## Open items
- Re7 email domain + NAV line labels (mRe7YIELD, mRe7BTC).
- mWIN vlayer email (Northern Trust) + cadence.
- Confirm the live 1token supported-token list to finalize the "to add" set.
- Token contract addresses + oracle addresses per token (from `midas-apps/contracts` `config/constants/addresses.ts`) for the tokens.json entries.
