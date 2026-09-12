# credsScrapper: expanded detection, manual key testing, status filter, leak-commit dedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 14 new secret-detection patterns, a manual "Testing" tab where a user records valid/invalid/unknown verdicts per finding, a status filter on the Findings page, and cross-scan dedup that tracks every commit where a leaked secret appears.

**Architecture:** Mechanical additions to the existing domain pattern list (`ESecretType`/`PATTERNS`/`DESCRIPTIONS`, mirrored front+back). A new `EFindingStatus` enum and two new `Finding` columns (`status`, `leakCommits`) via Prisma migration. Dedup/promote/merge logic is folded entirely into `PrismaStateRepository.addFinding()` so the scan use-case is untouched. A new `PATCH /findings/:id/status` endpoint plus reuse of the existing `GET /findings?repoIds=` endpoint power a new frontend "Testing" tab — no background job, no live network calls to third-party services (see spec's Non-goals: this tool only ever does passive detection, per `CLAUDE.md`).

**Tech Stack:** NestJS (apps/api, Jest), Next.js/React (apps/web, Vitest), Prisma + SQLite.

**Spec:** `docs/superpowers/specs/2026-09-12-key-testing-and-dedup-design.md`

## Global Constraints

- Never add a network call that authenticates as a credential this tool found (`credsScrapper/CLAUDE.md`) — the Testing tab is manual-verdict only, no live probing.
- Run `npm run test -w apps/api`, `npm run test -w apps/web`, `npm run build -w apps/api`, `npm run build -w apps/web` (from `credsScrapper/`) before calling any task done.
- New backend capability → domain types first, then `application/ports` abstraction, then `infrastructure` adapter, then `presentation` controller — hexagonal layering (`domain` imports nothing from outer layers; `application` depends only on `application/ports/*.port.ts`; `infrastructure` implements ports; `presentation` calls exactly one use-case per route).
- Naming: enums/constants in `<concept>.constant.ts` under `constant/`, `E`-prefixed; interfaces/types in `<concept>.type.ts` under `types/`, `I`/`T`-prefixed; ports are `*.port.ts` abstract classes, no prefix.
- No `git commit` without explicit permission for that action — this plan's steps show `git add`/`git commit` commands for the executor's own local checkpoints, but hold off on running them; the user has separately told this session to ask before committing.

---

## Task 1: Add `EFindingStatus` constant (backend + frontend)

**Files:**
- Create: `credsScrapper/apps/api/src/modules/scanner/domain/constant/finding-status.constant.ts`
- Create: `credsScrapper/apps/web/src/lib/constant/finding-status.constant.ts`

**Interfaces:**
- Produces: `EFindingStatus { UNKNOWN = 'unknown', VALID = 'valid', INVALID = 'invalid' }` in both apps, identical values.

- [ ] **Step 1: Create the backend constant**

```typescript
// credsScrapper/apps/api/src/modules/scanner/domain/constant/finding-status.constant.ts
// Manually recorded verdict, not an automated probe result - see
// CLAUDE.md's "Detection is passive, always" rule. A finding starts
// unknown and only a human marks it valid/invalid via the Testing tab.
export enum EFindingStatus {
  UNKNOWN = 'unknown',
  VALID = 'valid',
  INVALID = 'invalid',
}
```

- [ ] **Step 2: Create the frontend mirror**

```typescript
// credsScrapper/apps/web/src/lib/constant/finding-status.constant.ts
// Mirrored from apps/api's domain/constant/finding-status.constant.ts.
export enum EFindingStatus {
  UNKNOWN = 'unknown',
  VALID = 'valid',
  INVALID = 'invalid',
}
```

- [ ] **Step 3: Build both apps to confirm no import errors**

Run: `npm run build -w apps/api && npm run build -w apps/web` (from `credsScrapper/`)
Expected: both succeed (these files aren't imported by anything yet, so this only checks they parse).

- [ ] **Step 4: Commit**

```bash
git add credsScrapper/apps/api/src/modules/scanner/domain/constant/finding-status.constant.ts credsScrapper/apps/web/src/lib/constant/finding-status.constant.ts
git commit -m "feat: add EFindingStatus constant"
```

---

## Task 2: Prisma migration — `Finding.status` and `Finding.leakCommits`

**Files:**
- Modify: `credsScrapper/apps/api/prisma/schema.prisma`
- Create (generated): a new migration under `credsScrapper/apps/api/prisma/migrations/`

**Interfaces:**
- Consumes: nothing.
- Produces: `Finding.status: String @default("unknown")`, `Finding.leakCommits: String @default("[]")` columns, available to every later task via `PrismaService`.

- [ ] **Step 1: Edit the schema**

In `credsScrapper/apps/api/prisma/schema.prisma`, change the `Finding` model:

```prisma
model Finding {
  id          Int      @id @default(autoincrement())
  repoId      Int      @map("repo_id")
  owner       String
  name        String
  filePath    String   @map("file_path")
  commitSha   String   @map("commit_sha")
  secretType  String   @map("secret_type") // ESecretType
  secretValue String   @map("secret_value")
  lineNumber  Int?     @map("line_number")
  foundAt     DateTime @default(now()) @map("found_at")
  context     String?
  status      String   @default("unknown") // EFindingStatus: unknown | valid | invalid
  leakCommits String   @default("[]") @map("leak_commits") // JSON array of commit SHAs, oldest first

  @@map("findings")
}
```

- [ ] **Step 2: Generate and apply the migration**

Run (from `credsScrapper/apps/api/`): `npx prisma migrate dev --name add_finding_status_and_leak_commits`
Expected: a new folder appears under `prisma/migrations/` containing `migration.sql` with `ALTER TABLE "findings" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'unknown';` and the equivalent for `leak_commits`; command exits 0 and regenerates the Prisma client.

- [ ] **Step 3: Verify the generated Prisma client has the new fields**

Run: `grep -n "leakCommits" credsScrapper/node_modules/.prisma/client/index.d.ts | head -5`
Expected: at least one match (confirms `prisma generate` picked up the schema change).

- [ ] **Step 4: Commit**

```bash
git add credsScrapper/apps/api/prisma/schema.prisma credsScrapper/apps/api/prisma/migrations
git commit -m "feat: add status and leakCommits columns to Finding"
```

---

## Task 3: Domain/mapper types for status + leakCommits

**Files:**
- Modify: `credsScrapper/apps/api/src/modules/scanner/domain/types/finding-record.type.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/persistence/prisma-state.mapper.ts`
- Test: `credsScrapper/apps/api/tests/unit/scanner/infrastructure/persistence/prisma-state.mapper.spec.ts`

**Interfaces:**
- Consumes: `EFindingStatus` (Task 1), `Finding` Prisma model with `status`/`leakCommits` columns (Task 2).
- Produces: `IFindingRecord.status: EFindingStatus`, `IFindingRecord.leakCommits: readonly string[]`; `toFindingStatus(raw: string): EFindingStatus`; `toFindingRecord()` now populates both fields. `IFindingsFilter.statuses?: readonly EFindingStatus[]`.

- [ ] **Step 1: Write the failing test for the mapper**

```typescript
// credsScrapper/apps/api/tests/unit/scanner/infrastructure/persistence/prisma-state.mapper.spec.ts
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { toFindingRecord } from '../../../../../src/modules/scanner/infrastructure/persistence/prisma-state.mapper';

describe('toFindingRecord', () => {
  it('parses leakCommits JSON and casts status', () => {
    const row = {
      id: 1,
      repoId: 42,
      owner: 'acme',
      name: 'widgets',
      filePath: 'src/config.ts',
      commitSha: 'abc123',
      secretType: ESecretType.AWS_ACCESS_KEY_ID,
      secretValue: 'AKIAABCDEFGH12345678',
      lineNumber: 3,
      context: null,
      foundAt: new Date('2026-01-01T00:00:00Z'),
      status: 'valid',
      leakCommits: '["abc123","def456"]',
    };

    const record = toFindingRecord(row as never);

    expect(record.status).toBe(EFindingStatus.VALID);
    expect(record.leakCommits).toEqual(['abc123', 'def456']);
  });

  it('falls back to an empty array for malformed leakCommits JSON', () => {
    const row = {
      id: 1,
      repoId: 42,
      owner: 'acme',
      name: 'widgets',
      filePath: 'src/config.ts',
      commitSha: 'abc123',
      secretType: ESecretType.AWS_ACCESS_KEY_ID,
      secretValue: 'AKIAABCDEFGH12345678',
      lineNumber: null,
      context: null,
      foundAt: new Date('2026-01-01T00:00:00Z'),
      status: 'unknown',
      leakCommits: 'not-json',
    };

    const record = toFindingRecord(row as never);

    expect(record.leakCommits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w apps/api -- prisma-state.mapper.spec.ts`
Expected: FAIL — `toFindingRecord` doesn't return `status`/`leakCommits` yet (property is `undefined`), and `toFindingStatus`/parsing don't exist.

- [ ] **Step 3: Update `finding-record.type.ts`**

```typescript
// credsScrapper/apps/api/src/modules/scanner/domain/types/finding-record.type.ts
import { EFindingStatus } from '../constant/finding-status.constant';
import { ESecretType } from '../constant/secret-type.constant';

export interface IFindingRecord {
  readonly id: number;
  readonly repoId: number;
  readonly owner: string;
  readonly name: string;
  readonly filePath: string;
  readonly commitSha: string;
  readonly secretType: ESecretType;
  readonly secretValue: string;
  readonly lineNumber: number | null;
  readonly context: string | null;
  readonly foundAt: Date;
  readonly status: EFindingStatus;
  readonly leakCommits: readonly string[];
}

export interface IFindingsFilter {
  readonly secretTypes?: readonly ESecretType[];
  readonly repoIds?: readonly number[];
  readonly statuses?: readonly EFindingStatus[];
  /** Free-text, matched against owner/name (as "owner/name" too), filePath, and context. */
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface IFindingsPage {
  readonly items: readonly IFindingRecord[];
  readonly total: number;
}

export interface IFindingsRepoOption {
  readonly repoId: number;
  readonly owner: string;
  readonly name: string;
  readonly count: number;
}

export interface ISecretTypeCount {
  readonly secretType: ESecretType;
  readonly count: number;
}
```

- [ ] **Step 4: Update `prisma-state.mapper.ts`**

Add the import and a `toFindingStatus` function, and update `toFindingRecord`:

```typescript
// add near the other `import` lines in prisma-state.mapper.ts:
import { EFindingStatus } from '../../domain/constant/finding-status.constant';

// add near toSecretType:
export function toFindingStatus(raw: string): EFindingStatus {
  return raw as EFindingStatus;
}

// add near the other helpers, used by toFindingRecord:
function parseLeakCommits(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

// replace the existing toFindingRecord body:
export function toFindingRecord(row: TPrismaFinding): IFindingRecord {
  return {
    id: row.id,
    repoId: row.repoId,
    owner: row.owner,
    name: row.name,
    filePath: row.filePath,
    commitSha: row.commitSha,
    secretType: toSecretType(row.secretType),
    secretValue: row.secretValue,
    lineNumber: row.lineNumber,
    context: row.context,
    foundAt: row.foundAt,
    status: toFindingStatus(row.status),
    leakCommits: parseLeakCommits(row.leakCommits),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w apps/api -- prisma-state.mapper.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add credsScrapper/apps/api/src/modules/scanner/domain/types/finding-record.type.ts credsScrapper/apps/api/src/modules/scanner/infrastructure/persistence/prisma-state.mapper.ts credsScrapper/apps/api/tests/unit/scanner/infrastructure/persistence/prisma-state.mapper.spec.ts
git commit -m "feat: map Finding.status and leakCommits from Prisma rows"
```

---

## Task 4: Dedup + promote + leak-commit merge in `PrismaStateRepository.addFinding`, plus `updateFindingStatus`

**Files:**
- Modify: `credsScrapper/apps/api/src/modules/scanner/application/ports/state-repository.port.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/persistence/prisma-state-repository.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/persistence/prisma-state.mapper.ts` (status filter in `listFindings`)
- Modify: `credsScrapper/apps/api/tests/integration/scanner/prisma-state-repository.spec.ts` (already exists — extend it, do not create a new file)

**Interfaces:**
- Consumes: `IFindingRecord`, `EFindingStatus` (Task 3), `PrismaService` (existing).
- Produces: `StateRepositoryPort.updateFindingStatus(id: number, status: EFindingStatus): Promise<void>`. `addFinding`'s signature and call sites are unchanged; its behavior now dedups.

Note on baseline: this file currently fails to compile on a clean checkout (`PrismaService`'s constructor loses its parameter type when subclassing the generated `PrismaClient`, and `Prisma.FindingWhereInput` fails to resolve) until `apps/api/src/modules/scanner/infrastructure/persistence/prisma.service.ts` gets an explicit `constructor(options?: Prisma.PrismaClientOptions) { super(options); }` and `npx prisma generate` (from `credsScrapper/apps/api/`) is re-run once. If `npm run test -w apps/api` fails before you touch anything with either of those two errors, apply that constructor fix and regenerate first, confirm the full suite is green, then proceed with this task's own changes.

- [ ] **Step 1: Read the existing test file's setup helper**

Read `credsScrapper/apps/api/tests/integration/scanner/prisma-state-repository.spec.ts` in full. It already defines a `makeRepository(dbFile)` helper (temp SQLite file, hand-rolled `CREATE TABLE` statements matching `schema.prisma`, returns `{ repo, prisma }`) and a `beforeEach`/`afterEach` that creates/removes a temp directory. Reuse this helper for the new tests below — do not duplicate its schema setup. Its `findings` table `CREATE TABLE` statement needs two new columns added to match Task 2's migration: `status TEXT NOT NULL DEFAULT 'unknown', leak_commits TEXT NOT NULL DEFAULT '[]'` (appended to the existing column list, before the closing `)`).

- [ ] **Step 2: Write the failing tests for dedup/promote/merge**

Add a `repo`/`prisma` pair per test the same way the existing tests in this file do (call `makeRepository(path.join(tmpDir, 'state.db'))` at the top of each new `it`, matching the file's existing style exactly), and append these two new `describe` blocks after the existing tests, before the closing `});` of the outer `describe`:

```typescript
describe('addFinding dedup', () => {
  it('inserts a fresh row with leakCommits seeded from the first commit', async () => {
    const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

    await repo.addFinding(1, 'acme', 'widgets', 'src/config.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 3, null);

    const page = await repo.listFindings({ repoIds: [1] });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].leakCommits).toEqual(['head-sha']);
    expect(page.items[0].filePath).toBe('src/config.ts');

    await prisma.$disconnect();
  });

  it('promotes a diff-based finding to path-based when the same secret is later found at HEAD', async () => {
    const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

    await repo.addFinding(1, 'acme', 'widgets', '<commit-diff>', 'old-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 1, null);
    await repo.addFinding(1, 'acme', 'widgets', 'src/config.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 3, null);

    const page = await repo.listFindings({ repoIds: [1] });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].filePath).toBe('src/config.ts');
    expect(page.items[0].commitSha).toBe('head-sha');
    expect([...page.items[0].leakCommits].sort()).toEqual(['head-sha', 'old-sha']);

    await prisma.$disconnect();
  });

  it('does not regress an already path-based finding when a diff-based match for the same secret arrives later', async () => {
    const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

    await repo.addFinding(1, 'acme', 'widgets', 'src/config.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 3, null);
    await repo.addFinding(1, 'acme', 'widgets', '<commit-diff>', 'old-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 1, null);

    const page = await repo.listFindings({ repoIds: [1] });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].filePath).toBe('src/config.ts');
    expect([...page.items[0].leakCommits].sort()).toEqual(['head-sha', 'old-sha']);

    await prisma.$disconnect();
  });

  it('does not merge findings with different secret values', async () => {
    const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

    await repo.addFinding(1, 'acme', 'widgets', 'src/config.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 3, null);
    await repo.addFinding(1, 'acme', 'widgets', 'src/other.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAZZZZZZZZ99999999', 1, null);

    const page = await repo.listFindings({ repoIds: [1] });
    expect(page.items).toHaveLength(2);

    await prisma.$disconnect();
  });
});

describe('updateFindingStatus', () => {
  it('persists the given status', async () => {
    const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

    await repo.addFinding(1, 'acme', 'widgets', 'src/config.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 3, null);
    const [before] = (await repo.listFindings({ repoIds: [1] })).items;

    await repo.updateFindingStatus(before.id, 'valid' as never);

    const [after] = (await repo.listFindings({ repoIds: [1] })).items;
    expect(after.status).toBe('valid');

    await prisma.$disconnect();
  });
});
```

These new blocks go inside the file's existing outer `describe('PrismaStateRepository (real SQLite, no mocks)', ...)`, using its existing `tmpDir` from `beforeEach`/`afterEach` — do not add a second outer `describe` or a second `tmpDir` setup.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -w apps/api -- prisma-state-repository.spec.ts`
Expected: FAIL — no dedup logic yet (each `addFinding` call inserts a new row), and `updateFindingStatus` doesn't exist on the port/class.

- [ ] **Step 4: Add `updateFindingStatus` and `statuses` filter to the port**

```typescript
// credsScrapper/apps/api/src/modules/scanner/application/ports/state-repository.port.ts
// add the import:
import { EFindingStatus } from '../../domain/constant/finding-status.constant';

// add this abstract method, near addFinding:
  abstract updateFindingStatus(id: number, status: EFindingStatus): Promise<void>;
```

(`IFindingsFilter.statuses` was already added in Task 3, so no further port change is needed for filtering — `listFindings` just needs its `where` clause updated, done in Step 6 below.)

- [ ] **Step 5: Implement dedup/promote/merge in `addFinding`, and `updateFindingStatus`**

Replace the existing `addFinding` method body in `prisma-state-repository.ts`:

```typescript
  async addFinding(
    repoId: number,
    owner: string,
    name: string,
    filePath: string,
    commitSha: string,
    secretType: ESecretType,
    secretValue: string,
    lineNumber: number,
    context: string | null,
  ): Promise<void> {
    const existing = await this.prisma.finding.findFirst({
      where: { repoId, secretType, secretValue },
    });

    if (!existing) {
      await this.prisma.finding.create({
        data: {
          repoId,
          owner,
          name,
          filePath,
          commitSha,
          secretType,
          secretValue,
          lineNumber,
          context,
          leakCommits: JSON.stringify([commitSha]),
        },
      });
      return;
    }

    const leakCommits = new Set<string>(JSON.parse(existing.leakCommits) as string[]);
    leakCommits.add(commitSha);

    const isIncomingPathBased = filePath !== '<commit-diff>';
    const isExistingDiffBased = existing.filePath === '<commit-diff>';
    const shouldPromote = isIncomingPathBased && isExistingDiffBased;

    await this.prisma.finding.update({
      where: { id: existing.id },
      data: {
        leakCommits: JSON.stringify([...leakCommits]),
        ...(shouldPromote ? { filePath, commitSha, lineNumber, context } : {}),
      },
    });
  }

  async updateFindingStatus(id: number, status: EFindingStatus): Promise<void> {
    await this.prisma.finding.update({ where: { id }, data: { status } });
  }
```

Add the import at the top of the file:

```typescript
import { EFindingStatus } from '../../domain/constant/finding-status.constant';
```

`addFinding`'s signature is otherwise unchanged from today's — `scan-repository.use-case.ts` needs no edits.

- [ ] **Step 6: Add the `statuses` filter to `listFindings`**

In `prisma-state-repository.ts`'s `listFindings`, add one line to the `where` object:

```typescript
  async listFindings(filter: IFindingsFilter): Promise<IFindingsPage> {
    const where: Prisma.FindingWhereInput = {
      secretType: filter.secretTypes?.length ? { in: [...filter.secretTypes] } : undefined,
      repoId: filter.repoIds?.length ? { in: [...filter.repoIds] } : undefined,
      status: filter.statuses?.length ? { in: [...filter.statuses] } : undefined,
      ...(filter.search ? { OR: buildSearchConditions(filter.search) } : {}),
    };
    // ...rest unchanged
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -w apps/api -- prisma-state-repository.spec.ts`
Expected: PASS

- [ ] **Step 8: Run the full backend test suite and build**

Run: `npm run test -w apps/api && npm run build -w apps/api` (from `credsScrapper/`)
Expected: all green — this also confirms nothing else called `addFinding` with an incompatible signature.

- [ ] **Step 9: Commit**

```bash
git add credsScrapper/apps/api/src/modules/scanner/application/ports/state-repository.port.ts credsScrapper/apps/api/src/modules/scanner/infrastructure/persistence/prisma-state-repository.ts credsScrapper/apps/api/tests/integration/scanner/prisma-state-repository.spec.ts
git commit -m "feat: dedup findings by secret value, merge leak commits, add updateFindingStatus"
```

---

## Task 5: `SetFindingStatusUseCase` + `PATCH /findings/:id/status` + status query param

**Files:**
- Create: `credsScrapper/apps/api/src/modules/scanner/application/use-cases/set-finding-status.use-case.ts`
- Create: `credsScrapper/apps/api/tests/unit/scanner/application/use-cases/set-finding-status.use-case.spec.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/presentation/findings.controller.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/scanner.module.ts`

**Interfaces:**
- Consumes: `StateRepositoryPort.updateFindingStatus` (Task 4), `EFindingStatus` (Task 1).
- Produces: `SetFindingStatusUseCase.execute(id: number, status: EFindingStatus): Promise<void>`; `PATCH /findings/:id/status`; `GET /findings?statuses=valid,invalid` query support.

- [ ] **Step 1: Write the failing use-case test**

```typescript
// credsScrapper/apps/api/tests/unit/scanner/application/use-cases/set-finding-status.use-case.spec.ts
import { SetFindingStatusUseCase } from '../../../../../src/modules/scanner/application/use-cases/set-finding-status.use-case';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';

describe('SetFindingStatusUseCase', () => {
  it('delegates to the state port', async () => {
    const state = { updateFindingStatus: jest.fn() } as unknown as StateRepositoryPort;
    const useCase = new SetFindingStatusUseCase(state);

    await useCase.execute(7, EFindingStatus.INVALID);

    expect(state.updateFindingStatus).toHaveBeenCalledWith(7, EFindingStatus.INVALID);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w apps/api -- set-finding-status.use-case.spec.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the use-case**

```typescript
// credsScrapper/apps/api/src/modules/scanner/application/use-cases/set-finding-status.use-case.ts
import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { StateRepositoryPort } from '../ports/state-repository.port';

export class SetFindingStatusUseCase {
  constructor(private readonly state: StateRepositoryPort) {}

  async execute(id: number, status: EFindingStatus): Promise<void> {
    await this.state.updateFindingStatus(id, status);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w apps/api -- set-finding-status.use-case.spec.ts`
Expected: PASS

- [ ] **Step 5: Wire the endpoint into the controller**

In `findings.controller.ts`, add the import, constructor param, `statuses` query parsing, and the new route:

```typescript
import { BadRequestException, Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { SetFindingStatusUseCase } from '../application/use-cases/set-finding-status.use-case';
import { EFindingStatus } from '../domain/constant/finding-status.constant';
// ...existing imports stay

@Controller('findings')
export class FindingsController {
  constructor(
    private readonly getFindings: GetFindingsUseCase,
    private readonly getFindingsRepoOptions: GetFindingsRepoOptionsUseCase,
    private readonly getFindingsSecretTypeCounts: GetFindingsSecretTypeCountsUseCase,
    private readonly setFindingStatus: SetFindingStatusUseCase,
  ) {}

  @Get()
  async list(
    @Query('secretTypes') secretTypes?: string,
    @Query('repoIds') repoIds?: string,
    @Query('statuses') statuses?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<IFindingsPage> {
    return this.getFindings.execute({
      secretTypes: parseCsv<ESecretType>(secretTypes),
      repoIds: parseCsv(repoIds, Number),
      statuses: parseCsv<EFindingStatus>(statuses),
      search: search || undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  // ...repoOptions and secretTypeCounts stay unchanged...

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ): Promise<{ ok: true }> {
    if (!Object.values(EFindingStatus).includes(status as EFindingStatus)) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }
    await this.setFindingStatus.execute(Number(id), status as EFindingStatus);
    return { ok: true };
  }
}
```

- [ ] **Step 6: Register the use-case in `scanner.module.ts`**

Add the import and a `provideUseCase` entry:

```typescript
import { SetFindingStatusUseCase } from './application/use-cases/set-finding-status.use-case';

// inside providers, alongside the other provideUseCase(...) calls:
    provideUseCase(
      SetFindingStatusUseCase,
      [StateRepositoryPort],
      (state) => new SetFindingStatusUseCase(state),
    ),
```

- [ ] **Step 7: Run the full backend suite and build**

Run: `npm run test -w apps/api && npm run build -w apps/api`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add credsScrapper/apps/api/src/modules/scanner/application/use-cases/set-finding-status.use-case.ts credsScrapper/apps/api/tests/unit/scanner/application/use-cases/set-finding-status.use-case.spec.ts credsScrapper/apps/api/src/modules/scanner/presentation/findings.controller.ts credsScrapper/apps/api/src/modules/scanner/scanner.module.ts
git commit -m "feat: add PATCH /findings/:id/status and statuses filter"
```

---

## Task 6: Frontend types, api-client, status badge, and Findings-page status filter

**Files:**
- Modify: `credsScrapper/apps/web/src/lib/types/finding.type.ts`
- Modify: `credsScrapper/apps/web/src/lib/api-client.ts`
- Create: `credsScrapper/apps/web/src/components/finding-status-badge.tsx`
- Modify: `credsScrapper/apps/web/src/components/findings-table.tsx`
- Test: `credsScrapper/apps/web/src/components/finding-status-badge.test.tsx` (match whatever test file naming/location the existing `apps/web` Vitest suite uses — check `credsScrapper/apps/web/src/components/*.test.tsx` for the exact convention before creating this one)

**Interfaces:**
- Consumes: `EFindingStatus` (Task 1, frontend copy), `IFindingsQuery` (existing).
- Produces: `IFinding.status: EFindingStatus`, `IFinding.leakCommits: readonly string[]`; `fetchFindings` accepts `statuses`; `updateFindingStatus(id, status): Promise<{ ok: true }>`; `<FindingStatusBadge status={...} />`.

- [ ] **Step 1: Check the existing frontend test convention**

Run: `ls credsScrapper/apps/web/src/components/*.test.tsx 2>/dev/null | head -3`
Use whatever pattern those files follow (import style, render helper) for Step 3's test below.

- [ ] **Step 2: Update `finding.type.ts`**

```typescript
// credsScrapper/apps/web/src/lib/types/finding.type.ts
import { EFindingStatus } from '../constant/finding-status.constant';
import { ESecretType } from '../constant/secret-type.constant';

// Mirrors apps/api's IFindingRecord.
export interface IFinding {
  readonly id: number;
  readonly repoId: number;
  readonly owner: string;
  readonly name: string;
  readonly filePath: string;
  readonly commitSha: string;
  readonly secretType: ESecretType;
  readonly secretValue: string;
  readonly lineNumber: number | null;
  readonly context: string | null;
  readonly foundAt: string;
  readonly status: EFindingStatus;
  readonly leakCommits: readonly string[];
}

export interface IFindingsPage {
  readonly items: readonly IFinding[];
  readonly total: number;
}

export interface IFindingsRepoOption {
  readonly repoId: number;
  readonly owner: string;
  readonly name: string;
  readonly count: number;
}

export interface ISecretTypeCount {
  readonly secretType: ESecretType;
  readonly count: number;
}
```

- [ ] **Step 3: Write the failing badge test**

```typescript
// credsScrapper/apps/web/src/components/finding-status-badge.test.tsx
// Follow the exact import/render helper pattern from an existing
// *.test.tsx in this directory (see Step 1) - substitute it in below.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { FindingStatusBadge } from './finding-status-badge';

describe('FindingStatusBadge', () => {
  it('renders the status label', () => {
    render(<FindingStatusBadge status={EFindingStatus.VALID} />);
    expect(screen.getByText('valid')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test -w apps/web -- finding-status-badge`
Expected: FAIL — `./finding-status-badge` doesn't exist yet.

- [ ] **Step 5: Create `finding-status-badge.tsx`**

```typescript
// credsScrapper/apps/web/src/components/finding-status-badge.tsx
import { EFindingStatus } from '../lib/constant/finding-status.constant';

const TONE_BY_STATUS: Record<EFindingStatus, string> = {
  [EFindingStatus.VALID]: 'text-critical border-critical/50 bg-critical/10',
  [EFindingStatus.INVALID]: 'text-accent border-accent-dim bg-accent/10',
  [EFindingStatus.UNKNOWN]: 'text-text-dim border-line bg-surface-2',
};

interface IFindingStatusBadgeProps {
  readonly status: EFindingStatus;
}

// A "valid" leaked key is the worst outcome (still live, still a real
// exposure) - critical tone, same as SecretTypeBadge's confident-match
// tone. "Invalid" (confirmed dead) gets the reassuring accent tone.
export function FindingStatusBadge({ status }: IFindingStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${TONE_BY_STATUS[status]}`}
    >
      {status}
    </span>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w apps/web -- finding-status-badge`
Expected: PASS

- [ ] **Step 7: Update `api-client.ts`**

Add `statuses` to `IFindingsQuery`/`fetchFindings`, add a `patch` helper, and `updateFindingStatus`:

```typescript
// add the import:
import { EFindingStatus } from './constant/finding-status.constant';

// extend IFindingsQuery:
export interface IFindingsQuery {
  secretTypes?: ESecretType[];
  repoIds?: number[];
  statuses?: EFindingStatus[];
  search?: string;
  limit?: number;
  offset?: number;
}

// in fetchFindings, add before the trailing get<IFindingsPage> call:
  if (query.statuses?.length) params.set('statuses', query.statuses.join(','));

// add a patch helper near post():
async function patch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`PATCH ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

// add near the other exported functions:
export function updateFindingStatus(id: number, status: EFindingStatus): Promise<{ ok: true }> {
  return patch<{ ok: true }>(`/findings/${id}/status`, { status });
}
```

- [ ] **Step 8: Add the status column and filter to `findings-table.tsx`**

Add the import, extend `ICommittedFilters`/state, add the `MultiSelect`, and render the badge column:

```typescript
// add imports:
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { FindingStatusBadge } from './finding-status-badge';

// extend ICommittedFilters:
interface ICommittedFilters {
  readonly secretTypes: ESecretType[];
  readonly repoIds: number[];
  readonly statuses: EFindingStatus[];
  readonly search: string;
}

const NO_FILTERS: ICommittedFilters = { secretTypes: [], repoIds: [], statuses: [], search: '' };

// add state next to the other useState calls:
  const [statuses, setStatuses] = useState<EFindingStatus[]>([]);

// update the committed-filters effect's dependency array and setCommitted call:
  useEffect(() => {
    const timer = setTimeout(() => {
      setCommitted({ secretTypes, repoIds, statuses, search });
      setPage(0);
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [secretTypes, repoIds, statuses, search]);

// update the fetch effect to pass statuses through:
  useEffect(() => {
    fetchFindings({
      secretTypes: committed.secretTypes.length ? committed.secretTypes : undefined,
      repoIds: committed.repoIds.length ? committed.repoIds : undefined,
      statuses: committed.statuses.length ? committed.statuses : undefined,
      search: committed.search || undefined,
      offset: page * FINDINGS_PAGE_SIZE,
    })
      .then(setFindingsPage)
      .catch(() => setFindingsPage({ items: [], total: 0 }));
  }, [committed, page, refreshKey]);

// add a new MultiSelect next to the existing Repository one:
        <MultiSelect
          label="Status"
          options={Object.values(EFindingStatus).map((value) => ({ value, label: value }))}
          selected={statuses}
          onChange={setStatuses}
        />

// add a new <th> in the header row, after the "Line" SortableHeader:
                <th className="px-3 py-2 font-medium">Status</th>

// add a new <td> in the row rendering, after the line-number <td>:
                  <td className="px-3 py-2">
                    <FindingStatusBadge status={finding.status} />
                  </td>
```

- [ ] **Step 9: Run the frontend test suite and build**

Run: `npm run test -w apps/web && npm run build -w apps/web`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add credsScrapper/apps/web/src/lib/types/finding.type.ts credsScrapper/apps/web/src/lib/api-client.ts credsScrapper/apps/web/src/components/finding-status-badge.tsx credsScrapper/apps/web/src/components/finding-status-badge.test.tsx credsScrapper/apps/web/src/components/findings-table.tsx
git commit -m "feat: show and filter findings by status"
```

---

## Task 7: "Testing" tab — manual verdict worklist

**Files:**
- Create: `credsScrapper/apps/web/src/components/testing-panel.tsx`
- Modify: `credsScrapper/apps/web/src/app/dashboard.tsx`
- Test: `credsScrapper/apps/web/src/components/testing-panel.test.tsx`

**Interfaces:**
- Consumes: `fetchFindingsRepoOptions()`, `fetchFindings()`, `updateFindingStatus()` (existing/Task 6), `IFindingsRepoOption`, `IFinding`, `EFindingStatus`, `SecretTypeBadge`, `SecretValue`, `FindingStatusBadge`.
- Produces: `<TestingPanel />` component; `Dashboard`'s `TABS` gains a `'testing'` entry.

- [ ] **Step 1: Write the failing component test**

```typescript
// credsScrapper/apps/web/src/components/testing-panel.test.tsx
// Follow this directory's existing *.test.tsx render/mock pattern (see
// Task 6 Step 1) - the shape below is the scenario to cover, adapt the
// mocking mechanics (vi.mock vs manual stub) to match what's already used.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../lib/api-client';
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { ESecretType } from '../lib/constant/secret-type.constant';
import { TestingPanel } from './testing-panel';

describe('TestingPanel', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'fetchFindingsRepoOptions').mockResolvedValue([
      { repoId: 1, owner: 'acme', name: 'widgets', count: 1 },
    ]);
    vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue({
      items: [
        {
          id: 10,
          repoId: 1,
          owner: 'acme',
          name: 'widgets',
          filePath: 'src/config.ts',
          commitSha: 'abc',
          secretType: ESecretType.AWS_ACCESS_KEY_ID,
          secretValue: 'AKIAABCDEFGH12345678',
          lineNumber: 3,
          context: null,
          foundAt: '2026-01-01T00:00:00Z',
          status: EFindingStatus.UNKNOWN,
          leakCommits: ['abc'],
        },
      ],
      total: 1,
    });
    vi.spyOn(apiClient, 'updateFindingStatus').mockResolvedValue({ ok: true });
  });

  it('loads a repo worklist and logs a marked verdict', async () => {
    render(<TestingPanel />);

    fireEvent.change(await screen.findByLabelText('Repository'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Load keys'));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Valid' }));

    await waitFor(() =>
      expect(apiClient.updateFindingStatus).toHaveBeenCalledWith(10, EFindingStatus.VALID),
    );
    expect(screen.getByText(/marked valid/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w apps/web -- testing-panel`
Expected: FAIL — `./testing-panel` doesn't exist yet.

- [ ] **Step 3: Create `testing-panel.tsx`**

```typescript
// credsScrapper/apps/web/src/components/testing-panel.tsx
'use client';

import { useEffect, useState } from 'react';
import { fetchFindings, fetchFindingsRepoOptions, updateFindingStatus } from '../lib/api-client';
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { IFinding, IFindingsRepoOption } from '../lib/types/finding.type';
import { FindingStatusBadge } from './finding-status-badge';
import { SecretTypeBadge } from './secret-type-badge';
import { SecretValue } from './secret-value';

// Manual, human-recorded verdicts only - see CLAUDE.md's "Detection is
// passive, always" rule. This tool never calls out to a service with a
// secret it found; it only records what the user tells it after
// checking a key by whatever means they choose.
export function TestingPanel() {
  const [repoOptions, setRepoOptions] = useState<IFindingsRepoOption[]>([]);
  const [repoId, setRepoId] = useState<number | null>(null);
  const [findings, setFindings] = useState<IFinding[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchFindingsRepoOptions().then(setRepoOptions).catch(() => setRepoOptions([]));
  }, []);

  async function loadKeys() {
    if (repoId === null) return;
    setLoading(true);
    try {
      const page = await fetchFindings({ repoIds: [repoId], limit: 1000 });
      setFindings(page.items);
      setLog((prev) => [...prev, `Loaded ${page.items.length} finding(s) for repo ${repoId}`]);
    } catch {
      setFindings([]);
    } finally {
      setLoading(false);
    }
  }

  async function mark(finding: IFinding, status: EFindingStatus) {
    await updateFindingStatus(finding.id, status);
    setFindings((prev) => prev.map((f) => (f.id === finding.id ? { ...f, status } : f)));
    setLog((prev) => [
      ...prev,
      `${finding.secretType} in ${finding.filePath} marked ${status}`,
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="testing-repo" className="mb-1 block text-xs text-text-dim">
            Repository
          </label>
          <select
            id="testing-repo"
            value={repoId ?? ''}
            onChange={(e) => setRepoId(e.target.value ? Number(e.target.value) : null)}
            className="w-64 border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
          >
            <option value="">Select a repository…</option>
            {repoOptions.map((repo) => (
              <option key={repo.repoId} value={repo.repoId}>
                {repo.owner}/{repo.name} ({repo.count})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={loadKeys}
          disabled={repoId === null || loading}
          className="border border-line bg-surface-2 px-3 py-1.5 text-sm text-text hover:border-accent disabled:opacity-50"
        >
          Load keys
        </button>
      </div>

      {findings.length > 0 && (
        <div className="overflow-x-auto border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs text-text-dim">
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Secret</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Mark as</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((finding) => (
                <tr key={finding.id} className="border-b border-line bg-surface last:border-0">
                  <td className="max-w-64 truncate px-3 py-2 font-mono text-text-dim" title={finding.filePath}>
                    {finding.filePath}
                  </td>
                  <td className="px-3 py-2">
                    <SecretTypeBadge secretType={finding.secretType} />
                  </td>
                  <td className="px-3 py-2">
                    <SecretValue value={finding.secretValue} />
                  </td>
                  <td className="px-3 py-2">
                    <FindingStatusBadge status={finding.status} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => mark(finding, EFindingStatus.VALID)}
                        className="border border-line px-2 py-1 text-xs text-text hover:border-accent"
                      >
                        Valid
                      </button>
                      <button
                        type="button"
                        onClick={() => mark(finding, EFindingStatus.INVALID)}
                        className="border border-line px-2 py-1 text-xs text-text hover:border-accent"
                      >
                        Invalid
                      </button>
                      <button
                        type="button"
                        onClick={() => mark(finding, EFindingStatus.UNKNOWN)}
                        className="border border-line px-2 py-1 text-xs text-text hover:border-accent"
                      >
                        Unknown
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {log.length > 0 && (
        <div className="max-h-56 overflow-y-auto border border-line bg-ink px-4 py-2 font-mono text-xs leading-relaxed">
          {log.map((line, index) => (
            <p key={index} className="text-text-dim">
              <span className="text-text-dim">{String(index + 1).padStart(3, '0')} </span>
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w apps/web -- testing-panel`
Expected: PASS

- [ ] **Step 5: Wire the tab into `dashboard.tsx`**

```typescript
// add the import:
import { TestingPanel } from '../components/testing-panel';

// extend TABS:
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'findings', label: 'Findings' },
  { id: 'repositories', label: 'Repositories' },
  { id: 'testing', label: 'Testing' },
] as const;

// add a new branch after the 'repositories' branch:
          {activeTab === 'testing' && <TestingPanel />}
```

- [ ] **Step 6: Run the frontend test suite and build**

Run: `npm run test -w apps/web && npm run build -w apps/web`
Expected: all green.

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run dev` (from `credsScrapper/`), open `http://localhost:3001`, click the "Testing" tab, pick a repo with findings, click "Load keys", click "Valid"/"Invalid"/"Unknown" on a row, confirm the badge updates and a log line appears, then reload the Findings tab and confirm the same finding now shows the new status and is filterable by it.

- [ ] **Step 8: Commit**

```bash
git add credsScrapper/apps/web/src/components/testing-panel.tsx credsScrapper/apps/web/src/components/testing-panel.test.tsx credsScrapper/apps/web/src/app/dashboard.tsx
git commit -m "feat: add manual key-testing tab"
```

---

## Task 8: Expand secret-detection patterns (14 new types)

**Files:**
- Modify: `credsScrapper/apps/api/src/modules/scanner/domain/constant/secret-type.constant.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/domain/detection/patterns.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/domain/detection/descriptions.ts`
- Modify: `credsScrapper/apps/web/src/lib/constant/secret-type.constant.ts`
- Modify: `credsScrapper/apps/api/tests/unit/scanner/domain/detection/patterns.spec.ts`

Per the repo's `add-scan-pattern` skill: every new type touches exactly these four files plus its test sample. Every type below has a genuine fixed, vendor-documented token prefix or structural marker — consistent with `patterns.ts`'s own rule that a pattern must match the token itself with no surrounding context required. Several commonly-requested "popular services" (Heroku, Datadog, CircleCI, Algolia, Segment, Auth0, Vercel, plain Azure AD client secrets, a bespoke AWS-secret-key regex) were deliberately left out: their real-world tokens are bare hex/base64/UUID strings with no fixed, recognizable prefix, so a regex for them would either false-positive constantly or silently rely on nearby text context — exactly what this codebase's `GENERIC_HIGH_ENTROPY` fallback exists to catch instead. Two of the additions below (`OPENSSH_PRIVATE_KEY`, `PGP_PRIVATE_KEY_BLOCK`) are the "private half" the user specifically asked for; `GCP_SERVICE_ACCOUNT_KEY` covers the JSON-embedded private-key case for GCP.

**Interfaces:**
- Produces: 14 new `ESecretType` members (below), matching `PATTERNS` entries, `DESCRIPTIONS` entries, and test `SAMPLES` entries.

- [ ] **Step 1: Add the new members to `ESecretType`** (both apps)

In `credsScrapper/apps/api/src/modules/scanner/domain/constant/secret-type.constant.ts`, add before `GENERIC_HIGH_ENTROPY = 'generic_high_entropy',`:

```typescript
  OPENSSH_PRIVATE_KEY = 'openssh_private_key',
  PGP_PRIVATE_KEY_BLOCK = 'pgp_private_key_block',
  GCP_SERVICE_ACCOUNT_KEY = 'gcp_service_account_key',
  AZURE_STORAGE_ACCOUNT_KEY = 'azure_storage_account_key',
  NEW_RELIC_API_KEY = 'new_relic_api_key',
  POSTMAN_API_KEY = 'postman_api_key',
  DATABRICKS_TOKEN = 'databricks_token',
  NOTION_API_TOKEN = 'notion_api_token',
  TERRAFORM_CLOUD_TOKEN = 'terraform_cloud_token',
  LINEAR_API_KEY = 'linear_api_key',
  SENTRY_AUTH_TOKEN = 'sentry_auth_token',
  FIGMA_PERSONAL_ACCESS_TOKEN = 'figma_personal_access_token',
  GRAFANA_API_KEY = 'grafana_api_key',
  DROPBOX_SHORT_LIVED_TOKEN = 'dropbox_short_lived_token',
```

Apply the identical block to `credsScrapper/apps/web/src/lib/constant/secret-type.constant.ts`.

- [ ] **Step 2: Write the failing pattern samples**

In `credsScrapper/apps/api/tests/unit/scanner/domain/detection/patterns.spec.ts`, add to the `SAMPLES` array (before the closing `];`):

```typescript
  [ESecretType.OPENSSH_PRIVATE_KEY, '-----BEGIN OPENSSH PRIVATE KEY-----'],
  [ESecretType.PGP_PRIVATE_KEY_BLOCK, '-----BEGIN PGP PRIVATE KEY BLOCK-----'],
  [ESecretType.GCP_SERVICE_ACCOUNT_KEY, '"type": "service_account"'],
  [ESecretType.AZURE_STORAGE_ACCOUNT_KEY, 'AccountKey=' + 'a'.repeat(86) + '=='],
  [ESecretType.NEW_RELIC_API_KEY, 'NRAK-' + 'A'.repeat(27)],
  [ESecretType.POSTMAN_API_KEY, 'PMAK-' + 'a'.repeat(24) + '-' + 'b'.repeat(34)],
  [ESecretType.DATABRICKS_TOKEN, 'dapi' + 'a'.repeat(32)],
  [ESecretType.NOTION_API_TOKEN, 'secret_' + 'a'.repeat(43)],
  [ESecretType.TERRAFORM_CLOUD_TOKEN, 'a'.repeat(14) + '.atlasv1.' + 'b'.repeat(64)],
  [ESecretType.LINEAR_API_KEY, 'lin_api_' + 'a'.repeat(40)],
  [ESecretType.SENTRY_AUTH_TOKEN, 'sntrys_' + 'a'.repeat(60)],
  [ESecretType.FIGMA_PERSONAL_ACCESS_TOKEN, 'figd_' + 'a'.repeat(40)],
  [ESecretType.GRAFANA_API_KEY, 'eyJrIjoi' + 'a'.repeat(60)],
  [ESecretType.DROPBOX_SHORT_LIVED_TOKEN, 'sl.' + 'a'.repeat(135)],
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w apps/api -- patterns.spec.ts`
Expected: FAIL — `PATTERNS` has no entries for the new types yet, so the `'has a sample for every declared secret type and vice versa'` check fails.

- [ ] **Step 4: Add the matching entries to `PATTERNS`**

Append to `PATTERNS` in `patterns.ts` (before the closing `];`):

```typescript
  // Private keys (specific formats, in addition to the existing generic PRIVATE_KEY_PEM)
  { secretType: ESecretType.OPENSSH_PRIVATE_KEY, pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/g },
  { secretType: ESecretType.PGP_PRIVATE_KEY_BLOCK, pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g },
  // GCP service account key (JSON credentials file)
  { secretType: ESecretType.GCP_SERVICE_ACCOUNT_KEY, pattern: /"type":\s*"service_account"/g },
  // Azure Storage connection string
  { secretType: ESecretType.AZURE_STORAGE_ACCOUNT_KEY, pattern: /AccountKey=[A-Za-z0-9+/]{86}==/g },
  // New Relic
  { secretType: ESecretType.NEW_RELIC_API_KEY, pattern: /NRAK-[A-Z0-9]{27}/g },
  // Postman
  { secretType: ESecretType.POSTMAN_API_KEY, pattern: /PMAK-[a-f0-9]{24}-[a-f0-9]{34}/g },
  // Databricks
  { secretType: ESecretType.DATABRICKS_TOKEN, pattern: /dapi[a-f0-9]{32}/g },
  // Notion
  { secretType: ESecretType.NOTION_API_TOKEN, pattern: /secret_[A-Za-z0-9]{43}/g },
  // Terraform Cloud
  { secretType: ESecretType.TERRAFORM_CLOUD_TOKEN, pattern: /[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9-_=]{64,}/g },
  // Linear
  { secretType: ESecretType.LINEAR_API_KEY, pattern: /lin_api_[A-Za-z0-9]{40}/g },
  // Sentry
  { secretType: ESecretType.SENTRY_AUTH_TOKEN, pattern: /sntrys_[A-Za-z0-9+/=_-]{40,200}/g },
  // Figma
  { secretType: ESecretType.FIGMA_PERSONAL_ACCESS_TOKEN, pattern: /figd_[A-Za-z0-9_-]{40}/g },
  // Grafana (base64-encoded {"k":...} blob, no dots - distinct shape from the dot-delimited JWT_TOKEN pattern)
  { secretType: ESecretType.GRAFANA_API_KEY, pattern: /eyJrIjoi[A-Za-z0-9+/=]{50,300}/g },
  // Dropbox short-lived token
  { secretType: ESecretType.DROPBOX_SHORT_LIVED_TOKEN, pattern: /sl\.[A-Za-z0-9_-]{130,152}/g },
```

- [ ] **Step 5: Run the pattern tests to verify they pass**

Run: `npm run test -w apps/api -- patterns.spec.ts`
Expected: PASS for every `SAMPLES` entry, including the "has a sample for every declared secret type and vice versa" and "does not false-positive on normal code" checks. If a specific sample doesn't match (e.g. an off-by-one on a length quantifier), fix that pattern's quantifier to match the vendor's real token length — never loosen it into an open-ended catch-all.

- [ ] **Step 6: Add `DESCRIPTIONS` entries**

Insert into `DESCRIPTIONS` in `descriptions.ts`, before the `GENERIC_HIGH_ENTROPY` entry:

```typescript
  [ESecretType.OPENSSH_PRIVATE_KEY]: 'OpenSSH Private Key',
  [ESecretType.PGP_PRIVATE_KEY_BLOCK]: 'PGP Private Key Block',
  [ESecretType.GCP_SERVICE_ACCOUNT_KEY]: 'GCP Service Account Key (JSON)',
  [ESecretType.AZURE_STORAGE_ACCOUNT_KEY]: 'Azure Storage Account Key',
  [ESecretType.NEW_RELIC_API_KEY]: 'New Relic API Key',
  [ESecretType.POSTMAN_API_KEY]: 'Postman API Key',
  [ESecretType.DATABRICKS_TOKEN]: 'Databricks Personal Access Token',
  [ESecretType.NOTION_API_TOKEN]: 'Notion Integration Token',
  [ESecretType.TERRAFORM_CLOUD_TOKEN]: 'Terraform Cloud API Token',
  [ESecretType.LINEAR_API_KEY]: 'Linear API Key',
  [ESecretType.SENTRY_AUTH_TOKEN]: 'Sentry Auth Token',
  [ESecretType.FIGMA_PERSONAL_ACCESS_TOKEN]: 'Figma Personal Access Token',
  [ESecretType.GRAFANA_API_KEY]: 'Grafana API Key',
  [ESecretType.DROPBOX_SHORT_LIVED_TOKEN]: 'Dropbox Short-Lived Access Token',
```

- [ ] **Step 7: Run the full backend suite and build**

Run: `npm run test -w apps/api && npm run build -w apps/api`
Expected: all green.

- [ ] **Step 8: Sync and build the frontend**

Confirm `apps/web/src/lib/constant/secret-type.constant.ts` has exactly the same 14 new members added in Step 1.

Run: `npm run test -w apps/web && npm run build -w apps/web`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add credsScrapper/apps/api/src/modules/scanner/domain/constant/secret-type.constant.ts credsScrapper/apps/api/src/modules/scanner/domain/detection/patterns.ts credsScrapper/apps/api/src/modules/scanner/domain/detection/descriptions.ts credsScrapper/apps/web/src/lib/constant/secret-type.constant.ts credsScrapper/apps/api/tests/unit/scanner/domain/detection/patterns.spec.ts
git commit -m "feat: detect 14 additional secret types"
```

---

## Task 9: Post-implementation review pass

**Files:** none new — this task runs the repo's mandated review agents/skills over everything touched in Tasks 1-8.

- [ ] **Step 1: Dispatch `hex-architecture-reviewer`**

Scope: everything changed under `credsScrapper/apps/api/src/modules/scanner/`. Fix any reported layering violation (e.g. a controller doing more than calling one use-case, an infrastructure detail leaking into `domain`).

- [ ] **Step 2: Dispatch `secret-handling-reviewer`**

Scope: `findings`, `secretValue`, `TestingPanel`, `FindingStatusBadge`, and the new `PATCH /findings/:id/status` endpoint/logs. Confirm no raw secret value reaches a log line or an unintended response field, and that `SecretValue`'s reveal-on-click remains the only place a secret renders unmasked.

- [ ] **Step 3: Run `ponytail-review` (or dispatch `lazy-simplifier`)**

Scope: all files touched in Tasks 1-8. Expect it to flag anything over-built — e.g. if the testing-panel log grew any unneeded state, or any dead code was left behind.

- [ ] **Step 4: Fix anything flagged, then re-run the full test/build matrix**

Run: `npm run test -w apps/api && npm run test -w apps/web && npm run build -w apps/api && npm run build -w apps/web` (from `credsScrapper/`)
Expected: all four green.

- [ ] **Step 5: Commit any review fixes**

```bash
git add -A
git commit -m "fix: address hex-architecture/secret-handling/ponytail review findings"
```
