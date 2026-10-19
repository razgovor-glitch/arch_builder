# Arch Builder

Describe a system (or drop in a whiteboard photo) and get an enterprise architecture where every piece is actually connected, plus the step-by-step rollout manual.

It borrows the idea of a brick designer whose engine checks every connection:

| Bricks | Arch Builder |
|---|---|
| Piece | Component (service, database, queue, gateway, SaaS, legacy system, …) |
| Stud | An interface the component **provides** (HTTPS, SQL, Kafka, OIDC, …) |
| Joint | A connection. It only grips when the consumer speaks a protocol the provider exposes |
| "Side-by-side contact holds nothing" | Components that sit in the same domain without an interface between them are flagged as floating |
| Sub-build | Domain / bounded context |
| Build manual | Ordered rollout runbook: providers first, a checkpoint per sub-build, sign-off page |

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. Three example builds are seeded on first run.

### Optional: design with Claude

Without credentials the app uses its offline blueprint engine (keyword-driven kits that always hold together). To let Claude design and change builds from free-form prompts and images:

```bash
cp .env.example .env   # then set ANTHROPIC_API_KEY
npm run dev
```

The key stays on the server: the Vite dev/preview server exposes `/api/designer`, which calls Claude (`claude-opus-5-5` by default, override with `ARCH_BUILDER_MODEL`) with structured outputs, compiles the result with the same engine, and sends the engine's findings back to Claude for up to two repair rounds. Progress streams to the chat as server-sent events.

## What's in the app

- **Chat / Library** (left): "Start a new build" or "Change this build". The offline engine understands commands such as `add fraud detection`, `add a redis cache to Orders`, `connect A to B via sql`, `scale X to 4`, `use MySQL for Orders DB`, `move X to Payments`, `mark Y as retiring`. The library keeps every build with its versions.
- **Model**: 3D isometric baseplate (pure SVG). Orbit, pan, zoom, 3/4 · front · top views, a build timeline that replays the rollout step by step, and Showcase mode.
- **Design**: editable diagram (React Flow). Drag pieces from the palette, draw joints from a piece's top handle to what it depends on, drag districts, auto-layout.
- **Manual**: cover, parts inventory, sub-build intros, one page per step (parts callout, instructions, acceptance checks, location inset) and a sign-off page. Export to PDF through the print dialog.
- **Parts**: bill of materials with run-cost estimates, and a sortable component register (owner, tier, lifecycle, joints).
- **Checks**: every finding, with one-click fixes where the engine knows one, and a table of all joints.
- **Inspector**: edit any component, joint or sub-build. Undo/redo with ⌘Z / ⇧⌘Z; Delete removes the selection.
- **Download**: design JSON (re-importable), Markdown runbook, component CSV, Mermaid diagram, manual PDF.

## The engine's rules

`src/engine/` is pure TypeScript and recompiles on every edit (a few milliseconds):

- **Errors**: weak joints (protocol mismatch), floating pieces, loose sub-assemblies (islands), collisions, pieces off the plate, dangling or self joints.
- **Warnings**: clients bypassing the edge, stores read across domains, tier-1 single points of failure, synchronous cycles, synchronous chains deeper than 5 hops, runtimes not sending telemetry, gateways not validating tokens, dependencies on retiring components.

## Project layout

```
src/model       types and the component catalog (studs, sockets, shapes, costs)
src/engine      validation, build plan, manual pages, layout, edit operations, exporters
src/generator   offline blueprint kits, prompt → design, offline change commands
src/ai          Claude prompt + JSON schema, draft normalization, browser client
src/iso         isometric renderer (camera, bricks, scene)
src/store       app state (zustand), persistence in localStorage
src/ui          views, inspector, panels
server          Claude designer endpoint (mounted by vite.config.ts)
```

## Scripts

```bash
npm run dev        # dev server with the designer endpoint
npm run build      # typecheck + production build
npm run preview    # serve the build (designer endpoint included)
npm test           # engine, generator, editor and normalizer tests
```

Builds are saved in the browser's localStorage. For a shared deployment, serve `dist/` and mount `designerMiddleware` from `server/designer.ts` on your Node server at `/api/designer`.
