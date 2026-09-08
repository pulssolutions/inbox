export class ValidationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ValidationError'
    this.code = code
  }
}

export class PermissionError extends Error {
  constructor(code, message) {
    super(message ?? code)
    this.name = 'PermissionError'
    this.code = code
  }
}

export class NotFoundError extends Error {
  constructor(code, message) {
    super(message ?? code)
    this.name = 'NotFoundError'
    this.code = code
  }
}

export class ConflictError extends Error {
  constructor(code, message) {
    super(message ?? code)
    this.name = 'ConflictError'
    this.code = code
  }
}

const STATUS_BY_NAME = {
  ValidationError: 400,
  PermissionError: 401,
  NotFoundError: 404,
  ConflictError: 409
}

export const errorToResponse = (err) => {
  const statusCode = STATUS_BY_NAME[err?.name] ?? 500
  const body =
    statusCode === 500
      ? { message: 'Internal error' }
      : { code: err.code ?? err.name, message: err.message }
  return { statusCode, body }
}
