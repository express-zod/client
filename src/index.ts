export interface Greeting {
  name: string
}

export function greet({ name }: Greeting): string {
  return `Hello, ${name}!`
}
