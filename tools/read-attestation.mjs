#!/usr/bin/env node
// Read a Midas PoR attestation from its on-chain attestationHash.
//
// Usage:
//   node read-attestation.mjs <0x-bytes32-attestationHash>
//   node read-attestation.mjs <0x-bytes32> --json
//
// Resolves the hash to an IPFS CIDv0, fetches the gzipped JSON from public
// gateways, decompresses, and prints the attestation. With --json prints the
// raw JSON; otherwise prints a human summary.

import { gunzipSync } from 'node:zlib'

const GATEWAYS = [
	'https://gateway.pinata.cloud/ipfs/',
	'https://cloudflare-ipfs.com/ipfs/',
	'https://ipfs.io/ipfs/',
	'https://dweb.link/ipfs/',
]

const REGISTRY_URLS = [
	'https://cdn.jsdelivr.net/gh/midas-apps/midas-por-v2@main/tokens.json',
	'https://raw.githubusercontent.com/midas-apps/midas-por-v2/main/tokens.json',
]

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Encode(bytes) {
	let zeros = 0
	while (zeros < bytes.length && bytes[zeros] === 0) zeros++
	const size = Math.ceil(((bytes.length - zeros) * 138) / 100) + 1
	const b58 = new Uint8Array(size)
	let length = 0
	for (let i = zeros; i < bytes.length; i++) {
		let carry = bytes[i]
		let j = 0
		for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
			carry += 256 * b58[k]
			b58[k] = carry % 58
			carry = Math.floor(carry / 58)
		}
		length = j
	}
	let it = size - length
	while (it < size && b58[it] === 0) it++
	let out = '1'.repeat(zeros)
	for (; it < size; it++) out += BASE58[b58[it]]
	return out
}

function hashToCid(hexHash) {
	const clean = hexHash.replace(/^0x/, '').toLowerCase()
	if (!/^[0-9a-f]{64}$/.test(clean)) {
		throw new Error('Expected a 32-byte hex hash (0x + 64 hex chars)')
	}
	const multihash = '1220' + clean
	const bytes = new Uint8Array(34)
	for (let i = 0; i < 34; i++) bytes[i] = parseInt(multihash.slice(i * 2, i * 2 + 2), 16)
	return base58Encode(bytes)
}

async function fetchWithFallback(urls, decode = (r) => r.arrayBuffer()) {
	const errors = []
	for (const url of urls) {
		try {
			const r = await fetch(url, { redirect: 'follow' })
			if (!r.ok) {
				errors.push(`${url} → HTTP ${r.status}`)
				continue
			}
			return { url, data: await decode(r) }
		} catch (e) {
			errors.push(`${url} → ${e.message}`)
		}
	}
	throw new Error(`All sources failed:\n  ${errors.join('\n  ')}`)
}

async function fetchAttestationFromIpfs(cid) {
	const urls = GATEWAYS.map((g) => g + cid)
	const { url, data } = await fetchWithFallback(urls)
	const compressed = Buffer.from(data)
	let json
	try {
		const decompressed = gunzipSync(compressed)
		json = JSON.parse(decompressed.toString('utf8'))
	} catch {
		json = JSON.parse(compressed.toString('utf8'))
	}
	return { gateway: url, attestation: json }
}

async function fetchTokenRegistry() {
	try {
		const { data } = await fetchWithFallback(REGISTRY_URLS, (r) => r.json())
		return data
	} catch {
		return null
	}
}

function findTokenName(registry, proofId) {
	if (!registry?.tokens || !proofId) return null
	const key = Object.keys(registry.tokens).find((k) => k.toLowerCase() === proofId.toLowerCase())
	return key ? registry.tokens[key].name : null
}

function fmt(value) {
	if (value === null || value === undefined) return '-'
	if (typeof value === 'number') return value.toLocaleString('en-US')
	if (typeof value === 'string') return value
	return JSON.stringify(value)
}

