
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        setupFiles: [],
        deps: {
            optimizer: {
                web: {
                    include: ['cloudflare:workers']
                }
            }
        }
    },
    resolve: {
        alias: {
            'cloudflare:workers': './src/__mocks__/cloudflare-workers.ts'
        }
    }
});
