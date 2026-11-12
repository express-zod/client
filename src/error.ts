export class ClientError<Status extends number = number, Body = unknown> extends Error {
  readonly status: Status
  readonly body: Body
  readonly response?: Response

  constructor(status: Status, body: Body, response?: Response) {
    super(`Request failed with status ${status}`)
    this.name = 'ClientError'
    this.status = status
    this.body = body
    this.response = response
  }
}
