import {
	consensusIdenticalAggregation,
	HTTPClient,
	Runtime,
	type NodeRuntime,
	EVMClient,
	encodeCallMsg,
	bytesToHex,
	LATEST_BLOCK_NUMBER,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult, zeroAddress } from 'viem'
import type { Config } from './config.js'
import { stringToBase64 } from '../library/utils.js'
import { getNetworkByChainSelector } from '../library/config-schemas.js'

/**
 * Vlayer verification result - raw response from vlayer API
 */
export interface VlayerVerificationResult {
	success: boolean
	serverDomain: string
	notaryKeyFingerprint: string
	request: {
		body: string | null
		headers: Array<[string, string]>
		method: string
		raw: string
		url: string
		version: string
	}
	response: {
		body: string
		headers: Array<[string, string]>
		raw: string
		status: number
		version: string
	}
}

interface VlayerVerificationResultConsensus {
	success: boolean
	serverDomain: string
	notaryKeyFingerprint: string
	request: {
		headers: Array<[string, string]>
		method: string
		raw: string
		url: string
		version: string
	}
	response: {
		body: string
		headers: Array<[string, string]>
		raw: string
		status: number
		version: string
	}
}

function verifyClaimWithVlayerInternal(
	nodeRuntime: NodeRuntime<Config>,
	proof: { data: string; version: string; meta: { notaryUrl: string } },
	vlayerUrl: string,
	clientId: string,
	authToken: string
): VlayerVerificationResultConsensus {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (clientId) headers['x-client-id'] = clientId
	if (authToken) headers['Authorization'] = `Bearer ${authToken}`

	const httpClient = new HTTPClient()
	const body = stringToBase64(JSON.stringify(proof))

	const response = httpClient.sendRequest(nodeRuntime, {
		url: vlayerUrl,
		method: 'POST' as const,
		headers,
		body,
		timeout: '10s',
		cacheSettings: { store: true, maxAge: '30s' },
	}).result()

	if (response.statusCode !== 200) {
		const errorBody = new TextDecoder().decode(response.body)
		throw new Error(`vlayer verification failed with status ${response.statusCode}: ${errorBody}`)
	}

	const fullResponse = JSON.parse(new TextDecoder().decode(response.body))

	return {
		success: fullResponse.success,
		serverDomain: fullResponse.serverDomain,
		notaryKeyFingerprint: fullResponse.notaryKeyFingerprint,
		request: {
			headers: fullResponse.request.headers,
			method: fullResponse.request.method,
			raw: fullResponse.request.raw,
			url: fullResponse.request.url,
			version: fullResponse.request.version,
		},
		response: {
			body: fullResponse.response.body,
			headers: fullResponse.response.headers,
			raw: fullResponse.response.raw,
			status: fullResponse.response.status,
			version: fullResponse.response.version,
		},
	}
}

const VLAYER_URL = 'https://web-prover.vlayer.xyz/api/v1/verify'
const VLAYER_CLIENT_ID = '3fa54803-7047-41af-bf4b-0e73db72ae63'

/**
 * Verify Vlayer claim with DON consensus.
 */
export async function verifyClaimWithVlayer(
	runtime: Runtime<Config>,
	proofData: any,
): Promise<VlayerVerificationResult> {
	const authToken = runtime.getSecret({ id: 'vlayerauthtoken' }).result().value as string

	const consensus = runtime.runInNodeMode(
		(nodeRuntime: NodeRuntime<Config>) => verifyClaimWithVlayerInternal(
			nodeRuntime,
			proofData,
			VLAYER_URL,
			VLAYER_CLIENT_ID,
			authToken
		),
		consensusIdenticalAggregation<VlayerVerificationResultConsensus>()
	)().result()

	const result: VlayerVerificationResult = {
		success: consensus.success,
		serverDomain: consensus.serverDomain,
		notaryKeyFingerprint: consensus.notaryKeyFingerprint,
		request: {
			body: null,
			headers: consensus.request.headers,
			method: consensus.request.method,
			raw: consensus.request.raw,
			url: consensus.request.url,
			version: consensus.request.version,
		},
		response: consensus.response,
	}

	if (!result.success) {
		throw new Error('vlayer verification failed')
	}

	return result
}

/**
 * Oracle price data from AggregatorV3Interface.latestRoundData()
 */
export interface OraclePriceData {
	answer: bigint
	updatedAt: number
	decimals: number
}

