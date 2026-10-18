#!/bin/sh
# Spectrum — run every headless check. Run from the repo root:
#   sh test/run-all-jsc.sh
#
# Covers everything that can be verified without After Effects: syntax, the
# ES3 guard, the ramp math, and the ordering/writing engine. The panel's
# ScriptUI layer still needs a live AE session — see README.

set -e

JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc

if [ ! -x "$JSC" ]; then
    echo "jsc not found at $JSC"
    exit 1
fi

echo "--- syntax + ES3 guard ---"
"$JSC" test/check-syntax.js

echo ""
echo "--- ramp math ---"
"$JSC" test/run-tests-jsc.js

echo ""
echo "--- ordering + writing engine ---"
"$JSC" test/run-engine-jsc.js

echo ""
echo "All headless checks passed."
