import {
	bytesToHex,
	handler,
	EVMClient,
	HTTPCapability,
	type EVMLog,
	type HTTPPayload,
	Runner,
	type Runtime,
	type NodeRuntime,
	consensusIdenticalAggregation,
	hexToBase64,
	TxStatus,
	encodeCallMsg,
	decodeJson,
} from '@chainlink/cre-sdk'
import { decodeAbiParameters, encodeFunctionData, decodeFunctionResult, zeroAddress } from 'viem'
import { SaveRegistryWithClaim } from '../contracts/abi/SaveRegistryWithClaim.js'
import { configSchema, type Config, type TokenConfig, getNetworkByChainSelector } from './config.js'
import { CRE_CONFIDENCE_MAP, getBlockNumberByConfidence } from '../library/config-schemas.js'
import { verifyClaimWithVlayer, readOraclePrice, fetchOneTokenReport, fetchSupplyDetails, fetchMidasTotalSupply, extractNavFromEmail, readOnchainTotalSupply, readErc20BalanceDecimal } from './api.js'
import type { OneTokenReportData, OnchainSupplyData } from './api.js'
import { hashToIPFSCid, ipfsCidToHash } from '../library/utils.js'
import { fetchFromIpfs, pushToIpfsPinata, compressJson, decompressJson } from '../library/ipfs.js'
import { fetchTokenRegistry } from '../library/token-registry.js'
import { AttestationBuilder } from '@save/core'
import {
	type OpsClaimData,
	createOpsClaimObject,
	createOraclePriceObjectClaim,
	createOraclePriceNumericClaim,
	createInternalOvercollateralizationClaim,
	createExternalOvercollateralizationClaim,
	createOvercollateralizationRatioClaim,
	createFundManagerEmailClaim,
	createEmailNavExtractedClaim,
	createEmailNavNumericClaim,
	createEmailSenderClaim,
	createEmailReceiverClaim,
	createOneTokenReportClaim,
	createOneTokenNavClaim,
	createOnchainSupplyClaim,
} from './claims.js'

export async function main() {
	try {
		const runner = await Runner.newRunner<Config>({ configSchema: configSchema as any })
		await runner.run(initWorkflow)
	} catch (error) {
		console.error('Fatal error in main:', error)
		throw error
	}
}

const initWorkflow = (config: Config) => {
	const network = getNetworkByChainSelector(config.newClaimLogTrigger.chainSelectorName)

	if (!network) {
		throw new Error(`Network not found: ${config.newClaimLogTrigger.chainSelectorName}`)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	// topics[1] is empty — workflow handles all registered tokens
	const topicFilters = config.newClaimLogTrigger.topics.map(topicFilter => ({
		values: topicFilter.values.map(topic => hexToBase64(topic)),
	}))

	const confidenceLevel = CRE_CONFIDENCE_MAP[config.newClaimLogTrigger.confidence]
	const httpCapability = new HTTPCapability()

	return [
		handler(
			evmClient.logTrigger({
				addresses: [hexToBase64(config.newClaimLogTrigger.address)],
				topics: topicFilters,
				confidence: confidenceLevel,
			}),
			onLogTrigger,
		),
		handler(
			httpCapability.trigger(config.httpTrigger || {}),
			onHttpTrigger,
		),
	]
}

/**
 * Resolve the full token map by fetching the remote registry (if configured)
 * and merging with inline `config.tokens` (inline takes precedence as override).
 * Falls back to inline tokens if the remote fetch fails.
 */
function resolveTokens(runtime: Runtime<Config>): Record<string, TokenConfig> {
	const inline = runtime.config.tokens ?? {}

	if (!runtime.config.tokenRegistry) {
		return inline
	}

	const registryCfg = runtime.config.tokenRegistry
	try {
		const fetched = runtime.runInNodeMode(
			(nodeRuntime: NodeRuntime<Config>) => fetchTokenRegistry(nodeRuntime as any, registryCfg),
			consensusIdenticalAggregation<ReturnType<typeof fetchTokenRegistry>>() as any
		)().result()

		const merged: Record<string, TokenConfig> = {}
		for (const [proofId, cfg] of Object.entries(fetched.tokens)) {
			merged[proofId.toLowerCase()] = cfg as TokenConfig
		}
		for (const [proofId, cfg] of Object.entries(inline)) {
			merged[proofId.toLowerCase()] = cfg
		}
		runtime.log(`Token registry: ${Object.keys(merged).length} tokens (remote: ${Object.keys(fetched.tokens).length}, inline overrides: ${Object.keys(inline).length})`)
		return merged
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		runtime.log(`WARN: token registry fetch failed (${msg}), falling back to inline tokens only`)
		return inline
	}
}

/**
 * Resolve token config by proofId — throws if not registered
 */
function getTokenConfig(tokens: Record<string, TokenConfig>, proofId: string): TokenConfig {
	const tokenConfig = tokens[proofId.toLowerCase()]
	if (!tokenConfig) {
		throw new Error(
			`ProofId ${proofId} is not registered. ` +
			`Registered tokens: ${Object.keys(tokens).map(k => tokens[k].name).join(', ')}`
		)
	}
	return tokenConfig
}

/**
 * HTTP Trigger Handler — manual attestation
 */
const onHttpTrigger = async (runtime: Runtime<Config>, payload: HTTPPayload): Promise<string> => {
	try {
		runtime.log('Running HTTP Trigger for manual attestation')

		const input = decodeJson(payload.input) as { proofId?: string; claimHash?: string }

		if (!input.proofId || input.proofId === '0x') throw new Error('Missing required field: proofId')
		if (!input.claimHash || input.claimHash === '0x') throw new Error('Missing required field: claimHash')

		const proofId = input.proofId as `0x${string}`
		const claimHash = input.claimHash as `0x${string}`

		const tokens = resolveTokens(runtime)
		// Validate token is registered before doing anything else
		getTokenConfig(tokens, proofId)

		runtime.log(`Received proofId: ${proofId}, claimHash: ${claimHash}`)

		const network = getNetworkByChainSelector(runtime.config.newClaimLogTrigger.chainSelectorName)
		if (!network) throw new Error(`Network not found: ${runtime.config.newClaimLogTrigger.chainSelectorName}`)

		const evmClient = new EVMClient(network.chainSelector.selector)

		const callData = encodeFunctionData({
			abi: SaveRegistryWithClaim,
			functionName: 'getClaimsForProofId',
			args: [proofId],
		})

		const contractCall = evmClient
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: runtime.config.newClaimLogTrigger.address as `0x${string}`,
					data: callData,
				}),
				blockNumber: getBlockNumberByConfidence(runtime.config.attesterProxy.readConfidence),
			})
			.result()

		const claimHashes = decodeFunctionResult({
			abi: SaveRegistryWithClaim,
			functionName: 'getClaimsForProofId',
			data: bytesToHex(contractCall.data),
		}) as `0x${string}`[]

		if (!claimHashes?.length) throw new Error(`No claims found for proofId: ${proofId}`)

		const claimExists = claimHashes.some(h => h.toLowerCase() === claimHash.toLowerCase())
		if (!claimExists) {
			throw new Error(
				`Claim hash ${claimHash} not found for proofId ${proofId}. ` +
				`Available: ${claimHashes.join(', ')}`
			)
		}

		const message = await runWorkflow(runtime, tokens, proofId, claimHash)
		runtime.log(`Workflow completed: ${message}`)
		return message
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		runtime.log(`ERROR in onHttpTrigger: ${msg}`)
		if (error instanceof Error && error.stack) runtime.log(`Stack: ${error.stack}`)
		throw error
	}
}

