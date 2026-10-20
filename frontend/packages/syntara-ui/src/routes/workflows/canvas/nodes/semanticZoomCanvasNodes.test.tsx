import { ExecutorTypeEnum, type ConditionActivity, type LoopActivity, type TaskActivity } from '@syntara/contracts'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FlowNodeType } from '../../../../constants'

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
    useNodeId: () => 'canvas-node',
    useEdges: () => [],
    Handle: () => null,
    Position: actual.Position,
  }
})

vi.mock('./hooks/useNodeMenuActions', () => ({
  MenuNodeType: { ACTIVITY: 'activity', CONTROL_FLOW: 'control_flow', TRIGGER: 'trigger' },
  useNodeMenuActions: () => [],
}))

vi.mock('./hooks/useLoopIterationCount', () => ({
  useLoopIterationCount: () => 0,
}))

vi.mock('./hooks/useCredentialName', () => ({
  useCredentialName: () => ({ name: undefined }),
}))

import { ConditionNodeComponent } from './ConditionNode'
import { GenericNodeComponent } from './GenericNode'
import { LoopNodeComponent } from './LoopNode'
import { TaskNodeComponent } from './TaskNode'

function baseCanvasProps<T extends { id: string }>(
  data: T,
  type: string
): NodeProps<{ type: string } & { data: T }> {
  return {
    id: data.id,
    data,
    type,
    position: { x: 0, y: 0 },
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    selected: false,
    dragging: false,
    isConnectable: true,
    zIndex: 0,
    selectable: true,
    deletable: true,
    draggable: true,
  } as NodeProps<{ type: string } & { data: T }>
}

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
        <ConditionNodeComponent {...baseCanvasProps(data, 'condition')} />
      </ReactFlowProvider>
    )

    expect(screen.queryByText('Check Status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check Status, Condition' })).toBeInTheDocument()
  })

  it('renders script task node with semantic zoom tooltip labels', () => {
    const data = {
      id: 'task-1',
      type: ExecutorTypeEnum.SCRIPT,
      name: 'Run backup',
      parameters: { language: 'python', code: 'print(1)' },
    } as TaskActivity

    render(
      <ReactFlowProvider>
        <TaskNodeComponent {...baseCanvasProps(data, FlowNodeType.TASK)} />
      </ReactFlowProvider>
    )

    expect(screen.queryByText('Run backup')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run backup, Script' })).toBeInTheDocument()
  })

  it('renders generic placeholder node at semantic zoom', () => {
    const data = {
      type: 'script',
      id: 'generic-1',
      name: 'Placeholder',
      parameters: { language: 'python', code: '' },
    } as TaskActivity

    render(
      <ReactFlowProvider>
        <GenericNodeComponent {...baseCanvasProps(data, FlowNodeType.GENERIC)} />
      </ReactFlowProvider>
    )

    expect(screen.getByRole('button', { name: 'Placeholder, Generic' })).toBeInTheDocument()
  })

  it('renders loop node with untitled fallback in tooltip', () => {
    const data = {
      type: 'loop',
      id: 'loop-1',
      name: '',
      parameters: { items: '[]' },
    } as LoopActivity

    render(
      <ReactFlowProvider>
        <LoopNodeComponent {...baseCanvasProps(data, 'loop')} />
      </ReactFlowProvider>
    )

    expect(screen.getByRole('button', { name: 'Untitled Loop, Loop' })).toBeInTheDocument()
  })
})
