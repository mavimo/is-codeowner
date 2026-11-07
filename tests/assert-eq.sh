#!/usr/bin/env bash
# Usage: assert-eq.sh <name> <expected> <actual>
# Values are passed as arguments from env vars by the workflow (never interpolated into the script).
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: assert-eq.sh <name> <expected> <actual>" >&2
  exit 2
fi

name=$1
expected=$2
actual=$3

if [ "$expected" != "$actual" ]; then
  {
    echo "::error::${name}: assertion failed"
    echo "  expected: [${expected}]"
    echo "  actual:   [${actual}]"
  } >&2
  exit 1
fi
echo "ok: ${name} == [${expected}]"
