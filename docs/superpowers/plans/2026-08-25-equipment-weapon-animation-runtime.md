# Equipment, Weapon, Animation, And Terminal Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend FrameBaker with creator-facing character, equipment, weapon, action, validation, and `.fbanim` v3 workflows, then add the terminal engine Region/Cutout runtime and high-level character presentation protocol needed to consume those packages.

**Architecture:** Preserve the existing FrameBaker v2/v1 asset paths and skeletal editor. Add shared TypeScript domain types, validators, project persistence, and a v3 compiler first; expose those capabilities through incremental React workspaces backed by the existing undo/save/notice conventions. Add a Rust runtime that consumes the compiled v3 contract through immutable assets, fixed-step animation, deterministic assembly/IK, transformed Region rendering, and high-level OSC commands. Do not connect authoritative game data until the first four asset/runtime slices pass fixture parity.

**Tech Stack:** Bun 1.3, TypeScript strict mode, React 19, PixiJS/SVG existing skeletal editor, SQLite/Elysia APIs, Rust 2021, serde/serde_json, image PNG decoding, existing `pixel-engine` tests and OSC 7770 protocol.

## Global Constraints

- FrameBaker is a creator tool; data interfaces without create/edit/preview/validate/save/reopen/import/export UI are incomplete.
- `.fbanim` v2 remains readable; v3 is a new package contract and must not silently reinterpret v2.
- Runtime capability declarations list minimum required versions; omitted capabilities are not required.
- Required unsupported capabilities reject a package; optional effect implementations may be omitted with diagnostics.
- The initial terminal runtime supports Region/Cutout, fixed-step playback, transformed nearest-neighbor Regions, equipment assembly, motion events, and 2D two-bone IK; it does not support Mesh/LBS or runtime Warp.
- FrameBaker UI text and comments follow the repository Chinese `t()`/`useT()` convention; new user-visible strings go in `apps/web/src/i18n/zh.ts` and `apps/web/src/i18n/en.ts`.
- All mutations use existing project dirty-state, undo/redo, save queue, autosave/recovery, and unsaved-change confirmation behavior.
- Server writes use `STORAGE_ROOT`/existing `db.ts`; no cwd-relative storage paths.
- Do not introduce a router, DnD dependency, ORM, or new runtime dependency without a concrete review.
- Do not perform Git operations or commits unless explicitly requested by the user.
- The terminal-engine worktree contains pre-existing user changes; modify only files listed for a task and never clean or reset unrelated work.

---

## Current File Map

### FrameBaker

- Modify `packages/shared/src/animation.ts`: preserve v1/v2 Skeleton, CharacterBinding, MotionClip primitives and add only reusable validation helpers needed by v3.
- Modify `packages/shared/src/skeletalProject.ts`: version the project document and add BodyProfile, equipment, loadout, profiles, and compiled-action references.
- Create `packages/shared/src/equipment.ts`: stable equipment/body/socket/weapon/action domain types and pure validation/assembly functions.
- Create `packages/shared/src/animationPackageV3.ts`: v3 manifest, canonical package builder, verifier, and v2 compatibility boundary.
- Create `packages/shared/schemas/animation/v3/*.schema.json`: machine-readable schemas for BodyProfile, equipment, action profiles, and runtime clips.
- Modify `packages/shared/src/index.ts`: export the new domain and package APIs.
- Modify `apps/server/src/api/skeletalProjects.ts`: validate and persist v2/v3 project documents and equipment references.
- Modify `apps/server/src/db.ts`: add idempotent skeletal project content tables or document migration fields only when the existing JSON document cannot represent the new entities safely.
- Modify `apps/server/src/ws.ts` and shared WS constants only if new project/equipment change notifications are required by the UI.
- Modify `apps/web/src/components/SkeletalProjectEditor.tsx`: add the five-workspace shell, dirty/save coordination, loadout preview state, and v3 import/export entry points.
- Modify `apps/web/src/components/AnimationAssetsWorkspace.tsx`: preserve current Skeleton/Binding/Motion editors and extract reusable preview/inspector primitives without changing current motion semantics.
- Create `apps/web/src/components/BodyProfileWorkspace.tsx`: semantic bone mapping, slot/socket editing, mirror pairing, and diagnostics.
- Create `apps/web/src/components/EquipmentWorkspace.tsx`: equipment wizard, attachment inspector, loadout try-on, conflict display, and focused body-part preview.
- Create `apps/web/src/components/WeaponWorkspace.tsx`: grip/socket editing, handedness, mirror, IK reach preview, and dual-wield test setup.
- Create `apps/web/src/components/ActionWorkspace.tsx`: action templates, layer source view, event timeline controls, compatibility matrix, and fixed terminal preview.
- Create `apps/web/src/components/PublishWorkspace.tsx`: package closure/capability validation, diagnostics, version diff, fixture export, and v3 export.
- Modify `apps/web/src/api.ts`: typed project content, asset, validation, and fixture API methods.
- Modify `apps/web/src/i18n/zh.ts`, `apps/web/src/i18n/en.ts`, and `apps/web/src/styles.css`: all new UI copy and pixel-theme layout styles.
- Modify `apps/web/src/export.ts` or create `apps/web/src/skeletalExport.ts`: v3 export adapter, keeping existing spritesheet export separate.
- Create focused tests under `tests/`: domain validation, assembly, v3 package, project API, UI reducer/state helpers, and deterministic fixtures.

