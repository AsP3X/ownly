# Getting started

← [Back to main README](../README.md) · [Documentation index](./README.md)

Get Ownly running with Docker Compose on a developer machine.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2
- [Git](https://git-scm.com/downloads) with **submodule** support

## First-time install

```bash
git clone --recurse-submodules <repository-url>
cd ownly
docker compose up --build
```

Open **http://localhost:8080**.

| Service | URL (local Compose) |
|---------|---------------------|
| Web UI | http://localhost:8080 |
| API | http://localhost:3000/api/v1 |
| Nebular OS | http://localhost:9000 |
| PostgreSQL | `localhost:5432` (`ownly` / dev password in `docker-compose.yml`) |

No `.env` file is required for **local Docker**. Without one, Compose uses the committed development `SETUP_TOKEN`:

`ownly-compose-local-dev-setup-token-not-for-production-use`

After `./init-env.sh` (or `docker compose --profile init run --rm init-env`), paste the generated `SETUP_TOKEN` from `.env` — Compose now interpolates that value into the API. The API also prints the live token on first boot while setup is still open.

For production secrets and hardening, see [Configuration](./configuration.md) and [Secure deployment](./secure-deployment.md).

## First-run wizard

The wizard asks for **SETUP_TOKEN** first. Use the compose-dev value above, or the token from `.env` / the API log after init-env. Pasting the whole `SETUP_TOKEN=...` line is fine.

On first launch the onboarding flow at `/setup` then configures:

1. **Admin account** — root administrator  
2. **Instance settings** — name, public registration, account approval  
3. **Object storage** — bucket name and default per-user quota  
4. **PostgreSQL** — connection test before setup completes  

After setup you land in the drive UI: upload, browse, search, share, and admin tools.

## Stop the stack

Keep data volumes:

```bash
./scripts/compose-dev-down.sh
```

**Do not** run `docker compose down -v` unless you intend to wipe Postgres and blob volumes.

**Backup before upgrades or volume experiments:** [Backup and restore](./backup-restore.md).

## Clone without submodules?

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

An empty `nebular-os/` folder breaks the image build (`failed to read dockerfile`). Confirm:

```bash
# Unix / Git Bash
test -f nebular-os/Dockerfile && git submodule status

# Windows PowerShell
Test-Path .\nebular-os\Dockerfile
git submodule status
```

You should see `nebular-os/Dockerfile` on disk and `git submodule status` showing a commit hash (no leading `-` on the `nebular-os` line).

Install Git hooks (blocks accidental commits under the read-only submodule):

```bash
./scripts/install-git-hooks.sh
```

More on the submodule: [Nebular OS integration](./nebular-integration.md).

## Next steps

| Goal | Doc |
|------|-----|
| Environment variables | [Configuration](./configuration.md) |
| Production deploy | [Secure deployment](./secure-deployment.md) · [Configuration](./configuration.md) |
| Develop API/UI without full Compose rebuilds | [Local development](./local-development.md) |
| Full backup | [Backup and restore](./backup-restore.md) |
