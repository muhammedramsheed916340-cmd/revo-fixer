/**
 * Minimal ambient declaration for the `bun:test` module.
 *
 * `bun test` provides this module at RUNTIME (no install needed). This file
 * provides the TypeScript types so `tsc --noEmit` can type-check the test
 * files without requiring the full `@types/bun` package (which would augment
 * global `process` types and surface unrelated errors in demo/example files).
 *
 * Only the API surface used by the test suite is declared; matchers are typed
 * loosely (unknown) since the tests assert runtime behavior, not types.
 */
declare module "bun:test" {
  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toBeCloseTo(expected: number, digits?: number): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toBeUndefined(): void;
    toBeNull(): void;
    toBeDefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toContain(expected: unknown): void;
    toContainEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toMatch(expected: unknown): void;
    toThrow(expected?: unknown): void;
    toBeInstanceOf(expected: unknown): void;
    not: Matchers;
    resolves: Matchers;
    rejects: Matchers;
  }
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function describe(name: string, fn: () => void): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function expect<T>(actual: T): Matchers;
}
