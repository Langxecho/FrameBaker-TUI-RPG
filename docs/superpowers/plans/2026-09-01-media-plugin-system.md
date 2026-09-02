# Media Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent `.iap/.vap/.aap` media plugin system to FrameBaker with Bun-managed installation, Python execution, asynchronous generation, unified media materials, a three-tab generation center, and MCP query/generation tools.

**Architecture:** Keep the existing `GenProvider` system unchanged. Bun owns plugin discovery, package installation, settings, API, queue jobs, material archival, frontend, and MCP; a bundled Python CLI runner reuses the plugin runtime core and dynamically executes trusted `provider.py` files from `.venv-media`.

**Tech Stack:** Bun, TypeScript, Elysia, bun:sqlite, React 19, Motion, lucide-react, shared TypeScript types, Python 3 with the copied plugin runtime, `requests`, native file upload, existing queue/WebSocket/material abstractions.

## Global Constraints

- The new plugin system is independent from `GenProvider`; do not merge or modify the existing provider execution path.
- Support `.iap` image plugins, `.vap` video plugins, and `.aap` audio plugins; `.cfp` and `.pap` are out of scope.
- Plugin archives are trusted executable code and must be marked as such in the UI; no OS-level sandbox is promised.
- Backend paths must use `STORAGE_ROOT`; never use cwd-relative storage paths.
- Python execution uses the shared `.venv-media` environment; plugin dependencies are not installed automatically in the first release.
- Existing `jobs`, queue concurrency, cancellation, WebSocket events, and `materials` workflows remain the shared lifecycle infrastructure.
- User-visible text and code comments are Chinese and must go through `t()` / `useT()` with English dictionary entries added.
- Do not add dependencies unless required; use existing native upload, queue, media, and confirmation/notification helpers.
- Do not use browser `alert`, `confirm`, or `prompt`; use `notify()` and `askConfirm()`.
- Do not perform git operations unless explicitly requested by the user.
- After API changes, update `docs/api.md` and `docs/api.zh-CN.md`; after architecture changes, update both architecture docs and `AGENTS.md` if directory/runtime rules change.

---

## File Map

### New backend files

- `apps/server/src/mediaPlugins/types.ts`: shared server-side plugin manifest, summary, request, runner result, and media-kind types.
- `apps/server/src/mediaPlugins/paths.ts`: safe `STORAGE_ROOT` plugin/run/python paths and path containment helpers.
- `apps/server/src/mediaPlugins/manifest.ts`: JSON parsing, schema normalization, package validation, parameter validation, and secret redaction.
- `apps/server/src/mediaPlugins/registry.ts`: scan installed plugin directories and return typed plugin summaries/details.
- `apps/server/src/mediaPlugins/installer.ts`: archive validation, Zip Slip-safe extraction, replacement confirmation support, and deletion.
- `apps/server/src/mediaPlugins/secrets.ts`: update secret values and parameter defaults while preserving manifest structure.
- `apps/server/src/mediaPlugins/runner.ts`: create request files, spawn `.venv-media` Python runner, enforce timeout/cancellation, and parse result JSON.
- `apps/server/src/mediaPlugins/service.ts`: public plugin service methods, reference-material resolution, generation validation, and result archival coordination.
- `apps/server/src/api/mediaPlugins.ts`: plugin list/detail/import/settings/delete HTTP endpoints.
- `apps/server/src/api/mediaGeneration.ts`: media generation request validation and queue creation endpoint.
- `apps/server/src/jobs/mediaPlugin.ts`: queue worker for image/video/audio plugin jobs and output archival.
- `apps/server/src/python/media_plugin_runner.py`: JSON-file CLI bridge that dispatches to copied image/video/audio runtime modules.
- `apps/server/src/python/aigc_bench_plugin_runtime/`: minimal copied/adapted runtime core from the reusable system, excluding FastAPI templates/routes/MCP/web code.

### Modified backend files

