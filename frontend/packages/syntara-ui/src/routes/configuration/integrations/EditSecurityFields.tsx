import {
  Checkbox,
  ExpandableSection,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  TextArea,
} from '@patternfly/react-core'
import { RhUiErrorIcon } from '@patternfly/react-icons'
import { useState } from 'react'
import { Controller, useWatch, type Control, type FieldErrors } from 'react-hook-form'

import styles from './EditIntegrationForm.module.css'
import type { EditIntegrationFormValues } from './editIntegrationFormSchema'

type EditSecurityFieldsProps = Readonly<{
  control: Control<EditIntegrationFormValues>
  errors: FieldErrors<EditIntegrationFormValues>
  showAllowHttp?: boolean
}>

export function EditSecurityFields({ control, errors, showAllowHttp = true }: EditSecurityFieldsProps) {
  const [userExpanded, setUserExpanded] = useState(false)
  const skipTlsVerify = useWatch({ control, name: 'insecure_skip_tls_verify' })
  const isExpanded = userExpanded || !!errors.ca_certificate

  return (
    <ExpandableSection
      toggleText="Security"
      isExpanded={isExpanded}
      onToggle={(_e, expanded) => setUserExpanded(expanded)}
      isIndented
    >
      <div className={styles.securityFields}>
        {showAllowHttp && (
          <Controller
            name="allow_http"
            control={control}
            render={({ field }) => (
              <Checkbox
                id="edit-allow-http"
                label="Allow HTTP connections"
                description="Permits unencrypted HTTP URLs for this integration"
                isChecked={field.value}
                onChange={(_event, checked) => field.onChange(checked)}
              />
            )}
          />
        )}
        <Controller
          name="insecure_skip_tls_verify"
          control={control}
          render={({ field }) => (
            <Checkbox
              id="edit-insecure-skip-tls-verify"
              label="Disable TLS certificate verification"
              description="Skips validation of the server's TLS certificate on connections"
              isChecked={field.value}
              onChange={(_event, checked) => field.onChange(checked)}
              body={
                skipTlsVerify ? (
                  <HelperText>
                    <HelperTextItem variant="warning">
                      The server's TLS certificate will not be verified. Only enable in trusted networks.
                    </HelperTextItem>
                  </HelperText>
                ) : undefined
              }
            />
          )}
        />
        {!skipTlsVerify && (
          <FormGroup label="CA certificate" fieldId="edit-ca-certificate">
            <Controller
              name="ca_certificate"
              control={control}
              render={({ field }) => (
                <TextArea
                  id="edit-ca-certificate"
                  placeholder={'-----BEGIN CERTIFICATE-----\n\n-----END CERTIFICATE-----'}
                  aria-label="CA certificate"
                  resizeOrientation="vertical"
                  rows={4}
                  validated={errors.ca_certificate ? 'error' : 'default'}
                  value={field.value ?? ''}
                  onChange={(_event, value) => field.onChange(value || null)}
                  onBlur={field.onBlur}
                  name={field.name}
                />
              )}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem
                  variant={errors.ca_certificate ? 'error' : 'default'}
                  icon={errors.ca_certificate ? <RhUiErrorIcon /> : undefined}
                >
                  {errors.ca_certificate?.message ??
                    "PEM-encoded CA certificate to trust for this integration's TLS connections."}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
        )}
      </div>
    </ExpandableSection>
  )
}