### Terminal Engine

- Modify `pixel-engine/src/assets.rs`: retain sprite manifest loading and add bounded v3 package/Region asset loading.
- Modify `pixel-engine/src/animation.rs`: retain existing Sprite clock and add deterministic runtime clip sampling/event crossing in a separate module or clearly separated section.
- Create `pixel-engine/src/skeletal_asset.rs`: serde DTOs, package limits, digest/reference verification, and immutable loaded asset representation.
- Create `pixel-engine/src/skeletal_animation.rs`: fixed-tick clip sampling, interpolation, action requests, blending, interrupt policies, and event crossing.
- Create `pixel-engine/src/character_assembly.rs`: slot validation, replacement/hide/attachment/effect assembly, and previous-valid-loadout retention.
- Create `pixel-engine/src/skeletal_constraints.rs`: FK, primary-grip alignment, 2D two-bone IK, joint limits, and socket world transforms.
- Create `pixel-engine/src/skeletal_render.rs`: transformed Region command generation and nearest-neighbor software rasterization.
- Create `pixel-engine/src/presentation_events.rs`: local weapon/effect/footstep event types and diagnostics.
- Modify `pixel-engine/src/protocol.rs`: high-level `character.*` OSC commands, bounded payload validation, and protocol tests.
- Modify `pixel-engine/src/scene.rs` and `pixel-engine/src/software_renderer.rs`: integrate runtime characters without changing existing Sprite/scene behavior.
- Modify `pixel-engine/src/lib.rs`: module exports.
- Create `pixel-engine/tests/skeletal_assets.rs`, `skeletal_animation.rs`, `skeletal_assembly.rs`, `skeletal_render.rs`, and `skeletal_protocol.rs`.
- Create canonical fixtures under `tests/fixtures/fbanim-v3/`; `scripts/sync_fbanim_fixtures.ts` copies the checked-in canonical bytes into the terminal engine's generated test-input directory `pixel-engine/tests/fixtures/fbanim-v3/`.

### Deferred Game Integration

- After Phases 1-4, inspect the game/client protocol files before editing them. The integration task will identify exact files then; no server file is pre-authorized by this plan.

## Fixture Contract

Every fixture is a directory containing:

```text
package.fbanim
loadout.json
actions.json
steps.json
expected-bones.json
expected-slots.json
expected-events.json
expected.png
```

Use these initial fixture IDs:

```text
minimal-region
eye-attachment
binocular-eye-multislot
cyber-arm-replacement
internal-chip-none
equipment-effect
rifle-right-primary
rifle-left-primary
dual-pistol
conflicting-loadout
action-event-boundary
```

TypeScript produces canonical package/expected data; Rust consumes the same
bytes and compares matrices/socket positions with explicit epsilon and pixels
with exact equality unless a fixture records a reviewed threshold.

## Tasks

### Task 1: Establish v3 Shared Domain Types And Schema

**Files:**
- Create: `packages/shared/src/equipment.ts`
- Modify: `packages/shared/src/skeletalProject.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/schemas/animation/v3/body-profile.schema.json`
- Create: `packages/shared/schemas/animation/v3/equipment.schema.json`
- Create: `packages/shared/schemas/animation/v3/action-profile.schema.json`
- Create: `packages/shared/schemas/animation/v3/common.schema.json`
- Test: `tests/equipment-domain.test.ts`

**Interfaces:**
- Consumes: existing `Transform`, `Skeleton`, `CharacterBinding`, `MotionClip`, and `ValidationResult` types from `packages/shared/src/animation.ts`.
- Produces: `BodyProfile`, `BodySlotDefinition`, `BodySocketDefinition`, `EquipmentDefinition`, `EquipmentAttachment`, `EquipmentEffectBinding`, `CharacterLoadout`, `EquippedItem`, `WeaponProfile`, `TwoBoneIkConstraint`, `ActionTemplate`, `ActionInterrupt`, `ContactRule`, `validateBodyProfile`, `validateEquipmentDefinition`, `validateLoadout`, and `assembleLoadout`.

