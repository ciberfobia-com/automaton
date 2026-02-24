# Engineering Workflow — ciberfobia-com/automaton

> **Why `ENGINEERING.md` at root?** Upstream keeps all engineering docs at root level (`README.md`, `ARCHITECTURE.md`, `DOCUMENTATION.md`). Creating a `docs/` directory would add structural divergence for no gain. This file is fork-only — upstream doesn't have it — so merge conflicts are impossible.

---

## 1. Branching Strategy

| Branch | Purpose | Merges into |
|---|---|---|
| `main` | Mirror of upstream `main` + our economy hooks. Must stay fast-forwardable to upstream whenever possible. | — |
| `economy/phase-N` | Long-lived phase branches (e.g., `economy/phase-1-metrics`). One per milestone. | `main` via PR |
| `economy/<feature>` | Short-lived feature branches (e.g., `economy/task-recommender`). | `economy/phase-N` or `main` via PR |
| `hotfix/<desc>` | Urgent fixes to economy code already on `main`. | `main` via PR |

**Rules:**

- **Rebase** feature branches onto their target before merging (clean, linear history).
- **Merge commits** (no fast-forward) when closing a `economy/phase-N` into `main` — this preserves the phase boundary as a single merge commit.
- **Never force-push `main`.**

---

## 2. Upstream Sync Process

### One-time setup

```bash
git remote add upstream https://github.com/Conway-Research/automaton.git
git remote -v  # verify: origin = ciberfobia-com, upstream = Conway-Research
```

### Routine sync (default: rebase)

```bash
git fetch upstream
git checkout main
git rebase upstream/main   # rebase, not merge — keeps our commits on top
git push origin main       # fast-forward push
```

> **Why rebase?** Our economy additions sit cleanly on top of upstream. This makes `git log` readable and keeps the fork trivially mergeable back upstream if we ever PR something.

### If rebase conflicts

```bash
# during rebase:
git status                     # see conflicted files
# fix conflicts, then:
git add <resolved-files>
git rebase --continue
# if it's a mess:
git rebase --abort             # start over, no damage done
```

### Tag known-good baselines

```bash
# after a clean sync:
git tag upstream-baseline/2026-02-24 upstream/main
git push origin --tags
```

---

## 3. Change Isolation Rules

| Rule | Detail |
|---|---|
| **All new code** → `src/economy/` | Every module we write lives here. No exceptions. |
| **One hook maximum** | If we need to call economy code from the main runtime, we add **one** adapter call in **one** agreed file (e.g., `src/index.ts`). The call must be behind a null-safe guard: `economy?.init(ctx)`. |
| **No mass formatting** | Don't run Prettier/ESLint --fix on upstream files. Format only files we own. |
| **Don't touch core** | Forbidden to modify: `survival/`, `identity/`, `constitution.md`, `src/agent/policy-engine.ts`, `src/agent/policy-rules/`, `src/identity/wallet.ts`, `src/heartbeat/daemon.ts`, `src/heartbeat/scheduler.ts`. |
| **Shared types** | If we need new interfaces, put them in `src/economy/types.ts`, not in `src/types.ts`. Import upstream types read-only. |

---

## 4. Adapter Pattern

```
src/economy/
  runtime-adapters/
    database.ts      ← wraps AutomatonDatabase access
    credits.ts       ← wraps survival tier + balance queries
    inference.ts     ← wraps inference cost lookups
    config.ts        ← wraps config reads
    index.ts         ← barrel export
  modules/
    metrics/         ← economic metrics calculator
    memory/          ← RAG-based economic memory
    recommender/     ← task recommender
    evolution/       ← evolution engine
  types.ts
  index.ts           ← single entry point for the hook in src/index.ts
```

**Rule:** Economy code imports **only** from `src/economy/runtime-adapters/`, never from `src/state/database.ts` or `src/conway/credits.ts` directly. If upstream renames an internal function, we fix **one adapter file**, not twenty modules.

---

## 5. Versioning & Release Notes

### CHANGELOG

Maintain `CHANGELOG.md` at root (fork-only, no upstream conflict). Format:

```markdown
# Changelog — ciberfobia-com/automaton

## [economy-0.2.0] — 2026-02-24
### Added
- Economic metrics module (src/economy/modules/metrics/)
- Task recommender v1

### Fixed
- Adapter null-safety on missing credit balance
```

### Tags

| Tag pattern | Example | Purpose |
|---|---|---|
| `upstream-baseline/<date>` | `upstream-baseline/2026-02-24` | Last clean sync point |
| `economy-<semver>` | `economy-0.1.0` | Economy milestone release |

---

## 6. Testing & CI

### Economy tests

- Place tests in `src/__tests__/economy/` (mirrors upstream test location convention).
- Name files `<module>.test.ts`.
- Use the same vitest setup and mock infrastructure from `src/__tests__/mocks.ts`.

### Run locally

```bash
pnpm test                              # ALL tests (upstream + ours)
pnpm test -- --grep 'economy'          # only economy tests
pnpm typecheck                         # must pass with zero errors
```

### CI contract

- **Upstream tests must pass unchanged.** If an upstream test breaks, we broke isolation — fix immediately.
- Economy tests are additive — they never replace upstream tests.
- Add a script to `package.json` if needed:

```json
"test:economy": "vitest run --grep 'economy'"
```

---

## 7. Code Style & Repo Hygiene

| Guideline | Detail |
|---|---|
| **No sweeping refactors** | If you want to rename something upstream, upstream a PR instead. |
| **Small PRs** | Max ~300 lines changed. Split larger work into stacked PRs. |
| **Commit messages** | `type(scope): description` — e.g., `feat(economy): add metrics calculator`, `fix(adapter): handle null credit balance`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. |
| **PR titles** | Same format as commit messages. |
| **No generated files** | Don't commit `dist/`, `node_modules/`, `.db` files. |

---

## 8. Security & Governance

| Principle | Implementation |
|---|---|
| **Policy engine is sacred** | Economy code never bypasses `PolicyEngine.evaluate()`. All tool calls from economy modules go through the standard tool execution path. |
| **Constitution is immutable** | Economy code never reads, writes, or references `constitution.md` directly. The three laws are upstream's domain. |
| **Creator override** | If we need kill-switch / override flags for economy features, they live in `src/economy/governance.ts` as a standalone guard. This guard checks config flags **before** economy actions execute — it does NOT patch core policy. |
| **Treasury policy respected** | Economy modules that involve spending must call the existing `SpendTracker` (via adapter). No shadow accounting. |
| **Wallet isolation** | Economy code never imports from `src/identity/wallet.ts`. If wallet data is needed, the adapter exposes only the public address (read-only). |
