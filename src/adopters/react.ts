import { useCallback, useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'

import type { ClientPromise } from '../client.ts'
import type { ClientError } from '../error.ts'

export type UseClientStatus = 'idle' | 'pending' | 'success' | 'error'

export type UseClientOptions<T, E extends ClientError = ClientError> = {
  immediate?: boolean
  initialData?: T
  deps?: DependencyList
  onSuccess?: (data: T) => void
  onError?: (error: E) => void
  onFinish?: () => void
}

export type UseClientReturn<T, E extends ClientError = ClientError> = {
  data: T | undefined
  error: E | undefined
  pending: boolean
  status: UseClientStatus
  execute: () => Promise<T | undefined>
  refresh: () => Promise<T | undefined>
}

export function useClient<T, E extends ClientError = ClientError>(
  fetcher: () => ClientPromise<T, E>,
  options: UseClientOptions<T, E> = {},
): UseClientReturn<T, E> {
  const [data, setData] = useState<T | undefined>(options.initialData)
  const [error, setError] = useState<E | undefined>()
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<UseClientStatus>('idle')

  const requestId = useRef(0)
  const fetcherRef = useRef(fetcher)
  const optionsRef = useRef(options)

  fetcherRef.current = fetcher
  optionsRef.current = options

  const execute = useCallback(async (): Promise<T | undefined> => {
    const currentId = ++requestId.current

    setPending(true)
    setStatus('pending')
    setError(undefined)

    try {
      const result = await fetcherRef.current()
      if (currentId !== requestId.current) return undefined

      setData(result)
      setStatus('success')
      optionsRef.current.onSuccess?.(result)
      return result
    } catch (cause) {
      if (currentId !== requestId.current) return undefined

      const caught = cause as E
      setError(caught)
      setStatus('error')
      optionsRef.current.onError?.(caught)
      return undefined
    } finally {
      if (currentId === requestId.current) {
        setPending(false)
        optionsRef.current.onFinish?.()
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      requestId.current++
    }
  }, [])

  useEffect(() => {
    if (options.immediate === false) return

    void execute()
  }, [execute, options.immediate, ...(options.deps ?? [])])

  return {
    data,
    error,
    pending,
    status,
    execute,
    refresh: execute,
  }
}
