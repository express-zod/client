import { ClientError } from './error.ts'
import type { HostPrefix, StripPrefix } from './host.ts'
import type { ArgsOf, ArgsTuple, MethodsOf, PathsOf, ResponseOf, RouteAt } from './types.ts'

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

type RequestArgs = {
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, unknown>
}

type ClientRoutes<T, Prefix extends string> = {
  [
    Key in keyof T as Key extends `${infer Method} ${infer Path}`
      ? `${Method} ${StripPrefix<Path, Prefix>}`
      : never
  ]: T[Key]
}

type ClientOf<Routes> = {
  [Method in MethodsOf<Routes>]: <Path extends PathsOf<Routes, Method>>(
    path: Path,
    ...args: ArgsTuple<ArgsOf<RouteAt<Routes, `${Method} ${Path}`>>>
  ) => Promise<ResponseOf<RouteAt<Routes, `${Method} ${Path}`>>>
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

function serializeHeaders(headers: RequestArgs['headers']) {
  const result = new Headers()
  if (!headers) return result

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue
    result.set(key, Array.isArray(value) ? value.join(', ') : String(value))
  }

  return result
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
  args: RequestArgs = {},
): Promise<unknown> {
  const headers = serializeHeaders(args.headers)
  const body = args.body === undefined || args.body === null ? undefined : JSON.stringify(args.body)

  if (body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const response = await fetch(
    `${normalizeHost(host)}${resolvePath(path, args.params)}${serializeQuery(args.query)}`,
    {
      method: method === 'all' ? 'GET' : method.toUpperCase(),
      headers,
      body,
    },
  )

  const payload = await parseBody(response)
  if (!response.ok) throw new ClientError(response.status, payload)

  return payload
}

export function createClient<Host extends string>(host: Host) {
  return {
    as: <T extends object>(): Client<T, HostPrefix<Host>> => {
      return new Proxy({} as Client<T, HostPrefix<Host>>, {
        get(target, property, receiver) {
          if (typeof property !== 'string' || !METHODS.has(property)) {
            return Reflect.get(target, property, receiver)
          }

          return (path: string, args?: RequestArgs) => request(host, property, path, args)
        },
      })
    },
  }
}
