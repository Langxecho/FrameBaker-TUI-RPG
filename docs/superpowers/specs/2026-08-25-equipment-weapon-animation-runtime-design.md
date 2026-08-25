# FrameBaker Equipment, Weapon, Animation, And Terminal Runtime Design

## Status

Approved design baseline for implementation planning. This document defines the
creator workflow, runtime package, and terminal-engine integration needed for
wearable equipment, cyberware, one-handed and two-handed weapons, and reusable
character actions.

This is not a production deployment plan. It does not authorize changes to the
game server, production flags, or deployed services.

## Context

FrameBaker already provides Skeleton, MotionClip, CharacterBinding, Region
Attachment, FK evaluation, attachment tracks, motion events, project editing,
and deterministic `.fbanim` v2 packages. Its current binding is a Region/Cutout
system. It is not a weighted Mesh/LBS runtime.

The terminal pixel engine at `F:\CodeProject\tui-rpg-terminal-engine` currently
renders a fixed 320x180 canvas through OSC 7770. It supports Sprite animations,
layers, fixed-step playback, and effects, but does not support bone hierarchies,
rotated Region attachments, equipment assembly, IK, or `.fbanim` packages.

The target architecture keeps FrameBaker as the authoring and validation tool,
uses a versioned `.fbanim` package as the runtime contract, and adds a
Region/Cutout skeletal runtime to the terminal engine. The game server remains
authoritative for equipment, combat, and character state.

## Goals

- Let creators build and edit characters, equipment, cyberware, weapons, and
  actions without hand-editing JSON.
- Support visible attachments, body-part replacements, non-visible equipment,
  and event-driven equipment effects.
- Support standard body semantics plus project-defined custom sockets.
- Support multi-slot equipment and multiple visual attachments per item.
- Support left- or right-handed one-hand weapons, dual wielding, and two-hand
  weapons with primary and secondary grips.
- Reuse actions through base actions, stance profiles, equipment corrections,
  and narrow action overrides.
- Export deterministic, capability-declared runtime packages.
- Render and animate those packages in the terminal engine with dynamic
  loadouts and deterministic local presentation events.
- Develop FrameBaker and terminal runtime in compatible vertical slices backed
  by shared fixtures.

## Non-Goals

The first program of work does not include:

- Mesh Attachment or weighted LBS skinning.
- Automatic weight generation or weight-painting UI.
- 3D skeletons, physics cloth, ragdolls, or arbitrary scripted constraints.
- A general visual animation state-machine editor.
- Per-frame poses sent by the game server.
- Silent degradation of unsupported required asset capabilities.
- Production deployment.

## Architecture

```text
FrameBaker
  character, equipment, weapon, action, constraint authoring
  preview, diagnostics, compilation, publication
          |
          v
.fbanim v3
  versioned JSON + PNG runtime package
          |
          v
Terminal Engine
  Region skeletal runtime, loadout assembly, actions, IK, rendering,
  local presentation events
          ^
          |
Game Client / Server
  authoritative loadout and combat semantics; high-level action requests
```

FrameBaker owns authoring and package compilation. The terminal engine consumes
compiled runtime facts. The server never owns animation frames or bone poses.

## Domain Model

The examples below use the existing FrameBaker `Transform` convention. New
cross-file references use stable asset IDs and are validated before save and
again before publication.

### BodyProfile

`BodyProfile` maps stable skeleton bones to game-facing body semantics and
attachment sockets. It does not replace Skeleton or CharacterBinding.

```ts
interface BodyProfile {
  schemaVersion: number;
  id: string;
  name: string;
  skeletonId: string;
  mirrorAxis: "x";
  slots: BodySlotDefinition[];
  sockets: BodySocketDefinition[];
}

interface BodySlotDefinition {
  id: string;
  semantic: string;
  capacity: number;
  accepts: string[];
}

interface BodySocketDefinition {
  id: string;
  semantic: string;
  boneId: string;
  rest: Transform;
  accepts: string[];
  mirrorSocketId?: string;
}
```

