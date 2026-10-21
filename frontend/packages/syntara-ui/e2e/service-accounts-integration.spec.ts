/**
 * E2E Tests: Service Accounts — Integration (Creator Access)
 *
 * Test cases covered:
 * - Creators manage identities independently of project grants
 */
import { test, expect } from './fixtures'
import {
  goToServiceAccountsList,
  filterServiceAccountByName,
  goToServiceAccountDetail,
  deleteServiceAccountViaApi,
} from './helpers/service-accounts'
import { buildUniqueName } from './helpers/workflows'
import { isSkipWebServerForPlaywrightTests } from './playwrightWebServerEnv'
import { apiRequest } from './utils/api'

const isRealBackend = isSkipWebServerForPlaywrightTests()

test.describe('Creator-owned service accounts', () => {
  test.skip(isRealBackend, 'project-admin is a mock-only role with no real backend equivalent')
  test('project admin sees accounts they created', async ({ app, projectAdminApp }) => {
    const otherProjectSaName = buildUniqueName('sa-other-proj')
    const ownProjectSaName = buildUniqueName('sa-own-proj')
    let otherSaId: string | undefined
    let ownSaId: string | undefined

    try {
      // Another human creates an account.

      const otherResp = await apiRequest(app, 'post', '/service_accounts', {
        data: { name: otherProjectSaName, description: 'Unrelated identity' },
      })
      const otherSa = (await otherResp.json()) as { id: string }
      otherSaId = otherSa.id

      // The current human creates an account.

      const ownResp = await apiRequest(projectAdminApp, 'post', '/service_accounts', {
        token: 'mock-token-project-admin',
        data: { name: ownProjectSaName, description: 'Own identity' },
      })
      const ownSa = (await ownResp.json()) as { id: string }
      ownSaId = ownSa.id

      // Project admin navigates to SA list
      await goToServiceAccountsList(projectAdminApp)

      // The creator can see their own account.
      await filterServiceAccountByName(projectAdminApp, ownProjectSaName)
      await expect(projectAdminApp.getByRole('row', { name: new RegExp(ownProjectSaName) })).toBeVisible()

      // Clear filter and verify the other project SA is NOT visible
      await projectAdminApp.getByRole('button', { name: 'Reset' }).click()
      await filterServiceAccountByName(projectAdminApp, otherProjectSaName)
      await expect(projectAdminApp.getByText('No results found')).toBeVisible({ timeout: 10_000 })
    } finally {
      if (ownSaId) await deleteServiceAccountViaApi(app, ownSaId)
      if (otherSaId) await deleteServiceAccountViaApi(app, otherSaId)
    }
  })

  test('project admin has create permission and can view created SAs', async ({ app, projectAdminApp }) => {
    const saName = buildUniqueName('sa-pa-create')
    let saId: string | undefined

    try {
      // Verify the create button is enabled (not permission-gated) for project-admin
      await goToServiceAccountsList(projectAdminApp)
      const createButton = projectAdminApp.getByRole('button', { name: 'Create service account' })
      await expect(createButton).toBeVisible()
      await expect(createButton).not.toHaveAttribute('aria-disabled', 'true')

      // Create with the same signed-in user who will manage the account.

      const resp = await apiRequest(projectAdminApp, 'post', '/service_accounts', {
        token: 'mock-token-project-admin',
        data: { name: saName, description: 'Created for project-admin' },
      })
      const sa = (await resp.json()) as { id: string }
      saId = sa.id

      // Project admin can see the SA in their filtered list
      await projectAdminApp.reload()
      await filterServiceAccountByName(projectAdminApp, saName)
      await expect(projectAdminApp.getByRole('row', { name: new RegExp(saName) })).toBeVisible()
    } finally {
      if (saId) await deleteServiceAccountViaApi(app, saId)
    }
  })

  test('project admin can edit a service account name', async ({ app, projectAdminApp }) => {
    const originalName = buildUniqueName('sa-pa-edit')
    const editedName = buildUniqueName('sa-pa-edited')
    let saId: string | undefined

    try {
      // Create as the user who will edit the account.

      const resp = await apiRequest(projectAdminApp, 'post', '/service_accounts', {
        token: 'mock-token-project-admin',
        data: { name: originalName, description: 'SA for edit test' },
      })
      const sa = (await resp.json()) as { id: string; name: string }
      saId = sa.id

      // Project admin navigates to the SA detail page
      await goToServiceAccountDetail(projectAdminApp, { id: sa.id, name: originalName })

      // Edit via the edit button
      await projectAdminApp.getByRole('button', { name: 'Edit service account' }).click()
      const modal = projectAdminApp.getByRole('dialog')
      await expect(modal).toBeVisible()

      const nameInput = modal.getByRole('textbox', { name: 'Name', exact: true })
      await expect(nameInput).toHaveValue(originalName)

      await nameInput.clear()
      await nameInput.fill(editedName)
      await modal.getByRole('button', { name: 'Save service account' }).click()

      // Verify updated heading
      await expect(projectAdminApp.getByText('Service account updated')).toBeVisible()
      await expect(projectAdminApp.getByRole('heading', { level: 1, name: editedName })).toBeVisible()
    } finally {
      if (saId) await deleteServiceAccountViaApi(app, saId)
    }
  })

  test('project admin can disable a service account via toggle', async ({ app, projectAdminApp }) => {
    const saName = buildUniqueName('sa-pa-disable')
    let saId: string | undefined

    try {
      // Create an active account as its creator.

      const resp = await apiRequest(projectAdminApp, 'post', '/service_accounts', {
        token: 'mock-token-project-admin',
        data: { name: saName, description: 'SA for disable test' },
      })
      const sa = (await resp.json()) as { id: string; name: string }
      saId = sa.id

      // Project admin navigates to the SA detail page
      await goToServiceAccountDetail(projectAdminApp, { id: sa.id, name: saName })

      // Verify initially enabled — wait for useCanI so the switch is actionable
      const toggle = projectAdminApp.getByRole('switch', { name: 'Toggle service account status' })
      await expect(toggle).toBeEnabled()
      await expect(toggle).toBeChecked()

      // PF Switch hides the real <input>; native click() fires the change event reliably
      await toggle.evaluate((el: HTMLElement) => el.click())

      const dialog = projectAdminApp.getByRole('dialog')
      await expect(dialog.getByText('Disable service account?')).toBeVisible()
      await dialog.getByRole('button', { name: 'Disable service account' }).click()

      // Verify the toggle is now unchecked (disabled)
      await expect(toggle).not.toBeChecked({ timeout: 10_000 })
    } finally {
      if (saId) await deleteServiceAccountViaApi(app, saId)
    }
  })
})
