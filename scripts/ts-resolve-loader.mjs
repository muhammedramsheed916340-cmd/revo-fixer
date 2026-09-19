/**
 * NODE TS RESOLUTION LOADER (ADDITIVE TOOLING — not part of the app bundle)
 * =======================================================================
 * The repo's source files use extension-less relative imports (Next.js
 * resolves them). Plain Node ESM requires explicit extensions, so the
 * validation scripts register this resolve hook, which appends `.ts` /
 * `.tsx` / `/index.ts` when a relative specifier has no extension.
 *
 * Usage:
 *   node --import ./scripts/ts-resolve-register.mjs scripts/validate_signal_layers.ts
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(specifier);
  if (isRelative && !hasExtension && context.parentURL) {
    const parentPath = fileURLToPath(context.parentURL);
    const base = path.resolve(path.dirname(parentPath), specifier);
    for (const ext of [".ts", ".tsx", ".mts", ".js", ".mjs", path.join("index.ts")]) {
      const candidate = ext.startsWith("index") ? path.join(base, ext) : base + ext;
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
