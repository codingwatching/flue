import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		exclude: ['test/vite-cloudflare-build.test.ts', 'test/packed-copy-release.test.ts'],
	},
});
