/**
 * Claim creation functions for the Midas NAV PoR attestation workflow
 */

import { ObjectClaim, NumericClaim, StringClaim, createVlayerProof } from '@save/core'
import type { CreConsensusProofData } from '@save/core'
import type { VlayerVerificationResult, OneTokenReportData, OraclePriceData, OnchainSupplyData } from './api.js'

/**
 * Ops claim data pushed by the Midas ops team to IPFS
 */
export interface OpsClaimData {
	token: string
	createdAt: string
	priceUpdateTxHash: string
	priceUpdateChainId: number
	totalSupplyCrossChainReportedByOps: string // wei as decimal string (18 decimals) — net of tokens in the burn/redemption pipeline
	navReportedByOps: string                   // collateral value net of pending payouts (in oracle denomination). Used in the ratio.
	// Gross reserve in USD, computed by ops as (off-chain portfolio value from fund admin) + (on-chain TVL Midas holds).
	// Optional — present when ops publishes it. Used only for public display on the Midas frontend;
	// the overcollateralization ratio keeps using the net `navReportedByOps` (net-vs-net stays
	// consistent while the burn/redemption pipeline is still in-flight).
	navReportedByOpsGross?: string
	tokenPriceReportedByOps: string            // token price in oracle denomination
	oracleAddress: string                      // Chainlink price feed address
	oracleChainSelectorName: string            // e.g. "ethereum-mainnet"
	vlayerClaimHash?: string                   // bytes32 hex — present if token has offchain data
}

const CRE_CONSENSUS_PROOF: CreConsensusProofData = {
	trustModel: 'computation',
	mechanism: 'cre_consensus',
}

/**
 * Create object claim for the ops team NAV PoR claim data
 */
export function createOpsClaimObject(opsClaimData: OpsClaimData): ObjectClaim {
	return new ObjectClaim({
		id: 'ops_claim',
		format: 'json',
		data: opsClaimData as unknown as Record<string, unknown>,
		description: 'Ops team NAV PoR claim containing cross-chain supply and NAV data',
		proof: CRE_CONSENSUS_PROOF,
	})
}

/**
 * Create object claim for the on-chain oracle price
 */
export function createOraclePriceObjectClaim(
	oracleAddress: string,
	chainSelectorName: string,
	oraclePriceData: OraclePriceData,
): ObjectClaim {
	return new ObjectClaim({
		id: 'oracle_price',
		format: 'json',
		data: {
			oracleAddress,
			chainSelectorName,
			priceRaw: oraclePriceData.answer.toString(),
			oracleLastUpdatedAt: oraclePriceData.updatedAt,
			oracleLastUpdatedAtISO: new Date(oraclePriceData.updatedAt * 1000).toISOString(),
			decimals: oraclePriceData.decimals,
		},
		description: 'On-chain token price from Chainlink AggregatorV3 oracle',
		proof: CRE_CONSENSUS_PROOF,
	})
}

/**
 * Create source-backed numeric claim for oracle price (USD, N decimals)
 */
export function createOraclePriceNumericClaim(): NumericClaim {
	return NumericClaim.sourceBacked({
		id: 'oracle_price_usd',
		dataPointer: 'oracle_price#/priceRaw',
		unit: 'USD_9DEC',
		description: 'Token price in USD from on-chain oracle (9 decimal places)',
	})
}

/**
 * Create overcollateralization claim using backoffice NAV data (internal fallback).
 * Supply is from the ops claim (placeholder until Midas supply explorer API is available).
 * Formula: navUsed / totalSupplyTokens / oraclePriceUSD > threshold
 */