- `packages/shared/src/types.ts`: add media kinds, plugin job types, material metadata contracts, and API response types.
- `apps/server/src/db.ts`: add safe media metadata/media-kind migration and any media preview metadata indexes required by the existing schema.
- `apps/server/src/queue.ts`: add media plugin payloads, job dispatch, process cancellation, and result cleanup.
- `apps/server/src/app.ts`: mount plugin/generation APIs, media file/thumbnail routes, and config diagnostics for Python/plugin runtime.
- `apps/server/src/media.ts`: serve video/audio content types and generate/locate video thumbnails where existing media helpers support it.
- `apps/server/src/api/materials.ts`: filter unified media materials and expose media-aware stream/download behavior; reject non-image assets for frame import.
- `apps/server/src/mcp/index.ts`: register media plugin MCP tools.
- `apps/server/src/mcp/tools/mediaPlugins.ts`: new MCP query and generation tools.

### New frontend files

- `apps/web/src/components/MediaGenerationPage.tsx`: `/generate` shell, tabs, form state, submit flow, and result panel.
- `apps/web/src/components/MediaPluginForm.tsx`: plugin selector, capability display, dynamic `params_schema` controls, and validation.
- `apps/web/src/components/MediaReferencePicker.tsx`: media-kind-aware material picker with constraint filtering.
- `apps/web/src/components/MediaResultPreview.tsx`: image, video, and audio result preview/download controls.
- `apps/web/src/components/MediaPluginSettings.tsx`: plugin cards, import, detail, secrets, defaults, test, export, and delete flows.

### Modified frontend files

- `apps/web/src/App.tsx`: add `/generate` view and route navigation.
- `apps/web/src/components/TopNav.tsx`: add generation-center navigation.
- `apps/web/src/components/SettingsPage.tsx`: render the media plugin settings section.
- `apps/web/src/components/MaterialsPage.tsx`: add media filter and video/audio cards/players.
- `apps/web/src/api.ts`: add typed plugin, generation, media material, and download API methods.
- `apps/web/src/i18n/zh.ts`, `apps/web/src/i18n/en.ts`: add all new UI strings.
- `apps/web/src/styles.css`: add responsive plugin settings, generation center, media cards, players, and form styles using existing CSS variables only.

### Tests and docs

- `tests/media-plugin-manifest.test.ts`: manifest and dynamic parameter behavior.
- `tests/media-plugin-paths.test.ts`: path containment and archive safety.
- `tests/media-plugin-api.test.ts`: plugin management and generation endpoint behavior.
- `tests/media-plugin-jobs.test.ts`: queue execution, cancellation, result validation, and archival.
- `tests/media-plugin-mcp.test.ts`: MCP query/generation tool contracts and input restrictions.
- `tests/media-plugin-runner.test.ts`: Python bridge protocol and error translation.
- `apps/server/src/python/tests/test_media_plugin_runtime.py`: copied runtime tests adapted from the reusable system.
- `scripts/setup_media.ps1`, `scripts/setup_media.sh`: create `.venv-media` and install only declared base runtime dependencies.
- `docs/api.md`, `docs/api.zh-CN.md`: new HTTP API contracts.
- `docs/architecture.md`, `docs/architecture.zh-CN.md`: new plugin/runtime boundary and storage layout.
- `AGENTS.md`: document the new Python runner and plugin storage rules if implementation introduces a durable convention not already covered.

---

### Task 1: Define Shared Contracts And Database Migration

**Files:**
- Modify: `packages/shared/src/types.ts:23-36, 330-410, 620-640`
- Modify: `apps/server/src/db.ts:78-90, 181-195`
- Create: `tests/media-plugin-manifest.test.ts`

**Interfaces:**
- Produce `MediaKind = "image" | "video" | "audio"`, `MediaPluginKind = "image_api" | "video_api" | "audio_api"`, and job types `media_plugin_image`, `media_plugin_video`, `media_plugin_audio`.
- Produce serializable `MediaPluginSummary`, `MediaPluginDetail`, `MediaPluginGenerationRequest`, and `MediaPluginResult` contracts used by API, MCP, and web.
- Preserve existing `Material`, `MaterialRow`, `JobType`, and old image records.

