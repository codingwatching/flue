import { describe, expect, it } from 'vitest';
import { NodePlugin } from '../src/lib/build-plugin-node.ts';
import type { BuildContext } from '../src/lib/types.ts';

describe('NodePlugin', () => {
	it('uses the default sqlite adapter when no db.ts is present', () => {
		const entry = new NodePlugin().generateEntryPoint(
			testBuildContext({
				agents: [{ name: 'assistant', filePath: '/fixture/agents/assistant.ts' }],
			}),
		);

		expect(entry).toContain('sqlite()');
		expect(entry).not.toContain('/fixture/db.ts');
	});

	it('wires a user-supplied db.ts instead of the default adapter', () => {
		const entry = new NodePlugin().generateEntryPoint(
			testBuildContext({
				agents: [{ name: 'assistant', filePath: '/fixture/agents/assistant.ts' }],
				dbEntry: '/fixture/db.ts',
			}),
		);

		expect(entry).toContain('"/fixture/db.ts"');
		expect(entry).not.toContain('sqlite()');
	});

	it('composes user app.ts when present and falls back to the default app', () => {
		const withApp = new NodePlugin().generateEntryPoint(
			testBuildContext({
				agents: [{ name: 'assistant', filePath: '/fixture/agents/assistant.ts' }],
				appEntry: '/fixture/app.ts',
			}),
		);

		expect(withApp).toContain('"/fixture/app.ts"');
		expect(withApp).not.toContain('createDefaultFlueApp()');

		const withoutApp = new NodePlugin().generateEntryPoint(
			testBuildContext({
				agents: [{ name: 'assistant', filePath: '/fixture/agents/assistant.ts' }],
			}),
		);

		expect(withoutApp).toContain('createDefaultFlueApp()');
		expect(withoutApp).not.toContain('/fixture/app.ts');
	});

	it('closes the persistence adapter on shutdown signals', () => {
		const entry = new NodePlugin().generateEntryPoint(
			testBuildContext({
				agents: [{ name: 'assistant', filePath: '/fixture/agents/assistant.ts' }],
				dbEntry: '/fixture/db.ts',
			}),
		);

		expect(entry).toContain('persistenceAdapter.close');
		expect(entry).toContain("process.on('SIGINT'");
		expect(entry).toContain("process.on('SIGTERM'");
	});
});

function testBuildContext(overrides: Partial<BuildContext> = {}): BuildContext {
	return {
		agents: [],
		workflows: [],
		root: '/fixture',
		output: '/fixture/dist',
		runtimeVersion: '0.0.0-test',
		...overrides,
	};
}