Standard semantics include:

```text
head, face, eye_left, eye_right, ear_left, ear_right, neck, chest, back,
arm_left, arm_right, forearm_left, forearm_right, hand_left, hand_right,
leg_left, leg_right, foot_left, foot_right,
weapon_hand_left, weapon_hand_right
```

Projects may define custom semantics such as `spine_implant`,
`shoulder_cannon`, `tail`, or `drone_mount`. Stable IDs, not display names,
form references.

### Base Body Parts

CharacterBinding attachments gain authoring metadata that identifies whether a
part is foundational, replaceable, or permanently attached. Runtime package
compilation resolves these fields into explicit part groups and hide tags.

```ts
interface BodyPartMetadata {
  semantic: string;
  category: "base" | "replaceable" | "permanent-attachment";
  hideTags: string[];
  replaceable: boolean;
  drawGroup: string;
}
```

This prevents cyberware replacement from guessing body parts by material name.

### EquipmentDefinition

```ts
type EquipmentVisualMode = "none" | "attached" | "replacement" | "effect";

interface EquipmentDefinition {
  schemaVersion: number;
  id: string;
  name: string;
  tags: string[];
  visualMode: EquipmentVisualMode;
  primarySlot: string;
  occupiedSlots: string[];
  conflictTags: string[];
  replacesParts: string[];
  hidesSlots: string[];
  attachments: EquipmentAttachment[];
  actionProfile?: string;
  actionOverrides?: Record<string, string>;
  effectBindings?: EquipmentEffectBinding[];
  weapon?: WeaponProfile;
}

interface EquipmentAttachment {
  id: string;
  name: string;
  socket: string;
  materialId: string;
  imageSlot: "raw" | "processed";
  size: [number, number];
  pivot: [number, number];
  rest: Transform;
  drawGroup: string;
  drawOffset: number;
}

interface EquipmentEffectBinding {
  event: string;
  effectId: string;
  socket?: string;
  enabledState?: string;
}
```

Visual-mode behavior is fixed:

- `none`: no persistent visual attachment, suitable for internal chips.
- `attached`: add one or more visual attachments to body sockets.
- `replacement`: remove declared body parts before adding attachments.
- `effect`: register event- or state-driven presentation effects without a
  persistent Region.

One item may occupy multiple slots and provide multiple attachments. A
binocular cyber-eye can use `eye_left` as its primary slot, occupy `eye_right`,
replace both eye parts, and attach distinct left and right textures.

### CharacterLoadout

```ts
interface CharacterLoadout {
  bodyProfileId: string;
  equipment: EquippedItem[];
}

interface EquippedItem {
  equipmentId: string;
  instanceId?: string;
  primarySlot: string;
  variant?: string;
}
```

Assembly order is deterministic:

1. Load the base CharacterBinding.
2. Validate slot capacity, occupied slots, accepted tags, and conflict tags.
3. Apply replacement rules and remove replaced base parts.
4. Apply hide rules.
5. Add attached and replacement Regions.
6. Register effect bindings.
7. Resolve stance profiles and action overrides.
8. Build an immutable runtime assembly used until the loadout changes.

Invalid loadouts are rejected. A runtime loadout update retains the previous
legal assembly when the new loadout is invalid.

## Weapon Model

Weapons are EquipmentDefinitions with a WeaponProfile.

```ts
interface WeaponProfile {
  holdMode: "one_hand" | "two_hand" | "either";
  preferredPrimaryHand: "left" | "right";
  mirrorAllowed: boolean;
  primaryGrip: Transform;
  secondaryGrip?: Transform;
  muzzleSocket?: Transform;
  ejectSocket?: Transform;
  stanceProfile: string;
  recoilProfile?: string;
  secondaryHandConstraint?: TwoBoneIkConstraint;
}

interface TwoBoneIkConstraint {
  id: string;
  upperBoneId: string;
  lowerBoneId: string;
  endBoneId: string;
  targetSocket: string;
  bendDirection: "positive" | "negative";
  mix: number;
  stretch: "forbid" | "limited";
  maxStretch?: number;
}
```

