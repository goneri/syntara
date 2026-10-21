import {
  ActivityTypeEnum,
  EdgeHandleEnum,
  ExecutorTypeEnum,
  TriggerTypeEnum,
  type ApprovalActivity,
  type ConditionActivity,
  type ConvergeActivity,
  type LoopActivity,
  type SwitchActivity,
  type TaskActivity,
  type WaitActivity,
} from '@syntara/contracts'
import { render, screen } from '@testing-library/react'
import { Position, ReactFlowProvider, type Node, type NodeProps } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FlowNodeType } from '../../../../constants'
import { buildSwitchCasePort } from '../../../builder/utils/switchCaseHelpers'

const viewportState = vi.hoisted(() => ({ zoom: 0.5 }))

vi.mock('../../../../assets/eda.svg?react', () => ({
  default: () => <span data-testid="mock-eda-icon" />,
}))

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

vi.mock('../../stores/useExecutionStore', () => ({
  useExecutionStore: (selector: (state: { activityStates: Map<string, unknown> }) => unknown) =>
    selector({ activityStates: new Map() }),
}))

import { ApprovalNodeComponent, type ApprovalNode } from './ApprovalNode'
import { ConditionNodeComponent, type ConditionNode } from './ConditionNode'
import { ConvergeNodeComponent, type ConvergeNode } from './ConvergeNode'
import { GenericNodeComponent, type GenericNode } from './GenericNode'
import { LoopNodeComponent, type LoopNode } from './LoopNode'
import { SwitchNodeComponent, type SwitchNode } from './SwitchNode'
import { TaskNodeComponent, type TaskNode } from './TaskNode'
import { TriggerNodeComponent, type TriggerNode } from './TriggerNode'
import { WaitNodeComponent, type WaitNode } from './WaitNode'

function castNodeProps<T extends Node>(props: ReturnType<typeof canvasNodeProps>): NodeProps<T> {
  return props as unknown as NodeProps<T>
}

function canvasNodeProps(data: object, type: string, id: string) {
  return {
    id,
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
    sourcePosition: Position.Left,
    targetPosition: Position.Right,
  }
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
        <ConditionNodeComponent {...castNodeProps<ConditionNode>(canvasNodeProps(data, 'condition', data.id))} />
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
        <TaskNodeComponent {...castNodeProps<TaskNode>(canvasNodeProps(data, FlowNodeType.TASK, data.id))} />
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
        <GenericNodeComponent {...castNodeProps<GenericNode>(canvasNodeProps(data, FlowNodeType.GENERIC, data.id))} />
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
        <LoopNodeComponent {...castNodeProps<LoopNode>(canvasNodeProps(data, 'loop', data.id))} />
      </ReactFlowProvider>
    )

    expect(screen.getByRole('button', { name: 'Untitled Loop, Loop' })).toBeInTheDocument()
  })

  it('renders switch node with branch handles at semantic zoom', () => {
    const data = {
      id: 'switch-1',
      type: 'switch',
      name: 'Route by status',
      parameters: {
        cases: [{ port: buildSwitchCasePort(0), label: 'Approved', condition: '${x}' }],
        default_port: EdgeHandleEnum.DEFAULT,
      },
    } as SwitchActivity

    render(
      <ReactFlowProvider>
        <SwitchNodeComponent {...castNodeProps<SwitchNode>(canvasNodeProps(data, 'switch', data.id))} />
      </ReactFlowProvider>
    )

    expect(screen.getByRole('button', { name: 'Route by status, Switch' })).toBeInTheDocument()
  })

  it('renders approval node with approve/reject branch labels', () => {
    const data = {
      type: 'approval',
      id: 'approval-1',
      name: 'Sign off',
      parameters: { approver_timeout: 3600 },
    } as ApprovalActivity

    render(
      <ReactFlowProvider>
        <ApprovalNodeComponent {...castNodeProps<ApprovalNode>(canvasNodeProps(data, 'approval', data.id))} />
      </ReactFlowProvider>
    )

    expect(screen.getByRole('button', { name: 'Sign off, Approval' })).toBeInTheDocument()
  })

  it('renders wait node at semantic zoom', () => {
    const data = {
      type: 'wait',
      id: 'wait-1',
      name: 'Pause',
      parameters: { duration: 60 },
    } as WaitActivity

    render(
      <ReactFlowProvider>
        <WaitNodeComponent {...castNodeProps<WaitNode>(canvasNodeProps(data, 'wait', data.id))} />
      </ReactFlowProvider>
    )

    expect(screen.getByRole('button', { name: 'Pause, Wait' })).toBeInTheDocument()
  })

  it('renders webhook trigger node at semantic zoom', () => {
    const data = {
      name: 'Incoming hook',
      details: null,
      triggerType: TriggerTypeEnum.WEBHOOK_TRIGGER,
    }

    render(
      <ReactFlowProvider>
        <TriggerNodeComponent
          {...castNodeProps<TriggerNode>(canvasNodeProps(data, FlowNodeType.TRIGGER, 'trigger-0'))}
        />
      </ReactFlowProvider>
    )

    expect(screen.getByRole('button', { name: 'Incoming hook, Webhook trigger' })).toBeInTheDocument()
  })

  it('renders converge node at semantic zoom', () => {
    const data = {
      type: ActivityTypeEnum.CONVERGE,
      id: 'converge-1',
      name: 'Join paths',
      parameters: { strategy: 'all' },
    } as ConvergeActivity

    render(
      <ReactFlowProvider>
        <ConvergeNodeComponent {...castNodeProps<ConvergeNode>(canvasNodeProps(data, 'converge', data.id))} />
      </ReactFlowProvider>
    )

    expect(screen.getByRole('button', { name: 'Join paths, Converge' })).toBeInTheDocument()
  })
})
