// src/components/ErrorBoundary.tsx
import { Component, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'

type Props = { children: ReactNode }
type State = { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorBoundaryContent error={this.state.error} />
      )
    }
    return this.props.children
  }
}

function ErrorBoundaryContent({ error }: { error?: Error }) {
  const { t } = useI18n()
  
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-2">{t('common.somethingWentWrong')}</h2>
      <pre className="text-sm text-red-600 whitespace-pre-wrap">
        {error?.message}
      </pre>
    </div>
  )
}

export default ErrorBoundary