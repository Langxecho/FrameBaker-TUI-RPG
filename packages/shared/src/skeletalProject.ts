import type { CharacterBinding } from "./animation";
import type { ActionTemplate, BodyProfile, CharacterLoadout, EquipmentDefinition } from "./equipment";

/** 骨骼项目中的一条动作配置；动作资产本身由 MotionClip 共享。 */
export interface SkeletalProjectAnimation {
  id: string;
  name: string;
  motionClipId: string;
  speed: number;
  repeat: number;
  loop: boolean;
}

export const SKELETAL_PROJECT_SCHEMA_VERSION = 2;

export interface SkeletalProjectStanceProfile {
  id: string;
  requiredActions: string[];
  optionalActions: string[];
  constraints: string[];
}

export interface SkeletalProjectRuntimePackageSettings {
  requiredCapabilities?: Record<string, number>;
}

/** 骨骼项目持久化文档 v2。 */
export interface SkeletalProjectDocument {
  schemaVersion: number;
  projectId: string;
  /** 具体角色及其素材绑定只属于本项目，不进入动作资产库。 */
  character: { binding: CharacterBinding } | null;
  animations: SkeletalProjectAnimation[];
  activeAnimationId: string | null;
  bodyProfiles?: BodyProfile[];
  equipment?: EquipmentDefinition[];
  loadouts?: CharacterLoadout[];
  actionTemplates?: ActionTemplate[];
  stanceProfiles?: SkeletalProjectStanceProfile[];
  runtimePackageSettings?: SkeletalProjectRuntimePackageSettings;
}

export interface SkeletalProjectDocumentResponse {
  document: SkeletalProjectDocument;
}

function arrayOrEmpty<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }

/** 将历史 v1 或含运行时扩展的文档规整为可持久化的 v2 形状。 */
export function migrateSkeletalProjectDocument(value: unknown): SkeletalProjectDocument {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const character = source.character && typeof source.character === "object" && !Array.isArray(source.character)
    ? { binding: (source.character as Record<string, unknown>).binding as CharacterBinding }
    : null;
  const runtime = source.runtimePackageSettings && typeof source.runtimePackageSettings === "object" && !Array.isArray(source.runtimePackageSettings)
    ? source.runtimePackageSettings as Record<string, unknown>
    : {};
  const document: SkeletalProjectDocument = {
    schemaVersion: SKELETAL_PROJECT_SCHEMA_VERSION,
    projectId: source.projectId as string,
    character,
    animations: arrayOrEmpty<SkeletalProjectAnimation>(source.animations),
    activeAnimationId: source.activeAnimationId === null || typeof source.activeAnimationId === "string" ? source.activeAnimationId : null,
    bodyProfiles: arrayOrEmpty<BodyProfile>(source.bodyProfiles),
    equipment: arrayOrEmpty<EquipmentDefinition>(source.equipment),
    loadouts: arrayOrEmpty<CharacterLoadout>(source.loadouts),
    actionTemplates: arrayOrEmpty<ActionTemplate>(source.actionTemplates),
    stanceProfiles: arrayOrEmpty<SkeletalProjectStanceProfile>(source.stanceProfiles),
    runtimePackageSettings: {
      ...(runtime.requiredCapabilities && typeof runtime.requiredCapabilities === "object" && !Array.isArray(runtime.requiredCapabilities)
        ? { requiredCapabilities: runtime.requiredCapabilities as Record<string, number> }
        : {}),
    },
  };
  return document;
}
