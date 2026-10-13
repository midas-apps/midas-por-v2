import { z } from 'zod'
import {
	EVM_CONFIDENCE_LEVELS,
	type EVMConfidenceLevel,
	logTriggerConfigSchema,
	registryConfigSchema,
	ipfsHttpEndpointSchema,
	getNetworkByChainSelector,
} from '../library/config-schemas.js'

export { EVM_CONFIDENCE_LEVELS, type EVMConfidenceLevel, getNetworkByChainSelector }

const vlayerEndpointSchema = z
	.object({ url: z.string(), clientId: z.string() })
	.refine((d) => /^https?:\/\/.+/.test(d.url), { message: 'Invalid URL', path: ['url'] })

const attesterConfigSchema = z
	.object({ publicKey: z.string() })
	.refine((d) => /^0x[a-fA-F0-9]+$/.test(d.publicKey), {
		message: 'Invalid public key format (must be 0x + hex)',
		path: ['publicKey'],
	})

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const domainRegex = /^@[^\s@]+\.[^\s@]+$/  // e.g. @fasanara.com

// Some custodians do not put the NAV in the email body but in an attached tabular
// export (e.g. Northern Trust sends a TSV holdings report). vlayer notarises the
// attachment download as a second TLS session (`attachmentProof`), and the NAV is a
// column to be summed over every data row rather than a labelled line.
//
// `columns` are summed across all rows: for Northern Trust, `A-AST-MV-BSE` is the asset
// market value in base currency, and `A-INC-RCVBL-BSE` the accrued income receivable —
// which of the two (or both) constitutes the NAV is a reporting decision, hence config.
const navAttachmentSchema = z.object({
	// Only tab-separated exports are supported today; declared explicitly so a future
	// CSV/fixed-width variant is an additive change rather than a silent reinterpretation.
	format: z.literal('tsv').default('tsv'),
	columns: z.array(z.string()).min(1),
	// Column holding the valuation date (e.g. `D-VALN-AS-OF`). When set, it is checked
	// against maxEmailStalenessDays exactly like the email `Date` header, so a custodian
	// re-sending an old export cannot pass as current.
	asOfColumn: z.string().optional(),
})

export type NavAttachmentConfig = z.infer<typeof navAttachmentSchema>

const fundManagerConfigSchema = z
	.object({
		expectedEmail: z.string(),
		requiredReceiverEmail: z.string(),
		allowedReceiverEmails: z.array(z.string()).default([]),
		tokenName: z.string(),
		// NAV read from labelled lines in the email body. Optional: tokens whose custodian
		// reports through an attachment use `navAttachment` instead. Exactly one of the two
		// must be present (enforced below).
		navFields: z.array(z.string()).min(1).optional(),
		navAttachment: navAttachmentSchema.optional(),
		// Where the valuation date is printed in the email body, and how it is written.
		//
		// Fund administrators report in arrears: JTC send the 31 July valuation on 22
		// September. Anchoring on the email's `Date` header therefore compares a reserve
		// struck at one moment against a supply read seven weeks later, which understates
		// the ratio by however much the token grew in between. When this is set, the stated
		// valuation date drives both the anchor and the staleness check instead.
		//
		// `format` is explicit because `01/07/2026` reads as 1 July or 7 January depending
		// on the administrator, and guessing would shift the anchor silently.
		valuationDate: z
			.object({
				label: z.string().min(1),
				format: z.enum(['DD/MM/YYYY', 'DD/MM/YY', 'ISO']),
			})
			.optional(),
		navIsTotal: z.boolean().default(false),
		// Bounds how far the report may be from the figures it is compared against. Its exact
		// meaning depends on whether `valuationDate` is set, because the two cases need
		// different questions asked:
		//
		// - WITHOUT `valuationDate`: maximum absolute age of the report, measured from the ops
		//   claim. Suits managers who value and send on the same day (Fasanara). Default 14.
		//
		// - WITH `valuationDate`: maximum delay between the mail landing and the oracle price
		//   being pushed from it. Absolute age is meaningless for a fund that values monthly
		//   and publishes seven weeks later — it is *always* ~54 days behind, by design. What
		//   must be true is that this report is the one backing the current price, which shows
		//   up as the oracle updating shortly after the mail. A week is generous for that.
		//
		// In both cases a breach invalidates the method-1 candidate and the token falls through
		// to method-2:ops, visible in the attestation through `overcollateralizationType`.
		maxEmailStalenessDays: z.number().positive().default(14),
	})
	.refine((d) => emailRegex.test(d.expectedEmail) || domainRegex.test(d.expectedEmail), {
		message: 'Invalid sender email (must be a full email or a domain like @fasanara.com)',
		path: ['expectedEmail'],
	})
	.refine((d) => emailRegex.test(d.requiredReceiverEmail), {
		message: 'Invalid required receiver email',
		path: ['requiredReceiverEmail'],
	})
	// Exactly one NAV source. Neither would silently yield no method-1 candidate; both would
	// leave the precedence ambiguous to anyone reading the registry.
	.refine((d) => (d.navFields != null) !== (d.navAttachment != null), {
		message: 'Provide exactly one of navFields (NAV in the email body) or navAttachment (NAV in a tabular attachment)',
		path: ['navFields'],
	})