const aggregatorV3ABI = [
	{
		name: 'latestRoundData',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [
			{ name: 'roundId', type: 'uint80' },
			{ name: 'answer', type: 'int256' },
			{ name: 'startedAt', type: 'uint256' },
			{ name: 'updatedAt', type: 'uint256' },
			{ name: 'answeredInRound', type: 'uint80' },
		],
	},
] as const

/**
 * Read oracle price from on-chain AggregatorV3Interface.
 * All params are explicit (per-token config).
 */
export function readOraclePrice(
	runtime: Runtime<Config>,
	oracleAddress: string,
	chainSelectorName: string,
	decimals: number,
): OraclePriceData {
	const oracleNetwork = getNetworkByChainSelector(chainSelectorName)
	if (!oracleNetwork) {
		throw new Error(`Oracle network not found for chain selector: ${chainSelectorName}`)
	}

	const oracleEvmClient = new EVMClient(oracleNetwork.chainSelector.selector)

	const callData = encodeFunctionData({
		abi: aggregatorV3ABI,
		functionName: 'latestRoundData',
	})

	const result = oracleEvmClient
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: oracleAddress as `0x${string}`,
				data: callData,
			}),
			blockNumber: LATEST_BLOCK_NUMBER,
		})
		.result()

	const decoded = decodeFunctionResult({
		abi: aggregatorV3ABI,
		functionName: 'latestRoundData',
		data: bytesToHex(result.data),
	}) as readonly [bigint, bigint, bigint, bigint, bigint]

	return {
		answer: decoded[1],
		updatedAt: Number(decoded[3]),
		decimals,
	}
}


/**
 * Extract NAV from a Vlayer fund manager email by summing the configured navFields.
 * Each field in navFields is matched case-insensitively as a substring of a line.
 * All matched fields must be found; returns null if any field is missing.
 */
export function extractNavFromEmail(
	emailClaim: { resolve: (pointer: string) => unknown },
	navFields: string[],
): number | null {
	try {
		const body = emailClaim.resolve(
			'/response/@parseJson(body)/payload/parts/0/body/@decodeBase64(data)'
		) as string

		if (typeof body !== 'string' || navFields.length === 0) return null

		const lines = body.split('\n')

		const parseAmount = (line: string): number | null => {
			const match = line.match(/([\d,]+\.?\d*)\s*(?:USD)?[\s]*$/)
			if (!match) return null
			const num = parseFloat(match[1].replace(/,/g, ''))
			return isNaN(num) ? null : num
		}

		let total = 0
		for (const field of navFields) {
			let found = false
			for (const line of lines) {
				if (line.trim().toLowerCase().includes(field.toLowerCase())) {
					const amount = parseAmount(line.trim())
					if (amount !== null) {
						total += amount
						found = true
						break
					}
				}
			}
			if (!found) return null
		}

		return total
	} catch {
		return null
	}
}

const totalSupplyABI = [
	{
		name: 'totalSupply',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'uint256' }],
	},
] as const

export interface OnchainSupplyData {
	supplyRaw: bigint
	supply: number
	decimals: number
}

/**
 * Read ERC-20 totalSupply() at latest block.
 */
export function readOnchainTotalSupply(
	runtime: Runtime<Config>,
	tokenAddress: string,
	decimals: number,
	chainSelectorName: string,
): OnchainSupplyData {
	const network = getNetworkByChainSelector(chainSelectorName)
	if (!network) throw new Error(`Network not found for chain selector: ${chainSelectorName}`)

	const evmClient = new EVMClient(network.chainSelector.selector)

	const callData = encodeFunctionData({ abi: totalSupplyABI, functionName: 'totalSupply' })

	const result = evmClient
		.callContract(runtime, {
			call: encodeCallMsg({ from: zeroAddress, to: tokenAddress as `0x${string}`, data: callData }),
			blockNumber: LATEST_BLOCK_NUMBER,
		})
		.result()

	const supplyRaw = decodeFunctionResult({
		abi: totalSupplyABI,
		functionName: 'totalSupply',
		data: bytesToHex(result.data),
	}) as bigint

	return { supplyRaw, supply: Number(supplyRaw) / Math.pow(10, decimals), decimals }
}


/**
 * 1token report data — equity in millions USD, navBase in fund base currency (e.g. BTC)
 */
export interface OneTokenReportData {
	assets: Record<string, number>
	liabilities: Record<string, number>
	equity: Record<string, number>
	navBase?: number
	/** Pending redemption extracted from nav_by_wallet entries matching the pattern. Unit matches the AUM unit: raw base currency (e.g. BTC) when useNavBase=true, USD otherwise (already converted from millions). Only present if a pattern was provided to fetch. */
	pendingRedemption?: number
}

