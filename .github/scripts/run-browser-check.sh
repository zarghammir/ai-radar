#!/usr/bin/env bash
#
# Runs one browser check and maps its exit code to a CI outcome.
#
#   0  the checks passed
#   1  the checks RAN and FAILED
#   2  THE INSTRUMENT COULD NOT RUN — no browser resolvable, or nothing serving
#
# 2 is the state a CI job is most likely to get wrong. It is non-zero for a
# reason that looks environmental rather than like a defect, so the tempting
# handling is to skip — which reports a green tick for a run that measured
# nothing. Both non-zero cases are red here. They are separated only so the log
# says which happened, because the fixes are unrelated; the script itself prints
# the specific cause directly above this, since an exit code alone cannot tell
# "no browser" from "nothing serving".
#
# This lives in one file because there are two callers. Two copies of a contract
# that a control can only ever reach one of is how the copies drift apart.
#
# The URL is passed as an ARGUMENT rather than left to the environment:
# verify-shell.mjs reads argv[2] || VERIFY_URL, a11y-audit.mjs reads argv[2]
# only. argv is the one input both honour, so passing it binds both to the same
# server instead of binding one and appearing to bind the other.
set -u

LABEL="$1"
NPM_SCRIPT="$2"
URL="$3"

# stdout is captured so the measurement digest can read the script's trailing
# JSON summary; stderr is left alone so a crash still reaches the log in real
# time. The captured stream is printed either way, before anything is judged.
OUT="$(mktemp)"
set +e
npm run "$NPM_SCRIPT" -- "$URL" > "$OUT"
CODE=$?
set -e
cat "$OUT"

case "$CODE" in
  0)
    # A check that exits 0 having measured NOTHING is the defect #83 is about,
    # and adding jobs without this would reproduce it inside its own fix. Run
    # only on success: on a failure the failure is the story, and demanding a
    # summary from a crashed run would bury the real error under a second one.
    node "$(dirname "$0")/measured-digest.mjs" "$LABEL" < "$OUT"
    echo "RESULT: ${LABEL} ran against ${URL} and passed."
    ;;
  2)
    echo "::error::${LABEL} could NOT RUN — no browser could be resolved, or nothing was serving ${URL}. This is not a pass and not a skip; see the script's own message above for which." >&2
    exit 1
    ;;
  *)
    echo "::error::${LABEL} RAN and FAILED (exit ${CODE})." >&2
    exit "$CODE"
    ;;
esac
