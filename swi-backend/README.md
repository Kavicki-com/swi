# swi-backend — API (NestJS + Prisma + Postgres)

Backend conteinerizado do SWI. Loop local: `docker compose up` (API :3000,
MailHog :8025, Postgres :5432). Design: `../docs/plans/2026-07-01-swi-backend-container-pivot-design.md`.

`amplify/` é **referência read-only** do backend Amplify anterior (não buildado,
excluído do tsconfig) — removido quando a migração dos domínios terminar.
