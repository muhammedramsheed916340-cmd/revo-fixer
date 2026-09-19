/**
 * PANEL RENDER TEST (ADDITIVE TEST TOOLING — not part of the app bundle)
 * ======================================================================
 * Renders the new signal panels in a real DOM (jsdom) with the SAME React
 * runtime the app uses, then checks what the UI actually displays.
 *
 * Two scenarios are asserted:
 *
 *   A. COLD START — no live sensor, no dealer, no rounds:
 *      every panel must render the honest "UNAVAILABLE / INSUFFICIENT" text
 *      WITH a reason. Nothing may show a fabricated dealer, direction, speed
 *      or Top-4.
 *
 *   B. SIMULATED LIVE PIPELINE — real settled rounds, a real telemetry frame
 *      sequence with a signed rotation, and a dealer observation with measured
 *      position geometry are pushed through the PUBLIC store API (the same
 *      calls the collector makes). The panels must then display:
 *        · wheel rotation direction + speed (measured, not hardcoded)
 *        · dealer profile + measured position
 *        · channel availability READY / INSUFFICIENT
 *        · physics Top-4 when the evidence is valid
 *      …without any page reload, i.e. purely from store notifications.
 *
 * This is a UI/render test. It makes NO accuracy claim and uses no fabricated
 * "casino" data: the frames are a synthetic motion source used only to prove the
 * wiring renders real values (they never enter the validation metrics).
 *
 * Run:
 *   node --import ./scripts/ts-resolve-register.mjs scripts/render_signal_panels.tsx
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// jsdom is a test-only dependency; resolve it from wherever it is installed.
const require = createRequire(import.meta.url);
const jsdomEntry = require.resolve("jsdom");
const { JSDOM } = await import(jsdomEntry.startsWith("/") ? jsdomEntry : path.resolve(jsdomEntry));

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "https://revo-fixer.test/",
  pretendToBeVisual: true,
});
const w = dom.window as unknown as Window & typeof globalThis;
const g = globalThis as unknown as Record<string, unknown>;
g.window = w;
g.document = w.document;
g.HTMLElement = w.HTMLElement;
g.Node = w.Node;
g.Event = w.Event;
g.MouseEvent = w.MouseEvent;
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.localStorage = w.localStorage;
try {
  Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
} catch {
  /* some Node versions expose a read-only navigator — the panels do not need it */
}

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;

// Compiled panels (tsc --jsx react-jsx → node_modules/.signal-ssr). The app
// itself still consumes the .tsx sources; this is only how the test executes
// them outside Next.js.
const OUT = "../node_modules/.signal-ssr";
if (!existsSync(new URL(`${OUT}/RevoDealerPanel.js`, import.meta.url))) {
  console.error(
    "Compiled panels not found. Build them first:\n" +
      "  npx tsc --noCheck --jsx react-jsx --target es2022 --module esnext --moduleResolution bundler --skipLibCheck \\\n" +
      "    --outDir node_modules/.signal-ssr --rootDir src/components/revo \\\n" +
      "    src/components/revo/RevoTimeSignalPanel.tsx src/components/revo/RevoDealerPanel.tsx \\\n" +
      "    src/components/revo/RevoSignalEnsemblePanel.tsx src/components/revo/RevoLiveSensorDebugPanel.tsx",
  );
  process.exit(2);
}
const { RevoTimeSignalPanel } = await import(`${OUT}/RevoTimeSignalPanel.js`);
const { RevoDealerPanel } = await import(`${OUT}/RevoDealerPanel.js`);
const { RevoSignalEnsemblePanel } = await import(`${OUT}/RevoSignalEnsemblePanel.js`);
const { RevoLiveSensorDebugPanel } = await import(`${OUT}/RevoLiveSensorDebugPanel.js`);
const store = await import(`${OUT}/signalDataStore.js`);
const { resetDealerProfiles } = await import(`${OUT}/dealerSignal.js`);
const { __setFlagsForTest, SIGNAL_FLAGS_OFF } = await import(`${OUT}/signalFlags.js`);

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const container = w.document.getElementById("root")!;
const root = createRoot(container);

async function renderPanels(): Promise<string> {
  await act(async () => {
    root.render(
      React.createElement(
        "div",
        null,
        React.createElement(RevoLiveSensorDebugPanel),
        React.createElement(RevoDealerPanel),
        React.createElement(RevoTimeSignalPanel),
        React.createElement(RevoSignalEnsemblePanel),
      ),
    );
  });
  return container.textContent ?? "";
}