- [ ] Write tests asserting old material rows deserialize as `mediaKind: "image"`, plugin kinds map to archive extensions, and invalid media kinds are rejected.
- [ ] Run `bun test tests/media-plugin-manifest.test.ts` and confirm the new symbols fail before implementation.
- [ ] Add the shared constants/types and a migration that defaults existing materials to image without rewriting valid metadata.
- [ ] Run `bun test tests/media-plugin-manifest.test.ts` and `bun run typecheck`; expect the contract tests and both TypeScript projects to pass.
- [ ] Inspect the migration SQL for idempotence and verify no existing `GenProvider` type or job type is removed.

### Task 2: Port The Python Runtime And Add The JSON Runner

**Files:**
- Create: `apps/server/src/python/aigc_bench_plugin_runtime/` from the reusable image/video/audio plugin runtime and shared capabilities/errors modules.
- Create: `apps/server/src/python/media_plugin_runner.py`
- Create: `apps/server/src/python/tests/test_media_plugin_runtime.py`
- Create: `scripts/setup_media.ps1`
- Create: `scripts/setup_media.sh`
- Create: `tests/media-plugin-runner.test.ts`

**Interfaces:**
- Runner command: `python apps/server/src/python/media_plugin_runner.py --request <request.json> --result <result.json>`.
- Input JSON has `kind`, `pluginId`, `prompt`, `imageUrls`, `audioUrls`, `durationSeconds`, `params`, and `outputDir`.
- Successful output is `{ "ok": true, "result": { ... } }`; failures are `{ "ok": false, "code": string, "error": string }`.
- Runtime must call image `GenerateRequest`, video `GenerateVideoRequest`, and audio `GenerateAudioRequest` with manifest defaults and configured secrets.

- [ ] Add Python tests for image URL result, video local output validation, audio output validation, missing required secret, unsupported mode, and malformed plugin result.
- [ ] Run `python -m pytest apps/server/src/python/tests/test_media_plugin_runtime.py -q` and confirm failures before the port is complete.
- [ ] Copy only the backend runtime modules needed by the runner; remove imports of the reusable project’s cwd paths, FastAPI, templates, web routes, and MCP history.
- [ ] Implement the runner’s safe plugin-root selection and JSON protocol, including traceback redaction to a short error message.
- [ ] Implement setup scripts that create `.venv-media` and install the base runtime dependency set without reading or executing plugin-provided dependency commands.
- [ ] Run the Python tests and `bun test tests/media-plugin-runner.test.ts`; expect pass, with a separate test for missing Python returning `PYTHON_RUNTIME_UNAVAILABLE`.

### Task 3: Implement Plugin Paths, Manifest Registry, Installation, And Settings

**Files:**
- Create: `apps/server/src/mediaPlugins/types.ts`
- Create: `apps/server/src/mediaPlugins/paths.ts`
- Create: `apps/server/src/mediaPlugins/manifest.ts`
- Create: `apps/server/src/mediaPlugins/registry.ts`
- Create: `apps/server/src/mediaPlugins/installer.ts`
- Create: `apps/server/src/mediaPlugins/secrets.ts`
- Create: `tests/media-plugin-paths.test.ts`
- Create: `tests/media-plugin-api.test.ts`

**Interfaces:**
- `listInstalledMediaPlugins(kind?: MediaPluginKind): MediaPluginSummary[]`.
- `getMediaPlugin(kind: MediaPluginKind, pluginId: string): MediaPluginDetail | null`.
- `installMediaPluginArchive(file: Blob|Uint8Array, filename: string, replace: boolean): MediaPluginDetail`.
- `updateMediaPluginSecrets(kind, pluginId, values): MediaPluginDetail`.
- `updateMediaPluginParams(kind, pluginId, defaults): MediaPluginDetail`.
- `deleteMediaPlugin(kind, pluginId): void`.

