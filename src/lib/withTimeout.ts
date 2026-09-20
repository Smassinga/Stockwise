export class TimeoutError extends Error {
  readonly label: string
  readonly timeoutMs: number

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out`)
    this.name = 'TimeoutError'
    this.label = label
    this.timeoutMs = timeoutMs
  }
}

export function isTimeoutError(error: unknown, label?: string): error is TimeoutError {
  return error instanceof TimeoutError && (label === undefined || error.label === label)
}

export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
