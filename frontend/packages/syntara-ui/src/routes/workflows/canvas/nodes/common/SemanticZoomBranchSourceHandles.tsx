import { Handle, Position } from '@xyflow/react'
import type { CSSProperties } from 'react'

import type { SemanticZoomBranchSource } from '../../semanticZoomTypes'

import { sourceHandleStyle } from './handleStyle'

export type { SemanticZoomBranchSource } from '../../semanticZoomTypes'

/**
 * Source handles for branching nodes at semantic zoom: no labels, stacked on the
 * right edge of the icon tile so edges fan out (matches topology-style LOD).
 */
export function SemanticZoomBranchSourceHandles(props: {
  handles: readonly SemanticZoomBranchSource[]
  /** Height of the tile region handles are anchored to. */
  tileHeightPx: number
}) {
  const { handles, tileHeightPx } = props
  const n = handles.length
  if (n === 0) return null

  return (
    <>
      {handles.map((h, i) => {
        const topPercent = (100 * (i + 1)) / (n + 1)
        const anchorStyle: CSSProperties = {
          position: 'absolute',
          right: 0,
          top: `${(topPercent * tileHeightPx) / 100}px`,
          transform: 'translate(50%, -50%)',
          width: 1,
          height: 1,
          pointerEvents: 'none',
          zIndex: 1,
        }
        return (
          <div key={h.id} style={anchorStyle}>
            <Handle
              type="source"
              id={h.id}
              position={Position.Right}
              aria-label={h.ariaLabel}
              style={{
                ...sourceHandleStyle,
                position: 'relative',
                pointerEvents: 'auto',
              }}
            />
          </div>
        )
      })}
    </>
  )
}