- [ ] **Step 1: Write failing domain tests** for standard/custom sockets, all four visual modes, multi-slot/multi-attachment items, two-hand grip requirements, conflict tags, and invalid loadouts.
- [ ] **Step 2: Run `bun test tests/equipment-domain.test.ts`** and confirm failures identify missing exports/functions rather than malformed test setup.
- [ ] **Step 3: Add the exact domain interfaces** from the approved spec, using stable string IDs and existing Transform conventions. Do not copy game stats or authoritative inventory fields.
- [ ] **Step 4: Implement pure validators** that reject unknown visual modes, duplicate IDs, missing sockets, invalid slot capacity, invalid `two_hand` grip declarations, non-finite transforms, zero/negative IK parameters, and conflicting/over-capacity loadouts.
- [ ] **Step 5: Implement `assembleLoadout(bodyProfile, binding, definitions, loadout)`** returning a deterministic immutable result with visible parts, hidden parts, attachments, occupied slots, effects, resolved action overrides, and diagnostics.
- [ ] **Step 6: Add JSON schemas** with `additionalProperties: false`, bounded arrays/strings, explicit enums, and stable reference fields. Ensure schemas describe only persisted package data, not runtime caches.
- [ ] **Step 7: Run `bun test tests/equipment-domain.test.ts` and `bun run typecheck`**; expected result is all focused tests pass and both TypeScript projects typecheck.
- [ ] **Checkpoint:** inspect the diff and leave it uncommitted; no Git command beyond status/diff is allowed without user authorization.

### Task 2: Version Skeletal Project Persistence And API

**Files:**
- Modify: `packages/shared/src/skeletalProject.ts`
- Modify: `apps/server/src/api/skeletalProjects.ts`
- Modify: `apps/server/src/db.ts` only if migration is required by the chosen document shape
- Modify: `apps/server/src/ws.ts` only if content notifications are added
- Modify: `apps/web/src/api.ts`
- Modify: `docs/api.md`
- Modify: `docs/api.zh-CN.md`
- Test: `tests/skeletal-project.test.ts`
- Test: `tests/skeletal-project-api.test.ts`

**Interfaces:**
- Consumes: Task 1 domain validators and current `SkeletalProjectDocument` v1 API.
- Produces: `SkeletalProjectDocument` schema v2 with optional `bodyProfiles`, `equipment`, `loadouts`, `actionTemplates`, `stanceProfiles`, and `runtimePackageSettings`; `migrateSkeletalProjectDocument`; typed GET/PUT content API methods.

- [ ] **Step 1: Add migration tests** proving v1 documents load unchanged, v2 documents round-trip without unknown fields, invalid body-profile/equipment references are rejected, and missing material IDs retain current validation behavior.
- [ ] **Step 2: Run `bun test tests/skeletal-project.test.ts tests/skeletal-project-api.test.ts`** and confirm the new cases fail before implementation.
- [ ] **Step 3: Implement an explicit v1-to-v2 migration** that supplies empty arrays/defaults, never changes existing binding IDs or animation IDs, and strips transient runtime fields before persistence.
- [ ] **Step 4: Update `validateDocument`** to validate document version, project ID, entity limits, all stable references, body profile skeleton identity, loadout equipment IDs, and action/profile references using Task 1 validators.
- [ ] **Step 5: Keep the API response shape stable where possible** and add typed sub-resource methods only if a full-document PUT would exceed existing limits; document every endpoint in both API docs.
- [ ] **Step 6: Add idempotent SQLite migration only when needed**; if JSON v2 is sufficient, do not add tables. If tables are needed, keep them owned by the skeletal project and use existing `db` transaction style.
- [ ] **Step 7: Run `bun test tests/skeletal-project.test.ts tests/skeletal-project-api.test.ts` and `bun run typecheck`**.
- [ ] **Checkpoint:** verify API docs match route code and `git diff --check` is clean.

### Task 3: Build And Verify `.fbanim` v3 Packages

