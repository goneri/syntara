import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SEMANTIC_ZOOM_TILE_HANDLE_TOP_PX } from '../../routes/workflows/canvas/semanticZoom'

import { SynStepConnectionHandles } from './SynStepConnectionHandles'

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    Handle: (props: { id: string; type: string; style?: React.CSSProperties; position: string }) => (
      <div
        data-testid={`handle-${props.id}`}
        data-handle-type={props.type}
        data-handle-pos={props.position}
        style={props.style}
      />
    ),
    Position: actual.Position,
  }
})

function renderHandles(props: ComponentProps<typeof SynStepConnectionHandles>) {
  return render(
    <ReactFlowProvider>
      <SynStepConnectionHandles {...props} />
    </ReactFlowProvider>
  )
}

describe('SynStepConnectionHandles', () => {
  it('renders default target and source handles', () => {
    renderHandles({ isSemanticZoom: false, semanticZoomHandleStyle: {} })
    expect(screen.getByTestId('handle-target')).toBeInTheDocument()
    expect(screen.getByTestId('handle-source')).toBeInTheDocument()
  })

  it('omits handles when disabled', () => {
    renderHandles({
      isSemanticZoom: false,
      semanticZoomHandleStyle: {},
      disableTarget: true,
      disableSource: true,
    })
    expect(screen.queryByTestId('handle-target')).not.toBeInTheDocument()
    expect(screen.queryByTestId('handle-source')).not.toBeInTheDocument()
  })

  it('renders optional start and end handles', () => {
    renderHandles({
      isSemanticZoom: false,
      semanticZoomHandleStyle: {},
      enableStart: true,
      enableEnd: true,
    })
    expect(screen.getByTestId('handle-start')).toBeInTheDocument()
    expect(screen.getByTestId('handle-end')).toBeInTheDocument()
  })

  it('swaps handle sides when reverseHandles is set', () => {
    renderHandles({ isSemanticZoom: false, semanticZoomHandleStyle: {}, reverseHandles: true })
    expect(screen.getByTestId('handle-target')).toHaveAttribute('data-handle-pos', 'right')
    expect(screen.getByTestId('handle-source')).toHaveAttribute('data-handle-pos', 'left')
  })

  it('applies semantic zoom vertical offset on connection handles', () => {
    renderHandles({
      isSemanticZoom: true,
      semanticZoomHandleStyle: { top: SEMANTIC_ZOOM_TILE_HANDLE_TOP_PX, transform: 'translateY(-50%)' },
    })
    expect(screen.getByTestId('handle-target')).toHaveStyle({ top: `${SEMANTIC_ZOOM_TILE_HANDLE_TOP_PX}px` })
  })
})
