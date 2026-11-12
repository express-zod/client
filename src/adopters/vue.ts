import { getCurrentScope, onScopeDispose, ref, shallowRef, watchEffect } from 'vue'
import type { Ref } from 'vue'

import type { ClientPromise } from '../client.ts'
import type { ClientError } from '../error.ts'

export type UseClientStatus = 'idle' | 'pending' | 'success' | 'error'

export type UseClientOptions<T, E extends ClientError = ClientError> = {
  immediate?: boolean
  initialData?: T
  onSuccess?: (data: T) => void
  onError?: (error: E) => void
  onFinish?: () => void
}

export type UseClientReturn<T, E extends ClientError = ClientError> = {
  data: Ref<T | undefined>
  error: Ref<E | undefined>
  pending: Ref<boolean>
  status: Ref<UseClientStatus>
  execute: () => Promise<T | undefined>
  refresh: () => Promise<T | undefined>
}

export function useClient<T, E extends ClientError = ClientError>(
  fetcher: () => ClientPromise<T, E>,
  options: UseClientOptions<T, E> = {},
): UseClientReturn<T, E> {
  const data = shallowRef<T | undefined>(options.initialData)
  const error = shallowRef<E | undefined>()
  const pending = ref(false)
  const status = ref<UseClientStatus>('idle')

  let requestId = 0

  const execute = async (): Promise<T | undefined> => {
    const currentId = ++requestId
    pending.value = true
    status.value = 'pending'
    error.value = undefined

    try {
      const result = await fetcher()
      if (currentId !== requestId) return data.value

      data.value = result
      status.value = 'success'
      options.onSuccess?.(result)
      return result
    } catch (cause) {
      if (currentId !== requestId) return data.value

      const caught = cause as E
      error.value = caught
      status.value = 'error'
      options.onError?.(caught)
      return undefined
    } finally {
      if (currentId === requestId) {
        pending.value = false
        options.onFinish?.()
      }
    }
  }

  if (options.immediate !== false) {
    watchEffect(() => {
      void execute()
    })
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      requestId++
    })
  }

  return {
    data,
    error,
    pending,
    status,
    execute,
    refresh: execute,
  }
}
