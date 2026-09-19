/**
 * MINIMAL `bun:test` SHIM (ADDITIVE TEST TOOLING — not part of the app bundle)
 * ===========================================================================
 * The repository's existing test suites (tests/revo/*.test.ts) are written for
 * `bun test`. Bun is not installed in every environment, so this shim provides
 * the small subset of the `bun:test` API those suites use, letting the SAME
 * unmodified test files run under plain Node via the resolve hook in
 * `scripts/ts-resolve-loader.mjs`.
 *
 * Supported: test, it, describe, beforeAll, afterAll, beforeEach, afterEach,
 * expect(...) with toBe, toEqual, toBeCloseTo, toBeGreaterThan(OrEqual),
 * toBeLessThan(OrEqual), toContain, toHaveLength, toBeDefined, toBeUndefined,
 * toBeNull, toBeTruthy, toBeFalsy, toThrow, plus `.not`, `expect.any`,
 * `expect.arrayContaining`, `expect.objectContaining`, `expect.stringContaining`.
 *
 * Exit code is 1 when any test fails, exactly like bun test.
 */

const suites = [];
const results = { passed: 0, failed: 0, failures: [] };
let currentSuite = null;
const hooks = { beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] };
const pending = [];
let running = false;

function describe(name, fn) {
  const previous = currentSuite;
  currentSuite = previous ? `${previous} > ${name}` : name;
  try {
    fn();
  } finally {
    currentSuite = previous;
  }
}

function test(name, fn, timeout) {
  pending.push({ name: currentSuite ? `${currentSuite} > ${name}` : name, fn, timeout });
  scheduleRun();
}
const it = test;

function beforeAll(fn) {
  hooks.beforeAll.push(fn);
}
function afterAll(fn) {
  hooks.afterAll.push(fn);
}
function beforeEach(fn) {
  hooks.beforeEach.push(fn);
}
function afterEach(fn) {
  hooks.afterEach.push(fn);
}

function scheduleRun() {
  if (running) return;
  running = true;
  setTimeout(runAll, 0);
}

async function runAll() {
  for (const hook of hooks.beforeAll) await hook();
  for (const t of pending) {
    try {
      for (const hook of hooks.beforeEach) await hook();
      await t.fn();
      for (const hook of hooks.afterEach) await hook();
      results.passed++;
    } catch (err) {
      results.failed++;
      results.failures.push({ name: t.name, error: err });
    }
  }
  for (const hook of hooks.afterAll) await hook();

  const file = process.argv[1] ?? "test";
  if (results.failed > 0) {
    console.error(`\n${file}: ${results.passed} pass, ${results.failed} fail`);
    for (const f of results.failures) {
      console.error(`  ✗ ${f.name}`);
      console.error(`    ${f.error?.message ?? f.error}`);
      const stack = String(f.error?.stack ?? "").split("\n").slice(1, 4).join("\n");
      if (stack) console.error(stack.replace(/^/gm, "    "));
    }
    process.exit(1);
  }
  console.log(`${file}: ${results.passed} pass, 0 fail`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// expect()
// ---------------------------------------------------------------------------

function format(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(format).join(", ")}]`;
  if (value instanceof Date) return `Date(${value.toISOString()})`;
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    // asymmetric matchers
    if (typeof b.asymmetricMatch === "function") return b.asymmetricMatch(a);
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function makeMatchers(received, negated) {
  const fail = (message) => {
    throw new Error(negated ? `expected (NOT) ${message}` : `expected ${message}`);
  };
  const pass = (ok, message) => {
    if (negated ? ok : !ok) fail(message);
  };
  return {
    toBe(expected) {
      pass(Object.is(received, expected), `${format(received)} to be ${format(expected)}`);
    },
    toEqual(expected) {
      pass(deepEqual(received, expected), `${format(received)} to equal ${format(expected)}`);
    },
    toBeCloseTo(expected, precision = 2) {
      const tolerance = Math.pow(10, -precision) / 2;
      pass(
        typeof received === "number" && Math.abs(received - expected) <= tolerance,
        `${format(received)} to be close to ${format(expected)} (±${tolerance})`,
      );
    },
    toBeGreaterThan(expected) {
      pass(received > expected, `${format(received)} to be > ${format(expected)}`);
    },
    toBeGreaterThanOrEqual(expected) {
      pass(received >= expected, `${format(received)} to be >= ${format(expected)}`);
    },
    toBeLessThan(expected) {
      pass(received < expected, `${format(received)} to be < ${format(expected)}`);
    },
    toBeLessThanOrEqual(expected) {
      pass(received <= expected, `${format(received)} to be <= ${format(expected)}`);
    },
    toContain(expected) {
      const ok = typeof received === "string" ? received.includes(expected) : Array.isArray(received) && received.some((v) => deepEqual(v, expected));
      pass(ok, `${format(received)} to contain ${format(expected)}`);
    },
    toHaveLength(expected) {
      pass(received != null && received.length === expected, `${format(received)} to have length ${expected}`);
    },
    toBeDefined() {
      pass(received !== undefined, `${format(received)} to be defined`);
    },
    toBeUndefined() {
      pass(received === undefined, `${format(received)} to be undefined`);
    },
    toBeNull() {
      pass(received === null, `${format(received)} to be null`);
    },
    toBeTruthy() {
      pass(Boolean(received), `${format(received)} to be truthy`);
    },
    toBeFalsy() {
      pass(!received, `${format(received)} to be falsy`);
    },
    toThrow(matcher) {
      let threw = false;
      let message = "";
      try {
        received();
      } catch (err) {
        threw = true;
        message = String(err?.message ?? err);
      }
      const ok = threw && (matcher === undefined || (matcher instanceof RegExp ? matcher.test(message) : message.includes(String(matcher))));
      pass(ok, `the function to throw${matcher ? ` ${matcher}` : ""} (${threw ? `threw "${message}"` : "did not throw"})`);
    },
    toBeNaN() {
      pass(Number.isNaN(received), `${format(received)} to be NaN`);
    },
  };
}

function expect(received) {
  const matchers = makeMatchers(received, false);
  matchers.not = makeMatchers(received, true);
  return matchers;
}

expect.any = (ctor) => ({
  asymmetricMatch: (value) =>
    ctor === Number ? typeof value === "number" : ctor === String ? typeof value === "string" : ctor === Boolean ? typeof value === "boolean" : ctor === Function ? typeof value === "function" : value instanceof ctor,
});
expect.arrayContaining = (items) => ({
  asymmetricMatch: (value) => Array.isArray(value) && items.every((i) => value.some((v) => deepEqual(v, i))),
});
expect.objectContaining = (shape) => ({
  asymmetricMatch: (value) => value && typeof value === "object" && Object.entries(shape).every(([k, v]) => deepEqual(value[k], v)),
});
expect.stringContaining = (text) => ({
  asymmetricMatch: (value) => typeof value === "string" && value.includes(text),
});

export { test, it, describe, beforeAll, afterAll, beforeEach, afterEach, expect };
export default { test, it, describe, beforeAll, afterAll, beforeEach, afterEach, expect };