The weapon is parented through its primary grip. The secondary hand follows the
weapon's secondary grip through 2D two-bone IK. The weapon is never driven by
both hands, avoiding a cyclic constraint.

One-hand weapons occupy one hand slot. An `either` weapon may use either hand
when allowed. Dual wielding uses two independent one-hand weapon instances.
Two-hand weapons occupy a primary hand slot and the opposite hand slot.

The initial IK implementation is two-dimensional and rotates bones around Z.
Stretch is forbidden unless explicitly bounded. Zero-length bones, unreachable
targets, invalid joint bends, and non-finite results block publication. Left-hand
primary use requires `mirrorAllowed` and successful mirror validation.

Constraint evaluation order is:

1. Sample and combine authored action tracks.
2. Apply equipment bone corrections.
3. Evaluate initial FK.
4. Align weapon primary grip to the primary-hand socket.
5. Compute secondary-grip world position.
6. Solve secondary-arm two-bone IK.
7. Apply wrist and aim constraints.
8. Re-evaluate affected world matrices.
9. Resolve muzzle, eject, and other socket world transforms.

## Action System

Actions are layered during authoring and compiled into resolved runtime clips.
The terminal engine does not resolve authoring inheritance.

Layers are applied in this order:

1. Base action.
2. Profession action or stance profile.
3. Equipment action override.
4. Equipment correction tracks.
5. Weapon and IK constraints.
6. Temporary presentation offsets.
7. Final FK.

Action families include base actions (`idle`, `move`, `hit`, `death`),
profession actions, and stance profiles such as `pistol_one_hand`,
`dual_pistol`, `rifle_two_hand`, and `heavy_two_hand`.

An equipment definition overrides only actions that genuinely differ. A
bullpup rifle may override `reload` without cloning every rifle action.

```ts
interface ActionTemplate {
  id: string;
  loop: boolean;
  requiredTracks: string[];
  requiredEvents: string[];
  allowedEvents: string[];
  contactRules: ContactRule[];
  constraintRules: string[];
  fallbackAction?: string;
  defaultInterrupt: ActionInterrupt;
  defaultBlendMs: number;
}

type ActionInterrupt = "immediate" | "event-boundary" | "non-interruptible";

interface ContactRule {
  semantic: string;
  requiredFrom: number;
  requiredUntil: number;
  tolerancePixels: number;
}

interface StanceProfile {
  id: string;
  requiredActions: string[];
  optionalActions: string[];
  constraints: string[];
}
```

The initial `rifle_two_hand` profile requires `hold`, `aim`, `fire`, `reload`,
`move`, `hit`, and `death`.

Standard motion events include:

```text
weapon.fire
weapon.eject
weapon.reload.detach
weapon.reload.attach
weapon.reload.complete
weapon.melee.active
weapon.melee.inactive
equipment.activate
equipment.deactivate
equipment.swap
effect.trigger
combat.hitbox.start
combat.hitbox.end
combat.invulnerable.start
combat.invulnerable.end
movement.footstep.left
movement.footstep.right
```

Event payloads reference semantic sockets. `weapon.fire` requires an existing
`muzzle` socket. Reload detach, attach, and completion events must be ordered.
Animation events drive local presentation only; they never determine combat
authority.

Runtime action requests contain an action ID, priority, interrupt policy, and
blend duration. The first engine adapter supports `idle`, `moving`, `aiming`,
`attacking`, `reloading`, `hit`, `dead`, and `skill` states without introducing
a general state-machine authoring system.

## Creator-Facing FrameBaker UI

FrameBaker remains one application. A skeletal project gains five primary
workspaces:

```text
Character | Equipment | Weapons | Actions | Publish
```