// Second vlayer-notarized email (optional, parallel to `fundManager`).
// Purpose: extract non-NAV flow data — pending investments, pending redemptions,
// tokens locked in redemption process — from a separate custodian email.
// `fields` maps a semantic key (e.g. "pendingRedemption") to the exact email
// field label; the workflow reads each value as a USD amount (or token count
// for keys ending in "Tokens").
const fundInflightConfigSchema = z
	.object({
		expectedEmail: z.string(),
		requiredReceiverEmail: z.string(),
		allowedReceiverEmails: z.array(z.string()).default([]),
		tokenName: z.string(),
		// Map of semantic field key -> email field label to extract.
		// Recognized keys (all optional): pendingInvest, pendingRedemption,
		// liquidityRequestedTokens (interpreted as token count, not USD).
		fields: z.record(z.string(), z.string()),
	})
	.refine((d) => emailRegex.test(d.expectedEmail) || domainRegex.test(d.expectedEmail), {
		message: 'Invalid sender email',
		path: ['expectedEmail'],
	})
	.refine((d) => emailRegex.test(d.requiredReceiverEmail), {
		message: 'Invalid required receiver email',
		path: ['requiredReceiverEmail'],
	})

export type FundInflightConfig = z.infer<typeof fundInflightConfigSchema>

const oneTokenApiSchema = z.object({
	tokenName: z.string(),
	useNavBase: z.boolean().default(false),
	// Hours back to try when fetching the 1token snapshot, in priority order.
	// Each entry costs one HTTP call (max budget concern). Workflow stops at the
	// first successful fetch. Default `[0, 1, 2, 3, 4]` tries the exact anchor
	// hour then walks back 1h at a time up to 4h — resilient to the Midas
	// transparency endpoint's occasional 2-3h publication lag.
	timestampOffsetHoursBack: z.array(z.number().int().nonnegative()).default([0, 1, 2, 3, 4]),
	// Sub-keys of `assets_by_protocol.equity` that represent off-chain valuation
	// (synthetic OTC accounts, fund-share placeholders). Their values are
	// subtracted from `equity.total` to obtain the strictly on-chain AUM. The
	// off-chain portion is recovered separately from the vlayer-notarized fund
	// manager email — mixing both would double-count.
	// Default `["general_wallet"]` matches 1token's current label for the
	// synthetic OTC account (Fasanara / M1 / JTC fund shares).
	offchainEquityKeys: z.array(z.string()).default(['general_wallet']),
})

const tokenRegistrySchema = z
	.object({
		url: z.string(),
		fallbackUrl: z.string().optional(),
	})
	.refine((d) => /^https?:\/\/.+/.test(d.url), { message: 'Invalid URL', path: ['url'] })

const ipfsPinataEndpointSchema = z
	.object({ url: z.string() })
	.refine((d) => /^https?:\/\/.+/.test(d.url), { message: 'Invalid URL', path: ['url'] })

const httpTriggerConfigSchema = z
	.object({
		authorizedKeys: z
			.array(z.object({ type: z.literal('KEY_TYPE_ECDSA_EVM'), publicKey: z.string() }))
			.optional(),
	})
	.optional()

