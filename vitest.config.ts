import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  esbuild: {
    // Use React 17+ automatic JSX runtime so test files don't have to
    // `import * as React from 'react'` to use JSX. tsconfig.json sets
    // `jsx: preserve` for Next, but Vitest transforms via esbuild and
    // needs an explicit choice here.
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'tests/**/*.test.ts',
    ],
    // Spread configDefaults.exclude so we inherit Vitest's built-in exclusions
    // (node_modules, dist, coverage, .idea, .git, .cache) instead of overriding them.
    // Adding our own repo-specific exclusions on top.
    exclude: [...configDefaults.exclude, '.next', '.worktrees', 'scripts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
