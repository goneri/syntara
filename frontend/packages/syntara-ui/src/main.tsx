import { Flex, FlexItem, Spinner } from '@patternfly/react-core'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

import { ErrorBoundary } from './components/ErrorBoundary'
import { ensureDocumentColorScheme } from './providers/theme/colorScheme.js'
import { registerAllNodes } from './routes/builder/registry/nodes'
import { FEATURE_FLAG_NAMES, isFeatureFlagEnabled, toFeatureFlagKey } from './utils/feature-flags'
import './index.css'

// Register all workflow step types (Add step panel) before app initialization
registerAllNodes()

ensureDocumentColorScheme()

if (import.meta.env.DEV) {
  const featureFlagRows = FEATURE_FLAG_NAMES.map((flagName) => ({
    key: toFeatureFlagKey(flagName),
    state: isFeatureFlagEnabled(flagName) ? 'enabled' : 'disabled',
  }))

  console.info('[syn] Feature flags loaded')
  console.table(featureFlagRows)
}

const App = lazy(() => import('./app/App.js'))

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- standard React entry point: root element is always present in index.html
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense
        fallback={
          <Flex
            alignItems={{ default: 'alignItemsCenter' }}
            justifyContent={{ default: 'justifyContentCenter' }}
            style={{
              height: '100vh',
              width: '100vw',
              backgroundColor: 'var(--pf-t--global--background--color--primary--default)',
            }}
          >
            <FlexItem>
              <Spinner size="xl" aria-label="Loading application" />
            </FlexItem>
          </Flex>
        }
      >
        <App />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>
)
