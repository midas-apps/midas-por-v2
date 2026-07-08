#!/usr/bin/env bash
# Validate all required secrets are present in .env file before running
# `cre secrets create/update`.
#
# Usage: ./check-secrets.sh [.env.dev]

set -euo pipefail

ENV_FILE="${1:-.env.dev}"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found"
  exit 1
fi

# Map: secret name in secrets.yaml -> env var name
REQUIRED=(
  "vlayerauthtoken=VLAYER_AUTH_TOKEN"
  "vlayerauthtokenv2=VLAYER_AUTH_TOKEN_V2"
  "pinatajwt=PINATA_JWT"
  "attesterprivatekey=ATTESTER_PRIVATE_KEY"
  "verifierprivatekey=VERIFIER_PRIVATE_KEY"
  "attestationpinatagroupid=ATTESTATION_PINATA_GROUP"
  "verificationpinatagroupid=VERIFICATION_PINATA_GROUP"
)

# Optional (warn only)
OPTIONAL=(
  "ipfspassword=IPFS_PASSWORD"
)

# Also needed for deploy tx signing
DEPLOY=(
  "CRE_ETH_PRIVATE_KEY"
)

missing=0

check_var() {
  local var="$1"
  local secret_id="${2:-}"
  local val
  val=$(grep "^${var}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//' | tr -d '[:space:]')
  if [ -z "$val" ]; then
    return 1
  fi
  return 0
}

echo "Checking $ENV_FILE..."
echo

echo "Required (secrets.yaml):"
for entry in "${REQUIRED[@]}"; do
  secret_id="${entry%%=*}"
  var="${entry#*=}"
  if check_var "$var"; then
    echo "  ✓ $secret_id ← $var"
  else
    echo "  ✗ $secret_id ← $var MISSING/EMPTY"
    missing=$((missing + 1))
  fi
done

echo
echo "Optional:"
for entry in "${OPTIONAL[@]}"; do
  secret_id="${entry%%=*}"
  var="${entry#*=}"
  if check_var "$var"; then
    echo "  ✓ $secret_id ← $var"
  else
    echo "  - $secret_id ← $var (skip)"
  fi
done

echo
echo "Deploy signer:"
for var in "${DEPLOY[@]}"; do
  if check_var "$var"; then
    echo "  ✓ $var"
  else
    echo "  ✗ $var MISSING/EMPTY"
    missing=$((missing + 1))
  fi
done

echo
if [ "$missing" -gt 0 ]; then
  echo "✗ $missing required value(s) missing or empty. Fix $ENV_FILE before running 'cre secrets create' or 'cre workflow deploy'."
  exit 1
fi
echo "✓ All required values set."
