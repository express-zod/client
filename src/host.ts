export type TrimTrailingSlash<Path extends string> = Path extends `${infer Rest}/`
  ? TrimTrailingSlash<Rest>
  : Path

export type StripScheme<Host extends string> = Host extends `${string}://${infer Rest}`
  ? Rest
  : Host

export type PathnameOf<Host extends string> =
  StripScheme<Host> extends `${string}/${infer Path}` ? `/${Path}` : '/'

export type HostPrefix<Host extends string> =
  TrimTrailingSlash<PathnameOf<Host>> extends '/' ? '' : TrimTrailingSlash<PathnameOf<Host>>

export type StripPrefix<Path extends string, Prefix extends string> = Prefix extends ''
  ? Path
  : Path extends `${Prefix}/${infer Rest}`
    ? `/${Rest}`
    : Path extends Prefix
      ? '/'
      : Path
