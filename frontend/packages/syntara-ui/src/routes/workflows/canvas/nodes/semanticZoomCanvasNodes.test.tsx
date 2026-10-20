import type { ConditionActivity } from '@syntara/contracts'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const viewportState = vi.hoisted(() => ({ zoom: 0.5 }))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    useReactFlow: () => ({
      deleteElements: vi.fn(),
      updateNode: vi.fn(),
      getNode: vi.fn(),
    }),
    useStore: (selector: (s: { transform: [number, number, number]; nodesConnectable: boolean }) => unknown) =>
      selector({ transform: [0, 0, viewportState.zoom], nodesConnectable: true }),
    useUpdateNodeInternals: () => vi.fn(),
    useNodeId: () => 'condition-1',
    useEdges: () => [],
    Handle: () => null,
    Position: actual.Position,
  }
})

import { ConditionNodeComponent } from './ConditionNode'

describe('canvas nodes at semantic zoom', () => {
  afterEach(() => {
    viewportState.zoom = 0.5
  })

  it('renders condition node as tooltip tile without on-canvas labels', () => {
    const data = {
      type: 'condition',
      id: 'condition-1',
      name: 'Check Status',
      parameters: { condition: 'status === "active"' },
    } as ConditionActivity

    render(
      <ReactFlowProvider>
        <ConditionNodeComponent
          id={data.id}
          data={data}
          type="condition"
          position={{ x: 0, y: 0 }}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selected={false}
          dragging={false}
          isConnectable={true}
          zIndex={0}
          selectable
          deletable
          draggable
        />
      </ReactFlowProvider>
    )

    expect(screen.queryByText('Check Status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check Status, Condition' })).toBeInTheDocument()
  })
})
