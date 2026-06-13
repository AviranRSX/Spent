import assert from "node:assert/strict";
import test from "node:test";

const { buildOllamaModelOptions } = await import(
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
      { name: "llama3.2:3b", installed: false, recommended: true },
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
