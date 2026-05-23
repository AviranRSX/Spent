import type { ImportSourceKind, ImportTemplateType } from "@/lib/types";

export interface ImportTemplateDefinition {
  templateType: ImportTemplateType;
  kind: ImportSourceKind;
  name: string;
  description: string;
  sampleFile: string;
}

export interface ImportSourceKindOption {
  kind: ImportSourceKind;
  label: string;
}

export const IMPORT_TEMPLATE_DEFINITIONS: ImportTemplateDefinition[];
export const IMPORT_SOURCE_KIND_OPTIONS: ImportSourceKindOption[];
export const IMPORT_WORKBOOK_ACCEPT: string;

export function getImportTemplatesForKind(
  kind: ImportSourceKind
): ImportTemplateDefinition[];
export function getImportTemplateDefinition(
  templateType: ImportTemplateType
): ImportTemplateDefinition | null;
export function getImportTemplateLabel(templateType: ImportTemplateType): string;
export function isImportTemplateType(value: unknown): value is ImportTemplateType;
export function isImportSourceKind(value: unknown): value is ImportSourceKind;
export function templateMatchesSourceKind(
  templateType: ImportTemplateType,
  kind: ImportSourceKind
): boolean;
