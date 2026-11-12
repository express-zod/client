import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
// @vitest-environment jsdom
import { createApp } from 'express-zod'
import type { RoutesOf } from 'express-zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { useClient } from '../src/adopters/react.ts'
import { ClientError, createClient } from '../src/index.ts'

const app = createApp().get(
  '/api/users/:id',
  {
    params: z.object({ id: z.string() }),
    response: {
      200: z.object({ id: z.string() }),
      404: z.object({ message: z.string() }),
    },
  },
  () => {},
)

const client = createClient('http://example.com/api').as<RoutesOf<typeof app>>()

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function useUser(id: string) {
  return useClient(() => client.get('/users/:id', { params: { id } }), { deps: [id] })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('react useClient', () => {
  it('fetches immediately and exposes state', async () => {
    fetchMock.mockResolvedValue(json({ id: '1' }))

    const { result } = renderHook(() =>
      useClient(() => client.get('/users/:id', { params: { id: '1' } })),
    )

    await waitFor(() => expect(result.current.status).toBe('success'))

    expect(result.current.data).toEqual({ id: '1' })
    expect(result.current.error).toBeUndefined()
    expect(result.current.pending).toBe(false)
  })

  it('refetches when deps change', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(json({ id: String(url).split('/').pop() })),
    )

    const { result, rerender } = renderHook(({ id }: { id: string }) => useUser(id), {
      initialProps: { id: '1' },
    })

    await waitFor(() => expect(result.current.data).toEqual({ id: '1' }))

    rerender({ id: '2' })

    await waitFor(() => expect(result.current.data).toEqual({ id: '2' }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('captures errors', async () => {
    fetchMock.mockResolvedValue(json({ message: 'missing' }, 404))

    const { result } = renderHook(() =>
      useClient(() => client.get('/users/:id', { params: { id: '1' } })),
    )

    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.error).toBeInstanceOf(ClientError)
    expect(result.current.error?.status).toBe(404)
    expect(result.current.data).toBeUndefined()
  })

  it('ignores a stale success response', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const { result, rerender } = renderHook(({ id }: { id: string }) => useUser(id), {
      initialProps: { id: '1' },
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    rerender({ id: '2' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    second.resolve(json({ id: '2' }))
    await waitFor(() => expect(result.current.data).toEqual({ id: '2' }))

    first.resolve(json({ id: '1' }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(result.current.data).toEqual({ id: '2' })
    expect(result.current.status).toBe('success')
    expect(result.current.pending).toBe(false)
  })

  it('ignores a stale error response', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const { result, rerender } = renderHook(({ id }: { id: string }) => useUser(id), {
      initialProps: { id: '1' },
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    rerender({ id: '2' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    second.resolve(json({ id: '2' }))
    await waitFor(() => expect(result.current.data).toEqual({ id: '2' }))

    first.reject(new Error('stale'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(result.current.error).toBeUndefined()
    expect(result.current.status).toBe('success')
    expect(result.current.pending).toBe(false)
  })

  it('runs onError when the request fails', async () => {
    fetchMock.mockResolvedValue(json({ message: 'missing' }, 404))
    const events: string[] = []

    const { result } = renderHook(() =>
      useClient(() => client.get('/users/:id', { params: { id: '1' } }), {
        onError: (error) => events.push(`error:${error.status}`),
        onFinish: () => events.push('finish'),
      }),
    )

    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(events).toEqual(['error:404', 'finish'])
  })

  it('defers execution until execute is called', async () => {
    fetchMock.mockResolvedValue(json({ id: '1' }))

    const { result } = renderHook(() =>
      useClient(() => client.get('/users/:id', { params: { id: '1' } }), { immediate: false }),
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')

    await act(async () => {
      await result.current.execute()
    })

    expect(result.current.data).toEqual({ id: '1' })
  })

  it('runs lifecycle hooks', async () => {
    fetchMock.mockResolvedValue(json({ id: '1' }))
    const events: string[] = []

    const { result } = renderHook(() =>
      useClient(() => client.get('/users/:id', { params: { id: '1' } }), {
        onSuccess: (data) => events.push(`success:${data.id}`),
        onError: () => events.push('error'),
        onFinish: () => events.push('finish'),
      }),
    )

    await waitFor(() => expect(result.current.status).toBe('success'))

    expect(events).toEqual(['success:1', 'finish'])
  })

  it('uses initial data', () => {
    const { result } = renderHook(() =>
      useClient(() => client.get('/users/:id', { params: { id: '1' } }), {
        immediate: false,
        initialData: { id: 'seed' },
      }),
    )

    expect(result.current.data).toEqual({ id: 'seed' })
  })
})
