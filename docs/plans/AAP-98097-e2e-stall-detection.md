# AAP-98097: E2E Test Coverage for Workflow Stall Detection

**Jira**: AAP-98097  
**Parent Story**: AAP-92815  
**Component**: aap-testing-framework  
**Goal**: Add end-to-end Playwright coverage for workflow stall detection and related UI behavior.

---

## Background

Stall detection was implemented across multiple stories:

- **AAP-92824** (PR #657): Schema foundation — added `stall_alert_at` timestamp to `ActivityExecution` and `first_stall_detected_at` to `Execution`
- **AAP-92825** (PR #740): Periodic worker — scans for running activities exceeding `expected_duration`, claims them atomically via `UPDATE...RETURNING`, emits audit events, updates Prometheus gauges, sends Segment telemetry
- **AAP-92826** (branch `feat/AAP-92826-stall-api-frontend`): Frontend UI — shows execution-level "Delayed" badge and activity-level stall warnings with live WebSocket updates

**Current State**: Backend integration tests exist (`backend/tests/integration/workflows/test_stall_detection.py`). No E2E tests cover the user-visible UI behavior.

---

## Architecture Summary

### Backend

**Stall Detection Worker** (`backend/src/syntara/workflows/workers/stall_detection.py`):
- Runs every 10 seconds (configurable via `stall_detection_interval_seconds`)
- SQL query selects activities where:
  - `status = RUNNING`
  - `expected_duration IS NOT NULL`
  - `started_at IS NOT NULL`
  - `stall_alert_at IS NULL`
  - `started_at + make_interval(secs => expected_duration) < now()`
- Atomically claims stalls via `UPDATE ... SET stall_alert_at = now() ... RETURNING ActivityExecution`
- Sets `first_stall_detected_at` on parent `Execution` (once per execution, atomic)
- Emits:
  - Audit event (`NodeStalledEvent`)
  - Segment telemetry (`WorkflowStallEvent`)
  - Prometheus gauges (`orchestrator_stalled_workflows_current`, `orchestrator_stalled_steps_current`, `orchestrator_stalled_workflows_total`)

**Permanent Marker Semantics**:
- `stall_alert_at` and `first_stall_detected_at` are **never cleared**, even if the activity later completes
- This preserves stall history for observability and post-mortem analysis

**Global Expected Duration Settings** (`backend/src/syntara/settings/catalog.py`):
- Five settings in the `workflow_execution` category:
  - `workflow_engine.script_expected_duration_seconds`
  - `workflow_engine.http_request_expected_duration_seconds`
  - `workflow_engine.agentic_expected_duration_seconds`
  - `workflow_engine.aap_expected_duration_seconds`
  - `workflow_engine.approval_expected_duration_seconds`
- All default to `None` (stall detection disabled by default)
- Validation: minimum 1 second
- Resolution order: `node.settings.expected_duration` (per-node override) → global setting → `None`
- Cache TTL: 60 seconds (configurable per-setting, default propagation delay)

**API Exposure**:
- `ActivityExecution.stall_alert_at` appears in execution detail responses
- `Execution.first_stall_detected_at` appears in execution list/detail responses
- WebSocket incremental patches include `stall_alert_at` for live updates
- Runtime settings API: `PATCH /settings` (bulk update), `GET /settings/{key}` (read)

### Frontend

**UI Components** (from `feat/AAP-92826-stall-api-frontend` branch):

| Component | Location | Behavior |
|---|---|---|
| `ExecutionDelayedBadge` | `frontend/packages/syntara-ui/src/components/labels/ExecutionDelayedBadge.tsx` | Warning badge with "Delayed" label, shown when `execution.first_stall_detected_at != null` |
| `ActivityStatusLabel` | Modified to accept `stallAlertAt` prop and render warning icon when set | Shows stall warning on individual activities in execution detail views |
| `ExecutionActivityTable` | `frontend/packages/syntara-ui/src/routes/builder/ExecutionActivityTable.tsx` | Passes `state.stallAlertAt` to status label |
| `ExecutionsTableBody` | `frontend/packages/syntara-ui/src/routes/executions/ExecutionsTableBody.tsx` | Shows `ExecutionDelayedBadge` in execution list when `first_stall_detected_at != null` |
| `ExecutionDetailsPanelHeader` | `frontend/packages/syntara-ui/src/routes/builder/ExecutionDetailsPanelHeader.tsx` | Shows `ExecutionDelayedBadge` in builder's execution detail panel header |
| `SynStep` | `frontend/packages/syntara-ui/src/components/steps/SynStep.tsx` | Canvas node accepts `executionState.stall_alert_at`, renders warning when present |

**Live Updates**:
- WebSocket incremental patches include `stall_alert_at` updates
- `ExecutionStateEnricher` enriches activity state with `stall_alert_at` from patches
- UI components reactively update when state changes

**Key UI Locations**:
1. **Executions list page** (`/executions`) — "Delayed" badge next to execution status
2. **Execution detail page** (`/executions/{id}`) — "Delayed" badge in page header
3. **Builder execution detail panel** — "Delayed" badge in panel header when viewing execution history
4. **Activity table** (detail page and builder panel) — warning icon on stalled activities
5. **Canvas nodes** (builder execution view) — visual indicator on stalled steps

---

## Playwright Test Execution Model

**Configuration** (`frontend/packages/syntara-ui/playwright.config.ts`):
- **`fullyParallel: true`** — All test files run concurrently by default
- **Workers**: 3 in CI (`workers: process.env.CI ? 3 : undefined`), unlimited locally
- **Retries**: 1 in CI, 0 locally
- **Timeout**: 60s per test, 10s per assertion

**Implications for Test Design**:
- Tests run in isolated browser contexts — no shared state across tests
- Test files execute concurrently, but tests within a file run sequentially by default
- Expensive setup (workflow creation, execution, stall wait) should be minimized or consolidated where safe

**Parallelization Strategy**:
- **Independent scenarios** (different user flows, permissions, or cleanup requirements) → separate test files (run in parallel)
- **Same workflow lifecycle, different assertions** → consolidate into one test or use `test.describe.serial()` block where stall wait can be shared

---

## Runtime Minimization Strategy

### Current vs. Proposed Test Structure

**Original approach** (7 separate test files, 7 independent stall waits):
- Each scenario creates workflow → runs execution → waits 15-30s for stall detection → asserts different UI fields → cleans up
- **Total stall wait time**: ~7 × 20s = **140 seconds of blocking time** (though parallelized across 3 workers in CI, still ~47s wall-clock minimum)

**Optimized approach** (4 test files, 4 stall waits total)**:
1. **`stall-detection-core.spec.ts`** — Consolidates 4 scenarios (live warning, list visibility, persistence, WebSocket) into **one 30s stall wait**
2. **`stall-detection-no-false-positive.spec.ts`** — Unchanged (**one fast execution**, ~5s)
3. **`stall-detection-global-settings.spec.ts`** — New global settings test (**one 30s stall wait**)
4. **`stall-detection-builder-a11y.spec.ts`** — Builder panel + accessibility (**one 30s stall wait**)

**Estimated time savings**:
- **Before**: 7 stall waits × 20s = 140s total blocking time
- **After**: 3 stall waits × 30s + 1 fast execution (5s) = 95s total blocking time
- **Reduction**: ~32% reduction in time-based waits
- **CI wall-clock**: With 3 workers, pessimistically ~35s vs. ~50s (assuming stall tests dominate the critical path)

### Consolidation Rationale

**Why Scenarios 1, 2, 3, 5 can share one workflow lifecycle** (`stall-detection-core.spec.ts`):
- All assert **read-only views** of the same stall event (detail page, list page, builder panel, WebSocket patch)
- No destructive actions between assertions (navigation does not mutate state)
- Assertions are **independent** — checking badge in page header does not interfere with checking badge in list
- Workflow completion (for persistence test) happens naturally at the end of the stall wait

**Why other scenarios must remain separate**:
- **Scenario 4** (no false positive): Tests **absence** of stall (fast execution, opposite condition)
- **Global settings test**: Modifies backend runtime settings (requires isolated cleanup path to restore original values)
- **Builder + a11y**: Different UI entry point (builder vs. executions list), but can share one lifecycle (builder panel assertion + a11y scan)

---

## E2E Test Scenarios

### Test 1: Core Stall Detection Behavior

**Test Location**: `frontend/packages/syntara-ui/e2e/stall-detection-core.spec.ts`

**Consolidates**:
- Scenario 1: Live running workflow shows stall warning
- Scenario 2: Stalled execution appears in executions list
- Scenario 3: Stall history persists after activity completion
- Scenario 5: Stall warning updates live (WebSocket delivery)

**User Journeys Covered**:
1. User watches execution detail page and sees stall warning appear live
2. User navigates to executions list and sees "Delayed" badge
3. User sees stall warning persist after workflow completes
4. User observes WebSocket real-time updates without page refresh

**Single Workflow Lifecycle**:
```typescript
test('stall detection across all views', async ({ app }) => {
  // Setup: Create workflow with stalling activity
  const workflowName = buildUniqueName('stall-test')
  const { id } = await createWorkflowWithStallingActivityViaApi(
    app, workflowName,
    3,  // expected_duration: 3 seconds
    30  // actual sleep: 30 seconds
  )

  // Run workflow and navigate to execution detail page
  const executionUrl = await runWorkflowFromBuilderAndCaptureUrl(app, workflowName)

  // Assert: Activity is running (no stall yet) — proves WebSocket will deliver change
  await expect(app.getByText('Activity 1')).toBeVisible()
  await assertNoStallWarning(app, 'Activity 1')
  await assertNoExecutionDelayedBadge(app, pageHeader(app))

  // Wait for stall detection (WebSocket patch delivered live)
  await waitForActivityStallWarning(app, 'Activity 1', 30_000)

  // Assert: Stall warning visible in execution detail page header
  await waitForExecutionDelayedBadge(app, pageHeader(app), 5_000)

  // Assert: Stall warning visible in executions list
  await app.goto(toAppUrl('/executions'))
  const executionRow = app.getByRole('row').filter({ hasText: workflowName })
  await waitForExecutionDelayedBadge(app, executionRow, 5_000)

  // Navigate back to execution detail
  await app.goto(executionUrl)

  // Wait for workflow to complete
  await waitForExecutionCompleted(app, 60_000)

  // Assert: Stall warning persists after completion (permanent marker)
  await expect(pageHeader(app).getByText('Delayed')).toBeVisible()
  await expect(app.getByRole('row').filter({ hasText: 'Activity 1' })
    .getByRole('img', { name: /stalled|delayed/i })).toBeVisible()

  // Assert: Persistence in executions list
  await app.goto(toAppUrl('/executions'))
  await expect(app.getByRole('row').filter({ hasText: workflowName })
    .getByText('Delayed')).toBeVisible()

  // Cleanup
  await deleteWorkflowViaApi(app, id)
})
```

**Why Consolidated**:
- **One stall wait** (~30s) covers four scenarios that previously required four separate 30s waits
- All assertions are **non-destructive** reads of the same underlying state
- Natural progression: stall appears → cross-view assertion → completion → persistence assertion

**Fixtures/Helpers Needed**:
- `createWorkflowWithStallingActivityViaApi(app, workflowName, expectedDuration, actualDuration)` — creates workflow with script node
- `runWorkflowFromBuilderAndCaptureUrl(app, workflowName)` — runs workflow, captures execution detail URL
- `waitForActivityStallWarning(app, activityName, timeout)` — polls for stall warning icon
- `waitForExecutionDelayedBadge(app, locatorScope, timeout)` — polls for "Delayed" badge
- `assertNoStallWarning(app, activityName)` — asserts no stall icon initially (proves WebSocket delivery)
- `assertNoExecutionDelayedBadge(app, locatorScope)` — asserts no badge initially
- `waitForExecutionCompleted(app, timeout)` — polls for "Completed" status
- `pageHeader(app)` — locator scoped to `.pf-v6-c-compass__main-header`

**Flakiness Risks**:
- **WebSocket delivery delay**: Poll with 30s timeout for stall warning
- **Worker scan interval**: Allow 15-20s for detection (backend scans every 10s)
- **Activity completion race**: Use 30s sleep + 3s expected_duration to ensure detection window

**Mitigation**:
- Use polling helpers with generous timeouts
- Add explicit "no stall yet" assertion before waiting for stall (proves WebSocket delivery, not pre-existing state)
- Use `buildUniqueName` to avoid execution list pagination issues

---

### Test 2: No False Positives — Activity Below Threshold Not Flagged

**Test Location**: `frontend/packages/syntara-ui/e2e/stall-detection-no-false-positive.spec.ts`

**User Journey**: User runs a workflow with activities that complete within expected duration. No stall warnings appear.

**Setup**:
- Create workflow with one activity:
  - Activity 1: `script` node with `expected_duration: 60` seconds, runs a Python sleep for 2 seconds (completes well within threshold)
- Run workflow
- Navigate to execution detail page

**Assertions**:
1. Wait for Activity 1 to complete (status "Completed")
2. Assert **no** stall warning icon on Activity 1 row
3. Assert **no** `ExecutionDelayedBadge` in page header
4. Navigate to executions list
5. Assert **no** `ExecutionDelayedBadge` next to the execution

**Fixtures/Helpers Needed**:
- `createWorkflowWithFastActivityViaApi(app, workflowName, expectedDuration, actualDuration)` — creates workflow with script node
- `assertNoStallWarning(app, activityName)` — asserts stall warning icon is **not** present
- `assertNoExecutionDelayedBadge(app, locatorScope)` — asserts badge is **not** present

**Cleanup**:
- Delete workflow via API

**Flakiness Risks**:
- Test may succeed before backend worker has even scanned (false negative)

**Mitigation**:
- Add a small wait (e.g., 15s) after completion to allow at least one worker scan cycle before asserting absence
- Document in test comments that absence assertions are inherently time-dependent

**Why Separate**:
- Tests **opposite condition** (absence of stall) — cannot share lifecycle with tests that expect stall

---

### Test 3: Global Expected Duration Settings

**Test Location**: `frontend/packages/syntara-ui/e2e/stall-detection-global-settings.spec.ts`

**User Journey**: Admin sets global expected duration, creates workflow without per-node override, workflow inherits global setting and triggers stall warning.

**Setup**:
1. Read current value of `workflow_engine.script_expected_duration_seconds` via API (for cleanup)
2. Set global expected duration via settings API: `PATCH /settings` with `{ key: "workflow_engine.script_expected_duration_seconds", value: 3 }`
3. Wait 60s for settings cache to propagate (default TTL)
4. Create workflow with script node **without** `expected_duration` override in node settings
5. Run workflow (script sleeps 30s)
6. Navigate to execution detail page

**Assertions**:
1. Wait for stall warning to appear (proves global setting was inherited)
2. Assert `ExecutionDelayedBadge` in page header
3. Assert stall warning icon on activity row

**Cleanup (in `test.afterEach` or `finally` block)**:
1. Restore original setting value via `PATCH /settings` (or `DELETE /settings/{key}` if it was `null`)
2. Delete workflow via API

**Global Setting Coverage**:
- **Test one representative setting**: `workflow_engine.script_expected_duration_seconds` (simplest to trigger with `script` node)
- **Lower-level coverage**: Backend integration tests already validate the mapping between node types and setting keys (`backend/src/syntara/workflows/workflow_engine/node_settings_resolver.py`)
- **Rationale**: All five expected_duration settings use identical resolution logic (per-node → global → None). Testing one proves the mechanism; testing all five would add ~2.5 minutes of stall waits with no additional coverage value.

**Settings API Usage**:
- **Read**: `GET /api/v1/settings/workflow_engine.script_expected_duration_seconds`
- **Update**: `PATCH /api/v1/settings` with `{ updates: [{ key: "...", value: 3 }] }`
- **Permissions**: Requires `setting:read` and `setting:write` (admin user in E2E environment)
- **Cache propagation**: Settings cache TTL is 60s by default. Wait 60s after update before creating workflow, or use a longer expected_duration (e.g., 90s) if cache propagation is unreliable.

**Flakiness Risks**:
- **Settings cache propagation delay**: If cache TTL > 60s or cache invalidation via Redis Pub/Sub fails, workflow may not inherit new setting
- **Per-node override leak**: If workflow creation accidentally sets per-node `expected_duration`, test will pass falsely

**Mitigation**:
- Wait 60s after setting update before creating workflow
- Explicitly omit `expected_duration` from node settings payload in `createWorkflowViaApi` call
- Log workflow payload in test setup for debugging
- Add assertion in test: query execution detail API response and verify `activity.expected_duration == 3` (inherited from global)

**Why Separate**:
- **Isolated cleanup path**: Modifies backend runtime settings that affect all workflows, requires restore in finally block
- **Different setup flow**: Settings API interaction, cache wait, no per-node override
- **Unique coverage**: Proves global fallback mechanism (distinct from per-node override tested in core test)

**Optional Enhancement (Future Work)**:
- Test global expected_duration for other node types (HTTP request, agentic, AAP, approval)
- Test per-node override takes precedence over global setting
- Test `null` global setting → no stall detection (current default)

---

### Test 4: Builder Execution Panel + Accessibility

**Test Location**: `frontend/packages/syntara-ui/e2e/stall-detection-builder-a11y.spec.ts`

**Consolidates**:
- Scenario 6: Builder execution detail panel shows delayed badge
- Scenario 7: Accessibility — stall warning is keyboard/screen reader accessible

**User Journeys**:
1. User views workflow execution history in the builder and sees "Delayed" badge in the execution detail panel header
2. User navigates execution detail page with keyboard and screen reader, can discover and understand stall warnings

**Setup**:
- Create workflow with stalling activity
- Run workflow, wait for stall detection
- Navigate to builder page (`/builder/{workflowId}`)

**Assertions (Builder Panel)**:
1. Open execution detail panel (click on execution in history list)
2. Assert panel is visible
3. Assert `ExecutionDelayedBadge` appears in panel header
4. Assert stall warning icon on stalled activity in panel's activity table

**Assertions (Accessibility)**:
1. Navigate to execution detail page (`/executions/{id}`)
2. Run `AxeBuilder` scan on page
3. Assert **no new a11y violations** (stall UI components must be accessible)
4. Assert stall warning icon has appropriate `role` (e.g., `img`, `status`) and `aria-label` (e.g., "Activity stalled" or similar)
5. Assert `ExecutionDelayedBadge` has semantic role and accessible text
6. Focus on stall warning icon via keyboard (`Tab` navigation)
7. Assert focus indicator is visible

**Fixtures/Helpers Needed**:
- `openExecutionDetailPanel(app, executionId)` — clicks execution in history list
- `AxeBuilder` (already used in `a11y-audit.spec.ts`)
- Reuse stall warning assertion helpers from core test

**Cleanup**:
- Delete workflow via API

**Flakiness Risks**:
- Panel animation/rendering delay
- Axe scan timing issues (scanning before UI fully renders)

**Mitigation**:
- Use `waitFor` with sufficient timeout for panel to appear
- Scope locators to panel element to avoid false matches
- Wait for stall warning to appear before running Axe scan
- Follow existing a11y test patterns (e.g., `a11y-audit.spec.ts`)

**Why Separate**:
- **Different UI entry point**: Builder vs. executions list (though both show same badge)
- **Additional coverage**: Accessibility scan is distinct concern from functional stall detection
- **Can share workflow lifecycle**: Builder panel assertion + a11y scan can use the same stalled workflow (one 30s wait)

---

## Implementation Order

1. **Phase 1: Core Stall Detection**
   - `stall-detection-core.spec.ts` — validates end-to-end stall detection flow, consolidates 4 scenarios
   - Implement shared helpers in `e2e/helpers/stall-detection.ts`

2. **Phase 2: Edge Cases**
   - `stall-detection-no-false-positive.spec.ts` — validates no premature flagging
   - `stall-detection-global-settings.spec.ts` — validates global expected_duration fallback

3. **Phase 3: Builder + Accessibility**
   - `stall-detection-builder-a11y.spec.ts` — builder execution panel + WCAG compliance

---

## Files to Add or Modify

### New Test Files

| File | Purpose | Stall Wait |
|---|---|---|
| `frontend/packages/syntara-ui/e2e/stall-detection-core.spec.ts` | Core stall detection across all views (consolidates 4 scenarios) | 30s |
| `frontend/packages/syntara-ui/e2e/stall-detection-no-false-positive.spec.ts` | No false positives for fast activities | ~5s (fast execution) |
| `frontend/packages/syntara-ui/e2e/stall-detection-global-settings.spec.ts` | Global expected_duration fallback | 30s + 60s cache wait |
| `frontend/packages/syntara-ui/e2e/stall-detection-builder-a11y.spec.ts` | Builder panel + accessibility compliance | 30s |

**Total blocking time**: 3 × 30s + 5s + 60s cache wait = **155s** (cache wait is one-time per test, not per assertion)

### New Helper Functions

Add to `frontend/packages/syntara-ui/e2e/helpers/stall-detection.ts`:

```typescript
/**
 * Create a workflow with a script activity configured to stall.
 * @param expectedDuration - Expected duration in seconds (e.g., 3)
 * @param actualDuration - Actual sleep duration in seconds (e.g., 30)
 */
export async function createWorkflowWithStallingActivityViaApi(
  app: Page,
  workflowName: string,
  expectedDuration: number,
  actualDuration: number
): Promise<{ id: string }>

/**
 * Create a workflow with a script activity that completes quickly (no stall).
 * @param expectedDuration - Expected duration in seconds (e.g., 60)
 * @param actualDuration - Actual sleep duration in seconds (e.g., 2)
 */
export async function createWorkflowWithFastActivityViaApi(
  app: Page,
  workflowName: string,
  expectedDuration: number,
  actualDuration: number
): Promise<{ id: string }>

/**
 * Poll for stall warning icon on an activity row.
 * Scoped to the activity row to avoid false matches.
 */
export async function waitForActivityStallWarning(
  app: Page,
  activityName: string,
  timeout?: number
): Promise<void>

/**
 * Poll for "Delayed" badge in specified scope (page header, list row, panel header).
 * @param locatorScope - Parent locator to scope the search (e.g., pageHeader(app))
 */
export async function waitForExecutionDelayedBadge(
  app: Page,
  locatorScope: Locator,
  timeout?: number
): Promise<void>

/**
 * Assert that no stall warning icon is present on an activity row.
 */
export async function assertNoStallWarning(
  app: Page,
  activityName: string
): Promise<void>

/**
 * Assert that no "Delayed" badge is present in specified scope.
 */
export async function assertNoExecutionDelayedBadge(
  app: Page,
  locatorScope: Locator
): Promise<void>

/**
 * Poll for execution status "Completed".
 */
export async function waitForExecutionCompleted(
  app: Page,
  timeout?: number
): Promise<void>

/**
 * Run workflow from builder and capture the execution detail URL.
 * Returns URL string for later navigation.
 */
export async function runWorkflowFromBuilderAndCaptureUrl(
  app: Page,
  workflowName: string
): Promise<string>

/**
 * Locator scoped to the Compass page header region (h1, status badges, toolbar).
 */
export const pageHeader = (page: Page): Locator =>
  page.locator('.pf-v6-c-compass__main-header')
```

### New Settings API Helpers

Add to `frontend/packages/syntara-ui/e2e/utils/api-settings.ts`:

```typescript
/**
 * Get a runtime setting value by key.
 */
export async function getSettingViaApi(
  app: Page,
  key: string
): Promise<{ value: number | string | boolean | null }>

/**
 * Update a runtime setting value.
 */
export async function updateSettingViaApi(
  app: Page,
  key: string,
  value: number | string | boolean | null
): Promise<void>
```

### Existing Files to Modify

- `frontend/packages/syntara-ui/e2e/helpers/workflow-run.ts` — add `pageHeader` locator helper (or import from new `stall-detection.ts`)
- `frontend/packages/syntara-ui/e2e/utils/api.ts` — add barrel re-export for settings API helpers

---

## Validation Commands

```bash
# Run all stall detection E2E tests
npm run e2e -- stall-detection

# Run specific test
npm run e2e -- stall-detection-core.spec.ts

# Run with Playwright UI for debugging
npm run e2e:ui -- stall-detection-core.spec.ts

# Run against real backend (required for stall detection tests)
make -C backend run-all  # Terminal 1
VITE_API_URL=http://localhost:8000 npm run start:ui  # Terminal 2
SYNTARA_E2E_SKIP_WEB_SERVER=1 SYNTARA_E2E_BASE_URL=http://localhost:5173 npm run e2e -- stall-detection  # Terminal 3

# Estimated runtime (against real backend, 3 workers in CI)
# Core test: ~60s (30s stall wait + 30s completion wait + assertions)
# No false positive: ~10s (fast execution + 15s scan wait)
# Global settings: ~120s (60s cache wait + 30s stall wait + 30s completion)
# Builder + a11y: ~60s (30s stall wait + panel/a11y assertions)
# Total CI wall-clock: ~120s (global settings on critical path, others parallelized)
```

---

## Dependencies and Blockers

### Dependencies

- **AAP-92826 must be merged** — The stall detection UI is currently on `feat/AAP-92826-stall-api-frontend` branch. E2E tests cannot be written until the UI is merged to the feature branch or `devel`.
- **Playwright E2E infrastructure** — Already exists and stable (no blocker).
- **Backend stall detection worker** — Already merged via AAP-92825 (PR #740).
- **Real backend required** — Stall detection E2E tests **must** run against real backend (mock API does not simulate periodic worker). Add `test.skip(!isRealBackend, 'Requires real backend with stall detection worker')` guard.

### Blockers

- **None** — Assuming AAP-92826 is merged, no blockers exist. If AAP-92826 is delayed, E2E tests can be written against the feature branch and merged together.

### Open Questions

1. **Settings cache propagation reliability**: Does Redis Pub/Sub cache invalidation work consistently in E2E environment? If not, global settings test may need longer wait or page refresh.
   - **Recommendation**: Start with 60s wait, add page refresh fallback if flaky.

2. **Stall detection interval tuning**: Should E2E tests set a shorter scan interval (e.g., 5s) to reduce test time, or keep default 10s to match production?
   - **Recommendation**: Keep default 10s. Tests are designed to tolerate it, and overriding risks false positives if interval is too short.

---

## Out of Scope

The following are explicitly **out of scope** for AAP-98097:

1. **Backend scanner internals** — The periodic worker's SQL query logic, deduplication, and atomic claim behavior are covered by integration tests (`backend/tests/integration/workflows/test_stall_detection.py`). E2E tests focus on **user-visible UI behavior only**.

2. **Prometheus metrics assertions** — E2E tests do not query Prometheus or assert on `orchestrator_stalled_workflows_current` / `orchestrator_stalled_steps_current`. These are backend observability concerns covered by integration tests and manual validation.

3. **Segment telemetry validation** — E2E tests do not intercept or validate `WorkflowStallEvent` sent to Segment. This is a backend integration concern.

4. **Audit event verification** — E2E tests do not query the audit log or assert on `NodeStalledEvent`. This is a backend integration concern.

5. **Worker restart/failover behavior** — E2E tests assume a stable backend environment. Testing worker pod restarts, replica failover, or leader election is an infrastructure/integration concern, not E2E.

6. **Stall detection for non-script activities** — E2E tests use **script nodes only** for simplicity (HTTP request, AAP job, agentic, approval nodes are supported but not E2E tested). Testing stall detection across all node types is a lower priority and can be added incrementally.

7. **Execution cancellation/retry after stall** — Stall detection is **observability only** (AAP-92825 design). It does not cancel or retry activities. Testing user-initiated cancel/retry actions on stalled executions is a separate E2E concern (already covered by existing execution tests).

8. **Multi-activity stall within same execution** — E2E tests focus on **single stalled activity per execution** for simplicity. Testing multiple stalled activities in the same execution is possible but adds complexity without significant coverage value.

9. **Stall detection configuration changes** — E2E tests assume default `stall_detection_interval_seconds` (10s) and do not test reconfiguration or dynamic interval changes.

10. **Cross-browser compatibility** — E2E tests run on Playwright's default browser (Chromium). Cross-browser testing (Firefox, Safari) is handled by existing Playwright config and not specific to stall detection.

11. **All five global expected_duration settings** — Only `workflow_engine.script_expected_duration_seconds` is tested. The other four (`http_request`, `agentic`, `aap`, `approval`) use identical resolution logic (validated by backend integration tests) and testing all would add ~2 minutes of stall waits with no additional coverage.

12. **Settings UI testing** — Global settings test uses API directly (`PATCH /settings`). Testing the settings UI form (if it exists) is a separate concern covered by settings page E2E tests.

---

## Repository Evidence Used

This plan is based on direct inspection of the following repository artifacts:

### Backend

- `backend/src/syntara/workflows/workers/stall_detection.py` — periodic worker implementation
- `backend/src/syntara/workflows/models/activity_execution.py` — `ActivityExecution.stall_alert_at` schema
- `backend/src/syntara/workflows/models/execution.py` — `Execution.first_stall_detected_at` schema
- `backend/tests/integration/workflows/test_stall_detection.py` — integration test patterns
- `backend/docs/stall-detection-prometheus-gauges.md` — Prometheus metrics design
- `backend/src/syntara/core/database/migrations/versions/e3a1f5b7d924_add_stall_detection_columns.py` — schema migration
- `backend/src/syntara/workflows/audit/node_stalled.py` — audit event definition
- `backend/src/syntara/telemetry/events/workflow_stall.py` — Segment event definition
- `backend/src/syntara/settings/catalog.py` — global expected_duration settings (5 settings, all default to `None`)
- `backend/src/syntara/workflows/workflow_engine/node_settings_resolver.py` — expected_duration resolution logic (per-node → global → None)
- `backend/src/syntara/settings/cache/settings_cache.py` — settings cache TTL (default 60s)
- `backend/src/syntara/settings/router.py` — settings API endpoints (`GET /settings/{key}`, `PATCH /settings`)

### Frontend (from `feat/AAP-92826-stall-api-frontend` branch)

- `frontend/packages/syntara-ui/src/components/labels/ExecutionDelayedBadge.tsx` — "Delayed" badge component
- `frontend/packages/syntara-ui/src/components/steps/SynStep.tsx` — canvas node stall UI
- `frontend/packages/syntara-ui/src/routes/builder/ExecutionActivityTable.tsx` — activity table stall rendering
- `frontend/packages/syntara-ui/src/routes/executions/ExecutionsTableBody.tsx` — executions list stall rendering
- `frontend/packages/syntara-ui/src/routes/builder/utils/executionState/ExecutionStateEnricher.ts` — WebSocket state enrichment
- `frontend/packages/syntara-contracts/src/executions-api.ts` — TypeScript types for `stall_alert_at` and `first_stall_detected_at`

### E2E Test Patterns

- `frontend/packages/syntara-ui/playwright.config.ts` — `fullyParallel: true`, `workers: 3` in CI
- `.agents/skills/frontend-playwright-e2e/SKILL.md` — Playwright conventions and patterns
- `frontend/packages/syntara-ui/e2e/run-step.spec.ts` — kebab menu interaction patterns
- `frontend/packages/syntara-ui/e2e/helpers/workflow-run.ts` — `runWorkflowFromBuilder`, `waitForExecutionPaused` patterns
- `frontend/packages/syntara-ui/e2e/helpers/workflows.ts` — `buildUniqueName`, `createWorkflowViaApi`
- `frontend/packages/syntara-ui/e2e/utils/api.ts` — API helper barrel re-exports
- `frontend/packages/syntara-ui/e2e/fixtures.ts` — custom `{ app }` fixture definition
- `frontend/packages/syntara-ui/e2e/a11y-audit.spec.ts` — accessibility testing patterns

### Git History

- Commits on `feat/AAP-92826-stall-api-frontend` — stall UI implementation
- PR #657 (AAP-92824) — schema foundation
- PR #740 (AAP-92825) — periodic worker and telemetry
- Merge commit `222c7d9a7` — AAP-92824 schema merge

---

## Assumptions

1. **AAP-92826 UI is functionally complete** — The plan assumes the stall detection UI on `feat/AAP-92826-stall-api-frontend` is ready for E2E testing and requires no further UI changes.

2. **Backend worker is enabled in E2E environment** — The plan assumes the stall detection periodic worker runs automatically when the backend starts (via `make -C backend run-all` or `podman-compose`). If the worker requires manual enablement, E2E test setup must document this.

3. **WebSocket is reliable in E2E environment** — The plan assumes WebSocket incremental patches are delivered consistently in the E2E backend. If WebSocket is flaky, tests will need page refresh fallback logic (similar to `waitForExecutionPaused`).

4. **Default scan interval (10s) is acceptable for E2E** — Tests are designed to tolerate the default 10s worker interval. If this makes tests too slow, the interval can be reduced via env var (pending confirmation of `stall_detection_interval_seconds` configurability).

5. **Script nodes are sufficient for E2E coverage** — The plan uses `script` nodes (Python sleep) to trigger stalls. While the backend supports stall detection for all node types, script nodes are sufficient to validate the UI behavior.

6. **Stall warning icon locator is accessible** — The plan assumes the frontend uses a semantically accessible role (e.g., `role="img"`) and label for the stall warning icon. If the icon is purely decorative CSS, tests will need to adapt locators.

7. **Execution detail page is the primary test surface** — Most tests navigate to the execution detail page (`/executions/{id}`) as the primary assertion point. This is consistent with existing E2E patterns and provides the most comprehensive view of stall state.

8. **No backend configuration changes during tests** — Tests assume the backend's `stall_detection_interval_seconds` and other stall-related settings remain constant (except for the global settings test, which explicitly modifies and restores `workflow_engine.script_expected_duration_seconds`).

9. **Settings cache propagation takes ≤60s** — The global settings test assumes settings cache TTL is 60s and waits accordingly. If cache propagation is slower or unreliable, test may need longer wait or page refresh.

10. **Cleanup is best-effort** — Tests delete workflows via API in `test.afterEach`, but if a test crashes mid-run, orphaned workflows may remain. Global settings test uses `finally` block to restore setting. This is acceptable per existing E2E patterns (unique names prevent conflicts).

---

## Next Steps

1. **Confirm AAP-92826 merge timeline** — Check with team when `feat/AAP-92826-stall-api-frontend` will merge to feature branch or `devel`.
2. **Review and approve this plan** — Share with team for feedback, clarify open questions.
3. **Implement Phase 1** — Start with `stall-detection-core.spec.ts` and shared helpers in `e2e/helpers/stall-detection.ts`.
4. **Implement Phase 2** — Add edge case tests (no false positive, global settings).
5. **Implement Phase 3** — Add builder + a11y test.
6. **Run full suite against real backend** — Validate all scenarios end-to-end.
7. **Document any test-specific backend config** — If `stall_detection_interval_seconds` must be tuned for E2E, document in test comments or README.

---

**Plan Created**: 2026-10-20  
**Last Updated**: 2026-10-20  
**Status**: Draft — Pending review and AAP-92826 merge