/**
 * EVM Log Trigger Handler — fires on NewClaim with sha256("midas-ops-claim") type
 */
const onLogTrigger = async (runtime: Runtime<Config>, payload: EVMLog): Promise<string> => {
	try {
		runtime.log('Running NewClaim LogTrigger')

		const topics = payload.topics
		if (topics.length < 4) throw new Error(`Not enough topics: ${topics.length}`)

		const proofId = bytesToHex(topics[1]) as `0x${string}`
		const claimProvider = bytesToHex(topics[2].slice(12))
		const claimTypeHash = bytesToHex(topics[3])

		runtime.log(`ProofId: ${proofId}, ClaimProvider: ${claimProvider}, ClaimTypeHash: ${claimTypeHash}`)

		const tokens = resolveTokens(runtime)
		// Skip silently if token not registered — another workflow instance may handle it
		if (!tokens[proofId.toLowerCase()]) {
			runtime.log(`ProofId ${proofId} not registered in this workflow instance — skipping`)
			return `Skipped: proofId ${proofId} not registered`
		}

		const decoded = decodeAbiParameters(
			[
				{ name: 'previousClaimHash', type: 'bytes32' },
				{ name: 'newClaimHash', type: 'bytes32' },
				{ name: 'timestamp', type: 'uint48' },
			],
			bytesToHex(payload.data) as `0x${string}`
		)
		const newClaimHash = decoded[1]
		runtime.log(`NewClaimHash: ${newClaimHash}, Timestamp: ${decoded[2]}`)

		const message = await runWorkflow(runtime, tokens, proofId, newClaimHash)
		runtime.log(`Workflow completed: ${message}`)
		return message
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		runtime.log(`ERROR in onLogTrigger: ${msg}`)
		if (error instanceof Error && error.stack) runtime.log(`Stack: ${error.stack}`)
		throw error
	}
}

function formatOneTokenTimestamp(date: Date): string {
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, '0')
	const d = String(date.getUTCDate()).padStart(2, '0')
	const h = String(date.getUTCHours()).padStart(2, '0')
	return `${y}-${m}-${d}T${h}:00`
}

/**
 * Floor the given date to the hour, then build a list of past timestamps to try
 * by subtracting each offset (in hours) from it. Offsets are expected to be
 * non-negative; we never look into the future.
 */
function computeOneTokenTimestamps(isoDate: string, offsetsHoursBack: number[]): string[] {
	try {
		const date = new Date(isoDate)
		if (isNaN(date.getTime())) return []

		const anchor = new Date(date)
		anchor.setUTCMinutes(0, 0, 0)

		return offsetsHoursBack.map(h => {
			const t = new Date(anchor)
			t.setUTCHours(t.getUTCHours() - Math.max(0, Math.trunc(h)))
			return formatOneTokenTimestamp(t)
		})
	} catch {
		return []
	}
}

/**
 * Main workflow execution
 */
