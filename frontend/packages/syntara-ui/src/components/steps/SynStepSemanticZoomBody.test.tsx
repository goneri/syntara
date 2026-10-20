import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    useStore: (selector: (s: { nodesConnectable: boolean }) => unknown) => selector({ nodesConnectable: true }),
  }
})

import { SynStepSemanticZoomBody } from './SynStepSemanticZoomBody'

function renderWithFlow(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

describe('SynStepSemanticZoomBody', () => {
  it('exposes title and type on the tooltip trigger without on-canvas labels', () => {
    renderWithFlow(
      <SynStepSemanticZoomBody
        title="Analyze Data"
        typeLabel="Task Agent"
        accentColor="rgb(100, 100, 200)"
        selected={false}
        hasDashedBorder={false}
      />
    )

    expect(screen.queryByText('Analyze Data')).not.toBeInTheDocument()
    expect(screen.queryByText('Task Agent')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyze Data, Task Agent' })).toBeInTheDocument()
  })

  it('has no accessibility violations', async () => {
    const { container } = renderWithFlow(
      <SynStepSemanticZoomBody
        title="Node A"
        typeLabel="Condition"
        accentColor="#ccc"
        selected={false}
        hasDashedBorder={false}
        icon={<span aria-hidden="true" />}
      />
    )

    expect(await axe(container)).toHaveNoViolations()
  })
})
