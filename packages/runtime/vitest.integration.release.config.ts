import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/packed-copy-release.test.ts'],
	},
});
