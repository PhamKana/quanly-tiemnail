# nailby.ank Nail Manager

The repository is organized as a small monorepo so the web UI, API, and shared business contracts can evolve independently.

## Workspaces

- `apps/web`: React + Vite frontend, organized by product feature.
- `apps/api`: Express backend and operational scripts.
- `packages/shared`: framework-free TypeScript types and business policies used by both apps.
- `infra/firebase`: Firestore schema/rules and Firebase app configuration.
- `backups`: runtime data backup files consumed by the API.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run build
npm run test:salary
```

`npm run dev` starts the API, which mounts Vite in middleware mode and serves the web workspace. Production serves `dist/web` from `dist/server.cjs`.

See [docs/architecture.md](docs/architecture.md) before adding a feature.

