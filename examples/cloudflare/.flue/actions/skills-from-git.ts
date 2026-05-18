import type { ActionContext } from '@flue/runtime';
import { WorkspaceFileSystem } from '@cloudflare/shell';
import { createGit } from '@cloudflare/shell/git';
import { getDefaultWorkspace, getShellSandbox } from '../connectors/cloudflare-shell.ts';

export const triggers = { webhook: true };

interface Env {
	LOADER: WorkerLoader;
}

const HYDRATION_SENTINEL = '/.hydrated-git-v1';
const TARGET_REPO = 'https://github.com/FredKSchott/vinext-starter';
const CLONE_DIR = '/repo';

export default async function ({ init, env }: ActionContext<unknown, Env>) {
	const workspace = getDefaultWorkspace();
	if (!(await workspace.exists(HYDRATION_SENTINEL))) {
		const git = createGit(new WorkspaceFileSystem(workspace));
		await git.clone({ url: TARGET_REPO, dir: CLONE_DIR, singleBranch: true, depth: 1 });
		await workspace.writeFile(HYDRATION_SENTINEL, new Date().toISOString());
	}
	const harness = await init({
		sandbox: getShellSandbox({ workspace, loader: env.LOADER }),
		model: 'cloudflare/@cf/moonshotai/kimi-k2.6',
		cwd: CLONE_DIR,
		loadFromSandbox: true,
	});
	const session = await harness.session();
	const { text } = await session.prompt(
		`Use the code tool to list every top-level file and directory inside ${CLONE_DIR}, then briefly describe what this project is.`,
	);
	return { repo: TARGET_REPO, summary: text };
}
