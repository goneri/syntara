import { createContext, useContext, type ReactNode } from 'react'

export type FormFieldBuilderOptionsMode = 'default' | 'static-only'

const FormFieldBuilderOptionsModeContext = createContext<FormFieldBuilderOptionsMode>('default')

export function FormFieldBuilderOptionsModeProvider({
  mode,
  children,
}: Readonly<{ mode: FormFieldBuilderOptionsMode; children: ReactNode }>) {
  return (
    <FormFieldBuilderOptionsModeContext.Provider value={mode}>{children}</FormFieldBuilderOptionsModeContext.Provider>
  )
}

export function useFormFieldBuilderOptionsMode(): FormFieldBuilderOptionsMode {
  return useContext(FormFieldBuilderOptionsModeContext)
}
