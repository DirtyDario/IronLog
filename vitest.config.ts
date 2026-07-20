import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/tests/setup.ts'],
        alias: {
            '$lib': resolve(__dirname, 'src/lib'),
            '$app/stores': resolve(__dirname, 'src/tests/mocks/app-stores.ts'),
            '$app/navigation': resolve(__dirname, 'src/tests/mocks/app-navigation.ts'),
            '$env/static/public': resolve(__dirname, 'src/tests/mocks/env-static-public.ts'),
        }
    }
});
