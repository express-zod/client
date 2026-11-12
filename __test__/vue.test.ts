import { createApp } from 'express-zod'
import type { RoutesOf } from 'express-zod'
import { effectScope, ref } from 'vue'
import type { EffectScope } from 'vue'
import { z } from 'zod'

import { useClient } from '../src/adopters/vue.ts'
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
let scopes: EffectScope[] = []

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

function run<T>(callback: () => T): T {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(callback)!
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  scopes.forEach((scope) => scope.stop())
  scopes = []
  vi.unstubAllGlobals()
})

describe('useClient', () => {
  it('fetches immediately and exposes state', async () => {
    fetchMock.mockResolvedValue(json({ id: '1' }))

    const state = run(() => useClient(() => client.get('/users/:id', { params: { id: '1' } })))

    await vi.waitFor(() => expect(state.status.value).toBe('success'))

    expect(state.data.value).toEqual({ id: '1' })
    expect(state.error.value).toBeUndefined()
    expect(state.pending.value).toBe(false)
  })

  it('refetches when reactive dependencies change', async () => {
    const id = ref('1')
    fetchMock.mockImplementation(() => Promise.resolve(json({ id: id.value })))

    const state = run(() => useClient(() => client.get('/users/:id', { params: { id: id.value } })))

    await vi.waitFor(() => expect(state.data.value).toEqual({ id: '1' }))

    id.value = '2'
    await vi.waitFor(() => expect(state.data.value).toEqual({ id: '2' }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('captures errors', async () => {
    fetchMock.mockResolvedValue(json({ message: 'missing' }, 404))

    const state = run(() => useClient(() => client.get('/users/:id', { params: { id: '1' } })))

    await vi.waitFor(() => expect(state.status.value).toBe('error'))

    expect(state.error.value).toBeInstanceOf(ClientError)
    expect(state.error.value?.status).toBe(404)
    expect(state.data.value).toBeUndefined()
  })

  it('ignores a stale success response', async () => {
    const id = ref('1')
    const first = deferred<Response>()
    const second = deferred<Response>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const state = run(() => useClient(() => client.get('/users/:id', { params: { id: id.value } })))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    id.value = '2'
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    second.resolve(json({ id: '2' }))
    await vi.waitFor(() => expect(state.data.value).toEqual({ id: '2' }))

    first.resolve(json({ id: '1' }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.data.value).toEqual({ id: '2' })
    expect(state.status.value).toBe('success')
    expect(state.pending.value).toBe(false)
  })

  it('ignores a stale error response', async () => {
    const id = ref('1')
    const first = deferred<Response>()
    const second = deferred<Response>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const state = run(() => useClient(() => client.get('/users/:id', { params: { id: id.value } })))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    id.value = '2'
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    second.resolve(json({ id: '2' }))
    await vi.waitFor(() => expect(state.data.value).toEqual({ id: '2' }))

    first.reject(new Error('stale'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state.error.value).toBeUndefined()
    expect(state.status.value).toBe('success')
    expect(state.pending.value).toBe(false)
  })

  it('runs onError when the request fails', async () => {
    fetchMock.mockResolvedValue(json({ message: 'missing' }, 404))
    const events: string[] = []

    const state = run(() =>
      useClient(() => client.get('/users/:id', { params: { id: '1' } }), {
        onError: (error) => events.push(`error:${error.status}`),
        onFinish: () => events.push('finish'),
      }),
    )

    await vi.waitFor(() => expect(state.status.value).toBe('error'))

    expect(events).toEqual(['error:404', 'finish'])
  })

  it('defers execution until execute is called', async () => {
    fetchMock.mockResolvedValue(json({ id: '1' }))

    const state = run(() =>
      useClient(() => client.get('/users/:id', { params: { id: '1' } }), { immediate: false }),
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.status.value).toBe('idle')

    await state.execute()

    expect(state.data.value).toEqual({ id: '1' })
  })

  it('runs lifecycle hooks', async () => {
    fetchMock.mockResolvedValue(json({ id: '1' }))
    const events: string[] = []

    const state = run(() =>
      useClient(() => client.get('/users/:id', { params: { id: '1' } }), {
        onSuccess: (data) => events.push(`success:${data.id}`),
        onError: () => events.push('error'),
        onFinish: () => events.push('finish'),
      }),
    )

    await vi.waitFor(() => expect(state.status.value).toBe('success'))

    expect(events).toEqual(['success:1', 'finish'])
  })

  it('works outside an effect scope', async () => {
    fetchMock.mockResolvedValue(json({ id: '1' }))

    const state = useClient(() => client.get('/users/:id', { params: { id: '1' } }), {
      immediate: false,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.status.value).toBe('idle')

    await state.execute()

    expect(state.data.value).toEqual({ id: '1' })
  })

  it('uses initial data', () => {
    const state = run(() =>
      useClient(() => client.get('/users/:id', { params: { id: '1' } }), {
        immediate: false,
        initialData: { id: 'seed' },
      }),
    )

    expect(state.data.value).toEqual({ id: 'seed' })
  })
})
