import { getErrorStatus, isForbiddenError } from '../../utils/apiErrors'

const APPROVAL_LOAD_ERROR_TITLE = 'Failed to load approval'

const APPROVAL_LOAD_DEFAULT_MESSAGE = 'Could not load approval details. Please try again.'
const APPROVAL_LOAD_NOT_FOUND_MESSAGE = 'This approval is no longer available. It may have been resolved or deleted.'
const APPROVAL_LOAD_FORBIDDEN_MESSAGE = 'You do not have permission to view this approval.'

/** User-facing description when fetching approval details fails (execution view). */
export function getApprovalLoadErrorDescription(error: unknown): string {
  const status = getErrorStatus(error)
  if (status === 404) {
    return APPROVAL_LOAD_NOT_FOUND_MESSAGE
  }
  if (isForbiddenError(error)) {
    return APPROVAL_LOAD_FORBIDDEN_MESSAGE
  }
  return APPROVAL_LOAD_DEFAULT_MESSAGE
}

export function getApprovalLoadErrorAlert(error: unknown): { title: string; description: string } {
  return {
    title: APPROVAL_LOAD_ERROR_TITLE,
    description: getApprovalLoadErrorDescription(error),
  }
}
