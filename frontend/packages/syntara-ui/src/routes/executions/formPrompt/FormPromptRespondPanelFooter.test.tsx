import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { axe } from 'vitest-axe'

import {
  FormPromptRespondPanelFooterProvider,
  FormPromptRespondPanelFooterSlot,
  FormPromptRespondPanelFooterTestHarness,
} from './FormPromptRespondPanelFooter'

describe('FormPromptRespondPanelFooter', () => {
  it('renders footer inline when no panel provider is present', () => {
    render(
      <FormPromptRespondPanelFooterSlot>
        <button type="button">Send</button>
      </FormPromptRespondPanelFooterSlot>
    )

    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('projects footer through the panel provider', () => {
    let captured: ReactNode = null

    render(
      <FormPromptRespondPanelFooterProvider onFooterChange={(footer) => (captured = footer)}>
        <FormPromptRespondPanelFooterSlot>
          <button type="button">Submit response</button>
        </FormPromptRespondPanelFooterSlot>
      </FormPromptRespondPanelFooterProvider>
    )

    expect(screen.queryByRole('button', { name: 'Submit response' })).not.toBeInTheDocument()
    render(<>{captured}</>)
    expect(screen.getByRole('button', { name: 'Submit response' })).toBeInTheDocument()
  })

  it('renders harness footer in the document', () => {
    render(
      <FormPromptRespondPanelFooterTestHarness>
        <FormPromptRespondPanelFooterSlot>
          <button type="button">Send</button>
        </FormPromptRespondPanelFooterSlot>
      </FormPromptRespondPanelFooterTestHarness>
    )

    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('has no accessibility violations for inline footer slot', async () => {
    const { container } = render(
      <FormPromptRespondPanelFooterSlot>
        <button type="button">Send</button>
      </FormPromptRespondPanelFooterSlot>
    )

    expect(await axe(container)).toHaveNoViolations()
  })
})
