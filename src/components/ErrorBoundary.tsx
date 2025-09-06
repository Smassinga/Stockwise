// src/components/ErrorBoundary.tsx
import { Component, type ReactNode } from 'react'

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
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-2">Something went wrong.</h2>
          <pre className="text-sm text-red-600 whitespace-pre-wrap">
            {this.state.error?.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
