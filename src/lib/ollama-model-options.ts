export interface OllamaModelInfo {
  name: string;
  sizeGb: number;
  description: string;
  recommended?: boolean;
}

export const RECOMMENDED_OLLAMA_MODELS: OllamaModelInfo[] = [
  {
    name: "llama3.2:3b",
    sizeGb: 2.0,
    description: "Recommended. Fast and accurate enough for categorizing.",
    recommended: true,
  },
  {
    name: "llama3.2:1b",
    sizeGb: 1.3,
    description: "Smallest and fastest. Slightly less accurate.",
  },
  {
    name: "llama3.1:8b",
    sizeGb: 4.7,
    description: "Higher quality, slower, larger download.",
  },
  {
    name: "qwen2.5:3b",
    sizeGb: 1.9,
    description: "Alternative 3B model from Alibaba.",
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
