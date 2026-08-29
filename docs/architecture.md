# Architecture

## Dependency direction

```text
apps/web  ──────┐
                ├──> packages/shared
apps/api  ──────┘

apps/web -> HTTP API -> apps/api -> Firestore / payment providers
```

Shared code must not import React, Express, Firebase, browser APIs, or Node-only APIs.

## Frontend conventions

Frontend source is feature-oriented:

```text
apps/web/src/features/<feature>/
├── components/
├── hooks/
├── api/
├── models/
└── index.ts
```

A feature owns its screens and feature-specific components. Reusable visual primitives belong in `src/shared/components`; browser infrastructure belongs in `src/shared/lib`.

Do not add new business logic to `app/App.tsx`. New tabs should be implemented as feature entry components and imported by the application shell.

## Backend conventions

Backend modules use the following boundary:

```text
modules/<feature>/
├── <feature>.routes.ts
├── <feature>.controller.ts
├── <feature>.service.ts
├── <feature>.repository.ts
├── <feature>.schema.ts
└── <feature>.test.ts
```

- Routes apply authentication and role middleware.
- Controllers translate HTTP input/output only.
- Services own business rules and transaction orchestration.
- Repositories are the only module layer that reads or writes Firestore.
- Schemas validate every external input.
- Provider adapters isolate SePay, PayPal, web push, and future integrations.

The current `app.ts` still contains legacy routes. Move one complete feature at a time; do not create forwarding wrappers that leave logic duplicated.

## Financial invariants

Checkout, wallet balance, discount snapshots, commission snapshots, cancellation, and payroll settlement must remain server-authoritative and transactional. A frontend preview is never the final financial calculation.

When adding a payment provider, implement it under `modules/payments/providers` and keep appointment settlement in the checkout service.

## Migration rule

Structural moves must preserve API paths and Firestore document shapes. Schema changes require a migration script, backup, and rollback plan.

