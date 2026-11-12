import { createApp } from 'express-zod'
import type { RoutesOf } from 'express-zod'
import { z } from 'zod'

import { ClientError, createClient } from '../src/index.ts'

const app = createApp()
  .get(
    '/api/users/:id',
    {
      params: z.object({ id: z.string() }),
      query: z.object({
        page: z.number().optional(),
        tags: z.array(z.string()).optional(),
      }),
      response: {
        200: z.object({ id: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    () => {},
  )
  .post(
    '/api/users',
    {
      body: z.object({ name: z.string() }),
      headers: z.object({
        authorization: z.string(),
        'content-type': z.string().optional(),
        'x-tags': z.array(z.string()).optional(),
      }),
    },
    () => {},
  )
  .delete(
    '/api/sessions/:id',
    {
      params: z.object({ id: z.string() }),
      response: { 204: z.void() },
    },
    () => {},
  )
  .get('/api/files/*path', { response: z.object({ size: z.number() }) }, () => {})
  .get('/api/version', { response: z.string() }, () => {})
  .delete('/api/cache/:id', { response: { 205: z.void() } }, () => {})
  .all('/api/ping', () => {})

const client = createClient('http://example.com/api').as<RoutesOf<typeof app>>()

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createClient requests', () => {
  it('sends a GET request with params and query', async () => {
    fetchMock.mockResolvedValue(json({ id: 'a b' }))

    const body = await client.get('/users/:id', {
      params: { id: 'a b' },
      query: { page: 1, tags: ['x', 'y'] },
    })

    expect(body).toEqual({ id: 'a b' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.com/api/users/a%20b?page=1&tags=x&tags=y',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('serializes JSON bodies and headers', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }))

    await client.post('/users', {
      body: { name: 'a' },
      headers: { authorization: 'Bearer x' },
    })

    const [, init] = fetchMock.mock.calls[0]!
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ name: 'a' }))

    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer x')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('throws ClientError with the failure body', async () => {
    fetchMock.mockResolvedValue(json({ message: 'missing' }, 404))

    const error = await client
      .get('/users/:id', { params: { id: '1' } })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ClientError)
    expect(error).toMatchObject({ status: 404, body: { message: 'missing' } })
    expect((error as ClientError).response?.status).toBe(404)
  })

  it('returns undefined for no-content responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(client.delete('/sessions/:id', { params: { id: '1' } })).resolves.toBeUndefined()
  })

  it('joins wildcard params', async () => {
    fetchMock.mockResolvedValue(json({ size: 1 }))

    const body = await client.get('/files/*path', { params: { path: ['a b', 'c'] } })

    expect(body).toEqual({ size: 1 })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://example.com/api/files/a%20b/c')
  })

  it('maps all routes to GET', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))

    await client.all('/ping')

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' })
  })

  it('omits empty query values', async () => {
    fetchMock.mockResolvedValue(json({ id: '1' }))

    await client.get('/users/:id', {
      params: { id: '1' },
      query: { page: undefined, tags: [] },
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://example.com/api/users/1')
  })

  it('ignores a trailing slash in the host', async () => {
    const trailing = createClient('http://example.com/api/').as<RoutesOf<typeof app>>()
    fetchMock.mockResolvedValue(
      new Response('1.0.0', { headers: { 'content-type': 'text/plain' } }),
    )

    await trailing.get('/version')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://example.com/api/version')
  })

  it('returns text responses', async () => {
    fetchMock.mockResolvedValue(new Response(new TextEncoder().encode('1.0.0')))

    await expect(client.get('/version')).resolves.toBe('1.0.0')
  })

  it('skips undefined headers', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }))

    await client.post('/users', {
      body: { name: 'a' },
      headers: { authorization: 'Bearer x', 'content-type': undefined },
    })

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('keeps explicit headers', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }))

    await client.post('/users', {
      body: { name: 'a' },
      headers: {
        authorization: 'Bearer x',
        'content-type': 'application/vnd.api+json',
        'x-tags': ['a', 'b'],
      },
    })

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('content-type')).toBe('application/vnd.api+json')
    expect(headers.get('x-tags')).toBe('a, b')
  })

  it('returns undefined for reset-content responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 205 }))

    await expect(client.delete('/cache/:id', { params: { id: '1' } })).resolves.toBeUndefined()
  })

  it('throws ClientError with a text body', async () => {
    fetchMock.mockResolvedValue(
      new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } }),
    )

    const error = await client.get('/version').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ClientError)
    expect(error).toMatchObject({ status: 500, body: 'boom' })
  })

  it('ignores unknown properties', () => {
    expect((client as unknown as Record<string, unknown>).unknown).toBeUndefined()
  })
})

