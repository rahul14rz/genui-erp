# 0004. One OpenAI-compatible adapter, plus a scripted planner

Date: 2026-11-01. Status: accepted.

## Context

The brief asks for a provider-agnostic adapter with one provider wired up, and the owner asked for either a local model through Ollama or a hosted one.

## Decision

- `ModelAdapter` has one method, `complete({messages, tools, final})`.
- `OpenAiCompatibleModel` talks to any `/v1/chat/completions` endpoint with tool calls. Ollama, OpenAI, OpenRouter, Groq and vLLM all speak it, so switching is three environment variables: `MODEL_BASE_URL`, `MODEL_NAME`, `MODEL_API_KEY`.
- With `MODEL_BASE_URL` unset, the server uses `ScriptedModel`, a keyword planner that goes through the same tool calls, validation, repair and guard. The app runs end to end with no model, and tests are deterministic.
- `AdversarialModel` exists for the eval suite only. It obeys injected instructions, to show the server's checks hold when the model does not.

## Rejected

- Provider SDKs. Each one adds a dependency and a second request shape for the same three fields.
- Native structured output modes. Support differs by provider and by model. The server validates with zod and repairs instead, which works with any model.

## Consequences

- The scripted planner only understands the questions in its keyword table. It is a stand-in, not a model.
- Real-model quality is measured by running the eval suite with `MODEL_BASE_URL` set. The committed snapshot does not include a real model; see Known limits in the README.
