import { Alert, Button, Content, ContentVariants } from '@patternfly/react-core'

import { SynPage, SynPageBody } from '../../components/layout/SynPage'
import { SynPageHeader } from '../../components/layout/SynPageHeader'
import { SynPanel } from '../../components/layout/SynPanel'
import { SynPanelContentStack } from '../../components/layout/SynPanelContentStack'
import { useFeatureFlag } from '../../providers/use-feature-flag'
import { toFeatureFlagKey } from '../../utils/feature-flags'

/** Small direct-link page for demonstrating a local feature flag. */
export function FeatureFlagDemo() {
  const isEnabled = useFeatureFlag('workflow_builder_qol')

  function toggleFlag() {
    globalThis.localStorage.setItem(toFeatureFlagKey('workflow_builder_qol'), isEnabled ? 'false' : 'true')
    globalThis.location.reload()
  }

  return (
    <SynPage>
      <SynPageHeader title="Workflow builder feature flag demo" />
      <SynPageBody>
        <SynPanel isFullHeight>
          <SynPanelContentStack hasGutter>
            <Content component={ContentVariants.p}>
              This direct-link demo shows content controlled by the `workflow_builder_qol` feature flag.
            </Content>
            <Alert
              variant={isEnabled ? 'success' : 'info'}
              title={isEnabled ? 'Feature flag is enabled' : 'Feature flag is off'}
              isInline
            >
              {isEnabled
                ? 'The demo content below is visible because the flag is on.'
                : 'Turn the flag on to show the demo content. The page reloads after you change it.'}
            </Alert>
            <Button variant={isEnabled ? 'secondary' : 'primary'} onClick={toggleFlag}>
              {isEnabled ? 'Turn demo flag off' : 'Turn demo flag on'}
            </Button>
            {isEnabled && (
              <>
                <Content component={ContentVariants.h2}>New workflow builder experience</Content>
                <Content component={ContentVariants.p}>
                  This placeholder represents UI that is available only while the feature flag is enabled.
                </Content>
              </>
            )}
          </SynPanelContentStack>
        </SynPanel>
      </SynPageBody>
    </SynPage>
  )
}