const ONE_TOKEN_API_URL = 'https://api-prod.midas.app/api/transparency/by-timestamp'

/**
 * Sum nav_by_wallet entries whose key contains the pattern (case-insensitive).
 * The 1token wallet keys look like "('0xabc...', 'mHyperBTC_Redemption_Vault_Ethereum')".
 * When useNavBase is true, sums from `pv_base` (in the token's native base currency,
 * e.g. BTC for mHyperBTC). Otherwise sums from `pv_usd` (in millions USD).
 * Returns 0 if no match or no nav_by_wallet.
 */
function sumNavByWalletPattern(reports: any, pattern: string, useNavBase: boolean): number {
	const navByWallet = useNavBase ? reports?.nav_by_wallet?.pv_base : reports?.nav_by_wallet?.pv_usd
	if (!navByWallet || typeof navByWallet !== 'object') return 0
	const needle = pattern.toLowerCase()
	let total = 0
	for (const [key, value] of Object.entries(navByWallet)) {
		if (typeof value !== 'number') continue
		if (key.toLowerCase().includes(needle)) total += value
	}
	return total
}

function fetchOneTokenReportInternal(
	nodeRuntime: NodeRuntime<Config>,
	tokenName: string,
	timestamp: string,
	pendingPattern?: string,
	useNavBase: boolean = false,
): OneTokenReportData {
	const url = `${ONE_TOKEN_API_URL}?token=${tokenName}&timestamp=${timestamp}`

	const httpClient = new HTTPClient()
	const response = httpClient.sendRequest(nodeRuntime, {
		url,
		method: 'GET' as const,
		headers: {} as Record<string, string>,
		timeout: '10s',
		cacheSettings: { store: true, maxAge: '30s' },
	}).result()

	const bodyText = response.body ? new TextDecoder().decode(response.body) : ''

	if (response.statusCode !== 200) {
		throw new Error(`1token API returned status ${response.statusCode}: ${bodyText.slice(0, 200)}`)
	}

	if (!bodyText) {
		throw new Error(`1token API returned empty body (status ${response.statusCode})`)
	}

	const fullResponse = JSON.parse(bodyText)
	const reports = fullResponse?.reports
	const report = reports?.assets_and_liabilities_by_protocol

	if (!report || typeof report.equity?.total !== 'number') {
		throw new Error(`1token response missing equity.total. Body: ${bodyText.slice(0, 300)}`)
	}

	// Return only numeric fields to avoid null values crashing the CRE WASM serializer
	const sanitize = (obj: Record<string, unknown>): Record<string, number> =>
		Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'number' ? v : 0]))

	const navBaseCurrencyTotal = reports?.nav_by_chain?.pv_base?.total
	const pendingRaw = pendingPattern ? sumNavByWalletPattern(reports, pendingPattern, useNavBase) : undefined
	// pv_base is in raw base currency (e.g. BTC). pv_usd is in millions USD — convert to USD.
	const pending = typeof pendingRaw === 'number'
		? (useNavBase ? pendingRaw : pendingRaw * 1_000_000)
		: undefined

	return {
		assets: sanitize(report.assets ?? {}),
		liabilities: sanitize(report.liabilities ?? {}),
		equity: sanitize(report.equity ?? {}),
		...(typeof navBaseCurrencyTotal === 'number' ? { navBase: navBaseCurrencyTotal } : {}),
		...(typeof pending === 'number' ? { pendingRedemption: pending } : {}),
	}
}

export interface SupplyDetailsData {
	supply: number
	price: number
	tvl: number
	timestamp: number
}

function fetchSupplyDetailsInternal(
	nodeRuntime: NodeRuntime<Config>,
	tokenName: string,
): SupplyDetailsData {
	const url = 'https://api-prod.midas.app/api/data/prices/details'
	const httpClient = new HTTPClient()
	const response = httpClient.sendRequest(nodeRuntime, {
		url,
		method: 'GET' as const,
		headers: {} as Record<string, string>,
		timeout: '10s',
		cacheSettings: { store: true, maxAge: '30s' },
	}).result()

	const bodyText = response.body ? new TextDecoder().decode(response.body) : ''
	if (response.statusCode !== 200) throw new Error(`supply/details status ${response.statusCode}`)
	if (!bodyText) throw new Error('supply/details empty body')

	const data = JSON.parse(bodyText)
	// Response structure: { details: { mHyperBTC: { supply, price, tvl, timestamp }, ... }, ... }
	const entry = data?.details?.[tokenName]
	if (!entry || typeof entry.supply !== 'number') {
		const keys = Object.keys(data?.details ?? data).slice(0, 5).join(', ')
		throw new Error(`prices/details: token ${tokenName} not found. Keys: ${keys}`)
	}

	return {
		supply: entry.supply,
		price: entry.price,
		tvl: entry.tvl,
		timestamp: entry.timestamp,
	}
}

