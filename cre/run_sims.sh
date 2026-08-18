#!/usr/bin/env bash
# Batch-run `cre workflow simulate` for every token that has a recent NewClaim tx.
# Non-interactive (bypasses the TTY trigger prompt). Writes one log per token +
# a summary to /tmp/por_sim/ so the results can be analyzed afterwards.
#
# Usage:  bash cre/run_sims.sh
set -uo pipefail

cd "$(dirname "$0")"                 # -> cre/
OUT=/tmp/por_sim
mkdir -p "$OUT"
ENV="./.env.prod"
TARGET="por-attester-prod"          # prod config registry points at localhost:8899

# --- ensure the local token registry (full tokens.json) is served ---
if ! curl -sf http://localhost:8899/tokens.json >/dev/null 2>&1; then
  echo "Starting local token registry on :8899 ..."
  ( cd .. && nohup python3 -m http.server 8899 >/tmp/por_registry.log 2>&1 & )
  sleep 1
fi
if curl -sf http://localhost:8899/tokens.json >/dev/null 2>&1; then
  echo "Registry OK: $(curl -s http://localhost:8899/tokens.json | jq -r '.tokens|length') tokens on :8899"
else
  echo "WARN: localhost:8899 not reachable — prod config will fall back to inline tokens"
fi

# Token names to simulate — the NewClaim tx-hash for each is looked up LIVE on-chain
# below (latest claim wins), so this never tests a stale claim whose IPFS content
# may have rotted (vlayer proofs in particular are pinned per-push, not reliably
# long-lived — see the mFONE Aug-11 vs Aug-18 fetch-availability incident).
TOKEN_NAMES=(mFONE mHyperBTC mWIN mGLOBAL mM1-USD mHYPER)

RPC="https://mainnet.gateway.tenderly.co"           # keyless, serves full history (unlike rate-limited public RPCs)
REGISTRY_CONTRACT="0x2D6e9F608807436DE5D9603B00Abe3FEd1Bc809d"
PROVIDER_TOPIC="0x0000000000000000000000008003544d32ee074aa8a1fb72129fa8ef7fe02e5f"
CLAIMTYPE_TOPIC="0xcecc8202c7e9b8654414c0de09657c531f6ece617258c3682ac4317cbf462120"

echo "Resolving latest on-chain NewClaim tx per token..."
SIMS=()
for nm in "${TOKEN_NAMES[@]}"; do
  proofid=$(jq -r --arg n "$nm" '.tokens|to_entries[]|select(.value.name==$n)|.key' ../tokens.json)
  if [ -z "$proofid" ] || [ "$proofid" = "null" ]; then
    echo "WARN: $nm not found in tokens.json — skipping"
    continue
  fi
  resp=$(curl -s "$RPC" -X POST -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getLogs\",\"params\":[{\"address\":\"$REGISTRY_CONTRACT\",\"topics\":[null,\"$proofid\",\"$PROVIDER_TOPIC\",\"$CLAIMTYPE_TOPIC\"],\"fromBlock\":\"0x0\",\"toBlock\":\"latest\"}]}")
  tx=$(echo "$resp" | jq -r '.result | sort_by(.blockNumber) | last | .transactionHash // empty')
  # data = "0x" + previousClaimHash(64) + claimHash(64) + timestamp(64 hex chars, uint48 zero-padded)
  ts_hex=$(echo "$resp" | jq -r '.result | sort_by(.blockNumber) | last | .data // empty' | cut -c131-194)
  if [ -z "$tx" ]; then
    echo "WARN: no on-chain NewClaim found for $nm (proofId $proofid) — skipping"
    continue
  fi
  when="?"
  [ -n "$ts_hex" ] && when=$(date -u -r "$((16#$ts_hex))" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "?")
  echo "  $nm -> $tx ($when)"
  SIMS+=("$nm $tx")
done

SUMMARY="$OUT/summary.txt"
: > "$SUMMARY"
echo "=== PoR simulate batch $(date -u '+%Y-%m-%dT%H:%M:%SZ') ===" | tee -a "$SUMMARY"

for row in "${SIMS[@]}"; do
  nm=$(awk '{print $1}' <<<"$row")
  tx=$(awk '{print $2}' <<<"$row")
  log="$OUT/${nm}.log"
  echo ">>> simulating $nm ($tx)"
  cre workflow simulate ./por_attestation --target "$TARGET" \
    --evm-tx-hash "$tx" --evm-event-index 0 --trigger-index 0 \
    --limits none --non-interactive -e "$ENV" > "$log" 2>&1

  # verdict extraction (sim exit code is unreliable; read the log)
  passed=$(grep -aoE "Overcollateralization passed: [^,]+, ratio=[0-9.]+" "$log" | tail -1)
  cand=$(grep -aoE "Candidate method-[^:]+:[a-z0-9_+]+: .* ratio [0-9.]+" "$log" | tail -1)
  err=$(grep -aE "Overcollateralization check failed|Post-flight sanity FAILED|exceeds 1.30|ERROR in runWorkflow|panic" "$log" | head -1)
  cons=$(grep -acE "ConsensusFailed" "$log")
  result=$(grep -aoE "Overcollateralization: (method-[12]|verified|failed)" "$log" | tail -1)

  if [ -n "$passed" ]; then status="PASS  $passed"
  elif [ -n "$err" ];  then status="FAIL  $err"
  else status="???   (no verdict line — check log)"; fi
  [ "$cons" -gt 0 ] && status="$status  [ConsensusFailed x$cons]"

  printf '%-11s %s\n' "$nm" "$status" | tee -a "$SUMMARY"
  [ -n "$cand" ] && printf '   last candidate: %s\n' "$cand" | tee -a "$SUMMARY"
done

echo ""
echo "Per-token logs: $OUT/<token>.log"
echo "Summary:        $SUMMARY"
echo ""
echo "----- summary -----"
cat "$SUMMARY"