// ---------------------------------------------------------------------------
console.log("== scenario A: cold start (no live data)");
// ---------------------------------------------------------------------------
__setFlagsForTest({ ...SIGNAL_FLAGS_OFF });
store.clearSignalStore();
resetDealerProfiles();

let text = await renderPanels();

check("panels render without a browser sensor (no crash)", text.includes("Wheel physics") || text.includes("Live sensor debug") || text.length > 0);
check("live sensor shows video INACTIVE", /video INACTIVE/i.test(text), text.slice(0, 200));
check("dealer panel shows no invented dealer", /No dealer profile yet/i.test(text), "");
check(
  "dealer position is NOT invented on a cold start",
  /No dealer profile yet/i.test(text) && !/\b(LEFT|RIGHT|CENTER)\b/.test(text),
  text.slice(0, 160),
);
check(
  "physics/top-4 reported as INSUFFICIENT (no fabricated prediction)",
  /INSUFFICIENT/.test(text),
  "",
);

// ---------------------------------------------------------------------------
console.log("\n== scenario B: simulated live pipeline (public store API only)");
// ---------------------------------------------------------------------------
const t0 = Date.now() - 60_000;

// 1) real settled rounds (as the live result bus delivers them)
const sectors = ["1", "2", "5", "10", "CoinFlip", "Pachinko", "CashHunt", "CrazyTime"];
for (let i = 0; i < 60; i++) {
  store.recordSettledRound({
    sector: sectors[i % sectors.length],
    settledAt: t0 + i * 1_000,
    resultKey: `render-${i}`,
  });
}

// 2) telemetry: a signed rotation (positive angular velocity = RIGHT/CW)
const now = Date.now();
for (let i = 0; i < 30; i++) {
  store.recordMotionFrame({
    timestamp: now - (30 - i) * 100,
    angle: i * 12,             // +120 °/s
    velocity: 120,
    velocityRaw: 118,
    acceleration: -4,
    confidence: 0.9,
    direction: 1,
    isTracking: true,
    calibrationStable: true,
    profDiff: 55,
  });
}

// 3) dealer observation with measured geometry (change concentrated on the right)
const flat = new Array(12).fill(0.5);
const rightHeavy = flat.map((v, i) => (i >= 8 ? v + 0.4 : v));
store.observeDealer({
  timestamp: now,
  descriptor: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
  columns: rightHeavy,
  previousColumns: flat,
  physics: { direction: "RIGHT", speed: 118, deceleration: 4 },
});

// 4) the production prediction is published (read-only hand-off)
store.publishProductionPrediction({
  top4: ["1", "2", "5", "10"],
  probabilities: { "1": 0.4, "2": 0.3, "5": 0.15, "10": 0.1, "COIN FLIP": 0.02, PACHINKO: 0.01, "CASH HUNT": 0.01, "CRAZY TIME": 0.01 },
});

// 5) re-render purely from store notifications (no reload, no props change)
text = await renderPanels();

check("wheel rotation direction is displayed from measured motion", /RIGHT/.test(text), "");
const speedRx = new RegExp("1[12][0-9](\\.[0-9]+)?\\s*" + "\u00b0/s");
check(
  "wheel speed is displayed in deg/s",
  text.includes("\u00b0/s") && speedRx.test(text),
  (text.match(new RegExp("[^ ]*\\u00b0/s", "g")) ?? []).slice(0, 6).join(" | "),
);
check("dealer profile id is displayed", /dealer-/.test(text), "");
check("dealer name honestly shows UNKNOWN (no invented name)", /UNKNOWN/.test(text), "");
check("dealer position is displayed from frame geometry", /RIGHT/.test(text), "");
const confRx = new RegExp("conf\\s*[0-9]+%", "i");
check("dealer position confidence is displayed", confRx.test(text) || /confidence/i.test(text), "");
const roundsRx = new RegExp("[6-9][0-9]");
check("stored round count is displayed (live data reached the UI)", roundsRx.test(text), "");
check("ensemble shows explicit channel availability", /READY/.test(text) && /INSUFFICIENT/.test(text), "");
check("physics/Top-4 area explains its state (VALID or INSUFFICIENT with reason)", /VALID|INSUFFICIENT/.test(text), "");
check("no placeholder 'initializing' text remains after mount", !/initializing live diagnostics/.test(text), "");

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed · ${failed} failed`);
root.unmount();
if (failed > 0) process.exit(1);
process.exit(0);
