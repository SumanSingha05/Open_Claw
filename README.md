<h1 align="center">
  <br/>
  🐾 Open Claw
  <br/>
</h1>

<p align="center">
  <strong>A local-first, terminal-native AI coding agent built on Bun + TypeScript.</strong><br/>
  Powered by any OpenRouter model. Safe by design — every mutation is staged and requires explicit approval before touching your filesystem.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6?logo=bun&logoColor=white" alt="Bun" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/AI-OpenRouter-7c3aed?logoColor=white" alt="OpenRouter" />
  <img src="https://img.shields.io/badge/web-Firecrawl-f97316?logoColor=white" alt="Firecrawl" />
  <img src="https://img.shields.io/badge/license-MIT-22c55e" alt="MIT License" />
  <img src="https://img.shields.io/badge/status-active--development-f59e0b" alt="Status" />
</p>

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Modes](#modes)
  - [Agent Mode](#-agent-mode)
  - [Plan Mode](#-plan-mode)
  - [Ask Mode](#-ask-mode)
- [Key Design Decisions](#key-design-decisions)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Tool Reference](#tool-reference)
- [Web Tools](#web-tools-firecrawl)
- [Safety Model](#safety-model)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## Overview

**Open Claw** is a command-line AI agent that operates directly against your local codebase. Unlike cloud-based coding assistants, no files are sent anywhere — it runs entirely on your machine, using an in-memory staging layer to queue every proposed change before you see or approve it.

Think of it as a local pair programmer that can:

- Read, create, modify, and delete files in your workspace
- Execute shell commands (always with your approval)
- Search and crawl the web via Firecrawl to inform its answers
- Break large goals into discrete, reviewable steps before executing them
- Answer codebase questions without ever touching a single line of code

Every destructive or mutating operation goes through a mandatory **approval gate** — you always see a unified diff before anything lands on disk.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   index.ts  (Bun CLI)                │
│           Commander  ·  runWakeup()                  │
└────────────────────┬────────────────────────────────┘
                     │  figlet banner + @clack/prompts
                     ▼
              ┌──────────────┐
              │  tui/wakeup  │   CLI  ·  Telegram (planned)
              └──────┬───────┘
                     │
                     ▼
           ┌──────────────────┐
           │   modes/cli.ts   │   Agent │ Plan │ Ask
           └───┬──────┬───┬───┘
               │      │   │
         ┌─────┘      │   └────────────────────┐
         ▼            ▼                        ▼
    Agent Mode    Plan Mode               Ask Mode
    (full CRUD)  (plan→select→exec)    (read-only + Q&A)
         │            │                        │
         └────────────┴────────────────────────┘
                      │
                      ▼
            ┌──────────────────┐
            │   ToolExecutor   │   in-memory overlay / deleted sets
            └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │  ActionTracker   │   append-only audit log
            └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │  ApprovalFlow    │   unified diff · accept / reject per file
            └────────┬─────────┘
                     │  only now
                     ▼
              Real Filesystem
```

The AI layer is the **Vercel AI SDK `ToolLoopAgent`**, backed by any model reachable through [OpenRouter](https://openrouter.ai/).

---

## Modes

### 🤖 Agent Mode

Full agentic loop. Give it a concrete task; the agent browses your codebase, proposes file changes and shell commands, then hands control back to you for approval before writing a single byte.

```
◆ What would you like the agent to do?
│ Refactor all fetch() calls in src/ to use a shared httpClient utility

  ✓ list_files       src …
  ✓ search_files     src  *.ts  "fetch(" …
  ✓ read_file        src/api/users.ts …
  ✓ create_file      src/lib/httpClient.ts …
  ✓ modify_file      src/api/users.ts …

Apply staged changes?
❯ Approve and apply all
  Review one by one
  Cancel
```

- Up to **40 tool-call steps** per run
- Full CRUD suite: `read_file`, `create_file`, `modify_file`, `delete_file`, `create_folder`, `list_files`, `search_files`, `analyze_codebase`, `execute_shell`
- Skill discovery: `list_skills` / `read_skill` (reads Cursor / Claude `SKILL.md` files)

---

### 📋 Plan Mode

Two-phase workflow designed for complex, multi-file goals.

**Phase 1 — Research & Plan**  
A planner LLM uses read-only codebase tools (and optionally Firecrawl web tools) to produce a structured JSON plan of 1–15 steps. Each step carries a complexity label: `low` / `medium` / `high`.

**Phase 2 — Selective Execution**  
You multiselect which steps to run. Each selected step is dispatched to a full agent loop (up to 30 tool-call steps) with the complete tool suite, including web search.

```
 Researching & drafting a plan...

📋 Generated Plan

  Step  1. Audit package.json and tsconfig          [low]
  Step  2. Convert require() calls to import        [high]
  Step  3. Update build scripts                     [medium]

◆ Select steps to execute (space toggles, enter confirms)
◉ Audit package.json and tsconfig
◉ Convert require() calls to import
◯ Update build scripts
```

---

### ❓ Ask Mode

Read-only Q&A against your codebase, augmented with optional web search. The agent can read files, search patterns, crawl URLs — but **cannot modify, create, or delete files**. The sole exception is optionally saving the final answer to a `.md` file, which still goes through the approval gate.

```
◆ What do you want to ask?
│ How does the approval flow work and which files are involved?

[AI streams a codebase-informed answer]

◆ Save this answer to a .md file in the current directory?
  Yes / No
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Staging layer over direct writes** | All mutations go into an in-memory `Map` (overlay) and `Set` (deleted). Nothing touches the real filesystem until the user explicitly approves. |
| **Append-only `ActionTracker`** | Every tool call — read-only or mutating — is logged with a timestamp and status, providing a complete session audit trail. |
| **Workspace path escaping guard** | `resolveSafe()` resolves every path against `codebasePath` and throws immediately if the resolved path escapes via `..` traversal. |
| **Exclusion policy at executor level** | `node_modules`, `.git`, `dist`, `.env*`, `*.log` are blocked inside `ToolExecutor`, not at the tool-definition layer, so no tool can accidentally reach sensitive paths. |
| **Diff before apply** | The approval flow composes a unified diff (the `diff` package) for each staged change and renders it as a syntax-highlighted markdown fence inline in the terminal. |
| **Model-agnostic via OpenRouter** | `OPENROUTER_DEFAULT_MODEL` accepts any OpenRouter model ID — swap `claude-3-5-sonnet`, `gpt-4o`, `gemini-2.5-pro`, or a free-tier model without touching a single line of code. |
| **Firecrawl is optional** | Web tools are only registered when `FIRECRAWL_API_KEY` is set. When absent, the planner's system prompt explicitly tells the model web tools are unavailable. |

---

## Project Structure

```
open_claw/
├── index.ts                    # CLI entry point — Commander + runWakeup()
├── package.json
├── tsconfig.json
│
├── ai/
│   ├── ai.config.ts            # OpenRouter provider + model factory
│   └── index.ts                # Re-export barrel
│
├── tui/
│   ├── wakeup.ts               # Figlet banner + top-level mode selector
│   └── terminal-md.ts          # marked + marked-terminal Markdown renderer
│
├── modes/
│   ├── cli.ts                  # Sub-mode router (Agent / Plan / Ask)
│   │
│   ├── agent/
│   │   ├── orchestrator.ts     # Agent mode entry — ToolLoopAgent wiring
│   │   ├── agent-tools.ts      # Full tool suite definitions (Zod schemas)
│   │   ├── tool-executer.ts    # ToolExecutor — staging, FS ops, shell queue
│   │   ├── action-tracker.ts   # Append-only ActionLog store
│   │   ├── approval.ts         # Interactive diff review + apply flow
│   │   ├── diff-view.ts        # Unified diff composition helpers
│   │   └── types.ts            # ActionType · ActionLog · AgentConfig
│   │
│   ├── plan/
│   │   ├── orchestrator.ts     # Plan mode — generate → select → execute
│   │   ├── planner.ts          # Structured JSON plan gen (Zod output schema)
│   │   ├── selection.ts        # @clack/prompts multiselect for plan steps
│   │   ├── web-tool.ts         # Firecrawl: web_search / web_crawl / fetch_url
│   │   └── types.ts            # Plan · PlanStep interfaces
│   │
│   └── ask/
│       └── orchestator.ts      # Ask mode — read-only agent + optional save
│
└── cws/                        # Standalone landing-page static site (HTML/CSS)
    ├── index.html
    └── styles.css
```

---

## Prerequisites

| Requirement | Details |
|---|---|
| [Bun](https://bun.sh/) `>= 1.0` | Runtime and package manager |
| [OpenRouter API key](https://openrouter.ai/) | Required — provides access to all LLM models |
| [Firecrawl API key](https://www.firecrawl.dev/) | Optional — enables web search / crawl tools |

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/SumanSingha05/Open_Claw.git
cd Open_Claw

# 2. Install dependencies
bun install

# 3. Create and populate your environment file (see Configuration below)
cp .env.example .env

# 4. Launch the agent
bun run index.ts wakeup
```

**Optional — install as a global CLI command:**

```bash
bun link
openclaw-build wakeup
```

---

## Configuration

Create a `.env` file in the project root:

```env
# ── Required ─────────────────────────────────────────────────────────────────

# Your OpenRouter API key
OPENROUTER_API_KEY=sk-or-v1-...

# Any valid OpenRouter model identifier. Examples:
#   openrouter/auto                                  (automatic routing)
#   anthropic/claude-3-5-sonnet
#   openai/gpt-4o
#   google/gemini-2.5-pro-preview
#   meta-llama/llama-3.3-70b-instruct:free           (free tier)
OPENROUTER_DEFAULT_MODEL=openrouter/auto

# ── Optional ─────────────────────────────────────────────────────────────────

# Enables web_search / web_crawl / fetch_url tools in Plan and Ask modes
FIRECRAWL_API_KEY=fc-...

# Semicolon-separated paths to additional SKILL.md root directories
SKILLS_DIRS=/home/you/.cursor/my-skills;/home/you/.config/shared-skills
```

> **Security note:** `.env` is listed in `.gitignore`. Never commit API keys to source control.

---

## Usage

```bash
bun run index.ts wakeup
```

The `openclaw` ASCII banner appears, followed by an interactive mode selector.

### Agent Mode walkthrough

```
◆ What would you like the agent to do?
│ Add input validation to all Express route handlers in src/routes/

  ✓ list_files       src/routes …
  ✓ read_file        src/routes/users.ts …
  ✓ read_file        src/routes/products.ts …
  ✓ modify_file      src/routes/users.ts …
  ✓ modify_file      src/routes/products.ts …

Apply staged changes?
❯ Approve and apply all
  Review one by one       ← shows unified diff per file
  Cancel
```

### Plan Mode walkthrough

```
◆ What is your goal?
│ Migrate the project from CommonJS to ESM

 Researching & drafting a plan...

🔍 Research summary
  The project uses "type": "commonjs" in package.json …

📋 Generated Plan

  Step  1. Audit package.json and tsconfig    [low]
  Step  2. Convert require() to import        [high]
  Step  3. Update build and test scripts      [medium]

◆ Select steps to execute (space toggles, enter confirms)
◉ Audit package.json and tsconfig
◉ Convert require() to import
◯ Update build and test scripts

◆ Execute 2 step(s)?   Yes
```

### Ask Mode walkthrough

```
◆ What do you want to ask?
│ Which files handle file staging and how does the overlay work?

[Inline markdown answer rendered in the terminal]

◆ Save this answer to a .md file in the current directory?
  No
```

---

## Tool Reference

All tools are defined with the Vercel AI SDK `tool()` helper and Zod input schemas.

| Tool | Available In | Side Effects | Description |
|---|---|---|---|
| `read_file` | All modes | None | Read a text file; capped at `maxFileSizeToRead` (default 1 MB) |
| `create_file` | Agent, Plan | **Staged** | Stage creation of a new file |
| `modify_file` | Agent, Plan | **Staged** | Stage a full-file replacement |
| `delete_file` | Agent, Plan | **Staged** | Stage file deletion |
| `create_folder` | Agent, Plan | **Staged** | Stage a recursive directory creation (`mkdir -p`) |
| `list_files` | All modes | None | Directory listing with optional recursion; honours exclusion list |
| `search_files` | All modes | None | Glob pattern search with optional content-substring filter |
| `analyze_codebase` | All modes | None | File + directory counts for a subtree |
| `execute_shell` | Agent, Plan | **Staged** | Queue a shell command — runs only after explicit approval |
| `list_skills` | All modes | None | Discover `SKILL.md` files in Cursor / Claude skill directories |
| `read_skill` | All modes | None | Read a `SKILL.md`; path must be inside a known skill root |
| `web_search` | Plan, Ask | None | Firecrawl web search; returns title / URL / snippet list |
| `web_crawl` | Plan, Ask | None | Scrape a URL into clean Markdown |
| `fetch_url` | Plan, Ask | None | Raw HTTP GET; returns response body |

---

## Web Tools (Firecrawl)

Web tools are available in **Plan Mode** and **Ask Mode** when `FIRECRAWL_API_KEY` is present. They use the [`@mendable/firecrawl-js`](https://github.com/mendableai/firecrawl) client and are conditionally registered — if the key is absent, the planner system prompt explicitly tells the model these tools are unavailable.

| Tool | Limit | Notes |
|---|---|---|
| `web_search` | 8 000 chars | Up to 10 results; sources: `["web"]` |
| `web_crawl` | 8 000 chars | Firecrawl scrape → Markdown |
| `fetch_url` | 16 000 chars | Raw HTTP GET with redirect follow |

All web results are logged to the `ActionTracker` under `type: "code_analysis"` for session auditability.

---

## Safety Model

Open Claw enforces a layered, defence-in-depth safety model:

```
Tool call
  → resolveSafe()      — rejects path traversal outside workspace
  → excluded()         — blocks node_modules, .git, .env*, *.log, etc.
  → Overlay / Tracker  — mutation queued in memory, never written yet
  → Approval Gate      — unified diff shown; user accepts or rejects
  → applyApproved()    — only approved actions reach the real filesystem
```

Key properties:

- **Path confinement** — `resolveSafe()` resolves against `codebasePath` and throws on any `..` escape.
- **Exclusion list** — enforced inside `ToolExecutor`, not just in tool descriptions. No tool bypasses it.
- **Immutable staging** — the in-memory overlay can be discarded completely with `clearStaging()` at any time.
- **Diff-first review** — the approval UI always offers a diff view before applying. You are never blind to what will change.
- **Granular permission flags** — `AgentConfig.tools` independently gates `allowFileCreation`, `allowFileModification`, `allowFolderCreation`, and `allowShellExecution`. Ask Mode hard-disables all mutation flags.
- **Shell commands are queued, not run immediately** — `queueShell()` stages the command through the exact same approval path as file mutations.

---

## Roadmap

- [ ] **Telegram mode** — wire up the Telegram bot integration (UI stub present in `wakeup.ts`)
- [ ] **Streaming output** — stream tokens to the terminal during agent steps rather than waiting for completion
- [ ] **Patch-based file edits** — replace full-file rewrites with targeted diff-patch mutations to reduce token usage
- [ ] **Session persistence** — save and resume `ActionTracker` state across invocations
- [ ] **Plugin / custom tool system** — drop in additional tools without modifying core files
- [ ] **Workspace config file** — support `.openclaw.json` or `openclaw.config.ts` for per-project defaults
- [ ] **Named model profiles** — presets with per-mode model overrides
- [ ] **Test suite** — unit tests for `ToolExecutor` (path safety, overlay semantics) and `ActionTracker`

---

## Contributing

Contributions are welcome. A few ground rules:

1. Fork the repo and create a descriptive feature branch (`git checkout -b feat/streaming-output`).
2. Keep changes focused — one concern per pull request.
3. Run `bun run index.ts wakeup` and exercise your change end-to-end before opening a PR.
4. Describe *why* the change is needed, not just *what* it does, in the PR description.
5. If you add tests alongside a feature, that's a very welcome bonus.

---

<p align="center">
  Built with&nbsp;<a href="https://bun.sh">Bun</a>&nbsp;·&nbsp;<a href="https://sdk.vercel.ai">Vercel AI SDK</a>&nbsp;·&nbsp;<a href="https://openrouter.ai">OpenRouter</a>&nbsp;·&nbsp;<a href="https://www.firecrawl.dev">Firecrawl</a>
</p>
