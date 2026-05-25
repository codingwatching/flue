# Imported Skill Example

This example shows two supported contracts:

- `with-imported-skill` imports `.flue/skills/review/SKILL.md` with `{ type: 'skill' }`. The import is a lightweight `SkillReference`; the complete skill directory, including `CHECKLIST.txt`, is packaged and made readable only when the skill is activated.
- `with-custom-bash` imports `Bash` and `InMemoryFs` directly from `just-bash` to customize the virtual sandbox. Because application source imports it directly, `just-bash` is declared in this application's dependencies.

Run the imported skill on Node with an Anthropic key:

```bash
pnpm exec flue run with-imported-skill --target node --env ../../.env
```

Run the deterministic custom-sandbox workflow on Node or Cloudflare local development:

```bash
pnpm exec flue run with-custom-bash --target node
pnpm exec flue dev --target cloudflare
```

Cloudflare builds and local development use the official Vite/workerd integration. The release integration tests install packed `@flue/runtime` and `@flue/cli` copies of this example and activate the packaged skill deterministically without provider credentials.

From the repository root, run the slow production-path integration gate with:

```bash
pnpm run test:integration
```