Every capability is complete only when a creator can create, edit, preview,
validate, save, reopen, import, and export it without editing JSON.

All new workspace mutations participate in the existing project dirty-state,
undo/redo, autosave or recovery, and close-with-unsaved-changes behavior. A
multi-step operation such as mirroring a socket pair or applying a guided
equipment form is one undoable command. Switching workspaces must not discard
an incomplete edit without an explicit creator decision.

### Character Workspace

The character workspace has Skeleton, Body Parts, and Body Semantics modes.

Skeleton mode retains the bone tree, Rest Pose, transforms, joint tests,
binding, pivot, draw order, and warp tools. It adds semantic mapping,
left/right pairing, mirror-axis configuration, BodyProfile selection, bone
length diagnostics, and IK validity diagnostics.

Body Parts mode classifies attachments as base, replaceable, or permanent. It
edits part semantics, hide tags, draw groups, replacement eligibility, Region
geometry, and materials.

Body Semantics mode overlays sockets on the character. Creators can add a
socket on a selected bone, drag and rotate it, set accepted equipment tags,
assign standard or custom semantics, mirror paired sockets, and inspect socket
motion while actions play.

### Equipment Workspace

The equipment workspace contains an equipment library, live character and
loadout preview, and an inspector. Creation is a guided flow:

1. Basic identity and tags.
2. Visual mode.
3. Primary and occupied slots.
4. Visual attachments.
5. Replacement and hide rules.
6. Action overrides and effects.
7. Compatibility tests.

Attachments are edited directly on the character canvas with translate,
rotate, scale, pivot, socket selection, draw order, material replacement,
copy, and mirror tools. Fine body locations such as eyes automatically offer a
focused zoom view.

The loadout preview supports adding and removing equipment, selecting a
BodyProfile, saving test loadouts, playing actions, toggling facing, showing
hidden base parts, and isolating selected equipment. Conflicts display the
specific rule and do not silently replace another item.

### Weapon Workspace

The weapon editor overlays the character skeleton, hand sockets, weapon image,
grips, muzzle, eject point, IK chain, and reach envelope.

The guided flow selects the weapon texture and hold mode, then configures the
primary hand, primary grip, optional secondary grip, muzzle and eject sockets,
stance profile, mirror behavior, and compatibility tests.

Grip and socket points are dragged directly on the weapon. Secondary-grip
editing shows the IK chain and reach envelope. An invalid frame identifies
whether reach, bend direction, or joint limits caused the failure. The toolbar
provides right-primary, left-primary, dual-wield, and mirror previews. Invalid
or unsupported modes are disabled with a reason.

### Action Workspace

The action workspace contains an action/profile tree, live equipped-character
preview, bone/attachment/event timeline, and template/constraint diagnostics.

Creators can inspect the composed result or isolate base, stance, equipment,
pre-constraint, and post-constraint layers. Editing is restricted to the owned
layer so referenced assets are not mutated accidentally.

New actions begin from a template such as idle, move, aim, fire, reload, hit,
death, or custom. Templates populate loop, required events, interrupt rules,
constraints, fallback, and recommended key poses. A simplified key-pose mode
offers start, anticipation, action, and recovery poses while advanced mode
retains per-track editing.

Events use semantic choices rather than arbitrary strings. Selecting
`weapon.fire` lists valid weapon sockets and previews a muzzle placeholder at
the selected time. Reload event ordering is visible and validated.

The compatibility matrix runs an action against selected BodyProfiles,
weapons, handedness, cyberlimbs, and saved loadouts. Clicking a failed cell
loads the exact combination and failure time.

### Publish Workspace

Publication performs, in order:

1. Schema validation.
2. Reference-closure validation.
3. Loadout conflict validation.
4. Action-template validation.
5. Full-duration IK sampling.
6. Socket and event validation.
7. Mirror validation.
8. Runtime-capability validation.
9. Deterministic package construction.
10. `.fbanim` export.

