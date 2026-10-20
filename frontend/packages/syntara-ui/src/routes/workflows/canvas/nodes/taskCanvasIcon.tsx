import type { TaskActivity } from '@syntara/contracts'
import type { ReactNode } from 'react'

import { detectTaskNodeType } from './common/detectTaskNodeType'
import { getTaskIconDescriptor } from './nodeIconResolver'
import { executorMetadata } from './nodeMetadata'
import { renderNodeIcon, type NodeIconVariant } from './renderNodeIcon'

/** Canvas icon for a task-shaped step (detailed header or semantic zoom tile). */
export function getTaskCanvasIcon(
  data: TaskActivity,
  iconColor?: string,
  variant: NodeIconVariant = 'canvas'
): ReactNode | undefined {
  const { actualExecutor } = detectTaskNodeType(data)
  const executorMeta = executorMetadata[actualExecutor] ?? executorMetadata[data.type ?? '']
  const { id: iconId } = getTaskIconDescriptor(data)
  return renderNodeIcon(executorMeta?.icon, iconId, variant, iconColor)
}
