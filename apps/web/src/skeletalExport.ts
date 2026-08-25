import {
  buildFbanimV3Entries,
  canonicalizeJson,
  type CharacterBinding,
  type CharacterLoadout,
  type BodyProfile,
  type FbanimEntry,
  type MotionClip,
  type Skeleton,
} from "@framebaker/shared";
import { materialImageUrl } from "./api/mediaUrls";
import type { SkeletalProjectDocument } from "./api";
import { createZip } from "./zip";

function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function safeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "package";
}

const enc = new TextEncoder();

export async function exportFbanimV3Blob(entries: FbanimEntry[]): Promise<Blob> {
  return createZip(entries.map((entry) => ({ name: entry.path, data: entry.bytes })));
}

/** Deterministic `.fbanim` v3 download (ZIP of package entries). */
export async function downloadFbanimV3Package(name: string, entries: FbanimEntry[]): Promise<void> {
  const blob = await exportFbanimV3Blob(entries);
  download(blob, `${safeFilename(name)}.fbanim`);
}

export interface FixtureExportInput {
  fixtureId: string;
  packageEntries: FbanimEntry[];
  loadout: CharacterLoadout;
  actionSteps: Array<{ actionId: string; time: number; facing?: "left" | "right" }>;
  expected: {
    matrices?: unknown[];
    events?: unknown[];
    slots?: unknown[];
    sockets?: unknown[];
  };
  metadata: Record<string, unknown>;
}

/** Emit fixture ZIP entries in memory — never writes to storage/. */
export async function exportFixtureZipEntries(input: FixtureExportInput): Promise<Array<{ name: string; data: Uint8Array }>> {
  const packageZip = await exportFbanimV3Blob(input.packageEntries);
  const packageBytes = new Uint8Array(await packageZip.arrayBuffer());
  const json = (value: unknown) => canonicalizeJson(value as never);
  return [
    { name: "package.fbanim", data: packageBytes },
    { name: "loadout.json", data: json(input.loadout) },
    { name: "action-steps.json", data: json(input.actionSteps) },
    { name: "expected.json", data: json(input.expected) },
    {
      name: "metadata.json",
      data: json({
        fixtureId: input.fixtureId,
        ...input.metadata,
      }),
    },
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function downloadFixtureZip(name: string, input: FixtureExportInput): Promise<void> {
  const entries = await exportFixtureZipEntries(input);
  download(await createZip(entries), `${safeFilename(name)}-fixture.zip`);
}

/** Canonical minimal-region fixture builder for tests/fixtures/fbanim-v3. */
export async function buildMinimalRegionFixtureEntries(input: {
  skeleton: Skeleton;
  binding: CharacterBinding;
  body: BodyProfile;
  clip: MotionClip;
  textureBytes: Uint8Array;
}): Promise<Array<{ name: string; data: Uint8Array }>> {
  const entries = await buildFbanimV3Entries({
    createdBy: { name: "FrameBaker", version: "fixture" },
    skeleton: input.skeleton,
    characterBinding: input.binding,
    bodyProfiles: [input.body],
    equipment: [],
    actions: [{ id: "idle", name: "Idle", motionClip: input.clip, speed: 1, repeat: 1, loop: true }],
    actionProfiles: [],
    constraints: [],
    textures: input.binding.attachments.map((a) => ({ attachmentId: a.id, bytes: input.textureBytes })),
  });
  return exportFixtureZipEntries({
    fixtureId: "minimal-region",
    packageEntries: entries,
    loadout: { bodyProfileId: input.body.id, equipment: [] },
    actionSteps: [{ actionId: "idle", time: 0 }],
    expected: { matrices: [], events: [], slots: [] },
    metadata: { schemaVersion: 1, generatedBy: "FrameBaker", note: "canonical minimal-region" },
  });
}

/** Resolve project textures for v3 export from material URLs. */
export async function loadProjectTextures(
  document: SkeletalProjectDocument,
): Promise<Array<{ attachmentId: string; bytes: Uint8Array }>> {
  if (!document.character) return [];
  const textures: Array<{ attachmentId: string; bytes: Uint8Array }> = [];
  for (const attachment of document.character.binding.attachments) {
    const response = await fetch(materialImageUrl(attachment.materialId, undefined, attachment.imageSlot, undefined, true));
    if (!response.ok) throw new Error(`附件「${attachment.name}」纹理读取失败`);
    textures.push({ attachmentId: attachment.id, bytes: new Uint8Array(await response.arrayBuffer()) });
  }
  for (const item of document.equipment ?? []) {
    for (const attachment of item.attachments) {
      if (textures.some((t) => t.attachmentId === attachment.id)) continue;
      const response = await fetch(materialImageUrl(attachment.materialId, undefined, attachment.imageSlot, undefined, true));
      if (!response.ok) throw new Error(`装备附件「${attachment.name}」纹理读取失败`);
      textures.push({ attachmentId: attachment.id, bytes: new Uint8Array(await response.arrayBuffer()) });
    }
  }
  return textures;
}

export function fixtureEntryToText(entry: { name: string; data: Uint8Array }): string {
  return new TextDecoder().decode(entry.data);
}

export { enc };
