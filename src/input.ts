import { isStatus, type Backlog, type Status } from "./backlog.js"

export function record(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object")
  }
  return input as Record<string, unknown>
}

export function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`)
  }
  return value
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${key} must be a string`)
  return value
}

export function optionalNullableString(
  input: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = input[key]
  if (value === undefined || value === null || typeof value === "string") return value
  throw new Error(`${key} must be a string or null`)
}

export function optionalStatus(input: Record<string, unknown>, backlog: Backlog): Status | undefined {
  const value = input.status
  if (value === undefined) return undefined
  if (!isStatus(backlog, value)) throw new Error("status must identify a backlog category")
  return value
}

export function optionalPosition(input: Record<string, unknown>): number | undefined {
  const value = input.position
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error("position must be a non-negative integer")
  }
  return value
}