/**
 * Per-token configuration — add a new entry here to support a new token.
 * Key is the proofId (bytes32 hex, lowercase): sha256(proofName)
 */
const supplyTokenSchema = z.object({
	address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
	decimals: z.number().default(18),
	chainSelectorName: z.string().default('ethereum-mainnet'),
})
export type SupplyTokenConfig = z.infer<typeof supplyTokenSchema>

// Pending redemption can be composed from one or both sources, summed together.
const pendingRedemptionSourceSchema = z
	.object({
		// 1token wallet pattern (case-insensitive substring on the wallet label).
		oneTokenWalletPattern: z.string().optional(),
		// Email field name(s) to extract from vlayer fund manager email claim.
		emailFields: z.array(z.string()).min(1).optional(),
	})
	.refine(d => d.oneTokenWalletPattern || d.emailFields, {
		message: 'pendingRedemptionSource must specify at least one source',
	})

export type PendingRedemptionSource = z.infer<typeof pendingRedemptionSourceSchema>

// 1token snapshot anchor — explicit per-token rule. If absent, the workflow
// defaults to {source:'vlayer_email_date', offsetHours:1} when the token has
// a fundManager, otherwise {source:'ops_created_at', offsetHours:-3}.
const anchorRuleSchema = z.object({
	source: z.enum(['vlayer_email_date', 'ops_created_at']),
	offsetHours: z.number().int(),
})

export type AnchorRule = z.infer<typeof anchorRuleSchema>

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)

// Wallets whose balance of the primary token is subtracted from raw
// `totalSupply` to obtain the circulating supply used in the ratio check.
// Typical entries: redemption vault, burn queue, LP with pending-burn tokens.
// Any wallet listed is queried on-chain (ERC-20 balanceOf) at attestation time.
const supplyExclusionWalletsSchema = z.array(addressSchema).min(1)

