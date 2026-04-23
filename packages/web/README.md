# packages/web

Warstwa web dla projektu `Soon`.

## Zakres v1

1. UI trackingów i szczegółów produktów.
2. Brak AI user-facing.
3. Integracja tylko z kontraktami `packages/shared` i API `packages/api`.

## Smoke

1. `npm run smoke:e2e` — web client -> API end-to-end.

## Vite + TypeScript

1. `npm run web:dev` — start web app in Vite dev server.
2. `npm run web:typecheck` — TypeScript check (`tsc --noEmit`).
3. `npm run web:build` — production build to `packages/web/dist`.
