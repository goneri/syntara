/** All feature flags registered in the Syntara UI. */
export const FEATURE_FLAG_NAMES = ['workflow_builder_qol'] as const

/** The names callers may use when checking a feature flag. */
export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number]

/** Prefix for the separate browser storage keys used by Syntara feature flags. */
export const FEATURE_FLAG_STORAGE_PREFIX = 'syn.flags.'

/** Browser storage keys for the registered feature flags. */
export type FeatureFlagStorageKey = `${typeof FEATURE_FLAG_STORAGE_PREFIX}${FeatureFlagName}`

/** Returns the browser storage key for one registered flag. */
export function toFeatureFlagKey(flagName: FeatureFlagName): FeatureFlagStorageKey {
  return `${FEATURE_FLAG_STORAGE_PREFIX}${flagName}`
}

/** Saved values for registered feature flags. */
export type FeatureFlag = Partial<Record<FeatureFlagName, boolean>>

function readFeatureFlags(): FeatureFlag {
  const storage = globalThis.localStorage
  const registeredKeys = new Set<string>(FEATURE_FLAG_NAMES.map(toFeatureFlagKey))

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(FEATURE_FLAG_STORAGE_PREFIX) && !registeredKeys.has(key)) {
      return {}
    }
  }

  const flags: FeatureFlag = {}
  for (const flagName of FEATURE_FLAG_NAMES) {
    const storedValue = storage.getItem(toFeatureFlagKey(flagName))
    if (storedValue === null) {
      continue
    }
    if (storedValue !== 'true' && storedValue !== 'false') {
      return {}
    }
    flags[flagName] = storedValue === 'true'
  }

  return flags
}

/** Returns true only when a registered flag has the stored string value `true`. */
export function isFeatureFlagEnabled(flagName: FeatureFlagName): boolean {
  try {
    return readFeatureFlags()[flagName] === true
  } catch {
    return false
  }
}