// On-chain reserve additions — wallets holding USDC or other backing assets
// that are part of the fund's collateral but not surfaced by the fund manager
// email or 1token equity endpoint (e.g., Fasanara Settlement Funds in Process
// held in Fordefi vaults). Every wallet listed is queried at attestation time
// with a batched balanceOf call.
const reserveOnchainWalletsSchema = z.object({
	// USDC balances at these wallets are summed and added to the reserve.
	// Assumes USDC on ethereum-mainnet unless the token entry overrides.
	usdcWallets: z.array(addressSchema).default([]),
	// USDC contract address (default: mainnet USDC). Override for other chains.
	usdcAddress: addressSchema.default('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
	// Other on-chain tokens (e.g. mTBILL) — each entry is queried with balanceOf
	// and valued via its Chainlink oracle. `priceDecimals` defaults to 8.
	otherTokens: z
		.array(
			z.object({
				wallet: addressSchema,
				token: addressSchema,
				priceOracle: addressSchema,
				priceDecimals: z.number().int().nonnegative().default(8),
				label: z.string().default(''),
			})
		)
		.default([]),
})

export type ReserveOnchainWallets = z.infer<typeof reserveOnchainWalletsSchema>

// Solana (SPL) token. When present, the workflow reads supply from the SPL `mint`
// (getTokenSupply) and price from the Midas manual `priceFeed` account over `rpcUrl`,
// instead of the EVM oracle + EVM cross-chain supply. Trigger stays on the EVM registry
// (ops push the NewClaim there, referencing the Solana price-update tx).
const solanaConfigSchema = z.object({
	mint: z.string(),
	priceFeed: z.string(),
	rpcUrl: z.string().refine((u) => /^https?:\/\/.+/.test(u), { message: 'Invalid Solana RPC URL' }),
	maxStalenessSec: z.number().int().positive().default(2592000),
})

export type SolanaConfig = z.infer<typeof solanaConfigSchema>

export const tokenConfigSchema = z.object({
	name: z.string(),
	address: z.string().optional(),  // token contract address (used by external supply endpoint)
	// Primary chain the token lives on (chain selector name from cre-sdk). Defaults to
	// ethereum-mainnet when absent. Override for tokens on other chains (e.g. Base:
	// "ethereum-mainnet-base-1"). Passed to the Midas supply endpoint and any on-chain
	// read related to this token contract.
	chainSelectorName: z.string().default('ethereum-mainnet'),
	// Chainlink feed converting the price oracle's quote currency to USD, for tokens whose
	// oracle is NOT USD-denominated (mHyperBTC/BTC → BTC/USD feed, mGLOeuro/EUR → EUR/USD feed).
	// When set, oraclePriceUSD = rawOraclePrice × quoteFeed and the ops NAV (reported in the
	// oracle's native currency) is likewise scaled, so the whole ratio is USD-denominated.
	// Absent → oracle already USD.
	oracleQuoteFeed: z.string().optional(),
	// Solana (SPL) token: read supply + price from Solana instead of the EVM oracle/supply.
	solana: solanaConfigSchema.optional(),
	fundManager: fundManagerConfigSchema.optional(),
	// Second vlayer email (in-flight flows: invest/redeem pending, liquidity
	// requested). When present, ops includes `vlayerInflightHash` in ops_claim
	// and the workflow verifies it and extracts the configured fields.
	fundInflight: fundInflightConfigSchema.optional(),
	oneTokenApi: oneTokenApiSchema.optional(),
	supplyToken: supplyTokenSchema.optional(),
	pendingRedemptionSource: pendingRedemptionSourceSchema.optional(),
	anchorRule: anchorRuleSchema.optional(),
	// true if ops's `navReportedByOps` already excludes pending redemption (e.g. mFONE
	// reports Total assets = Strategy − Redemption Process). false/absent if ops reports
	// gross (e.g. mHyperBTC reports Strategy + Settlement). Controls whether we subtract
	// the pending value from ops's NAV when computing the symmetric deviation against
	// external (1token) net NAV.
	opsNavIsNetOfPending: z.boolean().optional(),
	// Wallets whose primary-token balance is excluded from the raw totalSupply
	// (redemption vault, burn queue, etc.). See supplyExclusionWalletsSchema.
	supplyExclusionWallets: supplyExclusionWalletsSchema.optional(),
	// On-chain USDC + other-token wallets that add to the reserve (Settlement
	// Funds in Process, mTBILL holdings, etc.). See reserveOnchainWalletsSchema.
	reserveOnchainWallets: reserveOnchainWalletsSchema.optional(),
})

export type TokenConfig = z.infer<typeof tokenConfigSchema>

export const configSchema = z
	.object({
		name: z.string(),
		newClaimLogTrigger: logTriggerConfigSchema,
		httpTrigger: httpTriggerConfigSchema,
		attesterProxy: registryConfigSchema,
		ipfsHttpEndpoint: ipfsHttpEndpointSchema,
		ipfsPinataEndpoint: ipfsPinataEndpointSchema.optional(),
		attester: attesterConfigSchema,
		// Claim a reference on our Pinata account to each vlayer proof the workflow fetches.
		// Our dedicated gateway only serves CIDs pinned to us, so third-party proofs come back
		// 403 and we fall onto public gateways that are slow and rate-limited — which has
		// already cost attestations. Pinning makes the dedicated gateway serve the proof from
		// the next run on, and since fund-manager emails are monthly the same CID is reused for
		// weeks. Costs one HTTP call per run and is a no-op once the claim-pushing service pins
		// upstream (see PIN_VLAYER_PROOF_TICKET.md), at which point this can be turned off.
		pinFetchedVlayerProofs: z.boolean().default(false),
		overcollateralizationThreshold: z.number().min(0).max(1).default(0.995),
		oneTokenDeviationThresholdPercent: z.number().min(0).max(100).default(5),
		// Token registry — fetched at runtime from a public URL.
		// To add a new token: open a PR updating the registry file, no workflow re-deploy needed.
		tokenRegistry: tokenRegistrySchema.optional(),
		// Inline token map — keyed by proofId (lowercase bytes32 hex).
		// Used when tokenRegistry is not set, or as override on top of the fetched registry.
		tokens: z.record(z.string(), tokenConfigSchema).default({}),
	})
	.refine((d) => d.name.trim().length > 0, { message: 'Name cannot be empty', path: ['name'] })
	.refine((d) => d.tokenRegistry != null || Object.keys(d.tokens).length > 0, {
		message: 'Either tokenRegistry must be set or at least one inline token must be registered',
		path: ['tokens'],
	})

export type Config = z.infer<typeof configSchema>
