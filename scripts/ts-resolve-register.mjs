/**
 * Registers the extension-less TS resolver used by the validation scripts.
 * See scripts/ts-resolve-loader.mjs for the rationale.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(new URL("./ts-resolve-loader.mjs", import.meta.url), pathToFileURL(import.meta.url));
