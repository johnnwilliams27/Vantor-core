import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
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
