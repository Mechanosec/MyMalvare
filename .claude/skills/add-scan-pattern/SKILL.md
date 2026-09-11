---
name: add-scan-pattern
description: Use when adding or editing a detected secret type/pattern in credsScrapper (a new API key format, token format, or entropy rule). Touches domain detection code, both constant files, and adds a unit test - use when the user says "add a pattern for X", "detect Y tokens", or "add a secret type".
---

Adding a new detected secret type in credsScrapper touches four places. Miss one and either detection silently does nothing, or the UI can't label a finding.

1. **Pattern** — `credsScrapper/apps/api/src/modules/scanner/domain/detection/patterns.ts`
   Add the regex/format matcher following the existing entries' shape.

2. **Description** — `credsScrapper/apps/api/src/modules/scanner/domain/detection/descriptions.ts`
   Add the human-readable description keyed the same way as the pattern.

3. **Constant, backend** — `credsScrapper/apps/api/src/modules/scanner/domain/constant/secret-type.constant.ts`
   Add the new type to the enum/const union.

4. **Constant, frontend** — `credsScrapper/apps/web/src/lib/constant/secret-type.constant.ts`
   Mirror the same value here (this file is a separate copy, not imported from the backend — Next.js and NestJS are separate apps) so `findings-table.tsx` can render/label it.

5. **Test** — add a case in `credsScrapper/apps/api/tests/unit/scanner/` covering a true-positive match and, if the format is easy to confuse with another, a false-positive-avoidance case.

Do not add a network call to validate the secret is "real" — see the README guardrail: detection only, never validation-by-use.

Run `npm test -w apps/api -- -t <new type>` (from `credsScrapper/`) to confirm the new test passes before finishing.