**Files:**
- Create: `packages/shared/src/animationPackageV3.ts`
- Create: `packages/shared/schemas/fbanim/v3/manifest.schema.json`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/web/src/export.ts` or create `apps/web/src/skeletalExport.ts`
- Test: `tests/animation-package-v3.test.ts`
- Test: `tests/animation-package-v2.test.ts` only for explicit compatibility assertions

**Interfaces:**
- Consumes: Task 1 domain types, Task 2 document types, existing canonical JSON/digest helpers, and v2 package builder/reader.
- Produces: `FBANIM_V3_VERSION`, `FbanimManifestV3`, `FbanimV3PackageSource`, `VerifiedFbanimV3Package`, `buildFbanimV3Entries`, `verifyFbanimV3Entries`, and `migrateV2PackageSource`.

- [ ] **Step 1: Write package tests** for deterministic ordering/digests, manifest capability floors, required/omitted capabilities, package closure, missing/extra entries, path traversal, byte limits, invalid PNG, invalid references, and v2 remaining readable.
- [ ] **Step 2: Run `bun test tests/animation-package-v3.test.ts tests/animation-package-v2.test.ts`** and verify the v3 tests fail while v2 behavior remains green.
- [ ] **Step 3: Define v3 manifest paths** for skeletons, bindings, body-profiles, equipment, motions, action-profiles, constraints, and textures with SHA-256 filenames and bounded package limits based on v2 constants.
- [ ] **Step 4: Implement canonical builder** that validates the source graph, compiles resolved runtime action clips, sorts all descriptors/entries, writes requirements as minimum versions, and rejects runtime Warp/Mesh requirements for the initial runtime.
- [ ] **Step 5: Implement verifier** that validates manifest schema, digest/byte length/path closure, each JSON asset, PNG signatures, cross-asset IDs, skeleton identity, and capability requirements without silently dropping data.
- [ ] **Step 6: Add v2 import adapter** that produces the v3 minimum representation only when the source contains no dynamic features; preserve original v2 importer behavior and error messages where tests rely on them.
- [ ] **Step 7: Run focused package tests, `bun run typecheck`, and `bun run test`**; expected result is all existing and new shared tests pass.
- [ ] **Checkpoint:** inspect canonical fixture bytes and ensure no generated storage or package archives are left in the repository.

### Task 4: Implement BodyProfile And Socket Creator UI

**Files:**
- Create: `apps/web/src/components/BodyProfileWorkspace.tsx`
- Modify: `apps/web/src/components/SkeletalProjectEditor.tsx`
- Modify: `apps/web/src/components/AnimationAssetsWorkspace.tsx`
- Modify: `apps/web/src/i18n/zh.ts`
- Modify: `apps/web/src/i18n/en.ts`
- Modify: `apps/web/src/styles.css`
- Test: `tests/body-profile-ui-state.test.ts`

**Interfaces:**
- Consumes: Task 1 `BodyProfile` validators, current `SkeletonPreview`, current `CharacterPreview`, Task 2 save API, and existing `notice`, `askConfirm`, `useT` patterns.
- Produces: creator actions for semantic mapping, socket creation/editing, mirror pairing, accepted tags, slot capacity, and diagnostics; a reusable `BodyProfileWorkspace` component accepting draft/profile/skeleton and `onChange`/`onSave` callbacks.

- [ ] **Step 1: Extract pure UI reducer/state tests** for selecting a bone, adding a socket, mirroring a socket pair, deleting a socket, dirty-state transitions, and one-command undo boundaries.
- [ ] **Step 2: Run the focused test and confirm it fails** because the reducer/component state is absent.
- [ ] **Step 3: Implement the workspace** with Skeleton, Body Parts, and Body Semantics modes while preserving existing SkeletonEditor/BindingEditor behavior.
- [ ] **Step 4: Add canvas overlays** for socket markers, selected socket handles, accepted-tag inspector, standard/custom semantic selection, and action-time socket follow preview.
- [ ] **Step 5: Integrate dirty state and undo/redo** with one undoable command per guided operation; switching/closing a workspace must use `askConfirm` for unsaved edits.
- [ ] **Step 6: Add Chinese/English UI strings and CSS** using existing variables, stepped borders, Fusion Pixel font, and dark/light theme tokens only.
- [ ] **Step 7: Run `bun test tests/body-profile-ui-state.test.ts` and `bun run typecheck`**; manually smoke `bun dev` and verify create/edit/save/reopen with a skeletal fixture.
- [ ] **Checkpoint:** no direct JSON editor is exposed as the required path; import/export remains a separate advanced operation.

### Task 5: Implement Equipment, Cyberware, And Loadout UI

**Files:**
- Create: `apps/web/src/components/EquipmentWorkspace.tsx`
- Modify: `apps/web/src/components/SkeletalProjectEditor.tsx`
- Modify: `apps/web/src/components/AnimationAssetsWorkspace.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/i18n/zh.ts`
- Modify: `apps/web/src/i18n/en.ts`
- Modify: `apps/web/src/styles.css`
- Test: `tests/equipment-ui-state.test.ts`
- Test: `tests/equipment-fixtures.test.ts`

**Interfaces:**
- Consumes: Task 1 domain/assembly functions, Task 2 persistence, Task 4 BodyProfile state and preview primitives.
- Produces: wizard state for identity/tags/visual mode/slots/attachments/replacement/effects, saved `CharacterLoadout` try-ons, conflict diagnostics, attachment transform edits, and fixture export inputs.

- [ ] **Step 1: Write reducer tests** for wizard transitions, visual-mode-specific required fields, multi-slot attachment edits, conflict display, save/reopen, and retaining the previous valid loadout after an invalid selection.
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Implement the equipment library and seven-step wizard**; prevent completion when required fields for the selected visual mode are absent.
- [ ] **Step 4: Implement direct canvas attachment editing** for translate/rotate/scale/pivot/socket/material/draw order, with focused zoom for eye/hand/body sockets and mirror-copy as one undoable operation.
- [ ] **Step 5: Implement Loadout try-on** with BodyProfile selection, add/remove equipment, saved test loadouts, action playback, facing toggle, hidden-base toggle, isolation, and exact conflict reasons.
- [ ] **Step 6: Add the fixed sample assets** for helmet, monocular/binocular eyes, cyber-arm, back device, internal chip, and event-driven effect as deterministic test fixtures, not production game content.
- [ ] **Step 7: Run focused tests, `bun run typecheck`, and manual browser smoke** for create/edit/preview/diagnose/save/reopen/import/export.
- [ ] **Checkpoint:** verify `none` creates no persistent draw attachment, `replacement` removes declared base parts, and invalid combinations do not mutate the previous legal preview.

### Task 6: Implement Actions, Profiles, Events, And Compatibility UI

**Files:**
- Create: `apps/web/src/components/ActionWorkspace.tsx`
- Modify: `apps/web/src/components/AnimationAssetsWorkspace.tsx`
- Modify: `apps/web/src/components/SkeletalProjectEditor.tsx`
- Modify: `packages/shared/src/equipment.ts` if action compilation belongs with domain code
- Modify: `apps/web/src/i18n/zh.ts`
- Modify: `apps/web/src/i18n/en.ts`
- Modify: `apps/web/src/styles.css`
- Test: `tests/action-composition.test.ts`
- Test: `tests/action-ui-state.test.ts`

**Interfaces:**
- Consumes: Task 1 action templates/profiles, Task 3 compiled v3 representation, current `sampleMotionClip`/event editing APIs, and Task 5 Loadout preview.
- Produces: `compileActionSet`, action-template editor state, semantic event insertion/deletion, layer-source inspection, compatibility matrix results, and fixed terminal-preview inputs.

- [ ] **Step 1: Write composition tests** for base/profile/override/correction order, narrow override inheritance, event ordering, loop boundary behavior, fallback action, and layer ownership.
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Implement pure `compileActionSet`** returning resolved RuntimeMotionClips and diagnostics; preserve existing MotionClip v1/v2 sampling and warp tests.
- [ ] **Step 4: Add template creation UI** for idle/move/aim/fire/reload/hit/death/custom with loop, required events, allowed events, interrupt, fallback, and recommended key poses.
- [ ] **Step 5: Add layer-source inspection** so creators can view base, stance, equipment, pre-constraint, and post-constraint results while only editing owned layers.
- [ ] **Step 6: Add semantic event controls** for weapon/equipment/effect/combat/movement events, socket selection, reload order, and muzzle placeholder preview.
- [ ] **Step 7: Add compatibility matrix** across BodyProfiles, weapons, handedness, cyberlimbs, and saved Loadouts; clicking a failed cell must load the exact combination/time.
- [ ] **Step 8: Run focused tests, `bun run typecheck`, and manual fixed-time playback smoke.**
- [ ] **Checkpoint:** verify event tracks never become authoritative combat mutations and one-shot events do not repeat at loop boundaries.

### Task 7: Implement Publish Workspace And Cross-Repo Fixture Export

**Files:**
- Create: `apps/web/src/components/PublishWorkspace.tsx`
- Modify: `apps/web/src/components/SkeletalProjectEditor.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/export.ts` or `apps/web/src/skeletalExport.ts`
- Modify: `apps/web/src/i18n/zh.ts`
- Modify: `apps/web/src/i18n/en.ts`
- Modify: `apps/web/src/styles.css`
- Create: `tests/publish-workspace.test.ts`
- Create: `tests/fixtures/minimal-region/*`

**Interfaces:**
- Consumes: Task 3 v3 builder/verifier, Task 4-6 editors/validators, and current zip/download helpers.
- Produces: ordered publish diagnostics, package capability display, previous-package diff, fixture export, and deterministic `.fbanim` v3 download.

- [ ] **Step 1: Write publish tests** for validation ordering, errors blocking export, warnings requiring confirmation, reference closure, full-duration IK sampling, capability rejection, deterministic bytes, and v2 import/v3 export.
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Implement `collectPublishDiagnostics`** with the exact ten-stage order from the spec and stable diagnostic codes/paths for UI linking.
- [ ] **Step 4: Implement Publish workspace** showing package contents, requirements, assets, actions, textures, fixtures, errors/warnings, prior-version diff, and 320x180 preview.
- [ ] **Step 5: Add fixture exporter** that emits package, loadout, action steps, expected snapshots, and metadata into a ZIP without writing to `storage/`.
- [ ] **Step 6: Run focused tests, `bun run typecheck`, `bun run test`, and `git diff --check`.**
- [ ] **Checkpoint:** manually verify a package with runtime Warp or Mesh requirement is refused; no error is hidden behind a transparent fallback.

### Task 8: Add Rust v3 Asset Loader And Shared Fixture Reader

**Files:**
- Create: `pixel-engine/src/skeletal_asset.rs`
- Modify: `pixel-engine/src/assets.rs`
- Modify: `pixel-engine/src/lib.rs`
- Test: `pixel-engine/tests/skeletal_assets.rs`
- Add: canonical fixture package files generated by Task 7 under `tests/fixtures/fbanim-v3/`

**Interfaces:**
- Consumes: Task 3 v3 package contract and Task 7 fixture ZIP contents.
- Produces: `SkeletalPackage`, `SkeletalAssetError`, `LoadedSkeleton`, `LoadedBodyProfile`, `LoadedEquipmentDefinition`, `RuntimeMotionClip`, `PackageRequirements`, and bounded `load_skeletal_package(entries)`.

- [ ] **Step 1: Add Rust tests** for valid minimal package, digest mismatch, missing entry, extra entry, path traversal, byte/entry caps, invalid JSON, unsupported required capability, invalid PNG, and v2 rejection/explicit legacy path.
- [ ] **Step 2: Run `cargo test -p tui-rpg-pixel-engine --test skeletal_assets`** and confirm expected failures.
- [ ] **Step 3: Define serde DTOs** matching canonical v3 JSON and convert them into owned/`Arc` runtime structures; do not deserialize unbounded arbitrary JSON into runtime state.
- [ ] **Step 4: Implement path/digest/reference/size validation** before decoding assets and use the existing image PNG decoder for texture bytes.
- [ ] **Step 5: Expose immutable package lookup methods** for skeletons, body profiles, equipment, actions, textures, and capability requirements.
- [ ] **Step 6: Run focused test, `cargo fmt --check`, and `cargo clippy -p tui-rpg-pixel-engine --all-targets -- -D warnings`** where the local toolchain permits; otherwise record the linker/toolchain blocker without treating it as a code result.
- [ ] **Checkpoint:** verify existing `assets.rs` Sprite manifest tests still pass unchanged.

### Task 9: Add Rust FK, Fixed-Step Actions, And Event Crossing

**Files:**
- Create: `pixel-engine/src/skeletal_animation.rs`
- Modify: `pixel-engine/src/animation.rs` only for shared fixed-tick constants/helpers
- Modify: `pixel-engine/src/lib.rs`
- Test: `pixel-engine/tests/skeletal_animation.rs`

**Interfaces:**
- Consumes: Task 8 `RuntimeMotionClip`, skeleton data, and existing `FIXED_STEP`/`FixedClock` semantics.
- Produces: `ActionRequest`, `ActionInterrupt`, `ActionPlayback`, `BlendState`, `SkeletalPose`, `MotionEvent`, `advance_action`, `sample_action`, and `crossed_events(previous_tick, current_tick)`.

- [ ] **Step 1: Write tests** for integer tick accumulation, loop/hold/once, interpolation, action priority, immediate/event-boundary/non-interruptible interruption, blend continuity, one-shot event uniqueness, loop boundary event delivery, and deterministic repeated playback.
- [ ] **Step 2: Run focused test and confirm failure.**
- [ ] **Step 3: Implement local transform sampling and FK** using the same coordinate convention as the TypeScript fixture producer; explicitly document Y-up/Y-down conversion at the package boundary.
- [ ] **Step 4: Implement action request resolution and blending** without a general visual state machine; preserve the fixed 60 Hz clock and integer tick accumulation.
- [ ] **Step 5: Implement event crossing** with loop-aware intervals and deduplication keys so one-shot events fire exactly once per crossing.
- [ ] **Step 6: Run focused test, full pixel-engine tests, and formatting/lint checks.**
- [ ] **Checkpoint:** compare `minimal-region` expected matrices/event sequence against TypeScript output before adding constraints.

### Task 10: Add Rust Loadout Assembly And Two-Bone IK

**Files:**
- Create: `pixel-engine/src/character_assembly.rs`
- Create: `pixel-engine/src/skeletal_constraints.rs`
- Modify: `pixel-engine/src/lib.rs`
- Test: `pixel-engine/tests/skeletal_assembly.rs`
- Test: `pixel-engine/tests/skeletal_animation.rs` for constraint ordering

**Interfaces:**
- Consumes: Task 8 immutable assets, Task 9 `SkeletalPose`, and fixture loadouts.
- Produces: `RuntimeCharacter`, `AssemblyDiagnostic`, `assemble_character`, `apply_constraints`, `TwoBoneIkResult`, `WorldSocket`, and deterministic previous-valid-loadout behavior.

- [ ] **Step 1: Write tests** for none/attached/replacement/effect, multi-slot occupancy, conflict rejection, previous-valid retention, primary-grip alignment, reachable/unreachable IK, bend direction, no-stretch/limited-stretch, mirrorAllowed, zero-length bones, and non-finite rejection.
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Implement assembly** in the exact order: base binding, slot/conflict validation, replacement, hide, attachments, effects, action resolution, immutable cache.
- [ ] **Step 4: Implement FK/world matrices and semantic socket resolution** with explicit handedness/facing mirror transform.
- [ ] **Step 5: Implement two-bone 2D IK** with primary-hand parented weapon, secondary-grip target, bend sign, angle limits, and bounded stretch; return structured diagnostics rather than panic.
- [ ] **Step 6: Implement fixed constraint order** and re-evaluate affected world matrices before resolving muzzle/eject sockets.
- [ ] **Step 7: Run focused tests and fixture comparisons for eye, cyber-arm, rifle right/left, dual pistol, and conflict cases.**
- [ ] **Checkpoint:** runtime never silently disconnects the off-hand; publication/runtime diagnostics identify the failing constraint.

### Task 11: Add Transformed Region Software Rendering

**Files:**
- Create: `pixel-engine/src/skeletal_render.rs`
- Modify: `pixel-engine/src/software_renderer.rs`
- Modify: `pixel-engine/src/scene.rs`
- Modify: `pixel-engine/src/lib.rs`
- Test: `pixel-engine/tests/skeletal_render.rs`
- Test: `pixel-engine/tests/render_snapshots.rs` only for non-regression integration

**Interfaces:**
- Consumes: Task 8 texture/Region data and Task 10 world poses/socket transforms.
- Produces: `RegionDrawCommand`, `build_region_commands`, `raster_region_nearest`, and runtime-character scene integration.

- [ ] **Step 1: Write tests** for translation, pivot, Z rotation, non-uniform scale, horizontal mirror, opacity, tint, draw order, clipping, transparent pixels, nearest-neighbor sampling, and exact 320x180 golden output.
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Implement command generation** from ordered runtime slots and world transforms without altering existing Sprite draw commands.
- [ ] **Step 4: Implement inverse-mapped nearest-neighbor software rasterization** using integer-safe bounds and no bilinear filtering.
- [ ] **Step 5: Integrate runtime characters into scene render order** with explicit layer/draw-order rules and no per-frame package reassembly.
- [ ] **Step 6: Run focused and existing render tests plus a nominal benchmark capture**; record bone/Region/character counts and CPU time for later threshold setting.
- [ ] **Checkpoint:** compare the `minimal-region` and `eye-attachment` PNGs exactly against TypeScript fixture output.

### Task 12: Add High-Level OSC Character Protocol And Presentation Bus

**Files:**
- Create: `pixel-engine/src/presentation_events.rs`
- Modify: `pixel-engine/src/protocol.rs`
- Modify: `pixel-engine/src/scene.rs`
- Modify: `pixel-engine/src/lib.rs`
- Test: `pixel-engine/tests/skeletal_protocol.rs`
- Test: `pixel-engine/tests/protocol.rs` for existing command compatibility

**Interfaces:**
- Consumes: Tasks 8-11 runtime APIs.
- Produces: `character.spawn`, `character.set_loadout`, `character.play_action`, `character.set_facing`, `character.remove`, `PresentationEvent`, `PresentationDiagnostic`, and bounded command validation.

- [ ] **Step 1: Write serde/protocol tests** for valid commands, missing/overlong IDs, invalid positions/layers, unknown fields, payload limits, sequence handling, and unchanged existing commands.
- [ ] **Step 2: Run focused protocol tests and confirm failure.**
- [ ] **Step 3: Add high-level command variants** using stable package/equipment/action/instance IDs; never add bone matrix arrays or per-frame pose payloads.
- [ ] **Step 4: Add scene handlers** that load/reuse immutable packages, assemble on spawn/loadout change, request actions, set facing, and retain previous legal state on invalid update.
- [ ] **Step 5: Add local presentation events** for weapon fire/eject, equipment activation, effects, footsteps, and diagnostics; events may affect local effects/audio only.
- [ ] **Step 6: Run all pixel-engine tests and protocol snapshot tests.**
- [ ] **Checkpoint:** inspect serialized OSC size/rate behavior against existing 64 KiB and command-rate caps.

### Task 13: Complete Cross-Repository Fixture Parity And Phase Acceptance

**Files:**
- Create: `scripts/sync_fbanim_fixtures.ts`
- Create: `tests/cross-repo-fixtures.test.ts`
- Create: `tests/fixtures/fbanim-v3/` canonical fixture files
- Create: `pixel-engine/tests/fixtures/fbanim-v3/` generated Rust test-input files
- Modify: `pixel-engine/tests/skeletal_assets.rs`
- Modify: `pixel-engine/tests/skeletal_animation.rs`
- Modify: `pixel-engine/tests/skeletal_assembly.rs`
- Modify: `pixel-engine/tests/skeletal_render.rs`
- Modify: `docs/superpowers/specs/2026-08-25-equipment-weapon-animation-runtime-design.md` only if an observed contract requires clarification
- Modify: `docs/architecture.md`, `docs/architecture.zh-CN.md`, and `AGENTS.md` when actual directory/API boundaries change

**Interfaces:**
- Consumes: all prior FrameBaker and Rust task outputs.
- Produces: one repeatable fixture command and a report that compares package validity, matrices, sockets, slots, events, and PNGs across both implementations.

- [ ] **Step 1: Add fixture parity tests** for all eleven fixture IDs and explicit epsilon/pixel policies.
- [ ] **Step 2: Run the TypeScript fixture command** and verify canonical expected files are reproducible byte-for-byte.
- [ ] **Step 3: Run Rust fixture tests** against the exact generated bytes, not re-created Rust-native fixtures.
- [ ] **Step 4: Resolve every mismatch** by identifying coordinate, interpolation, constraint order, draw-order, or serialization cause; do not loosen thresholds to hide a mismatch.
- [ ] **Step 5: Run FrameBaker `bun run test`, `bun run typecheck`, and terminal `cargo test -p tui-rpg-pixel-engine`** (or the documented Docker/Linux equivalent if Windows lacks the linker).
- [ ] **Step 6: Perform manual GUI acceptance** at 320x180, integer scales, both facings, rapid loadout changes, continuous actions, multiple characters, weapon effects, and a 30-minute loop; record measured counts/timings rather than inventing thresholds.
- [ ] **Checkpoint:** update architecture/API docs only for implemented routes/modules; do not claim game integration is complete.

## Deferred Game Integration

Game-server/client presentation integration is intentionally not an execution
task in this plan. After Tasks 1-13 pass, create a separate integration
mini-spec by inspecting the current server snapshot, Gunner combat mapping, and
client presentation boundary. That follow-up must define exact protocol files,
stable presentation-ID ownership, reconnect behavior, missing-asset behavior,
and contract tests before changing server/client code. It must preserve server
authority and must not deploy without a separate explicit request.

## Verification Contract

Run after each TypeScript task:

```powershell
bun test tests/equipment-domain.test.ts
bun run typecheck
```

Run after each Rust task affecting `pixel-engine`:

```powershell
cargo test -p tui-rpg-pixel-engine --test skeletal_assets
cargo clippy -p tui-rpg-pixel-engine --all-targets -- -D warnings
```

Run at the Phase 1-4 boundary:

```powershell
bun test
bun run typecheck
cargo test -p tui-rpg-pixel-engine
```

If Windows lacks MSVC `link.exe`, run the Rust contract in the project Docker/Linux workflow instead of treating the linker failure as a feature failure. Before any completion statement, inspect `git diff --check`, `git status --short`, and the full focused command output.

## Spec Coverage Self-Review

- Domain model: Task 1.
- Persistence and stable IDs: Task 2.
- `.fbanim` v3, capability floors, v2 boundary, deterministic export: Task 3 and Task 7.
- Character/body/socket creator UI: Task 4.
- Visible/non-visible equipment, cyberware, multi-slot, replacement, effects: Task 5.
- Action layers, templates, events, overrides, compatibility matrix: Task 6.
- Publish diagnostics, fixture generation, terminal preview: Task 7.
- Region/FK/fixed-step runtime: Tasks 8-9.
- Assembly, handedness, IK, sockets, failure semantics: Task 10.
- Rotated Region software renderer: Task 11.
- High-level OSC protocol and presentation events: Task 12.
- Cross-repo deterministic fixtures and GUI acceptance: Task 13.
- Real game integration is deliberately deferred and requires a separate
  integration mini-spec after Task 13.

The plan contains no placeholder task names, no silent fallback for required
features, and no implementation step that requires hand-editing JSON instead of
the creator UI.
