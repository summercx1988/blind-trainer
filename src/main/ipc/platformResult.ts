import type { PlatformFailure, PlatformResult, UnknownRecord } from '../../types/ipc'

export const ok = <T>(data: T, meta?: UnknownRecord): PlatformResult<T> => {
  return {
    success: true,
    data,
    error: null,
    code: null,
    meta,
  }
}

export const fail = (code: string, message: string, details?: UnknownRecord, meta?: UnknownRecord): PlatformFailure => {
  return {
    success: false,
    data: null,
    error: {
      message,
      details,
    },
    code,
    meta,
  }
}

