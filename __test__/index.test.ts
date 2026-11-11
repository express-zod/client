import { createApp } from 'express-zod'
import type { RoutesOf } from 'express-zod'

import { createClient } from '../src/index.ts'

describe('createClient', () => {
  it('returns a client proxy', () => {
    const app = createApp().get('/api/users', () => {})
    const client = createClient('http://localhost:3030/api').as<RoutesOf<typeof app>>()

    expect(typeof client).toBe('object')
    expect(Object.keys(client)).toHaveLength(0)
  })

  it('constructs a proxy without throwing when route keys collide', () => {
    const app = createApp()
      .get('/api/users', () => {})
      .get('/users', () => {})

    const client = createClient('http://localhost:3030/api').as<RoutesOf<typeof app>>()

    expect(typeof client).toBe('object')
    expect('get' in client).toBe(false)
  })
})
