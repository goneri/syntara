/**
 * Settings API helpers for E2E test setup/teardown.
 */
import type { Page } from '../fixtures'

import { apiRequest, getAuthToken } from './api-core'

/**
 * Get a runtime setting value by key.
 */
export async function getSettingViaApi(app: Page, key: string): Promise<{ value: number | string | boolean | null }> {
  const token = await getAuthToken(app)
  if (!token) throw new Error('getSettingViaApi: could not obtain auth token')

  const resp = await apiRequest(app, 'get', `/settings/${key}`, { token })
  if (!resp.ok()) {
    const body = await resp.text().catch(() => '(unreadable)')
    throw new Error(`GET /settings/${key} returned ${resp.status()}: ${body}`)
  }

  const body = (await resp.json()) as { value: number | string | boolean | null }
  return body
}

/**
 * Update a runtime setting value.
 */
export async function updateSettingViaApi(
  app: Page,
  key: string,
  value: number | string | boolean | null
): Promise<void> {
  const token = await getAuthToken(app)
  if (!token) throw new Error('updateSettingViaApi: could not obtain auth token')

  const resp = await apiRequest(app, 'patch', '/settings', {
    token,
    data: {
      updates: [{ key, value }],
    },
  })

  if (!resp.ok()) {
    const body = await resp.text().catch(() => '(unreadable)')
    throw new Error(`PATCH /settings returned ${resp.status()}: ${body}`)
  }
}