export function createInternalOvercollateralizationClaim(
	opsClaimData: OpsClaimData,
	oraclePriceData: OraclePriceData,
	threshold: number,
): ObjectClaim {
	const navUsed = parseFloat(opsClaimData.navReportedByOps)
	const totalSupplyTokens = Number(BigInt(opsClaimData.totalSupplyCrossChainReportedByOps)) / 1e18
	const navPerToken = totalSupplyTokens > 0 ? navUsed / totalSupplyTokens : 0
	const oraclePriceUSD = Number(oraclePriceData.answer) / Math.pow(10, oraclePriceData.decimals)
	const ratio = oraclePriceUSD > 0 ? navPerToken / oraclePriceUSD : 0

	const data: Record<string, unknown> = {
		overcollateralizationType: 'method-2',
		aumSource: 'ops_claim',
		supplySource: 'ops_claim',
		// ─── frontend display (gross) ───
		// Comes from ops when they publish `navReportedByOpsGross` (their own calc: off-chain
		// portfolio + on-chain TVL). Optional — present only when supplied.
		// ─── ratio math (net) ───
		totalReserveNetUSD: navUsed.toFixed(2),
		supplyTokensNet: totalSupplyTokens.toFixed(6),
		// ─── legacy fields (kept for backward compatibility with existing verifiers) ───
		totalReserveUSD: navUsed.toFixed(2),          // alias of totalReserveNetUSD
		supplyTokens: totalSupplyTokens.toFixed(6),    // alias of supplyTokensNet
		navReportedByOps: opsClaimData.navReportedByOps,
		totalSupplyCrossChainReportedByOps: opsClaimData.totalSupplyCrossChainReportedByOps,
		totalSupplyTokens: totalSupplyTokens.toFixed(6),
		navPerToken: navPerToken.toFixed(6),
		oraclePriceFormatted: oraclePriceUSD.toFixed(9),
		threshold,
		ratio: parseFloat(ratio.toFixed(6)),
		passed: ratio > threshold,
	}
	if (opsClaimData.navReportedByOpsGross != null) {
		data.totalReserveGrossUSD = opsClaimData.navReportedByOpsGross
	}
	return new ObjectClaim({
		id: 'overcollateralization',
		format: 'json',
		data,
		description: 'Overcollateralization check using ops NAV data (method-2 fallback). Frontend reads totalReserveGrossUSD (from ops) for display; ratio uses totalReserveNetUSD / supplyTokensNet.',
		proof: CRE_CONSENSUS_PROOF,
	})
}

/**
 * Create overcollateralization claim using external AUM data.
 * totalAUM and aumSource are pre-computed by the caller.
 */
export function createExternalOvercollateralizationClaim(
	totalAUM: number,
	aumSource: string,
	opsClaimData: OpsClaimData,
	oraclePriceData: OraclePriceData,
	threshold: number,
	supplyTokens: number,
	supplySource: 'method-1' | 'method-2',
	pendingRedemptionUSD: number,
	oneTokenOnchainAUM: number | null,
	emailNavUSD: number | null,
): ObjectClaim {
	const navPerToken = supplyTokens > 0 ? totalAUM / supplyTokens : 0
	const oraclePriceUSD = Number(oraclePriceData.answer) / Math.pow(10, oraclePriceData.decimals)
	const ratio = oraclePriceUSD > 0 ? navPerToken / oraclePriceUSD : 0

	const totalSupplyTokens = Number(BigInt(opsClaimData.totalSupplyCrossChainReportedByOps)) / 1e18
	const data: Record<string, unknown> = {
		overcollateralizationType: 'method-1',
		aumSource,
		supplySource,
		// ─── frontend display (gross) ───
		// Reserve gross of pending payouts = 1token + vlayer email (no pending subtraction).
		// Equivalent to totalReserveNetUSD + pendingRedemptionUSD.
		totalReserveGrossUSD: (totalAUM + pendingRedemptionUSD).toFixed(2),
		// ─── ratio math (net) ───
		totalReserveNetUSD: totalAUM.toFixed(2),
		supplyTokensNet: supplyTokens.toFixed(6),
		// ─── legacy fields (kept for backward compatibility) ───
		totalReserveUSD: totalAUM.toFixed(2),         // alias of totalReserveNetUSD
		supplyTokens: supplyTokens.toFixed(6),         // alias of supplyTokensNet
		oneTokenAUM: totalAUM.toFixed(2),              // alias of totalReserveNetUSD
		pendingRedemptionUSD: pendingRedemptionUSD.toFixed(2),
		totalSupplyCrossChainReportedByOps: opsClaimData.totalSupplyCrossChainReportedByOps,
		totalSupplyTokens: totalSupplyTokens.toFixed(6),
		navPerToken: navPerToken.toFixed(6),
		oraclePriceFormatted: oraclePriceUSD.toFixed(9),
		threshold,
		ratio: parseFloat(ratio.toFixed(6)),
		passed: ratio > threshold,
	}
	// Breakdown of the total reserve so the frontend / auditor can inspect each source separately.
	if (oneTokenOnchainAUM !== null) data.oneTokenOnchainAUM = oneTokenOnchainAUM.toFixed(2)
	if (emailNavUSD !== null && emailNavUSD > 0) data.fundManagerNavUSD = emailNavUSD.toFixed(2)

	return new ObjectClaim({
		id: 'overcollateralization',
		format: 'json',
		data,
		description: 'Overcollateralization check using external AUM data',
		proof: CRE_CONSENSUS_PROOF,
	})
}