- [x] Write failing tests for safe plugin IDs, path containment, invalid extension, missing `plugin.json`, invalid `kind`, missing `provider.py`, Zip Slip entries, duplicate ID requiring replacement, and secret redaction.
- [x] Run `bun test tests/media-plugin-paths.test.ts tests/media-plugin-api.test.ts` and verify the expected failures.
- [x] Implement paths under `STORAGE_ROOT/media-plugins/<kind>/<plugin-id>` and run containment checks after resolving every archive entry.
- [x] Implement manifest normalization for capabilities, constraints, params schema, entry metadata, and secret summaries; preserve secret values only on disk and never in list responses.
- [x] Implement archive extraction into a temporary directory, validate before installation, atomically replace the destination only after confirmation, and remove temporary files on every failure.
- [x] Implement secret/default updates with JSON preservation and explicit validation of parameter keys/types.
- [x] Run the focused tests, then run `bun run typecheck`.

### Task 4: Add Media Plugin Queue Execution And Unified Archival

**Files:**
- Create: `apps/server/src/jobs/mediaPlugin.ts`
- Create: `apps/server/src/mediaPlugins/runner.ts`
- Create: `apps/server/src/mediaPlugins/service.ts`
- Modify: `apps/server/src/queue.ts:10-16, 39-67, 165-221`
- Modify: `apps/server/src/jobs/generatedArtifacts.ts:9-203` or extract a shared media-aware committer beside it.
- Modify: `apps/server/src/api/materials.ts:58-92`
- Create: `tests/media-plugin-jobs.test.ts`

**Interfaces:**
- `createMediaGenerationJobs(request): string[]` creates one job per image/audio output and one job for video unless the plugin contract explicitly returns a batch.
- `runMediaPluginJob(payload, report, signal): Promise<MediaPluginResult[]>` executes the Python runner and archives outputs.
- `archiveMediaArtifact(input): { materialId: string; mediaKind: MediaKind }` writes `materials` and broadcasts `materials_changed`.

- [ ] Write failing tests for image/video/audio success, metadata/source values, folder assignment, optional image project import, invalid reference type, missing output, cancellation, timeout, and partial archive failure.
- [ ] Run `bun test tests/media-plugin-jobs.test.ts` and verify failures.
- [ ] Add queue payloads and dispatch for the three new job types; preserve in-memory payload behavior and existing restart semantics.
- [ ] Implement reference ID resolution from `materials` only, rejecting arbitrary paths and unsupported media types before job creation.
- [ ] Implement Python runner spawning through `Bun.spawn`, timeout and AbortSignal termination, output directory cleanup, JSON parsing, and output containment/non-empty checks.
- [ ] Implement media archival: image `raw.png`, video declared output plus first-frame thumbnail metadata, audio declared output plus format/duration metadata; set `source` to `media-plugin:<plugin-id>` and store no secrets.
- [ ] Reuse existing image-to-project import only after material creation; retain the material if project import fails.
- [ ] Run focused tests, `bun run typecheck`, and existing `bun test tests/generate-api.test.ts tests/server-runtime.test.ts` to catch regressions.

### Task 5: Add HTTP APIs, Media Serving, And Diagnostics

**Files:**
- Create: `apps/server/src/api/mediaPlugins.ts`
- Create: `apps/server/src/api/mediaGeneration.ts`
- Modify: `apps/server/src/app.ts:107-142, 214-251`
- Modify: `apps/server/src/media.ts`
- Modify: `apps/server/src/api/materials.ts:94-127, 129-149`
- Modify: `apps/server/src/doctor.ts`
- Create: `tests/media-plugin-api.test.ts`
- Modify: `docs/api.md`
- Modify: `docs/api.zh-CN.md`

**Interfaces:**
- `GET /api/media-plugins?kind=image_api|video_api|audio_api` returns summaries and install root metadata.
- `GET /api/media-plugins/:kind/:pluginId` returns non-sensitive detail.
- `POST /api/media-plugins/import` accepts multipart `plugin` and `confirm_replace`.
- `PATCH /api/media-plugins/:kind/:pluginId/secrets` and `/params` update settings.
- `DELETE /api/media-plugins/:kind/:pluginId` removes a plugin.
- `POST /api/media-generation` validates and returns `{ jobId, jobIds }`.
- `GET /api/materials/:id/media` and download variants serve image/video/audio with safe content types and range support where practical.

