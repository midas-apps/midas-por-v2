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

const fundManagerConfigSchema = z
	.object({
		expectedEmail: z.string(),
		requiredReceiverEmail: z.string(),
		allowedReceiverEmails: z.array(z.string()).default([]),
		tokenName: z.string(),
		navFields: z.array(z.string()).min(1),
		navIsTotal: z.boolean().default(false),
	})
	.refine((d) => emailRegex.test(d.expectedEmail) || domainRegex.test(d.expectedEmail), {
		message: 'Invalid sender email (must be a full email or a domain like @fasanara.com)',
		path: ['expectedEmail'],
	})
	.refine((d) => emailRegex.test(d.requiredReceiverEmail), {
		message: 'Invalid required receiver email',
		path: ['requiredReceiverEmail'],
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

const tokenConfigSchema = z.object({
	name: z.string(),
	address: z.string().optional(),  // token contract address (used by external supply endpoint)
	// Primary chain the token lives on (chain selector name from cre-sdk). Defaults to
	// ethereum-mainnet when absent. Override for tokens on other chains (e.g. Base:
	// "ethereum-mainnet-base-1"). Passed to the Midas supply endpoint and any on-chain
	// read related to this token contract.
	chainSelectorName: z.string().default('ethereum-mainnet'),
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
