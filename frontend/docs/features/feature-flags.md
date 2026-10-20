# Frontend feature flags

## Strategy

A feature flag enables temporary behavior in the frontend. A flag does not grant access or protect data. The backend must still check permissions.

Flags are off unless browser storage sets a registered flag to the string value `true` under its `syn.flags.<name>` key. `FeatureFlagsProvider` reads a snapshot when the app starts. Reload the page after you change a saved value.

This proof of concept uses a small in-repository feature-flag implementation rather than a flag-management library. TypeScript provides registered names, and the reader accepts only the exact strings `true` and `false`. The current need is one registered boolean flag, a browser-local override, and a reload. A remote flag service is outside this scope. Revisit this choice if flags need centralized control, targeting, or analytics.

## Add and use a flag

Add each flag name to `FEATURE_FLAG_NAMES` in `src/utils/feature-flags.ts`. TypeScript builds `FeatureFlagName` from this list. It rejects names that are not in the list.

Use `useFeatureFlag` in a React component:

```tsx
import { useFeatureFlag } from '../../providers/use-feature-flag'

function Example() {
  const isEnabled = useFeatureFlag('workflow_builder_qol')
  return isEnabled ? <span>Feature enabled</span> : null
}
```

The app provides `FeatureFlagsProvider`. Tests that render a component with this hook must also render the provider.

Do not cast a string to `FeatureFlagName` to skip the TypeScript check.

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

The previous `flags.<name>` keys and the former `feature-flags` JSON key are no longer read. Remove stale values with `localStorage.removeItem('flags.workflow_builder_qol')` and `localStorage.removeItem('feature-flags')` if needed.

## Demo route

Visit `/feature-flag-demo` to show placeholder content controlled by `workflow_builder_qol`. The route is not in navigation. Use its button to turn the flag on or off; it saves the flat local-storage value and reloads the page so the provider picks up the change.

## Demo walkthrough

1. Start the branch locally with `syn-dev` and wait for its readiness output. Use the `UI` endpoint printed for that run; `syn-dev` assigns ports dynamically, so do not rely on a fixed port. Append `/feature-flag-demo` to that UI URL.
2. Open the route. Its starting state reflects this browser's saved flag value, so it may already be on if you used the demo before.
3. Click **Turn demo flag on**. The page reloads, the status changes to enabled, and the placeholder “New workflow builder experience” content appears.
4. In browser DevTools, inspect Local Storage for the UI origin. The key `syn.flags.workflow_builder_qol` should have the string value `true`.
5. Click **Turn demo flag off**. The page reloads, the placeholder disappears, and the key value becomes the string `false`.

To reset the demo to its default state, remove the key in DevTools or run this in the browser console, then reload:

```js
localStorage.removeItem('syn.flags.workflow_builder_qol')
location.reload()
```

The flag controls client-side UI only. It does not grant permissions or protect backend data.

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

Use TanStack Router's `beforeLoad` option when a flag controls access to a route. This works with code-based routes created with `createRoute`; file-based routing is not required. `beforeLoad` runs outside React, so use `isFeatureFlagEnabled` instead of the React hook.

```tsx
import { createRoute, redirect } from '@tanstack/react-router'

import { rootRoute } from './__root'
import { isFeatureFlagEnabled } from '../../utils/feature-flags'

const featureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/feature-example',
  beforeLoad: () => {
    if (!isFeatureFlagEnabled('workflow_builder_qol')) {
      return redirect({ to: '/workflows', replace: true })
    }
  },
  component: Example,
})
```

Hide the route's navigation link when the flag is off. A route guard controls frontend navigation. It does not protect backend data or actions.

The `workflow_builder_qol` proof of concept only controls a small marker. Do not add a guard to the existing workflow builder routes.

## Flag catalog

Review every flag quarterly with its owner. Confirm that it is still needed and that its removal condition is current. Remove a flag when its condition is met. Delete its registry entry, application code, tests, and catalog row, and clear stale browser storage values.

| Name                   | Purpose                                    | Date added | Owner       | Work                                                       | Lifecycle | When to remove                                                                                                                   |
| ---------------------- | ------------------------------------------ | ---------- | ----------- | ---------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `workflow_builder_qol` | Test marker for the workflow builder flag. | 2026-10-19 | Nick Lemmon | [AAP-97515](https://redhat.atlassian.net/browse/AAP-97515) | Temporary | Remove after AAP-96509, AAP-96511, and AAP-96513 ship and no code needs the flag. Remove sooner if we stop the proof of concept. |

## Further reading

- [GitLab feature flag development guidance](https://docs.gitlab.com/development/feature_flags/)
- [LaunchDarkly guidance on managing technical debt from flags](https://launchdarkly.com/docs/eu-docs/guides/flags/technical-debt)
