import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { createServer } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const exampleRoot = path.join(repositoryRoot, 'examples', 'imported-skill');
const runtimeRoot = path.join(repositoryRoot, 'packages', 'runtime');
const cliRoot = path.join(repositoryRoot, 'packages', 'cli');
let testRoot: string;
let runtimeTarball: string;
let cliTarball: string;

beforeAll(() => {
	testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flue-packed-copy-release-'));
	const tarballs = path.join(testRoot, 'tarballs');
	fs.mkdirSync(tarballs);
	execFileSync('pnpm', ['pack', '--pack-destination', tarballs], { cwd: runtimeRoot, stdio: 'pipe' });
	execFileSync('pnpm', ['pack', '--pack-destination', tarballs], { cwd: cliRoot, stdio: 'pipe' });
	runtimeTarball = path.join(tarballs, requiredTarball(tarballs, 'flue-runtime-'));
	cliTarball = path.join(tarballs, requiredTarball(tarballs, 'flue-cli-'));
}, 120000);

afterAll(() => {
	if (testRoot) fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('packed example release shape', () => {
	it('runs the imported skill example on Node and Cloudflare without application just-bash', async () => {
		const root = createPackedExample('default-sandbox', false);
		writeDeterministicSkillWorkflow(root);
		fs.writeFileSync(path.join(root, '.env'), 'RELEASE_MARKER=packed-node-env\n');
		installFixture(root);

		const nodeOutput = runFlue(root, ['run', 'with-imported-skill', '--target', 'node', '--env', '.env']);
		expect(nodeOutput).toContain('Confirm the answer is direct, accurate, and complete.');
		expect(nodeOutput).toContain('packed-node-env');

		runFlue(root, ['build', '--target', 'cloudflare']);
		const response = await runCloudflareWorkflow(root, 'with-imported-skill');
		expect(response).toMatchObject({ result: { text: 'Confirm the answer is direct, accurate, and complete.\n', hasBody: false } });
	}, 240000);

	it('runs authored direct just-bash customization when declared by the application', async () => {
		const root = createPackedExample('custom-bash', true);
		installFixture(root);
		runFlue(root, ['build', '--target', 'cloudflare']);

		const response = await runCloudflareWorkflow(root, 'with-custom-bash');
		expect(response).toMatchObject({ result: { text: 'custom bash succeeded' } });
	}, 240000);
});

function createPackedExample(name: string, keepCustomBash: boolean): string {
	const root = path.join(testRoot, name);
	fs.cpSync(exampleRoot, root, {
		recursive: true,
		filter: (source) => {
			const basename = path.basename(source);
			return !['node_modules', 'dist', '.flue-vite', '.flue-vite.wrangler.jsonc', '.wrangler'].includes(basename) && !basename.startsWith('dist-');
		},
	});
	const packagePath = path.join(root, 'package.json');
	const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
		dependencies: Record<string, string>;
		devDependencies: Record<string, string>;
	};
	packageJson.dependencies['@flue/runtime'] = `file:${runtimeTarball}`;
	packageJson.devDependencies['@flue/cli'] = `file:${cliTarball}`;
	if (keepCustomBash) {
		fs.rmSync(path.join(root, '.flue', 'workflows', 'with-imported-skill.ts'));
	} else {
		delete packageJson.dependencies['just-bash'];
		packageJson.dependencies['@earendil-works/pi-ai'] = '*';
		fs.rmSync(path.join(root, '.flue', 'workflows', 'with-custom-bash.ts'));
	}
	fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, '\t')}\n`);
	fs.writeFileSync(
		path.join(root, 'pnpm-workspace.yaml'),
		`packages: []\noverrides:\n  '@flue/runtime': 'file:${runtimeTarball}'\nallowBuilds:\n  '@google/genai': false\n  '@mongodb-js/zstd': false\n  core-js-pure: false\n  esbuild: false\n  node-liblzma: false\n  protobufjs: false\n  sharp: false\n  workerd: false\n`,
	);
	return root;
}

function writeDeterministicSkillWorkflow(root: string): void {
	fs.writeFileSync(
		path.join(root, '.flue', 'workflows', 'with-imported-skill.ts'),
		`import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from '@earendil-works/pi-ai';\nimport { createAgent, http, type FlueContext } from '@flue/runtime';\nimport { registerProvider } from '@flue/runtime/app';\nimport review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport const channels = [http()];\nconst agent = createAgent(() => ({ model: 'fixture/reader', skills: [review] }));\nexport async function run({ init }: FlueContext) { const faux = registerFauxProvider({ api: 'fixture-skill-api', provider: 'fixture' }); registerProvider('fixture', { api: faux.api, baseUrl: 'https://fixture.invalid' }); faux.setResponses([fauxAssistantMessage(fauxToolCall('read', { path: '/.flue/packaged-skills/' + encodeURIComponent(review.id) + '/CHECKLIST.txt' }), { stopReason: 'toolUse' }), (context) => { const toolResult = context.messages[context.messages.length - 1]; const content = toolResult?.role === 'toolResult' && toolResult.content[0]?.type === 'text' ? toolResult.content[0].text : 'missing packaged content'; return fauxAssistantMessage(fauxText(content)); }]); try { const harness = await init(agent); const session = await harness.session(); const result = await session.skill(review); return { text: result.text, marker: typeof process === 'undefined' ? undefined : process.env.RELEASE_MARKER, hasBody: 'body' in review }; } finally { faux.unregister(); } }\n`,
	);
}

function installFixture(root: string): void {
	execFileSync('pnpm', ['install'], { cwd: root, stdio: 'inherit', timeout: 120000 });
	const appResolverPath = path.join(root, '__resolve-runtime.mjs');
	const cliResolverPath = path.join(root, 'node_modules', '@flue', 'cli', '__resolve-runtime.mjs');
	const resolveRuntimeScript = "import { realpathSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; console.log(realpathSync(fileURLToPath(import.meta.resolve('@flue/runtime'))));\n";
	fs.writeFileSync(appResolverPath, resolveRuntimeScript);
	fs.writeFileSync(cliResolverPath, resolveRuntimeScript);
	const directRuntime = execFileSync('node', [appResolverPath], { cwd: root, encoding: 'utf8' }).trim();
	const cliRuntime = execFileSync('node', [cliResolverPath], { cwd: root, encoding: 'utf8' }).trim();
	expect(directRuntime).toBe(cliRuntime);
	expect(directRuntime).toContain('@flue+runtime@file+');
}

function runFlue(root: string, args: string[]): string {
	return execFileSync('pnpm', ['exec', 'flue', ...args], { cwd: root, encoding: 'utf8', timeout: 120000 });
}

async function runCloudflareWorkflow(root: string, workflow: string): Promise<Record<string, unknown>> {
	const port = await availablePort();
	const child = spawn('pnpm', ['exec', 'flue', 'dev', '--target', 'cloudflare', '--port', String(port)], {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let output = '';
	child.stdout?.on('data', (chunk) => {
		output += String(chunk);
	});
	child.stderr?.on('data', (chunk) => {
		output += String(chunk);
	});
	try {
		const deadline = Date.now() + 60000;
		while (Date.now() < deadline) {
			if (child.exitCode !== null) throw new Error(`Cloudflare dev server exited early.\n${output}`);
			try {
				const response = await fetch(`http://127.0.0.1:${port}/workflows/${workflow}?wait=result`, { method: 'POST' });
				if (!response.ok) throw new Error(`Cloudflare workflow failed with ${response.status}: ${await response.text()}\n${output}`);
				return (await response.json()) as Record<string, unknown>;
			} catch (error) {
				if (error instanceof Error && error.message.startsWith('Cloudflare workflow failed')) throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		throw new Error(`Timed out waiting for Cloudflare workflow.\n${output}`);
	} finally {
		await terminateChild(child);
	}
}

async function terminateChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill('SIGTERM');
	const exited = await Promise.race([
		new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
	]);
	if (exited || child.exitCode !== null || child.signalCode !== null) return;
	child.kill('SIGKILL');
	await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

function requiredTarball(directory: string, prefix: string): string {
	const tarball = fs.readdirSync(directory).find((filename) => filename.startsWith(prefix) && filename.endsWith('.tgz'));
	if (!tarball) throw new Error(`Missing packed tarball with prefix ${prefix}.`);
	return tarball;
}

async function availablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close();
				reject(new Error('Failed to select an available port.'));
				return;
			}
			server.close(() => resolve(address.port));
		});
	});
}
