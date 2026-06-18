/**
 * Token registry fetch utility.
 *
 * Fetches the canonical token registry from a public GitHub-hosted JSON file
 * with multi-mirror fallback (raw.githubusercontent.com → jsdelivr CDN).
 *
 * All DON nodes must obtain the same content (enforced via
 * consensusIdenticalAggregation by the caller).
 */

import { HTTPClient, type NodeRuntime } from '@chainlink/cre-sdk'

export interface TokenRegistryFile {
	version: number
	lastUpdated?: string
	tokens: Record<string, unknown>
}

export interface TokenRegistryConfig {
	url: string
	fallbackUrl?: string
}

const DEFAULT_TIMEOUT = '10s'
const DEFAULT_CACHE_MAX_AGE = '30s'

/**
 * Fetch the token registry JSON from the configured URL.
 * Single-shot to keep the per-workflow HTTP budget bounded — the workflow
 * falls back to inline `config.tokens` if this call fails, so a second URL
 * mirror is not worth the budget cost.
 * Must be called from inside runInNodeMode with consensusIdenticalAggregation.
 */
export function fetchTokenRegistry<T>(
	nodeRuntime: NodeRuntime<T>,
	cfg: TokenRegistryConfig,
): TokenRegistryFile {
	const sources: string[] = [cfg.url]

	const httpClient = new HTTPClient()
	let lastError = 'no sources tried'

	for (const url of sources) {
		try {
			const response = httpClient.sendRequest(nodeRuntime, {
				url,
				method: 'GET' as const,
				headers: { 'Accept': 'application/json' },
				timeout: DEFAULT_TIMEOUT,
				cacheSettings: { store: true, maxAge: DEFAULT_CACHE_MAX_AGE },
			}).result()

			if (response.statusCode !== 200) {
				lastError = `${url} returned ${response.statusCode}`
				continue
			}

			const body = new TextDecoder().decode(response.body)
			const parsed = JSON.parse(body) as TokenRegistryFile

			if (typeof parsed !== 'object' || parsed === null || typeof parsed.tokens !== 'object') {
				lastError = `${url} returned invalid registry shape`
				continue
			}

			return parsed
		} catch (e) {
			lastError = `${url} failed: ${e instanceof Error ? e.message : String(e)}`
		}
	}

	throw new Error(`Failed to fetch token registry from all sources. Last error: ${lastError}`)
}