- [ ] Add API tests for each status code: invalid package 400, duplicate 409, missing plugin 404, invalid kind 400, successful install 200, generation validation 400, and successful queue creation 200.
- [ ] Run the focused API tests before implementation and confirm failures.
- [ ] Mount Elysia routes with strict request schemas, use existing `status()` error style, and never return secrets.
- [ ] Add config/doctor output for `.venv-media` availability and installed plugin count without exposing credentials.
- [ ] Add media serving with path containment and correct MIME handling; keep existing image aliases and frame-import behavior intact.
- [ ] Document request/response bodies, plugin archive rules, errors, and media URLs in both API docs.
- [ ] Run API tests, `bun run typecheck`, and the existing API smoke test suite.

### Task 6: Add MCP Plugin Query And Generation Tools

**Files:**
- Create: `apps/server/src/mcp/tools/mediaPlugins.ts`
- Modify: `apps/server/src/mcp/index.ts:11-30`
- Create: `tests/media-plugin-mcp.test.ts`

**Interfaces:**
- Tool `list_media_plugins`: optional `kind: image|video|audio|all`; returns summaries and configuration status.
- Tool `get_media_plugin`: `kind`, `pluginId`; returns non-sensitive detail/schema/constraints.
- Tool `generate_with_media_plugin`: `kind`, `pluginId`, `prompt`, optional `references`, `params`, `count`, `durationSeconds`, `folderId`, `projectId`, `name`; returns `jobId` and `jobIds`.

- [ ] Write tests proving the tools list/get plugins, create a job, reject arbitrary local paths, reject mismatched reference media, reject unknown parameters, and never include secret values.
- [ ] Run `bun test tests/media-plugin-mcp.test.ts` and confirm failures.
- [ ] Register tools with Zod v4 schemas and annotations matching the existing MCP conventions.
- [ ] Call the same service used by HTTP generation rather than making HTTP self-calls or duplicating validation.
- [ ] Ensure MCP does not expose install, delete, secret update, parameter-default update, arbitrary Python, or local-path operations.
- [ ] Run focused tests and existing `bun test tests/mcp.test.ts`.

### Task 7: Build The Generation Center And Plugin Settings UI

**Files:**
- Create: `apps/web/src/components/MediaGenerationPage.tsx`
- Create: `apps/web/src/components/MediaPluginForm.tsx`
- Create: `apps/web/src/components/MediaReferencePicker.tsx`
- Create: `apps/web/src/components/MediaResultPreview.tsx`
- Create: `apps/web/src/components/MediaPluginSettings.tsx`
- Modify: `apps/web/src/App.tsx:19-31, 130-154`
- Modify: `apps/web/src/components/TopNav.tsx:8-42`
- Modify: `apps/web/src/components/SettingsPage.tsx:256-1076`
- Modify: `apps/web/src/api.ts:1-267`
- Modify: `apps/web/src/i18n/zh.ts`
- Modify: `apps/web/src/i18n/en.ts`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `/generate` contains tabs for image/video/audio and only lists plugins for the active kind.
- Dynamic fields map `string` to text, `integer/number` to numeric input, `boolean` to switch, `enum` to select, and `json` to JSON editor.
- Submit calls `api.createMediaGeneration`, then monitors existing job events/list fallback.
- References submit material IDs only; archive target defaults to materials and image mode optionally accepts a project ID.

- [ ] Add component tests or pure state tests for tab changes, schema controls/defaults, required-field errors, reference filtering, and image-only project target.
- [ ] Run `bun run typecheck` before implementation and record the existing baseline if any.
- [ ] Add typed API methods for plugin list/detail/import/secret/default updates/delete, generation creation, and media URLs.
- [ ] Implement the responsive generation center with shared form sections and media-specific common fields; use existing `notify`, `askConfirm`, `JobPanel`, and `useT` patterns.
- [ ] Implement plugin settings cards with upload extension checks, 409 replacement confirmation, secret status editing, parameter defaults, test action, export download, and delete confirmation.
- [ ] Add navigation route and top-level nav item without changing editor routes.
- [ ] Add Chinese dictionary keys and English translations for every visible label, error, hint, and trusted-code warning.
- [ ] Add CSS using existing theme variables, pixel borders, responsive breakpoints, and accessible focus states; verify desktop and mobile layouts in the browser if available.
- [ ] Run `bun run typecheck` and relevant existing frontend tests.

