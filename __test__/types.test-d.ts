import { expectTypeOf } from 'vitest'

import { greet } from '../src/index.ts'

describe('greet types', () => {
  it('returns a string', () => {
    expectTypeOf(greet).returns.toEqualTypeOf<string>()
  })
})