/**
 * Create source-backed numeric claim for the overcollateralization ratio.
 * Allows machine-readable verification: ratio > threshold means overcollateralized.
 */
export function createOvercollateralizationRatioClaim(): NumericClaim {
	return NumericClaim.sourceBacked({
		id: 'overcollateralization_ratio',
		dataPointer: 'overcollateralization#/ratio',
		unit: 'RATIO',
		description: 'NAV per token / oracle price — overcollateralization ratio (must be > threshold)',
	})
}


/**
 * Create fund manager email object claim with verified Vlayer TLS data
 */
export function createFundManagerEmailClaim(
	vlayerVerificationResult: VlayerVerificationResult,
	rawProofData: any,
): ObjectClaim {
	const tlsNotaryProof = createVlayerProof({
		proofData: rawProofData,
		serverDomain: vlayerVerificationResult.serverDomain,
		notaryKeyFingerprint: vlayerVerificationResult.notaryKeyFingerprint,
	})

	// vlayer v2's /verify endpoint no longer returns `success` inside its `data` field
	// (it's only at the wire level). Storing it here made verifiers see a phantom
	// `success:true` in expectedData that's not in the re-verified result → canonical
	// mismatch. Strip it before storing.
	const { success: _drop, ...claimData } = vlayerVerificationResult
	return new ObjectClaim({
		id: 'fund_manager_claim',
		format: 'json',
		data: claimData as unknown as Record<string, unknown>,
		description: 'Total NAV reported by fund manager (Vlayer TLS verified)',
		proof: tlsNotaryProof,
	})
}

/**
 * Create object claim storing the NAV extracted from the fund manager email.
 * navFields lists the email line labels that were summed — verifiers can re-extract
 * the same value from the vlayer email proof using the same field labels.
 * navIsTotal=false: additive fund-manager-reported portion (may include CEX, OTC, fund shares — whatever the fund manager surfaces in the email). navIsTotal=true: full NAV for cross-check.
 */
export function createEmailNavExtractedClaim(navUSD: number, navIsTotal: boolean, navFields: string[]): ObjectClaim {
	return new ObjectClaim({
		id: 'email_nav',
		format: 'json',
		data: { navUSD, navIsTotal, navFields },
		description: navIsTotal
			? 'Total NAV reported by fund manager, vlayer-notarized via TLS proof (cross-check against 1token). navFields lists the email line labels summed to obtain navUSD.'
			: 'NAV portion reported by fund manager, vlayer-notarized via TLS proof (additive to 1token; may include CEX, OTC, fund shares, or any value the fund manager surfaces in the email). navFields lists the email line labels summed to obtain navUSD.',
		proof: CRE_CONSENSUS_PROOF,
	})
}

/**
 * Source-backed numeric claim pointing to the extracted email NAV.
 * Keeps the main-branch claim id `fund_manager_total_nav` for backward compatibility
 * with verifiers that already parse it.
 */
export function createEmailNavNumericClaim(): NumericClaim {
	return NumericClaim.sourceBacked({
		id: 'fund_manager_total_nav',
		dataPointer: 'email_nav#/navUSD',
		unit: 'USD',
		description: 'NAV extracted from fund manager email (vlayer-notarized)',
	})
}

/**
 * Create string claim to verify email sender
 */
