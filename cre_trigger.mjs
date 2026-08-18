#!/usr/bin/env node
// Trigger deployed CRE workflow via JWT (per docs.chain.link/cre/.../triggering-deployed-workflows)
//
// Usage:
//   HTTP_TRIGGER_PRIV_KEY=0x... node /tmp/cre_trigger.mjs \
//     <workflowId no 0x> <proofId 0x...> <claimHash 0x...>
//
// Requires viem — run from midas-por dir OR set NODE_PATH=/path/to/midas-por/node_modules

import { privateKeyToAccount } from 'viem/accounts'
import crypto from 'node:crypto'

const GATEWAY = 'https://01.gateway.zone-a.cre.chain.link'

const PRIV = process.env.HTTP_TRIGGER_PRIV_KEY
if (!PRIV) throw new Error('Set HTTP_TRIGGER_PRIV_KEY env')
const key = PRIV.startsWith('0x') ? PRIV : `0x${PRIV}`
const account = privateKeyToAccount(key)

const [, , workflowId, proofId, claimHash] = process.argv
if (!workflowId || !proofId || !claimHash) {
  console.error('Usage: cre_trigger.mjs <workflowId> <proofId> <claimHash>')
  process.exit(1)
}

const wfId = workflowId.startsWith('0x') ? workflowId.slice(2) : workflowId

console.log('Signer:', account.address)

function sortKeys(v) {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(sortKeys)
  const out = {}
  for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k])
  return out
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

const reqId = `midas-${wfId.slice(0, 8)}-${Date.now()}`

const body = {
  jsonrpc: '2.0',
  id: reqId,
  method: 'workflows.execute',
  params: {
    input: { proofId, claimHash, attestationHash: claimHash },
    workflow: { workflowID: wfId },
  },
}

const sortedJson = JSON.stringify(sortKeys(body))
const digest = '0x' + crypto.createHash('sha256').update(sortedJson, 'utf8').digest('hex')
const iat = Math.floor(Date.now() / 1000)
const exp = iat + 300

const header = { alg: 'ETH', typ: 'JWT' }
const payload = {
  digest,
  iss: account.address,
  iat,
  exp,
  jti: crypto.randomUUID(),
}

const hB64 = b64url(JSON.stringify(header))
const pB64 = b64url(JSON.stringify(payload))
const signingInput = `${hB64}.${pB64}`

// EIP-191 personal_sign over signingInput
const sigHex = await account.signMessage({ message: signingInput })
const sigBytes = Buffer.from(sigHex.slice(2), 'hex') // 65 bytes r||s||v
const sB64 = b64url(sigBytes)

const jwt = `${signingInput}.${sB64}`

console.log('JWT length:', jwt.length)
console.log('POST', GATEWAY)

const res = await fetch(GATEWAY, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt}`,
  },
  body: JSON.stringify(body),
})
const text = await res.text()
console.log('HTTP', res.status)
console.log(text)
process.exit(res.status < 400 ? 0 : 1)