describe('createClient options', () => {
  it('uses a custom fetch implementation', async () => {
    const customFetch = vi.fn<typeof fetch>().mockResolvedValue(json({ id: '1' }))
    const custom = createClient('http://example.com/api', { fetch: customFetch }).as<
      RoutesOf<typeof app>
    >()

    await custom.get('/users/:id', { params: { id: '1' } })

    expect(customFetch).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('merges default headers from an async factory', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }))
    const custom = createClient('http://example.com/api', {
      headers: async () => ({ 'x-token': 'abc' }),
    }).as<RoutesOf<typeof app>>()

    await custom.post('/users', {
      body: { name: 'a' },
      headers: { authorization: 'Bearer x' },
    })

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-token')).toBe('abc')
    expect(headers.get('authorization')).toBe('Bearer x')
  })

  it('merges default and per-request init', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }))
    const custom = createClient('http://example.com/api', {
      init: { credentials: 'include', cache: 'no-store' },
    }).as<RoutesOf<typeof app>>()

    await custom.post(
      '/users',
      { body: { name: 'a' }, headers: { authorization: 'Bearer x' } },
      { init: { cache: 'reload' } },
    )

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.credentials).toBe('include')
    expect(init?.cache).toBe('reload')
  })

  it('forwards an abort signal', async () => {
    fetchMock.mockResolvedValue(json({ id: '1' }))
    const controller = new AbortController()

    await client.get('/users/:id', { params: { id: '1' } }, { signal: controller.signal })

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
  })

  it('applies a timeout', async () => {
    fetchMock.mockResolvedValue(json({ id: '1' }))
    const custom = createClient('http://example.com/api', { timeout: 1000 }).as<
      RoutesOf<typeof app>
    >()

    await custom.get('/users/:id', { params: { id: '1' } })

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('accepts options for routes without args', async () => {
    fetchMock.mockResolvedValue(new Response('1.0.0'))

    await client.get('/version', { timeout: 1000 })

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('merges per-request headers', async () => {
    fetchMock.mockResolvedValue(json({ id: '1' }))

    await client.get('/users/:id', { params: { id: '1' } }, { headers: { 'x-trace': '1' } })

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-trace')).toBe('1')
  })

  it('returns the failure body when throwOnError is false', async () => {
    fetchMock.mockResolvedValue(json({ message: 'missing' }, 404))
    const custom = createClient('http://example.com/api', { throwOnError: false }).as<
      RoutesOf<typeof app>
    >()

    await expect(custom.get('/users/:id', { params: { id: '1' } })).resolves.toEqual({
      message: 'missing',
    })
  })

  it('accepts throwOnError per request', async () => {
    fetchMock.mockResolvedValue(json({ message: 'missing' }, 404))

    await expect(
      client.get('/users/:id', { params: { id: '1' } }, { throwOnError: false }),
    ).resolves.toEqual({ message: 'missing' })
  })

  it('uses a custom success predicate', async () => {
    fetchMock.mockResolvedValue(json({ message: 'not found' }, 404))
    const custom = createClient('http://example.com/api', {
      isSuccess: (status) => status < 500,
    }).as<RoutesOf<typeof app>>()

    await expect(custom.get('/users/:id', { params: { id: '1' } })).resolves.toEqual({
      message: 'not found',
    })
  })

  it('runs request, response, and error hooks', async () => {
    const events: string[] = []
    fetchMock.mockResolvedValue(json({ message: 'missing' }, 404))
    const custom = createClient('http://example.com/api', {
      onRequest: ({ url, init }) => {
        events.push(`request:${url}:${init.method}`)
      },
      onResponse: (response) => {
        events.push(`response:${response.status}`)
      },
      onError: (error) => {
        events.push(`error:${error.status}:${error.response?.status}`)
      },
    }).as<RoutesOf<typeof app>>()

    await expect(custom.get('/users/:id', { params: { id: '1' } })).rejects.toBeInstanceOf(
      ClientError,
    )
    expect(events).toEqual([
      'request:http://example.com/api/users/1:GET',
      'response:404',
      'error:404:404',
    ])
  })
})
