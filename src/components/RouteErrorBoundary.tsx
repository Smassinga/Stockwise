import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from './ui/button'
import { useI18n } from '../lib/i18n'
import { StaleChunkError } from '../lib/lazyRecoveryCore'
import { Sentry } from '../lib/sentry'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (error instanceof StaleChunkError) {
      Sentry.captureException(error, {
        tags: { operation: 'lazy_route_recovery', module_key: error.moduleKey },
        contexts: { react: { componentStack: info.componentStack } },
      })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    if (!(this.state.error instanceof StaleChunkError)) throw this.state.error
    return <RouteRecoveryScreen />
  }
}

function RouteRecoveryScreen() {
  const { lang } = useI18n()
  const navigate = useNavigate()
  const copy = lang === 'pt' ? {
    title: 'Actualização da aplicação disponível',
    description: 'O StockWise não conseguiu carregar esta página com a versão actual da aplicação. Recarregue para continuar com a versão mais recente.',
    reload: 'Recarregar',
    dashboard: 'Ir para o dashboard',
  } : {
    title: 'App update available',
    description: 'StockWise could not load this page from the current application version. Reload to continue with the latest version.',
    reload: 'Reload',
    dashboard: 'Go to dashboard',
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <section className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8" aria-labelledby="route-recovery-title">
        <h1 id="route-recovery-title" className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.description}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button type="button" onClick={() => window.location.reload()}>{copy.reload}</Button>
          <Button type="button" variant="outline" onClick={() => navigate('/dashboard')}>{copy.dashboard}</Button>
        </div>
      </section>
    </main>
  )
}
