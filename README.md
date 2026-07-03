# OpenConnector

[English](README.md) | [简体中文](README.zh-CN.md)

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE.txt)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933)
![Cloudflare compatible](https://img.shields.io/badge/Cloudflare-compatible-F38020)
![MCP](https://img.shields.io/badge/MCP-ready-111827)
![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-6BA539)

[![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fconnector.oomol.com%2Fv1%2Fcatalog&query=data.providerCount&label=Providers&color=%237d7fe9)](https://oomol.com/apps)
[![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fconnector.oomol.com%2Fv1%2Fcatalog&query=data.actionCount&label=Actions&color=%237d7fe9)](https://oomol.com/apps)

An open-source alternative to Composio for agent-ready SaaS auth, tools, and integrations.

OpenConnector is an open-source auth gateway that currently provides 680+ providers and 7,000+
prebuilt Actions in this repository. It supports Cloudflare-compatible deployment and lets AI
agents call real SaaS products safely through the
[Connector SDK](https://github.com/oomol-lab/connector-sdk), MCP, and HTTP.

OpenConnector does more than store provider credentials. The gateway, provider catalog, and Action
executors are open source, so developers can self-host the runtime, inspect every Action contract,
and give agents a controlled way to work with real SaaS products without rebuilding each integration
from scratch.

This repository contains the part of oomol's connector catalog that has already been migrated into
open source. The commercial oomol version covers 1,000+ providers; the open-source catalog will keep
growing as more integrations are turned into maintainable provider definitions and executors. The
commercial and open-source versions use compatible connector interfaces and Action contracts, so
teams can start on the commercial version for speed and later move to private or self-hosted
runtime infrastructure.

[oo CLI](https://github.com/oomol-lab/oo-cli) support for the open-source runtime is being added and
is targeted for mid-July 2026. Until then, use the SDK, MCP, HTTP API, OpenAPI, and local Web
Console paths below.

## Why OpenConnector

- [680+ providers and 7,000+ prebuilt Actions](docs/providers.md) across SaaS products such as
  GitHub, Gmail, Notion, BigQuery, Google Analytics, Supabase, Airtable, Slack, and more.
- Open-source auth gateway for API keys, OAuth2, custom credentials, and no-auth providers.
- Open-source Action layer with prebuilt request/response schemas and lazy-loaded executors.
- Cloudflare-compatible runtime for fast self-hosted deployment on Workers, D1, R2, and Static
  Assets.
- Agent-ready access through the [Connector SDK](https://github.com/oomol-lab/connector-sdk),
  MCP, HTTP API, OpenAPI, and a local Web Console, with
  [oo CLI](https://github.com/oomol-lab/oo-cli) support being adapted for the open-source runtime.
- Runtime controls for connection identity, scopes, runtime tokens, action allow/block policies,
  temporary file transit, and redacted run logs.

## Where It Fits

OpenConnector is designed for products where agents need to act inside the SaaS tools customers
already use, while keeping credentials, scopes, schemas, and execution logs in a controlled runtime.
The commercial and open-source versions stay interface-compatible: teams can start with oomol's
hosted service to avoid OAuth approval delays and ship faster, then move the same connector layer to
private or self-hosted infrastructure when they need more deployment control.

- Agent products that need a reusable connector layer across work apps, developer tools, data
  systems, communication platforms, and AI services.
- SaaS products that want to add agent workflows without turning every external API into a custom
  integration project.
- Teams that want to start hosted for speed and later move cleanly to private or self-hosted
  infrastructure.

## Developer Tools

| Tool                                                        | Use it for                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Connector SDK](https://github.com/oomol-lab/connector-sdk) | Call connector Actions, proxy upstream APIs, and inspect the catalog from TypeScript apps and agent runtimes. |
| [oo CLI](https://github.com/oomol-lab/oo-cli)               | Open-source runtime support is being added and is targeted for mid-July 2026.                                 |
| MCP                                                         | Expose app Actions to MCP-capable agent hosts through `http://localhost:3000/mcp`.                            |
| HTTP / OpenAPI                                              | Call `/v1/actions/*` directly or inspect the generated `/openapi.json` document.                              |

## Connected SaaS Logo Wall

OpenConnector currently supports 680+ providers and 7,000+ prebuilt Actions in this repository.
This logo wall is only a partial preview, not the full catalog. It highlights recognizable SaaS,
developer tools, productivity apps, analytics products, and AI services to show the breadth of the
catalog.

![Connected SaaS logo wall](assets/saas-logo-wall.png)

Provider names and trademarks belong to their respective owners and are used only for identification
and interoperability.

## How It Works

```mermaid
flowchart LR
  Agent["AI Agent / App"] -->|"SDK / MCP / HTTP"| Gateway["OpenConnector Gateway"]
  Gateway --> Auth["Credential & OAuth Boundary"]
  Gateway --> Catalog["Provider Catalog"]
  Gateway --> Actions["Open-source Action Executors"]
  Gateway --> Policy["Tokens, Scopes, Allow/Block Policy"]
  Gateway --> Logs["Run Logs"]
  Actions --> SaaS["680+ Providers"]
  Console["Web Console"] --> Gateway
  Cloudflare["Cloudflare Workers, D1, R2"] -. deploy .-> Gateway
```

Agents discover Actions, inspect schemas and scopes, select a connection alias, and execute through
the gateway. Provider secrets stay behind the runtime boundary; agents receive only the metadata,
safe account labels, and execution results they need.

## Usage Paths

| Path                         | Best for                                            | What you get                                                                                                                             |
| ---------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Open-source self-host        | Developers and teams that want full control         | Local Docker or Node runtime, SQLite storage, MCP, HTTP, OpenAPI, and Web Console                                                        |
| Cloudflare-compatible deploy | Teams that want a lightweight hosted runtime        | Workers runtime, D1 state, R2 transit files, and Static Assets for the console                                                           |
| [oomol](https://oomol.com/)  | Teams blocked by OAuth approval or launch deadlines | Hosted auth, runtime, and 1,000+ provider catalog; compatible with the open-source interface for later private or self-hosted deployment |

## Cloudflare Quick Start Video

[![Deploy OpenConnector on Cloudflare Workers](assets/cloudflare-quickstart-video.png)](https://www.youtube.com/watch?v=R0V1ZdCuTgc)

Watch the
[Cloudflare Workers deployment walkthrough](https://www.youtube.com/watch?v=R0V1ZdCuTgc) to launch
OpenConnector on Cloudflare with Workers, D1, R2, and the Web Console. The video follows the same
flow as [docs/cloudflare.md](docs/cloudflare.md): create Cloudflare resources, copy
`wrangler.example.jsonc` to `wrangler.local.jsonc`, apply D1 migrations, set required secrets, and
run `npm run deploy:cloudflare`.

## Quick Start

Start the runtime with Docker Compose:

```bash
docker compose up --build
```

Open the local console and generated API reference:

```text
http://localhost:3000
http://localhost:3000/docs
```

Run a no-auth Action to verify the runtime:

```bash
curl -s -X POST http://localhost:3000/v1/actions/hackernews.get_top_stories \
  -H 'content-type: application/json' \
  -d '{"input":{}}'
```

See [docs/quickstart.md](docs/quickstart.md) for the full local setup, first provider connection,
OAuth flow, and runtime settings.

## Connect A Provider

GitHub is the simplest credentialed example because it can use a personal access token:

```bash
curl -s -X PUT http://localhost:3000/api/connections/github \
  -H 'content-type: application/json' \
  -d '{"authType":"api_key","values":{"apiKey":"github_pat_..."}}'

curl -s -X POST http://localhost:3000/v1/actions/github.get_current_user \
  -H 'content-type: application/json' \
  -d '{"input":{}}'
```

For OAuth2 apps, named connections, credential encryption, token refresh, and action policies, see
[docs/credentials.md](docs/credentials.md) and [docs/configuration.md](docs/configuration.md).

## Give Tools To An Agent

OpenConnector exposes the same Action catalog through multiple agent-friendly surfaces:

- MCP: `http://localhost:3000/mcp`
- HTTP runtime API: `/v1/actions`
- OpenAPI document: `/openapi.json`
- Action guides: `/api/actions/:actionId/agent.md`
- Web Console examples: cURL, TypeScript, and agent prompt snippets for each Action

See [docs/runtime-api.md](docs/runtime-api.md) for endpoint details, response envelopes, auth
headers, MCP tools, and Action guide examples.

## Web Console

Open `http://localhost:3000` after starting the runtime. The console helps you browse providers,
save API keys or OAuth client configuration, create runtime tokens, inspect Action schemas, run
Actions for debugging, review recent runs, and open the generated OpenAPI and MCP metadata.

## Cloudflare Deployment

OpenConnector supports Cloudflare Workers as a metadata and runtime-state deployment target using
Workers, D1, R2, and Static Assets.

See [docs/cloudflare.md](docs/cloudflare.md) for resource creation, migrations, secrets, local Worker
preview, and remote deployment.

## oomol And Wanta

OpenConnector is the open-source gateway for teams that want to self-host and control the runtime.
[oomol](https://oomol.com/) is the compatible commercial SaaS version, with hosted auth, runtime
infrastructure, and the broader 1,000+ provider catalog. Teams that need to go live immediately can
start on oomol, then move to private or self-hosted runtime infrastructure when they need to control
the deployment boundary.

For small teams or individuals who want to use a desktop Agent directly, [Wanta](https://wanta.ai/)
connects apps through a desktop product experience and adds team app sharing, permission control,
multiple connected accounts, and workspace-specific connections.

## Documentation

- [Quickstart](docs/quickstart.md)
- [Developer tools](docs/sdk-cli.md)
- [Provider coverage](docs/providers.md)
- [Runtime API and MCP](docs/runtime-api.md)
- [Cloudflare deployment](docs/cloudflare.md)
- [Configuration](docs/configuration.md)
- [Credentials and OAuth](docs/credentials.md)
- [Catalog format](docs/catalog-format.md)
- [Verification language](docs/verification.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security](SECURITY.md)

## Development

Use Node.js 22 or newer:

```bash
npm install
npm run build:web
npm run dev
```

Before opening a pull request:

```bash
npm run fix-check
npm test
```

Provider code lives under `src/providers/<service>`. See
[CONTRIBUTING.md](CONTRIBUTING.md#adding-providers) for provider contribution rules.

## License Scope

Unless otherwise noted, the source code, scripts, generated project scaffolding, tests, and
documentation authored for this repository are licensed under the Apache License, Version 2.0. See
[LICENSE.txt](LICENSE.txt).

The Apache-2.0 license for this repository does not grant rights to third-party products,
providers, apps, APIs, trademarks, service marks, trade names, logos, icons, brand assets,
documentation, screenshots, or other copyrighted materials owned by their respective holders.

Provider and app names, metadata, links, scopes, permissions, and optional logos/icons are included
only to identify services and enable interoperability. All third-party brand and product rights
remain with their respective owners. Inclusion in this catalog does not imply endorsement,
sponsorship, partnership, certification, or verification by those owners.

If you contribute provider metadata or assets, only submit material you have the right to submit.
Prefer linking to official public assets instead of copying brand files into this repository.

## Community

Please keep issues and pull requests focused, respectful, and actionable. Participation in this
project is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
