import { Handle, Position } from '@xyflow/react'
import type { CSSProperties } from 'react'

import { sourceHandleStyle, targetHandleStyle } from '../../routes/workflows/canvas/nodes/common/handleStyle'

export type SynStepConnectionHandlesProps = {
  isSemanticZoom: boolean
  semanticZoomHandleStyle: CSSProperties
  disableTarget?: boolean
  disableSource?: boolean
  enableStart?: boolean
  enableEnd?: boolean
  reverseHandles?: boolean
}

export function SynStepConnectionHandles(props: Readonly<SynStepConnectionHandlesProps>) {
  const handleStyle = props.isSemanticZoom
    ? (base: CSSProperties) => ({ ...base, ...props.semanticZoomHandleStyle })
    : (base: CSSProperties) => base

  return (
    <>
      {!props.disableTarget && (
        <Handle
          type="target"
          id="target"
          position={props.reverseHandles ? Position.Right : Position.Left}
          style={handleStyle(targetHandleStyle)}
        />
      )}
      {!props.disableSource && (
        <Handle
          type="source"
          id="source"
          position={props.reverseHandles ? Position.Left : Position.Right}
          style={handleStyle(sourceHandleStyle)}
        />
      )}
      {props.enableStart && (
        <Handle
          type="source"
          id="start"
          position={Position.Right}
          style={{ ...handleStyle(sourceHandleStyle), top: '85%' }}
        />
      )}
      {props.enableEnd && (
        <Handle
          type="target"
          id="end"
          position={Position.Left}
          style={{
            ...handleStyle(targetHandleStyle),
            top: '50%',
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  )
}
