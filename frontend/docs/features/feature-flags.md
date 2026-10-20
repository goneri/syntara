# Frontend feature flags

## Strategy

A feature flag enables temporary behavior in the frontend. A flag does not grant access or protect data. The backend must still check permissions.

Flags are off unless browser storage sets a registered flag to the string value `true` under its `syn.flags.<name>` key. `FeatureFlagsProvider` reads a snapshot when the app starts. Reload the page after you change a saved value.

This proof of concept uses a small in-repository feature-flag implementation rather than a flag-management library. TypeScript provides registered names, and Zod validates stored names and the exact strings `true` and `false`. The current need is one registered boolean flag, a browser-local override, and a reload. A remote flag service is outside this scope. Revisit this choice if flags need centralized control, targeting, or analytics.

## Add and use a flag

Add each flag name to `FEATURE_FLAG_NAMES` in `src/utils/feature-flags.ts`. TypeScript builds the `FeatureFlag` union from this list. It rejects names that are not in the list. `FeatureFlagConfig` is the record of enabled states for those keys.

Use `useFeatureFlag` in a React component:

```tsx
import { useFeatureFlag } from '../../providers/use-feature-flag'

function Example() {
  const isEnabled = useFeatureFlag('workflow_builder_qol')
  return isEnabled ? <span>Feature enabled</span> : null
}
```

The app provides `FeatureFlagsProvider`. Tests that render a component with this hook must also render the provider.

Do not cast a string to `FeatureFlag` to skip the TypeScript check.

## Set a local value

Use the browser developer console to turn on a registered flag:

```js
localStorage.setItem('syn.flags.workflow_builder_qol', 'true')
location.reload()
```

Set the value to `false` to turn it off:

```js
localStorage.setItem('syn.flags.workflow_builder_qol', 'false')
location.reload()
```

Remove one saved value to turn that flag off:

```js
localStorage.removeItem('syn.flags.workflow_builder_qol')
location.reload()
```

Remove every saved feature flag value to turn all flags off:

```js
for (const key of Object.keys(localStorage)) {
  if (key.startsWith('syn.flags.')) localStorage.removeItem(key)
}
location.reload()
```

The module checks each `syn.flags.` key and value in storage. A missing flag is off. An unknown flag name or a value other than the strings `true` and `false` turns all flags off. Only the string value `true` turns a flag on.

In development, the browser console shows a table of each registered flag's storage key and effective state once when the app loads. Reload after changing local storage to see the updated state. Vite removes this development-only log from production builds.

The previous `flags.<name>` keys and the former `feature-flags` JSON key are no longer read. Remove stale values with `localStorage.removeItem('flags.workflow_builder_qol')` and `localStorage.removeItem('feature-flags')` if needed.

## Demo route

Visit `/feature-flag-demo` to demonstrate route guarding. Its TanStack Router `beforeLoad` check reads `workflow_builder_qol` from router context before the page loads. When the flag is off or missing, the router redirects to `/workflows`. When the flag is the string `true`, the route loads and shows the guarded placeholder content. The route is not in navigation.

Set the flag from the browser console, then open the demo route:

```js
localStorage.setItem('syn.flags.workflow_builder_qol', 'true')
location.assign('/feature-flag-demo')
```

Remove the key or set it to `false`, then open the route again to see the redirect. This is a client-side routing demonstration, not an access-control boundary.

## Test a flagged component

In tests, do not mock `useFeatureFlag`. Set `localStorage` before you render `FeatureFlagsProvider`. This tests storage validation and context wiring. The provider reads the values when it mounts. In this example, `Example` is the flagged component from the earlier example.

```tsx
import { render } from '@testing-library/react'

import { FeatureFlagsProvider } from '../../providers/feature-flags-provider'
import { toFeatureFlagKey } from '../../utils/feature-flags'

localStorage.setItem(toFeatureFlagKey('workflow_builder_qol'), 'true')

render(
  <FeatureFlagsProvider>
    <Example />
  </FeatureFlagsProvider>
)
```

Clear the storage key after each test so one test does not affect another.

## Gate a route

Use TanStack Router's typed router context when a flag controls route loading. The app passes the `FeatureFlagsProvider` snapshot to `<RouterProvider context={...} />`. Read flags from `context.featureFlags` in `beforeLoad`; do not read local storage there or call a React hook. This works with code-based routes created with `createRoute`; file-based routing is not required.

```tsx
import { createRootRouteWithContext, createRoute, redirect } from '@tanstack/react-router'

import type { FeatureFlagConfig } from '../../utils/feature-flags'

type AppRouterContext = {
  featureFlags: FeatureFlagConfig
}

const rootRoute = createRootRouteWithContext<AppRouterContext>()({ component: App })

const featureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/feature-example',
  beforeLoad: ({ context }) => {
    if (context.featureFlags.workflow_builder_qol !== true) {
      throw redirect({ to: '/workflows', replace: true })
    }
  },
  component: Example,
})
```

Create the router with a safe default:

```tsx
const tanstackRouter = createRouter({
  routeTree,
  context: { featureFlags: {} },
})
```

Then inject the provider snapshot from React:

```tsx
import { RouterProvider } from '@tanstack/react-router'

import { useFeatureFlags } from '../providers/use-feature-flag'
import { tanstackRouter } from './tanstackRouter'

function AppRouter() {
  const featureFlags = useFeatureFlags()
  return <RouterProvider router={tanstackRouter} context={{ featureFlags }} />
}
```

The root route context and initial router context keep the values typed. React components should continue to use `useFeatureFlag`; route guards should use `context.featureFlags`.

Hide the route's navigation link when the flag is off. A route guard controls frontend navigation. It does not protect backend data or actions.

The `workflow_builder_qol` proof of concept only controls a small marker. Do not add a guard to the existing workflow builder routes.

## Flag catalog

Review every flag quarterly with its owner. Confirm that it is still needed and that its removal condition is current. Remove a flag when its condition is met. Delete its registry entry, application code, tests, and catalog row, and clear stale browser storage values.

| Name                   | Purpose                                           | Date added | Owner       | Ticket name                                                                       | Lifecycle | When to remove                                                                                                                         |
| ---------------------- | ------------------------------------------------- | ---------- | ----------- | --------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow_builder_qol` | Gates in-progress workflow canvas UX improvements | 2026-10-19 | Nick Lemmon | [UI] [QoL] Add Zod-validated, browser-local feature flags to the Syntara frontend | Temporary | Remove after the related workflow-builder improvements ship and no code needs the flag. Remove sooner if we stop the proof of concept. |

## Further reading

- [TanStack Router context](https://tanstack.com/router/latest/docs/guide/router-context)
- [GitLab feature flag development guidance](https://docs.gitlab.com/development/feature_flags/)
