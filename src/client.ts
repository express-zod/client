import { ClientError } from './error.ts'
import type { HostPrefix, StripPrefix } from './host.ts'
import type {
  ArgsOf,
  ArgsTuple,
  ErrorBodyOf,
  ErrorResponseOf,
  ErrorStatusOf,
  MethodsOf,
  PathsOf,
  ResponseOf,
  RouteAt,
} from './types.ts'

const METHODS = new Set([
  'all',
  'connect',
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'query',
  'trace',
])

type RequestInitOptions = Omit<RequestInit, 'body' | 'headers' | 'method' | 'signal'>

type RequestArgs = {
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, unknown>
}

export type HeadersInput =
  | Headers
  | [string, string][]
  | Record<string, string | string[] | undefined | null>

export type RequestOptions = {
  headers?: HeadersInput
  init?: RequestInitOptions
  signal?: AbortSignal
  timeout?: number
  throwOnError?: boolean
}

export type ClientOptions = {
  fetch?: typeof fetch
  headers?: HeadersInput | (() => HeadersInput | Promise<HeadersInput>)
  init?: RequestInitOptions
  timeout?: number
  throwOnError?: boolean
  isSuccess?: (status: number) => boolean
  onRequest?: (request: { url: string; init: RequestInit }) => void | Promise<void>
  onResponse?: (response: Response) => void | Promise<void>
  onError?: (error: ClientError) => void | Promise<void>
}

type ClientRoutes<T, Prefix extends string> = {
  [
    Key in keyof T as Key extends `${infer Method} ${infer Path}`
      ? `${Method} ${StripPrefix<Path, Prefix>}`
      : never
  ]: T[Key]
}

type ArgsWithOptions<Args> =
  ArgsTuple<Args> extends infer Tuple extends unknown[]
    ? Tuple extends []
      ? [options?: RequestOptions]
      : [...Tuple, options?: RequestOptions]
    : never

type ClientErrorOf<Definition> = [ErrorResponseOf<Definition>] extends [never]
  ? ClientError
  : ClientError<ErrorStatusOf<Definition>, ErrorBodyOf<Definition>>

export interface ClientPromise<T, E extends ClientError = ClientError> extends Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: E) => TResult2 | PromiseLike<TResult2>) | null,
  ): ClientPromise<TResult1 | TResult2, E>
  catch<TResult = never>(
    onrejected?: ((reason: E) => TResult | PromiseLike<TResult>) | null,
  ): ClientPromise<T | TResult, E>
  finally(onfinally?: (() => void) | null): ClientPromise<T, E>
}

type ClientOf<Routes> = {
  [Method in MethodsOf<Routes>]: <Path extends PathsOf<Routes, Method>>(
    path: Path,
    ...args: ArgsWithOptions<ArgsOf<RouteAt<Routes, `${Method} ${Path}`>>>
  ) => ClientPromise<
    ResponseOf<RouteAt<Routes, `${Method} ${Path}`>>,
    ClientErrorOf<RouteAt<Routes, `${Method} ${Path}`>>
  >
}

type StripKey<Key, Prefix extends string> = Key extends `${infer Method} ${infer Path}`
  ? `${Method} ${StripPrefix<Path, Prefix>}`
  : never

type DuplicateKeys<T, Prefix extends string> = {
  [Key in keyof T]: StripKey<Key, Prefix> extends infer Stripped
    ? Stripped extends Key
      ? never
      : Stripped extends keyof T
        ? Key
        : never
    : never
}[keyof T]

export type Client<T extends object, Prefix extends string = ''> = [
  DuplicateKeys<T, Prefix>,
] extends [never]
  ? ClientOf<ClientRoutes<T, Prefix>>
  : { __duplicateRouteKey: DuplicateKeys<T, Prefix> }

function normalizeHost(host: string) {
  return host.replace(/\/+$/, '')
}

function encodeSegment(value: unknown) {
  return encodeURIComponent(String(value))
}

