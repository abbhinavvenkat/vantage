import { defineWorkspace } from 'vitest/config';
import { resolve } from 'node:path';

const sharedAlias = {
  '@': resolve(__dirname),
  '@/lib': resolve(__dirname, 'lib'),
  '@/app': resolve(__dirname, 'app'),
  '@/components': resolve(__dirname, 'components'),
  '@/tests': resolve(__dirname, 'tests'),
};

export default defineWorkspace([
  {
    resolve: { alias: sharedAlias },
    test: {
      name: 'unit',
      globals: true,
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
      setupFiles: ['tests/setup.ts'],
    },
  },
  {
    resolve: { alias: sharedAlias },
    test: {
      name: 'integration',
      globals: true,
      environment: 'node',
      include: ['tests/integration/**/*.test.ts'],
      setupFiles: ['tests/setup.auth.ts'],
    },
  },
]);