export function fetchSupplyDetails(
	runtime: Runtime<Config>,
	tokenName: string,
): SupplyDetailsData {
	return runtime.runInNodeMode(
		(nodeRuntime: NodeRuntime<Config>) => fetchSupplyDetailsInternal(nodeRuntime, tokenName),
		consensusIdenticalAggregation<SupplyDetailsData>()
	)().result()
}

/**
 * Fetch 1token report with CRE consensus.
 * oneTokenApi config is passed explicitly (per-token config).
 * Returns null if unavailable — never blocking.
 */
export function fetchOneTokenReport(
	runtime: Runtime<Config>,
	timestamp: string,
	oneTokenApi: { tokenName: string; useNavBase?: boolean },
	pendingPattern?: string,
): OneTokenReportData | null {
	return runtime.runInNodeMode(
		(nodeRuntime: NodeRuntime<Config>) => fetchOneTokenReportInternal(
			nodeRuntime,
			oneTokenApi.tokenName,
			timestamp,
			pendingPattern,
			oneTokenApi.useNavBase ?? false,
		),
		consensusIdenticalAggregation<OneTokenReportData>()
	)().result()
}

/**
 * Midas external supply endpoint — returns gross cross-chain supply for a token address.
 * Public endpoint (no auth). Returns the total supply already in decimal units (not raw).
 */
export interface MidasTotalSupplyData {
	supply: number
	supplyByChain: Record<string, number>
}

const MIDAS_SUPPLY_API_URL = 'https://api-prod.midas.app/api/data/supply/total/address'

function fetchMidasTotalSupplyInternal(
	nodeRuntime: NodeRuntime<Config>,
	tokenAddress: string,
	timestamp: number,
	chainSelectorName: string = 'ethereum-mainnet',
): MidasTotalSupplyData {
	const url = `${MIDAS_SUPPLY_API_URL}/${tokenAddress}?timestamp=${timestamp}&chain=${chainSelectorName}`

	const httpClient = new HTTPClient()
	const response = httpClient.sendRequest(nodeRuntime, {
		url,
		method: 'GET' as const,
		headers: { 'Accept': 'application/json' },
		timeout: '10s',
		cacheSettings: { store: true, maxAge: '30s' },
	}).result()

	const bodyText = response.body ? new TextDecoder().decode(response.body) : ''

	if (response.statusCode !== 200) {
		throw new Error(`Midas supply API returned status ${response.statusCode}: ${bodyText.slice(0, 200)}`)
	}

	const parsed = JSON.parse(bodyText)
	if (typeof parsed?.supply !== 'number') {
		throw new Error(`Midas supply API response missing 'supply' field. Body: ${bodyText.slice(0, 200)}`)
	}

	const byChain: Record<string, number> = {}
	if (parsed.supplyByChain && typeof parsed.supplyByChain === 'object') {
		for (const [chain, value] of Object.entries(parsed.supplyByChain)) {
			if (typeof value === 'number') byChain[chain] = value
		}
	}

	return { supply: parsed.supply, supplyByChain: byChain }
}

/**
 * Fetch total cross-chain supply from the Midas API with DON consensus.
 * Returns null if the call fails so the workflow can fall back to method-2.
 */
export function fetchMidasTotalSupply(
	runtime: Runtime<Config>,
	tokenAddress: string,
	timestamp: number,
	chainSelectorName: string = 'ethereum-mainnet',
): MidasTotalSupplyData | null {
	try {
		return runtime.runInNodeMode(
			(nodeRuntime: NodeRuntime<Config>) => fetchMidasTotalSupplyInternal(
				nodeRuntime,
				tokenAddress,
				timestamp,
				chainSelectorName,
			),
			consensusIdenticalAggregation<MidasTotalSupplyData>()
		)().result()
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		runtime.log(`WARN: Midas supply API call failed (${msg}), method-1 unavailable`)
		return null
	}
}