Errors block publication. Warnings require explicit confirmation. The page
shows package contents, capabilities, BodyProfiles, equipment, actions,
textures, fixtures, and diagnostics. It can export compatibility reports and
fixtures, compare against a previous package, and preview the final result on a
320x180 terminal simulation canvas.

## `.fbanim` v3 Runtime Contract

Version 3 is a new package version rather than an incompatible mutation of v2.
Version 2 remains readable as one fixed CharacterBinding with no dynamic
equipment contract.

```text
manifest.json
skeletons/<sha>.json
bindings/<sha>.json
body-profiles/<sha>.json
equipment/<sha>.json
motions/<sha>.json
action-profiles/<sha>.json
constraints/<sha>.json
textures/<sha>.png
```

The manifest declares minimum versions for capabilities the package requires.
Omitted capabilities are not required:

```json
{
  "requirements": {
    "regionRendering": 1,
    "equipmentAssembly": 1,
    "motionEvents": 1,
    "twoBoneIk": 1
  }
}
```

An unsupported required capability rejects the package. No required feature is
silently discarded. The first terminal runtime does not support runtime Warp;
packages declaring `runtimeWarp` or `meshSkinning` requirements are rejected.
Region-based guns, eyes, cyberlimbs, armor, and backpacks must be authored
without runtime Warp in the initial slices.

The package contains compiled RuntimeMotionClips after action layering and
override resolution. It may also contain test loadouts and compatibility
metadata, but these do not replace authoritative game equipment state.

## Terminal Engine Runtime

The terminal engine adds focused modules:

```text
skeletal_asset
skeletal_animation
skeletal_constraints
character_assembly
skeletal_render
presentation_events
```

`skeletal_asset` validates and loads packages into immutable shared assets.
`character_assembly` resolves a loadout only when the character, package, or
loadout changes. `skeletal_animation` samples fixed-step clips, blends actions,
and detects event crossings. `skeletal_constraints` implements the fixed
constraint order. `skeletal_render` emits and draws ordered Region commands.
`presentation_events` converts local motion events into effects and audio.

The runtime uses the existing fixed 60 Hz simulation clock. Asset times remain
seconds, but runtime accumulation uses integer ticks to avoid cumulative drift.

### Region Rendering

The existing axis-aligned Sprite blitter is insufficient. The authoritative
software implementation adds nearest-neighbor rendering of transformed Region
quads with translation, Z rotation, non-uniform scale, mirroring, pivot,
opacity, tint, clipping, and draw order.

```rust
struct RegionDrawCommand {
    texture: TextureHandle,
    world_transform: Mat3,
    pivot: Vec2,
    size: Vec2,
    uv: Rect,
    opacity: u8,
    tint: Option<u32>,
    draw_order: i32,
}
```

The software renderer computes a screen bounding box and inverse-maps target
pixels into source texture space with nearest-neighbor sampling. A future GPU
path may batch the same commands, but must match the software reference.

### Protocol

OSC 7770 gains high-level character commands instead of per-frame bone data:

```text
character.spawn
character.set_loadout
character.play_action
character.set_facing
character.remove
```

The terminal engine chooses resolved actions, samples motion, solves IK, and
emits local effects. The caller sends stable package, equipment, action, and
instance IDs plus position and facing.

### Presentation Events

Local events include weapon fire and eject, equipment activation, effects, and
footsteps. They may spawn particles, audio, flashes, camera shake, cyber-eye
scans, or cyberware overload effects. They never apply damage or mutate server
authority.

## Failure Semantics

- Invalid path, digest, size, schema, or reference: reject the package.
- Unsupported required capability: reject the package.
- Invalid loadout: keep the previous valid runtime assembly and report a
  diagnostic.
- Missing action: use an explicitly declared fallback action and report it; if
  no fallback exists, reject the request.
- Unreachable two-hand IK: block publication; at runtime keep the last valid
  pose and report a diagnostic.
