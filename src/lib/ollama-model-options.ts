export interface OllamaModelInfo {
  name: string;
  sizeGb: number;
  description: string;
  recommended?: boolean;
}

// Measured on a sample of synthetic transactions, qwen3.5:9b categorized
// noticeably better than the smaller Llama models, Hebrew merchant names
// included. It needs about 8 GB of free RAM or VRAM, so it stays the default.
// On a 24 GB GPU, qwen3.8:27b was more accurate on expenses at almost the same
// speed. gemma4:26b was twice as fast but less accurate on income.
export const DEFAULT_OLLAMA_MODEL = "qwen3.5:9b";

export const RECOMMENDED_OLLAMA_MODELS: OllamaModelInfo[] = [
  {
    name: "qwen3.8:27b",
    sizeGb: 17,
    description: "Recommended for a GPU with 24 GB of memory. Most accurate for categorizing.",
    recommended: true,
  },
  {
    name: "qwen3.5:9b",
    sizeGb: 6.6,
    description: "Recommended for most computers. Accurate and light. Needs about 8 GB of memory.",
    recommended: true,
  },
  {
    name: "llama3.2:3b",
    sizeGb: 2.0,
    description: "Smaller and faster, for machines with less memory. Less accurate.",
  },
  {
    name: "llama3.2:1b",
    sizeGb: 1.3,
    description: "Smallest and fastest. Least accurate.",
  },
  {
    name: "llama3.1:8b",
    sizeGb: 4.7,
    description: "Mid-size alternative. Slower than qwen3.5:9b and less accurate.",
  },
];

export interface OllamaModelOption {
  name: string;
  installed: boolean;
  info: OllamaModelInfo | undefined;
}

export function buildOllamaModelOptions({
  installedModels,
  selectedModel,
}: {
  installedModels: string[];
  selectedModel: string;
}): OllamaModelOption[] {
  const installedSet = new Set(installedModels);
  const recommendedNames = new Set(
    RECOMMENDED_OLLAMA_MODELS.map((model) => model.name)
  );

  return [
    ...installedModels.map((name) => ({
      name,
      installed: true,
      info: RECOMMENDED_OLLAMA_MODELS.find((model) => model.name === name),
    })),
    ...RECOMMENDED_OLLAMA_MODELS.filter(
      (model) => !installedSet.has(model.name)
    ).map((info) => ({
      name: info.name,
      installed: false,
      info,
    })),
    ...(!installedSet.has(selectedModel) && !recommendedNames.has(selectedModel)
      ? [
          {
            name: selectedModel,
            installed: false,
            info: undefined,
          },
        ]
      : []),
  ];
}
