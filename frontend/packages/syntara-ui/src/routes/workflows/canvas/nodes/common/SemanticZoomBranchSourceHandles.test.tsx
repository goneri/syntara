import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'

import { SEMANTIC_ZOOM_TILE_SIZE_PX } from '../../semanticZoom'

import { SemanticZoomBranchSourceHandles } from './SemanticZoomBranchSourceHandles'

vi.mock('@xyflow/react', () => ({
  Handle: (props: { id: string; type: string; 'aria-label'?: string }) => (
    <button type="button" data-testid={`handle-${props.id}`} aria-label={props['aria-label']}>
      {props.type}
    </button>
  ),
  Position: {
    Top: 'top',
    Bottom: 'bottom',
    Left: 'left',
    Right: 'right',
  },
}))

describe('SemanticZoomBranchSourceHandles', () => {
  it('renders no output when handles is empty', () => {
    render(<SemanticZoomBranchSourceHandles handles={[]} tileHeightPx={SEMANTIC_ZOOM_TILE_SIZE_PX} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders source handles with aria-labels and no visible branch text', () => {
    render(
      <SemanticZoomBranchSourceHandles
        handles={[
          { id: 'true', ariaLabel: 'True branch output' },
          { id: 'false', ariaLabel: 'False branch output' },
        ]}
        tileHeightPx={SEMANTIC_ZOOM_TILE_SIZE_PX}
      />
    )

    expect(screen.getByRole('button', { name: 'True branch output' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'False branch output' })).toBeInTheDocument()
    expect(screen.queryByText('True')).not.toBeInTheDocument()
    expect(screen.queryByText('False')).not.toBeInTheDocument()
  })

  it('has no accessibility violations when branch handles render', async () => {
    const { container } = render(
      <SemanticZoomBranchSourceHandles
        handles={[
          { id: 'true', ariaLabel: 'True branch output' },
          { id: 'false', ariaLabel: 'False branch output' },
        ]}
        tileHeightPx={SEMANTIC_ZOOM_TILE_SIZE_PX}
      />
    )

    expect(await axe(container)).toHaveNoViolations()
  })
})
