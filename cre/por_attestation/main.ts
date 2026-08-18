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
import { configSchema, tokenConfigSchema, type Config, type TokenConfig, getNetworkByChainSelector } from './config.js'
import { CRE_CONFIDENCE_MAP, getBlockNumberByConfidence } from '../library/config-schemas.js'
import { verifyClaimWithVlayer, readOraclePrice, fetchOneTokenReport, fetchSupplyDetails, fetchMidasTotalSupply, extractNavFromEmail, readOnchainTotalSupply, readErc20BalanceDecimal, fetchSolanaSupply, fetchSolanaPrice } from './api.js'
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
	createOvercollateralizationClaim,
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

		// Registry is the source of truth. Inline is only a fallback used for tokens
		// the registry doesn't return — so pushing to tokens.json takes effect at the
		// next run without redeploying the workflow.
		const merged: Record<string, TokenConfig> = {}
		for (const [proofId, cfg] of Object.entries(inline)) {
			merged[proofId.toLowerCase()] = cfg
		}
		for (const [proofId, cfg] of Object.entries(fetched.tokens)) {
			// Parse (not cast) so schema DEFAULTS apply — the registry JSON is raw, so casting
			// would leave defaulted fields (usdcAddress, offchainEquityKeys, timestampOffsetHoursBack,
			// maxStalenessSec…) undefined and crash downstream reads. Skip a malformed token with a
			// warning rather than aborting the whole registry.
			const parsed = tokenConfigSchema.safeParse(cfg)
			if (parsed.success) {
				merged[proofId.toLowerCase()] = parsed.data
			} else {
				const why = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
				runtime.log(`WARN: registry token ${proofId} failed validation, skipping — ${why.slice(0, 200)}`)
			}
		}
		runtime.log(`Token registry: ${Object.keys(merged).length} tokens (remote: ${Object.keys(fetched.tokens).length}, inline fallbacks: ${Object.keys(inline).length})`)
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

		// 2. Read price: Solana manual feed (SPL tokens) or EVM oracle on-chain

		let oraclePriceData
		if (tokenConfig.solana) {
			runtime.log(`Reading Solana manual price feed ${tokenConfig.solana.priceFeed}`)
			oraclePriceData = fetchSolanaPrice(runtime, tokenConfig.solana.rpcUrl, tokenConfig.solana.priceFeed, tokenConfig.solana.maxStalenessSec)
		} else {
			runtime.log(`Reading oracle price from ${opsClaimData.oracleAddress} on ${opsClaimData.oracleChainSelectorName}`)
			oraclePriceData = readOraclePrice(
				runtime,
				opsClaimData.oracleAddress,
				opsClaimData.oracleChainSelectorName,
				8,
			)
		}

		let oraclePriceUSD = Number(oraclePriceData.answer) / Math.pow(10, oraclePriceData.decimals)
		runtime.log(`Oracle price: ${oraclePriceUSD} (raw: ${oraclePriceData.answer})`)
		if (!(oraclePriceUSD > 0)) {
			throw new Error(`Invalid oracle price for ${tokenConfig.name}: ${oraclePriceUSD} (raw ${oraclePriceData.answer}, feed ${opsClaimData.oracleAddress}) — oracle must return a positive answer.`)
		}

		// Non-USD oracle (mHyperBTC/BTC, mGLOeuro/EUR): convert the quote currency to USD via a
		// Chainlink feed so TVL and reserve are USD-denominated. `quoteRate` also scales the ops
		// NAV (reported in the oracle's native currency) in the fallback candidate below.
		let quoteRate = 1
		if (tokenConfig.oracleQuoteFeed) {
			const quoteData = readOraclePrice(runtime, tokenConfig.oracleQuoteFeed, tokenConfig.chainSelectorName, 8)
			quoteRate = Number(quoteData.answer) / Math.pow(10, quoteData.decimals)
			if (!(quoteRate > 0)) {
				throw new Error(`Invalid oracle quote-feed rate for ${tokenConfig.name}: ${quoteRate} (feed ${tokenConfig.oracleQuoteFeed}) — quote feed must return a positive answer.`)
			}
			oraclePriceUSD = oraclePriceUSD * quoteRate
			runtime.log(`Oracle quote conversion ×${quoteRate} (feed ${tokenConfig.oracleQuoteFeed}) → price ${oraclePriceUSD} USD`)
		}

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
		const hasVlayerHash = opsClaimData.vlayerClaimHash != null && opsClaimData.vlayerClaimHash.toLowerCase() !== ZERO_HASH
		if (hasVlayerHash && !tokenConfig.fundManager) {
			// Defensive: ops pushed a vlayer claim for a token that has NO `fundManager` in the token
			// registry — e.g. a 1token/CEX-only token (mHYPER, mHyperBTC, mWIN, mTBILL), or a
			// fundManager wired into ops before the registry entry was added. Skip vlayer and process
			// via 1token + ops instead of crashing on the missing config. When a `fundManager` IS
			// present, the branch below uses its exact fields (expectedEmail, receiver, navFields,
			// navIsTotal) — so adding one to the registry later "just works" with no code change.
			runtime.log(`WARN: ops pushed a vlayerClaimHash for ${tokenConfig.name} but no fundManager is configured in the registry — skipping vlayer, processing via 1token/ops only`)
		} else if (hasVlayerHash && tokenConfig.fundManager) {

			runtime.log(`Fetching Vlayer claim from IPFS: ${opsClaimData.vlayerClaimHash}`)
			const vlayerCid = hashToIPFSCid(opsClaimData.vlayerClaimHash!)

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
						oneTokenOnchainAUM = useNavBase ? report.navBase! : report.equityOnchain * 1_000_000
						runtime.log(`1token AUM: ${oneTokenOnchainAUM.toFixed(0)} USD (ts=${ts})`)
						// B: on-chain equity was floored to 0 upstream (off-chain keys exceeded total) — surface it.
						if ((report.equity.total ?? 0) - report.offchainEquity < 0) {
							runtime.log(`WARN: ${tokenConfig.name} 1token on-chain equity negative (total=${(report.equity.total ?? 0).toFixed(2)}M − offchain=${report.offchainEquity.toFixed(2)}M), floored to 0`)
						}
						// C: double-count trip-wire. For an additive fund (navIsTotal=false) the 1token report MUST
						// subtract the off-chain fund-share account (general_wallet); if nothing was subtracted, the
						// full equity (incl. fund shares) is about to be added to the vlayer NAV → double-count.
						if (tokenConfig.fundManager && !tokenConfig.fundManager.navIsTotal && report.offchainEquity === 0 && oneTokenOnchainAUM > 0) {
							runtime.log(`WARN: ${tokenConfig.name} navIsTotal=false but 1token subtracted 0 off-chain equity (offchainEquityKeys=${JSON.stringify(tokenConfig.oneTokenApi.offchainEquityKeys ?? ['general_wallet'])} not found) — risk of double-counting the fund NAV with vlayer; verify the 1token general_wallet key.`)
						}
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
					const usdcAddr = roc.usdcAddress ?? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
					const bal = readErc20BalanceDecimal(runtime, usdcAddr, wallet, tokenConfig.chainSelectorName, 6)
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

		// 1token equity is always USD (equityOnchain × 1e6). The legacy `useNavBase` path
		// (equity in the token's base currency) is deprecated — 1token's `pv_base` is unreliable
		// for multi-chain tokens (e.g. mHyperBTC, where non-cex chains come back in wrong units),
		// so every onboarded token uses `useNavBase:false`. Kept defensively for any future token
		// whose base-currency snapshot is trustworthy.
		const oneTokenOnchainAUMUSD = oneTokenOnchainAUM !== null && useNavBase
			? oneTokenOnchainAUM * oraclePriceUSD
			: oneTokenOnchainAUM

		// ===================== Overcollateralization (GROSS reserve ≥ TVL, USD) =====================
		// TVL = gross on-chain supply × oraclePriceUSD (oracle already USD-converted via oracleQuoteFeed
		// for non-USD oracles). Gross reserve candidates, first above threshold wins:
		//   method-1 (independent): vlayer fund NAV + 1token on-chain equity + on-chain reserves
		//   method-2 (fallback):    ops-reported gross × quoteRate
		// No net/pending subtraction, no price cross-check. Everything USD → BTC/EUR oracles work
		// once oracleQuoteFeed is set (mHyperBTC/BTC, mGLOeuro/EUR).

		const fm = tokenConfig.fundManager

		// Gross on-chain supply (cross-chain Midas endpoint), fallback ops-reported supply.
		let grossSupplyTokens = totalSupplyTokens
		let supplySource: 'onchain' | 'ops' | 'solana' = 'ops'
		if (tokenConfig.solana) {
			grossSupplyTokens = fetchSolanaSupply(runtime, tokenConfig.solana.rpcUrl, tokenConfig.solana.mint)
			supplySource = 'solana'
			runtime.log(`Gross supply (Solana SPL ${tokenConfig.solana.mint}): ${grossSupplyTokens.toFixed(4)}`)
			if (!(grossSupplyTokens > 0)) throw new Error(`Solana supply is zero for ${tokenConfig.name}.`)
		} else if (tokenConfig.address && oraclePriceUSD > 0) {
			const anchorForSupply = oneTokenAnchorISO ?? opsClaimData.createdAt
			const eventTsSec = Math.floor(new Date(anchorForSupply).getTime() / 1000)
			const midasSupply = fetchMidasTotalSupply(runtime, tokenConfig.address, eventTsSec, tokenConfig.chainSelectorName)
			if (midasSupply && midasSupply.supply > 0) {
				grossSupplyTokens = midasSupply.supply
				supplySource = 'onchain'
				runtime.log(`Gross supply (on-chain, ${Object.keys(midasSupply.supplyByChain).length} chains): ${grossSupplyTokens.toFixed(2)}`)
				if (totalSupplyTokens > 0) {
					const sr = totalSupplyTokens / midasSupply.supply
					if (sr < 0.5 || sr > 2.0) {
						runtime.log(`Sanity: ops supply ${totalSupplyTokens.toFixed(2)} vs on-chain ${midasSupply.supply.toFixed(2)} (ratio ${sr.toFixed(3)})`)
						throw new Error(`Pre-flight sanity check failed for ${tokenConfig.name}.`)
					}
				}
			} else {
				runtime.log('Gross supply: Midas endpoint unavailable — using ops-reported supply')
			}
		}
		const tvlUSD = grossSupplyTokens * oraclePriceUSD

		// Gross reserve candidates (all USD). First above threshold wins.
		const opsGrossUSD = (opsClaimData.navReportedByOpsGross != null
			? parseFloat(opsClaimData.navReportedByOpsGross)
			: parseFloat(opsClaimData.navReportedByOps)) * quoteRate

		const candidates: Array<{ grossReserveUSD: number; aumSource: string; supplySource: 'method-1' | 'method-2' }> = []
		if (fm?.navIsTotal && emailNavUSD !== null) {
			candidates.push({ grossReserveUSD: emailNavUSD + onchainReserveUSD, aumSource: 'method-1:vlayer_total', supplySource: 'method-1' })
		} else if (fm && !fm.navIsTotal && emailNavUSD !== null && oneTokenOnchainAUMUSD !== null) {
			candidates.push({ grossReserveUSD: emailNavUSD + oneTokenOnchainAUMUSD + onchainReserveUSD, aumSource: 'method-1:vlayer+1token', supplySource: 'method-1' })
		} else if (!fm && oneTokenOnchainAUMUSD !== null) {
			candidates.push({ grossReserveUSD: oneTokenOnchainAUMUSD + onchainReserveUSD, aumSource: 'method-1:1token', supplySource: 'method-1' })
		}
		candidates.push({ grossReserveUSD: opsGrossUSD, aumSource: 'method-2:ops', supplySource: 'method-2' })

		let selectedCandidate: { grossReserveUSD: number; aumSource: string; supplySource: 'method-1' | 'method-2'; ratio: number } | null = null
		for (const c of candidates) {
			const ratio = tvlUSD > 0 ? c.grossReserveUSD / tvlUSD : 0
			runtime.log(`Candidate ${c.aumSource}: reserve=${c.grossReserveUSD.toFixed(0)} / TVL=${tvlUSD.toFixed(0)} (supply ${grossSupplyTokens.toFixed(2)} × ${oraclePriceUSD.toFixed(6)}) = ratio ${ratio.toFixed(4)}`)
			if (ratio > threshold) { selectedCandidate = { grossReserveUSD: c.grossReserveUSD, aumSource: c.aumSource, supplySource: c.supplySource, ratio }; break }
		}

		if (!selectedCandidate) {
			throw new Error(
				`Overcollateralization check failed for ${tokenConfig.name}. ` +
				`All candidates below threshold=${threshold}. Attestation will not be pushed.`
			)
		}

		// Post-flight sanity: the reserve must not exceed on-chain TVL (supply × price) by more than
		// 30%. A ratio > 1.30 signals a currency mismatch (e.g. ops NAV entered in USD for a BTC/EUR
		// token so quoteRate double-scales it) or a double-count — reject rather than attest garbage.
		if (selectedCandidate.ratio > 1.30) {
			runtime.log(`Post-flight sanity FAILED: ${tokenConfig.name} ratio ${selectedCandidate.ratio.toFixed(4)} > 1.30 (reserve ${selectedCandidate.grossReserveUSD.toFixed(0)} > TVL ${tvlUSD.toFixed(0)} × 1.30), source=${selectedCandidate.aumSource}`)
			throw new Error(`Post-flight sanity check failed for ${tokenConfig.name}: overcollateralization ratio ${selectedCandidate.ratio.toFixed(4)} exceeds 1.30 (reserve > on-chain TVL + 30%).`)
		}

		runtime.log(`Overcollateralization passed: ${selectedCandidate.aumSource}, ratio=${selectedCandidate.ratio.toFixed(4)}, supply source=${supplySource}`)

		// 7. Build claims

		const opsClaimObject = createOpsClaimObject(opsClaimData)
		const oraclePriceObjectClaim = createOraclePriceObjectClaim(
			opsClaimData.oracleAddress,
			opsClaimData.oracleChainSelectorName,
			oraclePriceData,
		)
		const oraclePriceNumericClaim = createOraclePriceNumericClaim()
		const overcollateralizationClaim = createOvercollateralizationClaim({
			grossReserveUSD: selectedCandidate.grossReserveUSD,
			grossSupplyTokens,
			oraclePriceUSD,
			tvlUSD,
			ratio: selectedCandidate.ratio,
			threshold,
			aumSource: selectedCandidate.aumSource,
			opsClaimData,
			oracleRawPrice: Number(oraclePriceData.answer) / Math.pow(10, oraclePriceData.decimals),
			quoteRate,
			emailNavUSD,
			oneTokenOnchainAUMUSD,
			onchainReserveUSD,
		})

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
