# Railway test deployment

## Objective

Run the backend-only MediCN test environment within Railway's five-service
free-trial limit. This topology combines the email, media, maps, and operations
consumers under one production supervisor while keeping the transactional
Outbox publisher isolated.

This is a test-environment consolidation. Independent downstream worker
services remain the preferred topology when the service limit no longer
applies.

## Build contract

Configure every source-backed Railway service with the repository root as its
root directory and use this exact build command:

```sh
npm run prisma:generate && npm run build:types && npm run build:api
```

The build produces the production JavaScript under `apps/api/dist`. None of the
Railway start commands use `ts-node`.

## Five-service topology

| # | Railway service | Kind | Start command |
|---|---|---|---|
| 1 | API | Repository service | `npm run start:api:prod` |
| 2 | PostgreSQL | Railway managed database | Managed by Railway |
| 3 | Redis | Railway managed database | Managed by Railway |
| 4 | Outbox worker | Repository service | `npm run worker:outbox:prod` |
| 5 | Downstream workers | Repository service | `npm run worker:all:prod` |

The downstream service contains exactly the email, media, maps, and operations
workers. It does not contain the Outbox worker. The supervisor starts each
compiled worker as a Node child process, forwards `SIGINT` and `SIGTERM`, waits
for all children to stop, and fails the service if any child exits
unexpectedly. It does not restart children; Railway owns service restarts.

## Railway service commands

Use the same build command shown above for the API, Outbox worker, and
downstream-worker services. Their exact start commands are:

```sh
# API service
npm run start:api:prod

# Outbox worker service
npm run worker:outbox:prod

# Combined email, media, maps, and operations service
npm run worker:all:prod
```

PostgreSQL and Redis are Railway managed services and do not have repository
build or start commands.

Set the source-backed services' `DATABASE_URL` and `REDIS_URL` through Railway
service references to the managed PostgreSQL and Redis services. Give each
service only the additional provider configuration needed by the code it runs.
Do not put credential values in build/start commands or deployment logs.

## Verification and boundaries

- The production commands must be run after the build command.
- Existing local `worker:email`, `worker:outbox`, `worker:media`,
  `worker:maps`, and `worker:operations` commands remain development commands.
- The supervisor inventory is an allowlist of compiled `.js` entry points.
- Any unexpected child exit terminates the other downstream workers and returns
  a non-zero status so Railway can restart the service.
- A Railway `SIGINT` or `SIGTERM` is forwarded to all children and a clean
  group shutdown returns status zero.
- No worker process or supervisor may log environment-variable or provider
  secret values.