function summarize(attestation, tokenName) {
	const lines = []
	const m = attestation.metadata ?? {}
	const sig = attestation.signature ?? {}
	const sigHex = typeof sig === 'string' ? sig : sig.signature
	lines.push('─'.repeat(72))
	lines.push(`  Midas PoR Attestation`)
	lines.push('─'.repeat(72))
	lines.push(`  Token         : ${tokenName ?? '(unknown — proofId not in registry)'}`)
	lines.push(`  proofId       : ${m.proofId ?? '-'}`)
	lines.push(`  attestationId : ${m.attestationId ?? '-'}`)
	lines.push(`  Schema        : ${m.schema ?? '-'} / ${m.version ?? '-'}`)
	lines.push(`  Issuer        : ${m.issuer?.name ?? '-'} (${m.issuer?.identity ?? '-'})`)
	lines.push(`  Public key URL: ${sig.publicKeySource ?? '-'}`)
	lines.push(`  Created at    : ${m.createdAt ?? '-'}`)
	lines.push(`  Expires at    : ${m.expiresAt ?? '-'}`)
	lines.push(`  Sig algo      : ${sig.algorithm ?? '-'}`)
	lines.push(`  Signature     : ${typeof sigHex === 'string' ? sigHex.slice(0, 22) + '…' : '-'}`)
	lines.push('')

	const claims = attestation.claims ?? []
	lines.push(`  Claims (${claims.length})`)
	lines.push('─'.repeat(72))
	for (const c of claims) {
		lines.push('')
		const typeLabel = c.claimType ?? c.format ?? '?'
		const extra = c.format && c.format !== c.claimType ? ` · ${c.format}` : ''
		lines.push(`  • [${c.id}] (${typeLabel}${extra})`)
		if (c.description) lines.push(`    ${c.description}`)
		const data = c.data
		if (data == null) {
			if (c.pointer) lines.push(`    pointer       : ${c.pointer}`)
			if (c.resolvedValue !== undefined) lines.push(`    resolvedValue : ${typeof c.resolvedValue === 'object' ? JSON.stringify(c.resolvedValue) : c.resolvedValue}`)
			continue
		}

		if (c.id === 'onchain_supply') {
			lines.push(`    chain         : ${data.chainSelectorName}`)
			lines.push(`    token         : ${data.tokenAddress}`)
			lines.push(`    totalSupply   : ${data.supply}  (raw=${data.supplyRaw}, decimals=${data.decimals})`)
			lines.push(`    readAt        : ${data.readAt}`)
		} else if (c.id === 'oracle_price') {
			lines.push(`    chain         : ${data.chainSelectorName}`)
			lines.push(`    oracle        : ${data.oracleAddress}`)
			lines.push(`    priceRaw      : ${data.priceRaw} (decimals=${data.decimals})`)
			lines.push(`    updatedAt     : ${data.oracleLastUpdatedAtISO}`)
		} else if (c.id === 'overcollateralization') {
			lines.push(`    type          : ${data.overcollateralizationType}`)
			lines.push(`    aumSource     : ${data.aumSource}`)
			lines.push(`    supplySource  : ${data.supplySource}`)
			lines.push(`    Total reserve : ${data.totalReserveUSD ?? data.oneTokenAUM ?? '-'} USD  (compare against supplyTokens × oraclePrice)`)
			lines.push(`    supply tokens : ${data.supplyTokens ?? data.totalSupplyTokens ?? '-'}`)
			lines.push(`    navPerToken   : ${data.navPerToken}`)
			lines.push(`    oraclePrice   : ${data.oraclePriceFormatted}`)
			lines.push(`    threshold     : ${data.threshold}`)
			lines.push(`    ratio         : ${data.ratio} ${data.passed ? '✓ PASSED' : '✗ FAILED'}`)
			if (data.pendingRedemptionUSD) lines.push(`    pending (USD) : ${data.pendingRedemptionUSD}`)
			if (data.fundManagerNavUSD) lines.push(`    FM NAV (USD)  : ${data.fundManagerNavUSD}`)
		} else if (c.id === 'ops_claim') {
			lines.push(`    token         : ${data.token}`)
			lines.push(`    NAV           : ${data.navReportedByOps}`)
			lines.push(`    crossChainSup : ${data.totalSupplyCrossChainReportedByOps}`)
			if (data.createdAt) lines.push(`    createdAt     : ${data.createdAt}`)
		} else if (c.id === 'onetoken_report') {
			const eq = data.equity?.total
			const meta = data._metadata ?? {}
			lines.push(`    source        : ${meta.source ?? '1token'}`)
			lines.push(`    snapshot      : ${meta.anchorISO ?? '-'} (rule=${meta.anchorRule ?? '-'})`)
			lines.push(`    equity.total  : ${fmt(eq)}`)
			const wallets = data.nav_by_wallet?.pv_usd ?? data.nav_by_wallet?.pv_base ?? data.nav_by_wallet
			if (wallets && typeof wallets === 'object') {
				lines.push(`    wallets       : ${Object.keys(wallets).length} entries`)
			}
		} else if (c.id === 'email_nav') {
			lines.push(`    navUSD        : ${data.navUSD}`)
			lines.push(`    navIsTotal    : ${data.navIsTotal}`)
			lines.push(`    fields summed : ${JSON.stringify(data.navFields)}`)
		} else if (typeof data === 'object') {
			for (const [k, v] of Object.entries(data)) {
				const display = typeof v === 'object' ? JSON.stringify(v).slice(0, 60) + '…' : fmt(v)
				lines.push(`    ${k.padEnd(14)}: ${display}`)
			}
		} else {
			lines.push(`    value         : ${fmt(data)}`)
		}
	}
	lines.push('')
	return lines.join('\n')
}

async function main() {
	const args = process.argv.slice(2)
	const jsonMode = args.includes('--json')
	const hash = args.find((a) => /^0x?[0-9a-fA-F]+$/.test(a))
	if (!hash) {
		console.error('Usage: read-attestation.mjs <0x-attestationHash> [--json]')
		process.exit(1)
	}

	const cid = hashToCid(hash)
	console.error(`→ Resolved CID: ${cid}`)

	const [{ gateway, attestation }, registry] = await Promise.all([
		fetchAttestationFromIpfs(cid),
		fetchTokenRegistry(),
	])
	console.error(`→ Fetched from: ${gateway}`)

	if (jsonMode) {
		console.log(JSON.stringify(attestation, null, 2))
		return
	}

	const tokenName = findTokenName(registry, attestation.metadata?.proofId)
	console.log(summarize(attestation, tokenName))
}

main().catch((e) => {
	console.error('Error:', e.message)
	process.exit(1)
})
