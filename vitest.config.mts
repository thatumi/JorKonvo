import { defineConfig } from "vitest/config";

/**
 * Root unit-test config. Tests live in `test/unit/**` and exercise the
 * framework-agnostic logic in `packages/matrix-core` plus the pure helpers
 * in `apps/web/src/lib` - no browser, no homeserver, fully deterministic.
 *
 * The end-to-end suite (real Chromium against a throwaway Synapse) is a
 * separate Playwright project under `e2e/` and is NOT run by `vitest`.
 */
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.{ts,tsx}"],
    // Default node; the few files that touch localStorage / document opt
    // into jsdom with a `// @vitest-environment jsdom` header.
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "test/coverage",
      include: ["packages/matrix-core/src/**/*.ts", "apps/web/src/lib/**/*.ts"],
    },
  },
  resolve: {
    // matrix-core's source uses NodeNext-style `./foo.js` specifiers that
    // actually point at `./foo.ts`; Vite resolves those transparently, but
    // be explicit about the extension order for clarity.
    extensions: [".ts", ".js", ".json"],
  },
});