function resolvePath(path: string, params: RequestArgs['params']) {
  if (!params) return path

  return path.replace(/([:*])(\w+)/g, (token, kind: string, name: string) => {
    const value = params[name]
    if (value === undefined || value === null) return token

    if (kind === '*') {
      const segments = Array.isArray(value) ? value : [value]
      return segments.map(encodeSegment).join('/')
    }

    return encodeSegment(value)
  })
}

function serializeQuery(query: RequestArgs['query']) {
  if (!query) return ''

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue
        search.append(key, String(item))
      }
    } else {
      search.append(key, String(value))
    }
  }

  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
}

function mergeHeaders(...sources: (HeadersInput | undefined)[]) {
  const result = new Headers()

  for (const source of sources) {
    if (!source) continue

    if (source instanceof Headers) {
      source.forEach((value, key) => result.set(key, value))
      continue
    }

    if (Array.isArray(source)) {
      for (const [key, value] of source) result.set(key, value)
      continue
    }

    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null) continue
      result.set(key, Array.isArray(value) ? value.join(', ') : String(value))
    }
  }

  return result
}

function createSignal(signal: AbortSignal | undefined, timeout: number | undefined) {
  if (timeout === undefined) return signal

  const timeoutSignal = AbortSignal.timeout(timeout)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined

  const text = await response.text()
  if (!text) return undefined

  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('json') ? JSON.parse(text) : text
}

async function request(
  host: string,
  method: string,
  path: string,
  args: RequestArgs,
  options: RequestOptions,
  config: ClientOptions,
): Promise<unknown> {
  const headers = mergeHeaders(
    typeof config.headers === 'function' ? await config.headers() : config.headers,
    args.headers as HeadersInput | undefined,
    options.headers,
  )

  const body = args.body === undefined || args.body === null ? undefined : JSON.stringify(args.body)
  if (body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const input = {
    url: `${normalizeHost(host)}${resolvePath(path, args.params)}${serializeQuery(args.query)}`,
    init: {
      ...config.init,
      ...options.init,
      method: method === 'all' ? 'GET' : method.toUpperCase(),
      headers,
      body,
      signal: createSignal(options.signal, options.timeout ?? config.timeout),
    },
  }

  await config.onRequest?.(input)

  const response = await (config.fetch ?? fetch)(input.url, input.init)
  await config.onResponse?.(response)

  const payload = await parseBody(response)
  const success = config.isSuccess
    ? config.isSuccess(response.status)
    : response.status >= 200 && response.status < 300

  if (!success) {
    const error = new ClientError(response.status, payload, response)
    await config.onError?.(error)
    if (options.throwOnError ?? config.throwOnError ?? true) throw error
  }

  return payload
}

function isRequestOptions(value: unknown): value is RequestOptions {
  if (typeof value !== 'object' || value === null) return false

  return 'signal' in value || 'timeout' in value || 'init' in value || 'throwOnError' in value
}

function splitArgs(rest: unknown[]) {
  if (rest.length > 1) {
    return {
      args: (rest[0] ?? {}) as RequestArgs,
      options: (rest[1] ?? {}) as RequestOptions,
    }
  }

  const [value] = rest
  if (isRequestOptions(value)) return { args: {}, options: value }

  return { args: (value ?? {}) as RequestArgs, options: {} }
}

export function createClient<Host extends string>(host: Host, config: ClientOptions = {}) {
  return {
    as: <T extends object>(): Client<T, HostPrefix<Host>> => {
      return new Proxy({} as Client<T, HostPrefix<Host>>, {
        get(target, property, receiver) {
          if (typeof property !== 'string' || !METHODS.has(property)) {
            return Reflect.get(target, property, receiver)
          }

          return (path: string, ...rest: unknown[]) => {
            const { args, options } = splitArgs(rest)
            return request(host, property, path, args, options, config)
          }
        },
      })
    },
  }
}