- Missing texture: reject the package rather than render an invisible part.
- `visualMode: none`: emit no persistent draw command.
- Missing optional effect implementation: preserve game state, omit only the
  optional presentation, and report a capability diagnostic.

## Compatibility Fixtures

Both repositories consume versioned fixtures:

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

Each fixture contains the input package, test loadout, action requests, fixed
time steps, expected bone matrices, expected slots, expected event sequence,
and expected PNG output. Matrices and sockets use explicit tolerances. Pixel
outputs use exact equality unless a reviewed fixture defines a bounded
difference policy.

Canonical bytes live under FrameBaker `tests/fixtures/fbanim-v3/` with a
`manifest.json` that lists all eleven contract IDs. Only fixtures marked
`available` include packages; `missing` IDs are reported by parity tests and
must not be invented in either repository. `scripts/sync_fbanim_fixtures.ts`
copies exact available bytes into the terminal engine's
`pixel-engine/tests/fixtures/fbanim-v3/`. Game integration remains out of
scope for this fixture workflow.

## Delivery Phases

### Phase 1: Region Runtime Baseline

FrameBaker delivers minimal v3 packages, BodyProfile and socket UI, runtime
preview, validation, and fixtures. The engine delivers v3 loading, FK, fixed
motion sampling, transformed Region rendering, and fixed-character playback.

Acceptance requires matching matrices, Region corners, draw order, fixed-time
images, loop behavior, and package-rejection behavior.

### Phase 2: Equipment And Cyberware

FrameBaker delivers equipment creation, all four visual modes, multi-slot and
multi-attachment editing, replacement/hide rules, loadout preview, conflicts,
and publication checks. The engine delivers deterministic assembly and dynamic
loadout updates.

Fixtures include a helmet, monocular and binocular cyber-eyes, a cyber-arm,
back equipment, an internal chip, and an event-driven cyberware effect.

### Phase 3: Actions

FrameBaker delivers templates, stance profiles, layer ownership, compiled
actions, event editing, compatibility matrices, and terminal preview. The
engine delivers priority, interruption, blending, event crossings, and the
presentation bus for idle, move, aim, fire, reload, hit, and death.

### Phase 4: One-Hand And Two-Hand Weapons

FrameBaker delivers WeaponProfile UI, grip and socket editing, handedness,
mirror validation, IK reach diagnostics, and weapon-action profiles. The
engine delivers left/right one-hand use, dual wield, left/right primary
two-hand use, two-bone IK, and muzzle/eject presentation.

Fixtures include one pistol, a dual-pistol pair, one two-hand rifle, and one
asymmetric non-mirrorable weapon.

### Phase 5: Game Integration

Only after the first four phases pass does the game protocol add presentation
package/loadout state, equipment updates, combat-to-action mapping, reconnect
restoration, and resource-version diagnostics. The server remains authoritative
for equipment validity, attacks, damage, skills, and character state.

## Verification

FrameBaker tests cover schemas, package security, assembly conflicts,
replacement and hiding, multi-slot rules, action compilation, event timing,
IK, mirroring, v2/v3 boundaries, UI workflow state, save/reopen, import/export,
and deterministic output.

Rust tests cover package safety, FK, interpolation, transformed Region sampling,
assembly, action transitions, event boundaries, IK, socket positions, and
fixture parity.

Windows GUI acceptance covers 320x180 rendering, facing and mirroring, integer
scales, rapid loadout changes, continuous actions, multiple characters, weapon
effects, and a 30-minute loop. Phase 1 measurement establishes explicit limits
for bones, Regions, simultaneous characters, CPU frame time, rendered pixels,
and memory; this design does not invent performance thresholds before a
reference implementation exists.

## Implementation Boundary

Implementation proceeds by vertical slice. A new FrameBaker capability is not
complete until its creator UI, persistence, validation, package export, fixture,
and terminal-engine consumer pass together. Data interfaces without creator UI
do not count as delivered functionality.
