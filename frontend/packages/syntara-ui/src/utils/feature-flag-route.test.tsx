import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isFeatureFlagEnabled, toFeatureFlagKey } from './feature-flags'

const workflowBuilderQolStorageKey = toFeatureFlagKey('workflow_builder_qol')

function createFeatureFlagRouter() {
  const rootRoute = createRootRoute({ component: Outlet })
  const fallbackRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/fallback',
    component: () => <h1>Fallback route</h1>,
  })
  const featureRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/feature',
    beforeLoad: () => {
      if (!isFeatureFlagEnabled('workflow_builder_qol')) {
        return redirect({ to: '/fallback', replace: true })
      }
    },
    component: () => <h1>Feature route</h1>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([fallbackRoute, featureRoute]),
    history: createMemoryHistory({ initialEntries: ['/feature'] }),
    defaultPendingMinMs: 0,
  })

  return router
}

beforeEach(() => {
  globalThis.localStorage.removeItem(workflowBuilderQolStorageKey)
})

afterEach(() => {
  globalThis.localStorage.removeItem(workflowBuilderQolStorageKey)
})

describe('feature flag route guard', () => {
  it('redirects from a code-based route when the flag is off', async () => {
    const router = createFeatureFlagRouter()

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: 'Fallback route' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Feature route' })).not.toBeInTheDocument()
  })

  it('loads a code-based route when the flag is on', async () => {
    globalThis.localStorage.setItem(workflowBuilderQolStorageKey, 'true')
    const router = createFeatureFlagRouter()

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: 'Feature route' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Fallback route' })).not.toBeInTheDocument()
  })
})
