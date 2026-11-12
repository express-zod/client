export type Simplify<T> = { [K in keyof T]: T[K] }

export type Optionalize<Key extends PropertyKey, Value> = {} extends Value
  ? { [K in Key]?: Value }
  : { [K in Key]: Value }

export type ArgsTuple<Args> = Args extends unknown
  ? keyof Args extends never
    ? []
    : {} extends Args
      ? [args?: Args]
      : [args: Args]
  : never

export type RouteAt<Routes, Key extends string> = Key extends keyof Routes ? Routes[Key] : never

export type ClientMethod =
  | 'all'
  | 'connect'
  | 'delete'
  | 'get'
  | 'head'
  | 'options'
  | 'patch'
  | 'post'
  | 'put'
  | 'query'
  | 'trace'

export type MethodsOf<Routes> = {
  [Key in keyof Routes]: Key extends `${infer Method} ${string}`
    ? Method extends ClientMethod
      ? Method
      : never
    : never
}[keyof Routes]

export type PathsOf<Routes, Method extends string> = {
  [Key in keyof Routes]: Key extends `${Method} ${infer Path}` ? Path : never
}[keyof Routes]

export type HasParams<Params, Schemas> = 'params' extends keyof Schemas
  ? true
  : keyof Params extends never
    ? false
    : true

export type ArgsOf<Definition> = Definition extends {
  params: infer Params
  query: infer Query
  body: infer Body
  headers: infer Headers
  schemas: infer Schemas
}
  ? Simplify<
      (HasParams<Params, Schemas> extends true ? Optionalize<'params', Params> : {}) &
        (Schemas extends { query: unknown } ? Optionalize<'query', Query> : {}) &
        (Schemas extends { body: unknown } ? Optionalize<'body', Body> : {}) &
        (Schemas extends { headers: unknown } ? Optionalize<'headers', Headers> : {})
    >
  : never

export type SuccessStatusCode = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226

export type SuccessKeysOf<Response> = Extract<keyof Response, SuccessStatusCode>

export type ErrorKeysOf<Response> = Exclude<keyof Response, SuccessStatusCode>

export type ResponseOf<Definition> = Definition extends { response: infer Response }
  ? keyof Response extends never
    ? unknown
    : Response[SuccessKeysOf<Response>]
  : never

export type ErrorResponseOf<Definition> = Definition extends { response: infer Response }
  ? {
      [Code in ErrorKeysOf<Response>]: { status: Code; body: Response[Code] }
    }[ErrorKeysOf<Response>]
  : never

export type ErrorStatusOf<Definition> =
  ErrorResponseOf<Definition> extends {
    status: infer Status extends number
  }
    ? Status
    : never

export type ErrorBodyOf<Definition> =
  ErrorResponseOf<Definition> extends { body: infer Body } ? Body : never