export function createEmailSenderClaim(
	emailClaim: ObjectClaim,
	expectedEmail: string,
): StringClaim {
	const headers = emailClaim.resolve(
		'/response/@parseJson(body)/payload/headers'
	) as Array<{ name: string; value: string }>

	const fromHeader = headers.find((h) => h.name === 'From')
	if (!fromHeader) throw new Error('From header not found in email')

	const emailMatch = fromHeader.value.match(/<(.+?)>/)
	const senderEmail = emailMatch ? emailMatch[1] : fromHeader.value

	const senderOk = expectedEmail.startsWith('@')
		? senderEmail.toLowerCase().endsWith(expectedEmail.toLowerCase())
		: senderEmail.toLowerCase() === expectedEmail.toLowerCase()

	if (!senderOk) {
		throw new Error(`Email sender verification failed: expected ${expectedEmail}, got ${senderEmail}`)
	}

	const fromHeaderIndex = headers.findIndex((h) => h.name === 'From')

	return StringClaim.sourceBacked({
		id: 'fund_manager_email_sender_verification',
		dataPointer: `fund_manager_claim#/response/@parseJson(body)/payload/headers/${fromHeaderIndex}/value`,
		expectedValue: fromHeader.value,
		description: 'Verification of the email sender in the Vlayer TLS proof',
	})
}

function parseRecipientEmails(toHeaderValue: string): string[] {
	return toHeaderValue.split(',').map(part => {
		const match = part.match(/<(.+?)>/)
		return (match ? match[1] : part).trim()
	}).filter(Boolean)
}

/**
 * Create string claim to verify email receivers
 */
export function createEmailReceiverClaim(
	emailClaim: ObjectClaim,
	requiredReceiverEmail: string,
	_allowedReceiverEmails: string[],
): StringClaim {
	const headers = emailClaim.resolve(
		'/response/@parseJson(body)/payload/headers'
	) as Array<{ name: string; value: string }>

	const toHeader = headers.find((h) => h.name === 'To')
	if (!toHeader) throw new Error('To header not found in email')

	const recipientEmails = parseRecipientEmails(toHeader.value)
	const hasRequired = recipientEmails.some(e => e.toLowerCase() === requiredReceiverEmail.toLowerCase())
	if (!hasRequired) {
		throw new Error(
			`Email receiver verification failed: required recipient ${requiredReceiverEmail} not found. ` +
			`Got: ${recipientEmails.join(', ')}`
		)
	}
	// Additional recipients beyond allowedReceiverEmails are tolerated — only requiredReceiverEmail is enforced

	const toHeaderIndex = headers.findIndex((h) => h.name === 'To')

	return StringClaim.sourceBacked({
		id: 'fund_manager_email_receiver_verification',
		dataPointer: `fund_manager_claim#/response/@parseJson(body)/payload/headers/${toHeaderIndex}/value`,
		expectedValue: toHeader.value,
		description: 'Verification of the email receiver in the Vlayer TLS proof',
	})
}

/**
 * Create object claim for 1token portfolio report
 */
export function createOneTokenReportClaim(
	reportData: OneTokenReportData,
	tokenName: string,
	timestamp: string,
	anchorRule: string,
	anchorISO: string,
): ObjectClaim {
	return new ObjectClaim({
		id: 'onetoken_report',
		format: 'json',
		data: {
			assets: reportData.assets,
			liabilities: reportData.liabilities,
			equity: reportData.equity,
			_metadata: {
				source: '1token',
				token: tokenName,
				timestamp,
				anchorRule,
				anchorISO,
			},
		},
		description: '1token portfolio report. Snapshot timestamp resolved by anchorRule from anchorISO.',
		proof: CRE_CONSENSUS_PROOF,
	})
}

/**
 * Create object claim for on-chain token total supply
 */
export function createOnchainSupplyClaim(
	tokenAddress: string,
	chainSelectorName: string,
	supplyData: OnchainSupplyData,
	readAt: string,
): ObjectClaim {
	return new ObjectClaim({
		id: 'onchain_supply',
		format: 'json',
		data: {
			tokenAddress,
			chainSelectorName,
			supplyRaw: supplyData.supplyRaw.toString(),
			supply: supplyData.supply.toFixed(6),
			decimals: supplyData.decimals,
			readAt,
		},
		description: 'On-chain token total supply from ERC-20 totalSupply() at attestation time',
		proof: CRE_CONSENSUS_PROOF,
	})
}

/**
 * Create source-backed numeric claim for 1token NAV (equity total)
 */
export function createOneTokenNavClaim(tokenName: string): NumericClaim {
	return NumericClaim.sourceBacked({
		id: 'onetoken_total_nav',
		dataPointer: 'onetoken_report#/equity/total',
		unit: 'USD_MILLIONS',
		description: `1token equity total for ${tokenName}`,
	})
}

