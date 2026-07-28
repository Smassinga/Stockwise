import { useReducedMotion } from 'framer-motion'
import { useI18n, withI18nFallback } from '../../lib/i18n'
import { cn } from '../../lib/utils'

export type WorkspaceSetupStep =
  | 'checking-account'
  | 'creating-company'
  | 'selecting-company'
  | 'confirming-access'
  | 'accepting-invitation'

type WorkspaceSetupLoaderProps = {
  step: WorkspaceSetupStep
  companyName?: string
  size?: 'sm' | 'md' | 'lg'
}

const copyKeys: Record<WorkspaceSetupStep, { title: string; body: string }> = {
  'checking-account': {
    title: 'onboarding.workspaceLoader.checking.title',
    body: 'onboarding.workspaceLoader.checking.body',
  },
  'creating-company': {
    title: 'onboarding.workspaceLoader.creating.title',
    body: 'onboarding.workspaceLoader.creating.body',
  },
  'selecting-company': {
    title: 'onboarding.workspaceLoader.selecting.title',
    body: 'onboarding.workspaceLoader.selecting.body',
  },
  'confirming-access': {
    title: 'onboarding.workspaceLoader.confirming.title',
    body: 'onboarding.workspaceLoader.confirming.body',
  },
  'accepting-invitation': {
    title: 'onboarding.workspaceLoader.accepting.title',
    body: 'onboarding.workspaceLoader.accepting.body',
  },
}

const fallbackCopy: Record<WorkspaceSetupStep, { title: string; body: string }> = {
  'checking-account': {
    title: 'Checking your account',
    body: 'Looking for company access and pending invitations.',
  },
  'creating-company': {
    title: 'Creating your company workspace',
    body: 'Creating the company structure and initial access.',
  },
  'selecting-company': {
    title: 'Selecting your workspace',
    body: 'Setting the new company as your active workspace.',
  },
  'confirming-access': {
    title: 'Confirming your access',
    body: 'Waiting for your company access to become available.',
  },
  'accepting-invitation': {
    title: 'Accepting your invitation',
    body: 'Connecting your account to the invited company.',
  },
}

export function WorkspaceSetupLoader({
  step,
  companyName,
  size = 'md',
}: WorkspaceSetupLoaderProps) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const keys = copyKeys[step]
  const fallback = fallbackCopy[step]

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'workspace-setup-loader mx-auto flex w-full max-w-md flex-col items-center justify-center text-center',
        size === 'sm' && 'min-h-44 gap-4 px-4 py-6',
        size === 'md' && 'min-h-60 gap-5 px-5 py-8',
        size === 'lg' && 'min-h-72 gap-6 px-6 py-10',
      )}
    >
      <span
        className={cn(
          'workspace-setup-loader__mark',
          reduceMotion && 'workspace-setup-loader__mark--static',
        )}
        aria-hidden="true"
      >
        <span className="workspace-setup-loader__accent" />
      </span>
      <span className="space-y-2">
        <span className="block text-lg font-semibold text-foreground">
          {withI18nFallback(t, keys.title, fallback.title)}
        </span>
        <span className="block text-sm leading-6 text-muted-foreground">
          {withI18nFallback(t, keys.body, fallback.body)}
        </span>
        {companyName ? (
          <span className="block truncate text-sm font-medium text-primary">{companyName}</span>
        ) : null}
      </span>
    </div>
  )
}
