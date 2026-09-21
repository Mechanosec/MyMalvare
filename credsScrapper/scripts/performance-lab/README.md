# Scanner performance laboratory

Experimental variants; none changes the production scanner. Build the API first.
All scan measurements are read-only and emit aggregate metrics only. Do not run
live credential validation. Do not commit real repository contents or findings.

## Local scans

Prepare a local JSON manifest with `name`, absolute `path` to a bare Git cache,
`head` SHA and `objectMiB` for each repository. Keep it outside version control.

```sh
npm run build -w apps/api
python3 scripts/performance-lab/run-profiles.py /tmp/manifest.json /tmp/results.json --commits 100 --rounds 3
# Full history attempts, bounded at 40 seconds per variant:
python3 scripts/performance-lab/run-profiles.py /tmp/manifest.json /tmp/full.json --commits 0 --rounds 1 --timeout 40 --variants baseline,no-renames,memo,head-only
```

The runner rotates variant order and enforces a process-group timeout. Results
include Git iteration wait, detector time, counts, RSS, and an ephemeral HMAC of
the complete finding-event stream. Compare HMACs only within one invocation.
Before publishing results replace fingerprints with equivalence booleans.

Variants: baseline, Git rename detection disabled, 32 MiB exact-input memo cache,
and an ASCII frequency-array entropy kernel. Additional `prefilter` and
`fast-node` variants skip regexes only when their required literal marker is
absent; `fast-node` combines this with the frequency array. `verify-fast` runs
both full detectors on every text and compares complete findings, outside any
performance comparison. The `head-only` profiler variant
omits history and MUST NOT be presented as coverage-equivalent acceleration.
`diagnostic` attributes regex and entropy time; it adds instrumentation overhead.
`BENCH_COMMIT_LIMIT` restricts history to the most recent N commits. The HEAD tree
is still scanned in full. A timeout is an incomplete scan, never a successful one.

This harness skips clone/fetch, cache locks, Piscina, Redis and database writes.
It measures an existing snapshot, not end-to-end production latency. CPU times
include benchmark callbacks; RSS includes findings temporarily allocated by the
real detector. Do not run CPU benchmarks concurrently.

## Acquisition

```sh
python3 scripts/performance-lab/acquisition.py OWNER/REPO SHA /tmp/acquisition.json
```

Public GitHub requests only, no credentials. Full clone, shallow clone, tarball
(three downloads) and API tree + individual blobs (four concurrent requests).
35-second Git deadline, 20-second HTTP socket timeout, 200 MiB response cap,
40-blob API budget. A changing default-branch HEAD invalidates Git comparison.
Archives/API only cover the requested snapshot, not deleted historical secrets.
No extraction of untrusted archive entries. HTTP/CDN and filesystem caches are
not purged. These are observed network timings, not stable throughput guarantees.

## Go versus JavaScript

```sh
GOCACHE=/tmp/creds-go-cache go build -o /tmp/creds-entropy scripts/performance-lab/entropy.go
node scripts/performance-lab/entropy.cjs /tmp/creds-entropy /tmp/entropy.json
node scripts/performance-lab/persistence.cjs /tmp/persistence.json
```

The Go prototype implements **only entropy detection**, not all patterns,
placeholder filtering, context extraction, provenance or the full scanner.
Synthetic ASCII fixtures compare exact token positions/lengths after a warm-up,
three samples per implementation. Compilation, process startup and file loading
are excluded. Production IPC, UTF-8/UTF-16 offset conversion and integration need
separate measurement. Fingerprinting is outside the measured kernel time.
The persistence test uses disposable SQLite and synthetic values exclusively.

To regenerate the report chart, run `plot.py REPORT_JSON OUTPUT_PNG` with a Python
installation containing matplotlib. The report includes raw timing samples.
