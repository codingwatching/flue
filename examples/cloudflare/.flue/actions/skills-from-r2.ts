import type { ActionContext } from '@flue/runtime';
import {
	getDefaultWorkspace,
	getShellSandbox,
	hydrateFromBucket,
} from '../connectors/cloudflare-shell.ts';
import * as v from 'valibot';

export const triggers = { webhook: true };

interface Env {
	KNOWLEDGE_BASE: R2Bucket;
	LOADER: WorkerLoader;
}

const HYDRATION_SENTINEL = '/.hydrated-r2-v1';

export default async function ({ init, env }: ActionContext<unknown, Env>) {
	const workspace = getDefaultWorkspace();
	if (!(await workspace.exists(HYDRATION_SENTINEL))) {
		await hydrateFromBucket(workspace, env.KNOWLEDGE_BASE);
		await workspace.writeFile(HYDRATION_SENTINEL, new Date().toISOString());
	}
	const harness = await init({
		sandbox: getShellSandbox({ workspace, loader: env.LOADER }),
		model: 'cloudflare/@cf/moonshotai/kimi-k2.6',
		loadFromSandbox: true,
	});
	const session = await harness.session();
	const result = await session.skill('spam-filter', {
		args: { message: 'CONGRATS! You have won a free iPhone. Click here: http://bit.ly/xyz' },
		result: v.object({
			spam: v.boolean(),
			confidence: v.picklist(['low', 'medium', 'high']),
			reasoning: v.string(),
		}),
	});
	return result.data;
}
