import { AdversarialModel } from "./adversarial.ts";
import { OpenAiCompatibleModel } from "./openai-compatible.ts";
import { ScriptedModel } from "./scripted.ts";
import type { ModelAdapter } from "./types.ts";

/**
 * Picks the model from the environment. With MODEL_BASE_URL unset the server
 * uses the scripted planner, so the app runs end to end with no model at all.
 */
export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelAdapter {
  if (env.MODEL_PROVIDER === "adversarial") return new AdversarialModel();
  if (!env.MODEL_BASE_URL || env.MODEL_PROVIDER === "scripted") return new ScriptedModel();
  return new OpenAiCompatibleModel({
    baseUrl: env.MODEL_BASE_URL,
    model: env.MODEL_NAME ?? "qwen2.5:7b-instruct",
    apiKey: env.MODEL_API_KEY || undefined,
    timeoutMs: env.MODEL_TIMEOUT_MS ? Number(env.MODEL_TIMEOUT_MS) : undefined,
  });
}