### Task 8: Extend The Materials UI For Unified Media

**Files:**
- Modify: `apps/web/src/components/MaterialsPage.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/i18n/zh.ts`
- Modify: `apps/web/src/i18n/en.ts`
- Create: `tests/media-material-ui-state.test.ts`

**Interfaces:**
- Materials page filters `all`, `image`, `video`, and `audio` using `metadata.mediaKind` or the shared serialized field.
- Image cards retain existing actions; video cards render poster/player/download; audio cards render player/duration/download.
- Frame import controls remain unavailable for video/audio and show a translated explanation.

- [ ] Write state tests for media-kind filter, unknown/legacy metadata fallback to image, and action availability.
- [ ] Run the focused test and confirm failure.
- [ ] Add media-kind parsing at the API boundary so components do not repeatedly parse untrusted JSON.
- [ ] Render safe media previews and preserve existing crop/matting/layer/delete flows for images only.
- [ ] Add responsive card/player styles and translated labels.
- [ ] Run focused tests, `bun run typecheck`, and existing material/import tests.

### Task 9: Finish Documentation, Runtime Setup, And Full Verification

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/architecture.zh-CN.md`
- Modify: `AGENTS.md` if needed for new durable conventions.
- Modify: `README.md` or project setup docs if runtime setup scripts need user-facing instructions.
- Modify: `scripts/setup_media.ps1`, `scripts/setup_media.sh`

- [x] Document the independent plugin system, `.venv-media`, storage layout, trusted-code warning, JSON runner boundary, API routes, and MCP limitations in both architecture docs.
- [x] Document Windows and POSIX setup commands and the behavior when Python/dependencies are unavailable.
- [x] Run `bun run typecheck`. *(evidenced in `.superpowers/sdd/task-9-verification-report.md`; re-run on review-fix sessions)*
- [ ] Run the complete Bun test command used by the repository and the complete Python plugin-runtime tests. *(not re-run in Task 9 review-fix; focused media-plugin Bun suite only — see verification report)*
- [ ] Start the server and smoke test `/api/health`, `/api/config`, `/api/media-plugins`, `/generate`, plugin import, one job per media kind, material preview/download, and MCP list/generate. *(live smoke not re-run; MCP covered by unit tests only)*
- [ ] Verify cancellation terminates the Python child process and that failed runs do not leave plugin output or secrets in storage. *(not re-run as live server smoke; cancel covered by focused job/API tests only)*
- [ ] Remove smoke-test plugin packages, media-plugin run directories, and generated storage artifacts after verification. *(depends on live smoke; not claimed by verification report)*
- [ ] Review `git diff` and `git status` without staging or committing; confirm only intended source, test, and documentation files changed. *(skipped — user forbade git)*

## Self-Review Checklist

- Spec coverage: Tasks 1-2 cover contracts/runtime, Tasks 3-5 cover plugin management/API/queue/archive, Tasks 6-8 cover MCP/frontend/materials, and Task 9 covers docs/setup/verification.
- No `GenProvider` merge: explicitly preserved in Tasks 1, 4, and 9.
- No local-path MCP escape: enforced in Tasks 4 and 6.
- Secret redaction: enforced in Tasks 3-6 and UI settings behavior in Task 7.
- Three media kinds and unified materials: covered by Tasks 1, 4, 5, and 8.
- Queue cancellation and existing event reuse: covered by Task 4.
- Zip Slip/path safety and trusted executable warning: covered by Tasks 3, 5, and 7.
- API and architecture documentation updates: covered by Tasks 5 and 9.
- No placeholder instructions or incomplete implementation steps are used.
- Function names and payload names are consistent across tasks: `MediaKind`, `MediaPluginKind`, `createMediaGenerationJobs`, `runMediaPluginJob`, and `archiveMediaArtifact`.
