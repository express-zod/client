import type { HostPrefix, StripPrefix } from './host.ts'
import type { ArgsOf, ArgsTuple, MethodsOf, PathsOf, ResponseOf, RouteAt } from './types.ts'

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

export function createClient<Host extends string>(host: Host) {
  return {
    as: <T extends object>(): Client<T, HostPrefix<Host>> => {
      void host
      return new Proxy({}, {}) as Client<T, HostPrefix<Host>>
    },
  }
}
