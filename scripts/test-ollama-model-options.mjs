import assert from "node:assert/strict";
import test from "node:test";

const { buildOllamaModelOptions, DEFAULT_OLLAMA_MODEL, RECOMMENDED_OLLAMA_MODELS } = await import(
  "../src/lib/ollama-model-options.ts"
);

test("shows installed Ollama models before recommended download options", () => {
  const options = buildOllamaModelOptions({
    installedModels: ["qwen2.5:3b", "mistral:7b"],
    selectedModel: "llama3.2:3b",
  });

  assert.deepEqual(
    options.map((option) => ({
      name: option.name,
      installed: option.installed,
      recommended: option.info?.recommended ?? false,
    })),
    [
      { name: "qwen2.5:3b", installed: true, recommended: false },
      { name: "mistral:7b", installed: true, recommended: false },
      { name: "qwen3.8:27b", installed: false, recommended: true },
      { name: "qwen3.5:9b", installed: false, recommended: true },
      { name: "llama3.2:3b", installed: false, recommended: false },
      { name: "llama3.2:1b", installed: false, recommended: false },
      { name: "llama3.1:8b", installed: false, recommended: false },
    ]
  );
});

test("keeps a custom selected model visible when it is not installed", () => {
  const options = buildOllamaModelOptions({
    installedModels: [],
    selectedModel: "custom:latest",
  });

  assert.equal(options.at(-1)?.name, "custom:latest");
  assert.equal(options.at(-1)?.installed, false);
});

test("keeps qwen3.5:9b as the default and recommends qwen3.8:27b for 24 GB GPUs", () => {
  assert.equal(DEFAULT_OLLAMA_MODEL, "qwen3.5:9b");
  assert.deepEqual(
    RECOMMENDED_OLLAMA_MODELS.filter((model) => model.recommended).map(
      (model) => model.name
    ),
    ["qwen3.8:27b", "qwen3.5:9b"]
  );
});
