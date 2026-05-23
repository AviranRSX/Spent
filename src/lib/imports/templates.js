const IMPORT_TEMPLATE_DEFINITIONS = [
  {
    templateType: "max_bill",
    kind: "card",
    name: "Max",
    description: "Credit card export",
    sampleFile: "max_aviran.xlsx",
  },
  {
    templateType: "isracard_bill",
    kind: "card",
    name: "Isracard",
    description: "Monthly card bill",
    sampleFile: "isracard_aviran.xlsx",
  },
  {
    templateType: "cal_bill",
    kind: "card",
    name: "CAL",
    description: "Monthly card bill",
    sampleFile: "cal_inbar_may.xlsx",
  },
  {
    templateType: "hapoalim_bank_account",
    kind: "bank",
    name: "Hapoalim",
    description: "Bank account transactions",
    sampleFile: "hapoalim_bank.xlsx",
  },
  {
    templateType: "leumi_bank_account",
    kind: "bank",
    name: "Leumi",
    description: "Bank account transactions",
    sampleFile: "leumi_bank.xls",
  },
];

const IMPORT_SOURCE_KIND_OPTIONS = [
  {
    kind: "card",
    label: "Credit card",
  },
  {
    kind: "bank",
    label: "Bank account",
  },
];

function getImportTemplatesForKind(kind) {
  return IMPORT_TEMPLATE_DEFINITIONS.filter((template) => template.kind === kind);
}

function getImportTemplateDefinition(templateType) {
  return (
    IMPORT_TEMPLATE_DEFINITIONS.find(
      (template) => template.templateType === templateType
    ) ?? null
  );
}

function getImportTemplateLabel(templateType) {
  return getImportTemplateDefinition(templateType)?.name ?? templateType;
}

function isImportTemplateType(value) {
  return IMPORT_TEMPLATE_DEFINITIONS.some(
    (template) => template.templateType === value
  );
}

function isImportSourceKind(value) {
  return IMPORT_SOURCE_KIND_OPTIONS.some((option) => option.kind === value);
}

function templateMatchesSourceKind(templateType, kind) {
  return getImportTemplateDefinition(templateType)?.kind === kind;
}

module.exports = {
  IMPORT_TEMPLATE_DEFINITIONS,
  IMPORT_SOURCE_KIND_OPTIONS,
  getImportTemplatesForKind,
  getImportTemplateDefinition,
  getImportTemplateLabel,
  isImportTemplateType,
  isImportSourceKind,
  templateMatchesSourceKind,
};
