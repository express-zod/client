import { greet } from '../src/index.ts'

describe('greet', () => {
  it('greets by name', () => {
    expect(greet({ name: 'world' })).toBe('Hello, world!')
  })
})