const runWorkflow = async (
	runtime: Runtime<Config>,
	tokens: Record<string, TokenConfig>,
	proofId: string,
	newClaimHash: string,
): Promise<string> => {
	try {
		const tokenConfig = getTokenConfig(tokens, proofId)
		runtime.log(`Processing token: ${tokenConfig.name} (proofId: ${proofId})`)

		// 1. Fetch ops claim from IPFS

		runtime.log(`Fetching ops claim from IPFS: ${newClaimHash}`)
		const ipfsCid = hashToIPFSCid(newClaimHash)

		const compressedData = runtime.runInNodeMode(
			(nodeRuntime: NodeRuntime<Config>) => fetchFromIpfs(nodeRuntime as any, ipfsCid),
			consensusIdenticalAggregation<Uint8Array>()
		)().result()

		const opsClaimData = decompressJson(compressedData) as OpsClaimData

		if (!opsClaimData?.token || !opsClaimData?.totalSupplyCrossChainReportedByOps || !opsClaimData?.navReportedByOps) {
			throw new Error('Invalid ops claim: missing token, totalSupplyCrossChainReportedByOps, or navReportedByOps')
		}

		runtime.log(`Ops claim: token=${opsClaimData.token}, navReportedByOps=${opsClaimData.navReportedByOps}${opsClaimData.navReportedByOpsGross ? ` (gross=${opsClaimData.navReportedByOpsGross})` : ''}, supply=${opsClaimData.totalSupplyCrossChainReportedByOps}`)

		// 2. Read oracle price on-chain

		runtime.log(`Reading oracle price from ${opsClaimData.oracleAddress} on ${opsClaimData.oracleChainSelectorName}`)

		const oraclePriceData = readOraclePrice(
			runtime,
			opsClaimData.oracleAddress,
			opsClaimData.oracleChainSelectorName,
			8,
		)

		const oraclePriceUSD = Number(oraclePriceData.answer) / Math.pow(10, oraclePriceData.decimals)
		runtime.log(`Oracle price: ${oraclePriceUSD} USD (raw: ${oraclePriceData.answer})`)

		// 2.5. Read on-chain total supply

		let onchainSupplyData: OnchainSupplyData | null = null
		if (tokenConfig.supplyToken) {
			try {
				onchainSupplyData = readOnchainTotalSupply(
					runtime,
					tokenConfig.supplyToken.address,
					tokenConfig.supplyToken.decimals,
					tokenConfig.supplyToken.chainSelectorName,
				)
				runtime.log(`On-chain supply: ${onchainSupplyData.supply.toFixed(6)} tokens (raw: ${onchainSupplyData.supplyRaw})`)
			} catch (e) {
				runtime.log(`WARN: on-chain supply read failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`)
			}
		}

		// 3. Vlayer fund manager claim (if vlayerClaimHash present)

		let fundManagerEmailClaim: ReturnType<typeof createFundManagerEmailClaim> | null = null
		let emailNavUSD: number | null = null
		let emailSenderClaim: ReturnType<typeof createEmailSenderClaim> | null = null
		let emailReceiverClaim: ReturnType<typeof createEmailReceiverClaim> | null = null

		const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'
		if (opsClaimData.vlayerClaimHash && opsClaimData.vlayerClaimHash.toLowerCase() !== ZERO_HASH) {

			runtime.log(`Fetching Vlayer claim from IPFS: ${opsClaimData.vlayerClaimHash}`)
			const vlayerCid = hashToIPFSCid(opsClaimData.vlayerClaimHash)

			const vlayerCompressed = runtime.runInNodeMode(
				(nodeRuntime: NodeRuntime<Config>) => fetchFromIpfs(nodeRuntime as any, vlayerCid),
				consensusIdenticalAggregation<Uint8Array>()
			)().result()

			const vlayerClaimData = decompressJson(vlayerCompressed)
			if (!vlayerClaimData?.proof) throw new Error('Invalid Vlayer claim: missing proof')

			runtime.log('Verifying Vlayer fund manager claim...')
			const vlayerResult = await verifyClaimWithVlayer(runtime, vlayerClaimData.proof)
			runtime.log('Vlayer verification successful')

			const fm = tokenConfig.fundManager!
			fundManagerEmailClaim = createFundManagerEmailClaim(vlayerResult, vlayerClaimData.proof)
			emailSenderClaim = createEmailSenderClaim(fundManagerEmailClaim, fm.expectedEmail)
			emailReceiverClaim = createEmailReceiverClaim(fundManagerEmailClaim, fm.requiredReceiverEmail, fm.allowedReceiverEmails)

			emailNavUSD = extractNavFromEmail(fundManagerEmailClaim, fm.navFields)
			if (emailNavUSD !== null) {
				runtime.log(`Email NAV extracted: ${emailNavUSD.toFixed(2)} USD (navIsTotal=${fm.navIsTotal})`)
			} else {
				runtime.log(`WARN: could not extract NAV from email (navFields=${JSON.stringify(fm.navFields)})`)
			}
		}

		// 1token report + overcollateralization candidates

		let oneTokenRawReport: OneTokenReportData | null = null
		let oneTokenTimestamp: string | null = null
		let oneTokenOnchainAUM: number | null = null
		let oneTokenAnchorRule: string | null = null
		let oneTokenAnchorISO: string | null = null

		const totalSupplyTokens = Number(BigInt(opsClaimData.totalSupplyCrossChainReportedByOps)) / 1e18
		const threshold = runtime.config.overcollateralizationThreshold
		const deviationThreshold = runtime.config.oneTokenDeviationThresholdPercent

		const computeRatio = (aum: number, supplyTokens: number): number => {
			const navPerToken = supplyTokens > 0 ? aum / supplyTokens : 0
			return oraclePriceUSD > 0 ? navPerToken / oraclePriceUSD : 0
		}

		if (tokenConfig.oneTokenApi) {
			try {
				runtime.log('Fetching 1token report...')

				let supplyTokens = totalSupplyTokens
				// fetchSupplyDetails skipped for tokens with fundManager — HTTP call budget is tight (limit=5)
				if (!tokenConfig.fundManager) {
					try {
						const supplyData = fetchSupplyDetails(runtime, tokenConfig.oneTokenApi.tokenName)
						const tsGap = Math.abs(supplyData.timestamp - oraclePriceData.updatedAt)
						if (tsGap <= 3600) {
							supplyTokens = supplyData.supply
							runtime.log(`prices/details supply: ${supplyData.supply.toFixed(6)} tokens (ts gap: ${tsGap}s) ✓`)
						} else {
							runtime.log(`prices/details supply timestamp mismatch (gap: ${tsGap}s > 3600s) — using ops supply`)
						}
					} catch (e) {
						runtime.log(`WARN: prices/details failed, using ops supply: ${e instanceof Error ? e.message : String(e)}`)
					}
				}

				const resolvedAnchor = tokenConfig.anchorRule ?? (
					fundManagerEmailClaim
						? { source: 'vlayer_email_date' as const, offsetHours: 1 }
						: { source: 'ops_created_at' as const, offsetHours: -3 }
				)
				let anchorISO: string
				let anchorRule: string
				const tryVlayerEmailDate = (offsetHours: number): { iso: string; rule: string } => {
					if (!fundManagerEmailClaim) throw new Error('anchorRule.source=vlayer_email_date but token has no fundManager')
					const headers = fundManagerEmailClaim.resolve('/response/@parseJson(body)/payload/headers') as Array<{ name: string; value: string }>
					const dateHeader = headers.find(h => h.name === 'Date')
					if (!dateHeader) throw new Error('no Date header in email')
					const parsed = new Date(dateHeader.value)
					if (isNaN(parsed.getTime())) throw new Error(`invalid Date header: ${dateHeader.value}`)
					parsed.setUTCHours(parsed.getUTCHours() + offsetHours)
					const sign = offsetHours >= 0 ? 'plus' : 'minus'
					return { iso: parsed.toISOString(), rule: `vlayer_email_date_${sign}_${Math.abs(offsetHours)}h` }
				}
				const opsCreatedAt = (offsetHours: number): { iso: string; rule: string } => {
					const opsTs = new Date(opsClaimData.createdAt)
					opsTs.setUTCHours(opsTs.getUTCHours() + offsetHours)
					const sign = offsetHours >= 0 ? 'plus' : 'minus'
					return { iso: opsTs.toISOString(), rule: `ops_created_at_${sign}_${Math.abs(offsetHours)}h` }
				}
				try {
					const r = resolvedAnchor.source === 'vlayer_email_date'
						? tryVlayerEmailDate(resolvedAnchor.offsetHours)
						: opsCreatedAt(resolvedAnchor.offsetHours)
					anchorISO = r.iso
					anchorRule = r.rule
				} catch (e) {
					const r = opsCreatedAt(-3)
					anchorISO = r.iso
					anchorRule = r.rule
					runtime.log(`WARN: anchorRule resolve failed, falling back to ops_created_at-3h (${e instanceof Error ? e.message : String(e)})`)
				}
				runtime.log(`1token anchor rule=${anchorRule} value=${anchorISO}`)
				oneTokenAnchorRule = anchorRule
				oneTokenAnchorISO = anchorISO

				const timestamps = computeOneTokenTimestamps(
					anchorISO,
					tokenConfig.oneTokenApi.timestampOffsetHoursBack,
				)
				if (timestamps.length > 0) {
					for (const ts of timestamps) {
						let report: OneTokenReportData | null = null
						try {
							const pendingPattern = tokenConfig.pendingRedemptionSource?.oneTokenWalletPattern
							report = fetchOneTokenReport(runtime, ts, tokenConfig.oneTokenApi, pendingPattern)
						} catch (e) {
							runtime.log(`1token "${ts}" error: ${e instanceof Error ? e.message : String(e)}`)
							continue
						}
						if (!report || typeof report.equity?.total !== 'number') {
							runtime.log(`1token "${ts}" no data — trying next`)
							continue
						}
						oneTokenRawReport = report
						oneTokenTimestamp = ts

						const useNavBase = tokenConfig.oneTokenApi.useNavBase && typeof report.navBase === 'number'
						oneTokenOnchainAUM = useNavBase ? report.navBase! : report.equity.total * 1_000_000
						runtime.log(`1token AUM: ${oneTokenOnchainAUM.toFixed(0)} USD (ts=${ts})`)
						break
					}
				}
			} catch (error) {
				runtime.log(`WARN: 1token fetch failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		// Pending redemption (independent of endpoint).
		// Computed from configured sources: 1token wallet pattern and/or email fields.
		// Used to (a) net the external supply (method-1) and (b) net the external AUM
		// so denominator and numerator stay apples-to-apples with ops's circulating-supply
		// accounting (ops's NAV already excludes assets allocated to pending payouts).

		// Unit matches the AUM unit: USD for most tokens, base currency (e.g. BTC) when
		// `oneTokenApi.useNavBase` is set. Email fields are always USD-denominated, so when
		// `useNavBase` is true any email-sourced pending is converted to the base currency
		// before accumulation to keep the unit consistent with the 1token-sourced portion.
		const useNavBase = tokenConfig.oneTokenApi?.useNavBase === true
		let pendingRedemption = 0
		const prs = tokenConfig.pendingRedemptionSource
		if (prs?.oneTokenWalletPattern && typeof oneTokenRawReport?.pendingRedemption === 'number') {
			const fromOneToken = oneTokenRawReport.pendingRedemption
			pendingRedemption += fromOneToken
			runtime.log(`Pending redemption (1token wallet "${prs.oneTokenWalletPattern}"): ${fromOneToken.toFixed(0)} USD`)
		}
		if (prs?.emailFields && fundManagerEmailClaim) {
			const extracted = extractNavFromEmail(fundManagerEmailClaim, prs.emailFields)
			if (extracted !== null) {
				const adjusted = useNavBase && oraclePriceUSD > 0 ? extracted / oraclePriceUSD : extracted
				pendingRedemption += adjusted
				runtime.log(`Pending redemption (email fields ${JSON.stringify(prs.emailFields)}): ${extracted.toFixed(0)} USD`)
			}
		}
		if (pendingRedemption > 0) {
			runtime.log(`Pending redemption total: ${pendingRedemption.toFixed(0)} USD`)
		}

		// On-chain reserve additions — sum USDC balances at configured wallets
		// (Settlement Funds in Process, Reserve, Fee Recipient, etc. — wallets
		// that hold backing assets the 1token endpoint doesn't cover). Any failure
		// on a single balanceOf call skips that wallet (non-fatal). Total is
		// added to the external gross reserve before pending-redemption netting.
		let onchainReserveUSD = 0
		const roc = tokenConfig.reserveOnchainWallets
		if (roc && roc.usdcWallets.length > 0) {
			for (const wallet of roc.usdcWallets) {
				try {
					const bal = readErc20BalanceDecimal(runtime, roc.usdcAddress, wallet, tokenConfig.chainSelectorName, 6)
					onchainReserveUSD += bal
					runtime.log(`Reserve on-chain USDC ${wallet.slice(0, 10)}...: $${bal.toFixed(2)}`)
				} catch (e) {
					runtime.log(`WARN: reserve on-chain USDC balanceOf failed for ${wallet}: ${e instanceof Error ? e.message : String(e)}`)
				}
			}
			for (const entry of roc.otherTokens) {
				try {
					const bal = readErc20BalanceDecimal(runtime, entry.token, entry.wallet, tokenConfig.chainSelectorName, 18)
					const priceRaw = readOraclePrice(runtime, entry.priceOracle, tokenConfig.chainSelectorName, entry.priceDecimals)
					const priceUSD = Number(priceRaw.answer) / Math.pow(10, entry.priceDecimals)
					const valueUSD = bal * priceUSD
					onchainReserveUSD += valueUSD
					runtime.log(`Reserve on-chain ${entry.label || 'token'} ${entry.wallet.slice(0, 10)}...: ${bal.toFixed(4)} × $${priceUSD.toFixed(6)} = $${valueUSD.toFixed(2)}`)
				} catch (e) {
					runtime.log(`WARN: reserve on-chain otherToken failed for ${entry.wallet}: ${e instanceof Error ? e.message : String(e)}`)
				}
			}
			if (onchainReserveUSD > 0) {
				runtime.log(`Reserve on-chain total: $${onchainReserveUSD.toFixed(2)}`)
			}
		}

		// For `useNavBase` tokens, `oneTokenOnchainAUM` and `pendingRedemption` are in the
		// token's base currency (e.g. BTC). Ops reports `navReportedByOps` in USD across
		// all tokens, so every comparison and ratio downstream is USD-denominated. Convert
		// the base-currency values here once so both the deviation log and the ratio math
		// operate on apples-to-apples USD numbers.
		const oneTokenOnchainAUMUSD = oneTokenOnchainAUM !== null && useNavBase
			? oneTokenOnchainAUM * oraclePriceUSD
			: oneTokenOnchainAUM
		const pendingRedemptionUSD = useNavBase ? pendingRedemption * oraclePriceUSD : pendingRedemption

		// External NAV deviation vs ops — comparing apples-to-apples in USD

		{
			const fm = tokenConfig.fundManager
			const opsNavUsed = parseFloat(opsClaimData.navReportedByOps)

			let externalAUMGrossUSD: number | null = null
			let externalLabel: string = ''
			if (oneTokenOnchainAUMUSD !== null && fm && !fm.navIsTotal && emailNavUSD !== null) {
				externalAUMGrossUSD = oneTokenOnchainAUMUSD + emailNavUSD
				externalLabel = '1token+fasanara_vlayer'
			} else if (fm?.navIsTotal && emailNavUSD !== null) {
				externalAUMGrossUSD = emailNavUSD
				externalLabel = 'vlayer_total'
			} else if (oneTokenOnchainAUMUSD !== null) {
				externalAUMGrossUSD = oneTokenOnchainAUMUSD
				externalLabel = '1token'
			}

			if (externalAUMGrossUSD !== null && opsNavUsed > 0) {
				const externalAUMNetUSD = externalAUMGrossUSD - pendingRedemptionUSD
				const opsNetForDev = tokenConfig.opsNavIsNetOfPending
					? opsNavUsed
					: opsNavUsed - pendingRedemptionUSD
				if (opsNetForDev <= 0) {
					throw new Error(`Invalid ops NAV for deviation: opsNetForDev=${opsNetForDev} (opsNavUsed=${opsNavUsed}, pendingUSD=${pendingRedemptionUSD}, opsNavIsNetOfPending=${!!tokenConfig.opsNavIsNetOfPending}) — pending exceeds NAV or ops payload is malformed`)
				}
				const dev = Math.abs((externalAUMNetUSD - opsNetForDev) / opsNetForDev) * 100
				runtime.log(`External NAV (${externalLabel}) vs ops deviation: external_net=${externalAUMNetUSD.toFixed(0)} USD (gross=${externalAUMGrossUSD.toFixed(0)} - pending=${pendingRedemptionUSD.toFixed(0)}), ops_net=${opsNetForDev.toFixed(0)} USD (raw=${opsNavUsed.toFixed(0)}${tokenConfig.opsNavIsNetOfPending ? ' already net' : ' - pending'}), deviation=${dev.toFixed(2)}% (threshold: ${deviationThreshold}%)${dev > deviationThreshold ? ' ⚠ EXCEEDS THRESHOLD' : ''}`)
			}

			// Cross-check sanity: if navIsTotal=true, log deviation vlayer vs 1token (both estimate total, both USD)
			if (fm?.navIsTotal && emailNavUSD !== null && oneTokenOnchainAUMUSD !== null && oneTokenOnchainAUMUSD > 0) {
				const dev = Math.abs((emailNavUSD - oneTokenOnchainAUMUSD) / oneTokenOnchainAUMUSD) * 100
				runtime.log(`Cross-check vlayer_total vs 1token: vlayer=${emailNavUSD.toFixed(0)} USD, 1token=${oneTokenOnchainAUMUSD.toFixed(0)} USD, deviation=${dev.toFixed(2)}%${dev > deviationThreshold ? ' ⚠' : ''}`)
			}
		}

		// Method-1 supply: external Midas endpoint - pending redemption (independent of ops)
		// Falls back to method-2 (ops supply) if:
		//   - endpoint unreachable or no token address configured
		//   - the configured pending source(s) failed to return data, making the
		//     effective supply unreliable (e.g., 1token report down but a wallet
		//     pattern was expected from it)

		let method1SupplyTokens: number | null = null

		const requiresOneTokenForPending = prs?.oneTokenWalletPattern != null
		const oneTokenAvailable = oneTokenRawReport !== null
		if (requiresOneTokenForPending && !oneTokenAvailable) {
			runtime.log('Method-1 unavailable: 1token report failed but pendingRedemptionSource.oneTokenWalletPattern is configured — falling back to method-2')
		} else if (tokenConfig.address && oraclePriceUSD > 0) {
			// Use the 1token anchor timestamp so AUM (1token) and supply (Midas API)
			// are sampled at the same moment — apples-to-apples ratio.
			const anchorForSupply = oneTokenAnchorISO ?? opsClaimData.createdAt
			const eventTsSec = Math.floor(new Date(anchorForSupply).getTime() / 1000)
			const midasSupply = fetchMidasTotalSupply(runtime, tokenConfig.address, eventTsSec, tokenConfig.chainSelectorName)

			if (midasSupply) {
				runtime.log(`Method-1 external supply: ${midasSupply.supply.toFixed(2)} tokens (${Object.keys(midasSupply.supplyByChain).length} chains)`)

				// Supply exclusions: subtract on-chain balances of the primary token in
				// configured non-circulating wallets (redemption vault, burn queue, LP
				// waiting-to-burn). Each failed balanceOf is treated as 0 (skipped).
				let onchainExclusions = 0
				if (tokenConfig.supplyExclusionWallets && tokenConfig.supplyExclusionWallets.length > 0 && tokenConfig.address) {
					for (const wallet of tokenConfig.supplyExclusionWallets) {
						try {
							const bal = readErc20BalanceDecimal(runtime, tokenConfig.address, wallet, tokenConfig.chainSelectorName, 18)
							onchainExclusions += bal
							runtime.log(`Supply exclusion ${wallet.slice(0, 10)}...: ${bal.toFixed(2)} tokens`)
						} catch (e) {
							runtime.log(`WARN: supply exclusion balanceOf failed for ${wallet}: ${e instanceof Error ? e.message : String(e)}`)
						}
					}
					if (onchainExclusions > 0) {
						runtime.log(`Supply exclusions total: ${onchainExclusions.toFixed(2)} tokens`)
					}
				}

				const pendingTokens = pendingRedemptionUSD / oraclePriceUSD
				const effectiveSupply = midasSupply.supply - pendingTokens - onchainExclusions
				if (effectiveSupply > 0) {
					method1SupplyTokens = effectiveSupply
					runtime.log(`Method-1 effective supply: ${effectiveSupply.toFixed(2)} tokens (gross=${midasSupply.supply.toFixed(2)} - pending=${pendingTokens.toFixed(2)}${onchainExclusions > 0 ? ` - onchainExclusions=${onchainExclusions.toFixed(2)}` : ''})`)
				} else {
					runtime.log(`WARN: Method-1 effective supply <= 0, skipping method-1`)
				}
			}
		}

		// Overcollateralization — prioritized candidates
		// Per AUM, try method-1 supply (endpoint - pending) first, then method-2 (ops supply).
		// Case A (navIsTotal=false, additive offchain): 1token+vlayer → 1token → ops
		// Case B (navIsTotal=true, cross-check): 1token → vlayer → ops
		// Case C (no fundManager): 1token → ops

		type OvercolCandidate = { totalAUM: number; aumSource: string; supplyTokens: number; supplySource: 'method-1' | 'method-2'; ratio: number }
		let selectedCandidate: OvercolCandidate | null = null

		const fm = tokenConfig.fundManager
		const opsNavUSD = parseFloat(opsClaimData.navReportedByOps)

		const trySupplies: Array<{ tokens: number; source: 'method-1' | 'method-2' }> = []
		if (method1SupplyTokens !== null) trySupplies.push({ tokens: method1SupplyTokens, source: 'method-1' })
		trySupplies.push({ tokens: totalSupplyTokens, source: 'method-2' })

		for (const { tokens: supplyTokens, source: supplySource } of trySupplies) {
			if (selectedCandidate) break

			// Both method-1 and method-2 supplies are net of pending payouts:
			//   - method-1 supply = Midas endpoint − pending (computed above)
			//   - method-2 supply = ops totalSupplyCrossChainReportedByOps (already net)
			// External AUMs (1token + vlayer) must exclude the same pending amount to stay
			// apples-to-apples with the denominator. The ratio is a net-vs-net check.
			const aumPendingAdj = pendingRedemptionUSD

			if (oneTokenOnchainAUMUSD !== null) {
				if (fm && !fm.navIsTotal && emailNavUSD !== null) {
					const grossAUM = oneTokenOnchainAUMUSD + emailNavUSD + onchainReserveUSD
					const totalAUM = grossAUM - aumPendingAdj
					const ratio = computeRatio(totalAUM, supplyTokens)
					runtime.log(`Candidate ${supplySource} 1token+fasanara_vlayer: ratio=${ratio.toFixed(4)}, AUM=${totalAUM.toFixed(0)} (1token=${oneTokenOnchainAUMUSD.toFixed(0)}, vlayer=${emailNavUSD.toFixed(0)}${onchainReserveUSD > 0 ? `, +onchainReserve=${onchainReserveUSD.toFixed(0)}` : ''}${aumPendingAdj > 0 ? `, -pending=${aumPendingAdj.toFixed(0)}` : ''}), supply=${supplyTokens.toFixed(2)}`)
					if (ratio > threshold) { selectedCandidate = { totalAUM, aumSource: '1token+fasanara_vlayer', supplyTokens, supplySource, ratio }; continue }
				}

				if (!selectedCandidate) {
					const totalAUM = oneTokenOnchainAUMUSD + onchainReserveUSD - aumPendingAdj
					const ratio = computeRatio(totalAUM, supplyTokens)
					runtime.log(`Candidate ${supplySource} 1token: ratio=${ratio.toFixed(4)}, AUM=${totalAUM.toFixed(0)}${aumPendingAdj > 0 ? ` (1token=${oneTokenOnchainAUMUSD.toFixed(0)} -pending=${aumPendingAdj.toFixed(0)})` : ''}, supply=${supplyTokens.toFixed(2)}`)
					if (ratio > threshold) { selectedCandidate = { totalAUM, aumSource: '1token', supplyTokens, supplySource, ratio }; continue }
				}
			}

			if (!selectedCandidate && fm?.navIsTotal && emailNavUSD !== null) {
				const totalAUM = emailNavUSD - aumPendingAdj
				const ratio = computeRatio(totalAUM, supplyTokens)
				runtime.log(`Candidate ${supplySource} vlayer_total: ratio=${ratio.toFixed(4)}, AUM=${totalAUM.toFixed(0)}${aumPendingAdj > 0 ? ` (vlayer=${emailNavUSD.toFixed(0)} -pending=${aumPendingAdj.toFixed(0)})` : ''}, supply=${supplyTokens.toFixed(2)}`)
				if (ratio > threshold) { selectedCandidate = { totalAUM, aumSource: 'vlayer', supplyTokens, supplySource, ratio }; continue }
			}

			if (!selectedCandidate && supplySource === 'method-2') {
				const ratio = computeRatio(opsNavUSD, supplyTokens)
				runtime.log(`Candidate ${supplySource} ops: ratio=${ratio.toFixed(4)}, AUM=${opsNavUSD.toFixed(0)}, supply=${supplyTokens.toFixed(2)}`)
				if (ratio > threshold) selectedCandidate = { totalAUM: opsNavUSD, aumSource: 'ops', supplyTokens, supplySource, ratio }
			}
		}

		if (!selectedCandidate) {
			throw new Error(
				`Overcollateralization check failed for ${tokenConfig.name}. ` +
				`All candidates below threshold=${threshold}. ` +
				`Attestation will not be pushed.`
			)
		}

		runtime.log(`Overcollateralization passed: ${selectedCandidate.supplySource}, ratio=${selectedCandidate.ratio.toFixed(4)}, supplyTokens=${selectedCandidate.supplyTokens.toFixed(2)}`)

		// 7. Build claims

		const opsClaimObject = createOpsClaimObject(opsClaimData)
		const oraclePriceObjectClaim = createOraclePriceObjectClaim(
			opsClaimData.oracleAddress,
			opsClaimData.oracleChainSelectorName,
			oraclePriceData,
		)
		const oraclePriceNumericClaim = createOraclePriceNumericClaim()
		const overcollateralizationClaim = selectedCandidate.aumSource === 'ops'
			? createInternalOvercollateralizationClaim(opsClaimData, oraclePriceData, threshold)
			: createExternalOvercollateralizationClaim(
				selectedCandidate.totalAUM,
				selectedCandidate.aumSource,
				opsClaimData,
				oraclePriceData,
				threshold,
				selectedCandidate.supplyTokens,
				selectedCandidate.supplySource,
				// Always pass USD-denominated values to the claim builder — for `useNavBase`
				// tokens (e.g. mHyperBTC) the raw `pendingRedemption` / `oneTokenOnchainAUM`
				// are in the base currency (BTC). Mixing them with USD `totalAUM` in the
				// claim would produce nonsensical `totalReserveGrossUSD`.
				pendingRedemptionUSD,
				oneTokenOnchainAUMUSD,
				emailNavUSD,
			)

		// 8. Build and sign attestation

		const attesterPrivateKey = runtime.getSecret({ id: 'attesterprivatekey' }).result().value as `0x${string}`
		const attesterPublicKey = runtime.config.attester.publicKey as `0x${string}`
		const now = runtime.now()

		const attestationBuilder = new AttestationBuilder({
			issuer: { identity: attesterPublicKey, name: 'Midas' },
			publicKeySource: 'https://midas.app/public/attestation-engine/pubkeys.json',
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
			proofId,
		})
			.addClaim(opsClaimObject)
			.addClaim(oraclePriceObjectClaim)
			.addClaim(oraclePriceNumericClaim)
			.addClaim(overcollateralizationClaim)
			.addClaim(createOvercollateralizationRatioClaim())

		if (fundManagerEmailClaim && emailSenderClaim && emailReceiverClaim) {
			attestationBuilder
				.addClaim(fundManagerEmailClaim)
				.addClaim(emailSenderClaim)
				.addClaim(emailReceiverClaim)
			if (emailNavUSD !== null && fm) {
				attestationBuilder
					.addClaim(createEmailNavExtractedClaim(emailNavUSD, fm.navIsTotal, fm.navFields))
					.addClaim(createEmailNavNumericClaim())
			}
			runtime.log('Vlayer fund manager claims added')
		}

		if (oneTokenRawReport && oneTokenTimestamp) {
			attestationBuilder
				.addClaim(createOneTokenReportClaim(oneTokenRawReport, tokenConfig.name, oneTokenTimestamp, oneTokenAnchorRule ?? '', oneTokenAnchorISO ?? ''))
				.addClaim(createOneTokenNavClaim(tokenConfig.name))
			runtime.log(`1token claims added`)
		}

		if (onchainSupplyData && tokenConfig.supplyToken) {
			attestationBuilder.addClaim(createOnchainSupplyClaim(
				tokenConfig.supplyToken.address,
				tokenConfig.supplyToken.chainSelectorName,
				onchainSupplyData,
				now.toISOString(),
			))
			runtime.log('On-chain supply claim added')
		}

		const attestation = attestationBuilder.sign(attesterPrivateKey)
		runtime.log(`Attestation signed, ID: ${attestation.id}`)

		// 9. Compress + upload to IPFS

		const compressedAttestation = compressJson(attestation.toData())
		runtime.log(`Compressed to ${compressedAttestation.length} bytes`)

		const pinataJwt = runtime.getSecret({ id: 'pinatajwt' }).result().value as string
		let pinataGroupId: string | undefined
		try { pinataGroupId = runtime.getSecret({ id: 'attestationpinatagroupid' }).result().value as string } catch { pinataGroupId = undefined }

		const attestationCid = runtime.runInNodeMode(
			(nodeRuntime: NodeRuntime<Config>) => pushToIpfsPinata(
				nodeRuntime as any,
				compressedAttestation,
				pinataJwt,
				`attestation_${tokenConfig.name}_${now.toISOString().slice(0, 10)}.json.gz`,
				'application/gzip',
				pinataGroupId || undefined,
			),
			consensusIdenticalAggregation<string>()
		)().result()

		runtime.log(`Attestation uploaded: ${attestationCid}`)

		// 10. Push attestation hash on-chain

		const attestationHash = ipfsCidToHash(attestationCid)
		const writeChain = runtime.config.attesterProxy.chainSelectorName ?? runtime.config.newClaimLogTrigger.chainSelectorName
		const network = getNetworkByChainSelector(writeChain)
		if (!network) throw new Error(`Network not found: ${writeChain}`)

		const evmClient = new EVMClient(network.chainSelector.selector)

		const reportData = encodeFunctionData({
			abi: SaveRegistryWithClaim,
			functionName: 'setAttestation',
			args: [proofId as `0x${string}`, attestationHash as `0x${string}`],
		})

		const reportResponse = runtime.report({
			encodedPayload: hexToBase64(reportData),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		}).result()

		const resp = evmClient.writeReport(runtime, {
			receiver: runtime.config.attesterProxy.address,
			report: reportResponse,
			gasConfig: { gasLimit: runtime.config.attesterProxy.gasLimit },
		}).result()

		if (resp.txStatus !== TxStatus.SUCCESS) {
			throw new Error(`Failed to write report: ${resp.errorMessage || resp.txStatus}`)
		}

		const txHash = bytesToHex(resp.txHash || new Uint8Array(32))
		runtime.log(`Attestation set on-chain: ${txHash}`)

		return (
			`${tokenConfig.name} claim ${newClaimHash} processed. ` +
			`Overcollateralization: ${selectedCandidate.supplySource}. ` +
			`Attestation CID: ${attestationCid}. TxHash: ${txHash}`
		)

	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		runtime.log(`ERROR in runWorkflow: ${msg}`)
		if (error instanceof Error && error.stack) runtime.log(`Stack: ${error.stack}`)
		throw error
	}
}
