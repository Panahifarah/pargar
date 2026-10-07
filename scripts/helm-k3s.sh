#!/usr/bin/env bash
# Install / upgrade Pargar on local k3s with the k3s values profile.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NS="${NS:-pargar}"
RELEASE="${RELEASE:-pargar}"

helm upgrade --install "$RELEASE" ./deploy/helm/pargar \
  --namespace "$NS" \
  --create-namespace \
  -f ./deploy/helm/pargar/values-k3s.yaml \
  "$@"

echo
echo "Add hosts entry if needed:  <node-ip>  pargar.local"
echo "Health: curl -k https://pargar.local/api/health"
