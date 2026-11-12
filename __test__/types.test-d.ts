import { createApp } from 'express-zod'
import type { RoutesOf } from 'express-zod'
import { expectTypeOf } from 'vitest'
import { z } from 'zod'

import { createClient } from '../src/index.ts'

const app = createApp()
  .get('/api', () => {})
  .get('/health', () => {})
  .get(
    '/api/users',
    {
      query: z.object({ page: z.number(), search: z.string().optional() }),
      response: z.object({ items: z.array(z.string()) }),
    },
    () => {},
  )
  .get(
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
  .post('/api/users', { body: z.object({ name: z.string() }) }, () => {})
  .post('/api/teams/:teamId/members', () => {})
  .delete(
    '/api/sessions/:id',
    {
      params: z.object({ id: z.string() }),
      response: { 204: z.void() },
    },
    () => {},
  )
  .patch('/api/settings', { body: z.object({ note: z.string().optional() }) }, () => {})
  .delete(
    '/api/users/:id',
    {
      params: z.object({ id: z.string() }),
      headers: z.object({ authorization: z.string() }),
    },
    () => {},
  )
  .get('/api/search', { query: z.object({ q: z.string().optional() }) }, () => {})
  .all('/api/ping', () => {})
  .get('/api/files/*path', { response: z.object({ size: z.number() }) }, () => {})
  .get('/api/files/:bucket/*path', { response: z.object({ size: z.number() }) }, () => {})
  .get('/api/v1/status', () => {})
  .get(
    '/api/orgs/:orgId/users/:userId',
    {
      params: z.object({ orgId: z.coerce.number() }),
      response: { 201: z.object({ ok: z.boolean() }) },
    },
    () => {},
  )

type EmptyRoute = {
  params: Record<never, never>
  query: Record<never, never>
  body: Record<never, never>
  headers: Record<never, never>
  schemas: Record<never, never>
  response: Record<never, never>
}

const client = createClient('http://localhost:3030/api').as<RoutesOf<typeof app>>()

describe('createClient methods', () => {
  it('only exposes registered methods', () => {
    expectTypeOf<keyof typeof client>().toEqualTypeOf<'get' | 'post' | 'patch' | 'delete' | 'all'>()
    expectTypeOf(client).not.toHaveProperty('put')
  })
})

describe('createClient constraints', () => {
  it('ignores keys with unknown methods', () => {
    const fake = createClient('http://localhost:3030').as<{
      'get /users': EmptyRoute
      'fake /users': EmptyRoute
    }>()

    expectTypeOf<keyof typeof fake>().toEqualTypeOf<'get'>()
  })

  it('rejects routes that collide after prefix stripping', () => {
    const duplicateApp = createApp()
      .get('/api/users', () => {})
      .get('/users', () => {})

    const duplicateClient = createClient('http://localhost:3030/api').as<
      RoutesOf<typeof duplicateApp>
    >()

    expectTypeOf(duplicateClient).toHaveProperty('__duplicateRouteKey')
    // @ts-expect-error colliding keys do not expose client methods
    duplicateClient.get('/users')
  })
})

describe('createClient paths', () => {
  it('strips the host pathname', () => {
    client.get('/')
    client.get('/users', { query: { page: 1 } })
    client.get('/users/:id', { params: { id: '1' } })
  })

  it('rejects paths that still contain the prefix', () => {
    // @ts-expect-error /api/users is stripped to /users
    client.get('/api/users')
  })

  it('rejects unknown paths', () => {
    // @ts-expect-error no such route
    client.get('/nope')
  })

  it('keeps routes outside the prefix', () => {
    client.get('/health')
  })

  it('keeps paths when the host has no pathname', () => {
    const bare = createClient('http://localhost:3030').as<RoutesOf<typeof app>>()
    bare.get('/api/users', { query: { page: 1 } })
    // @ts-expect-error /users is not a route without a prefix
    bare.get('/users')
  })

  it('ignores a trailing slash in the host', () => {
    const trailing = createClient('http://localhost:3030/api/').as<RoutesOf<typeof app>>()
    trailing.get('/users', { query: { page: 1 } })
  })

  it('parses a host without a scheme', () => {
    const noScheme = createClient('localhost:3030/api').as<RoutesOf<typeof app>>()
    noScheme.get('/users', { query: { page: 1 } })
  })

  it('strips multi-segment host pathnames', () => {
    const v1 = createClient('https://example.com/api/v1').as<RoutesOf<typeof app>>()
    expectTypeOf(v1.get('/status')).toEqualTypeOf<Promise<unknown>>()
  })

  it('does not strip when the host is not a literal', () => {
    const host: string = 'http://localhost:3030/api'
    const dynamic = createClient(host).as<RoutesOf<typeof app>>()
    dynamic.get('/api/users', { query: { page: 1 } })
  })
})

describe('createClient all and wildcards', () => {
  it('exposes the all method', () => {
    expectTypeOf(client.all('/ping')).toEqualTypeOf<Promise<unknown>>()
    // @ts-expect-error the prefix is stripped
    client.all('/api/ping')
  })

  it('infers wildcard params', () => {
    expectTypeOf(client.get('/files/*path', { params: { path: ['a', 'b'] } })).toEqualTypeOf<
      Promise<{ size: number }>
    >()
  })

  it('requires wildcard params', () => {
    // @ts-expect-error path is required
    client.get('/files/*path')
  })

  it('rejects the unstripped wildcard path', () => {
    // @ts-expect-error the prefix is stripped
    client.get('/api/files/*path')
  })

  it('accepts single and multiple wildcard segments', () => {
    expectTypeOf(client.get('/files/*path', { params: { path: ['a'] } })).toEqualTypeOf<
      Promise<{ size: number }>
    >()

    expectTypeOf(client.get('/files/*path', { params: { path: ['a', 'b'] } })).toEqualTypeOf<
      Promise<{ size: number }>
    >()

    expectTypeOf(
      client.get('/files/:bucket/*path', {
        params: { bucket: 'b', path: ['a', 'b', 'c'] },
      }),
    ).toEqualTypeOf<Promise<{ size: number }>>()
  })

  it('infers named params alongside wildcards', () => {
    expectTypeOf(
      client.get('/files/:bucket/*path', {
        params: { bucket: 'b', path: ['a', 'b'] },
      }),
    ).toEqualTypeOf<Promise<{ size: number }>>()

    // @ts-expect-error bucket is required
    client.get('/files/:bucket/*path', { params: { path: ['a'] } })
    // @ts-expect-error path is required
    client.get('/files/:bucket/*path', { params: { bucket: 'b' } })
    // @ts-expect-error path must be string[]
    client.get('/files/:bucket/*path', { params: { bucket: 'b', path: 'a' } })
  })
})

describe('createClient args', () => {
  it('omits args when a route takes none', () => {
    // @ts-expect-error the root route takes no args
    client.get('/', {})
  })

  it('requires args with a required field', () => {
    // @ts-expect-error page is required
    client.get('/users')
    // @ts-expect-error id is required
    client.get('/users/:id')
  })

  it('makes args optional when every field is optional', () => {
    client.get('/search')
    client.get('/search', { query: {} })
    client.patch('/settings')
    client.patch('/settings', { body: {} })
  })

  it('checks body fields', () => {
    client.post('/users', { body: { name: 'a' } })
    // @ts-expect-error name is required
    client.post('/users', { body: {} })
  })

  it('infers params from the path without a schema', () => {
    expectTypeOf(client.post('/teams/:teamId/members', { params: { teamId: 't' } })).toEqualTypeOf<
      Promise<unknown>
    >()
    // @ts-expect-error teamId is required
    client.post('/teams/:teamId/members')
  })

  it('merges path params with a params schema', () => {
    expectTypeOf(
      client.get('/orgs/:orgId/users/:userId', {
        params: { orgId: 1, userId: 'u' },
      }),
    ).toEqualTypeOf<Promise<{ ok: boolean }>>()

    // @ts-expect-error orgId is a number per the schema
    client.get('/orgs/:orgId/users/:userId', { params: { orgId: '1', userId: 'u' } })
  })

  it('checks headers', () => {
    client.delete('/users/:id', {
      params: { id: '1' },
      headers: { authorization: 'Bearer x' },
    })
    // @ts-expect-error authorization is required
    client.delete('/users/:id', { params: { id: '1' } })
  })
})

describe('createClient responses', () => {
  it('returns unknown without a response schema', () => {
    expectTypeOf(client.get('/')).toEqualTypeOf<Promise<unknown>>()
  })

  it('uses the response schema body', () => {
    expectTypeOf(client.get('/users', { query: { page: 1 } })).toEqualTypeOf<
      Promise<{ items: string[] }>
    >()
  })

  it('returns the successful response body directly', () => {
    expectTypeOf(client.get('/users/:id', { params: { id: '1' } })).toEqualTypeOf<
      Promise<{ id: string }>
    >()
  })

  it('maps no-body statuses to undefined', () => {
    expectTypeOf(client.delete('/sessions/:id', { params: { id: '1' } })).toEqualTypeOf<
      Promise<undefined>
    >()
  })

  it('excludes failure response bodies', () => {
    expectTypeOf(client.get('/users/:id', { params: { id: '1' } })).toEqualTypeOf<
      Promise<{ id: string }>
    >()
  })
})
