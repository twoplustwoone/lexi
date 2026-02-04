# Repository Guidelines

## Project Structure & Module Organization
- This is an npm workspace monorepo with three main workspaces:
  - `apps/api`: Cloudflare Worker API (`src/`), D1 migrations (`migrations/`), and Vitest suites (`tests/`).
  - `apps/web`: Preact + Vite frontend (`src/`), with Vitest and Playwright tests.
  - `packages/shared`: shared schemas/types/utilities used by API and web.
- Operational scripts live in `scripts/` (for example seeding and word-pool import). Supporting docs are in `docs/`.

## Build, Test, and Development Commands
- `npm run install:all` - install root + workspace dependencies.
- `npm run dev` - start local API and web development servers.
- `npm run build` - build API (Wrangler dry-run output) and web production bundle.
- `npm run lint` / `npm run typecheck` / `npm run test` - run checks across all workspaces.
- `npm run validate` - run lint + typecheck + test together (CI-equivalent gate).
- Workspace-specific examples:
  - `npm run dev --prefix apps/api`
  - `npm run dev --prefix apps/web`
  - `npm run db:migrate --prefix apps/api`

## Coding Style & Naming Conventions
- Language: TypeScript (strict mode enabled).
- Formatting: Prettier (`singleQuote: true`, `trailingComma: es5`, `printWidth: 100`).
- Linting: ESLint with `--max-warnings=0`; keep code warning-free.
- Use 2-space indentation and concise, typed functions.
- Naming patterns:
  - `PascalCase` for UI components (`apps/web/src/components`).
  - `camelCase` for variables/functions.
  - Migration files use ordered numeric prefixes (e.g. `0009_add_feature.sql`).
  - Tests use `*.test.ts`.

## Testing Guidelines
- Frameworks: Vitest (unit/integration), Playwright (web E2E).
- Run all tests with `npm run test`; run E2E via `npm run test:e2e --prefix apps/web`.
- Add/adjust tests for behavior changes, especially API routes, word selection, migrations, and settings/history flows.
- No fixed coverage threshold is enforced, but CI requires all checks to pass on PRs and pushes to `main`.

## Commit & Pull Request Guidelines
- Follow concise Conventional Commits, typically with scope:
  - `feat(api): ...`, `fix(web): ...`, `chore(scripts): ...`, `test(api): ...`
- Keep commits small and single-purpose; avoid mixing unrelated refactors.
- PRs should include: what changed, why, test evidence (commands run), and any migration/ops notes.
- For UI changes, attach screenshots or a short recording.

## Security & Configuration Tips
- Copy env templates (`apps/api/.dev.vars.example`, `apps/web/.env.example`) and never commit secrets.
- Use Wrangler secrets for production credentials.
- For D1 changes, validate with `--local` first, then run `--remote` intentionally.
