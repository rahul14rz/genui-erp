import type { Completion, CompletionRequest, ModelAdapter } from "./types.ts";

export type OpenAiCompatibleOptions = { baseUrl: string; model: string; apiKey?: string; timeoutMs?: number };

/**
 * Talks to any server that implements the OpenAI chat completions API. That
 * covers Ollama (http://localhost:11434/v1), OpenAI, OpenRouter, Groq,
 * Together and vLLM, so switching provider is a change of three env vars.
 */
export class OpenAiCompatibleModel implements ModelAdapter {
  readonly name: string;
  constructor(private readonly opts: OpenAiCompatibleOptions) {
    this.name = `${new URL(opts.baseUrl).host}/${opts.model}`;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: req.messages,
      temperature: 0,
    };
    if (!req.final && req.tools.length) {
      body.tools = req.tools.map((t) => ({ type: "function", function: t }));
      body.tool_choice = "auto";
    }
    if (req.final) body.response_format = { type: "json_object" };
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
    });
    if (!res.ok) throw new Error(`model request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: Completion["toolCalls"] } }[];
    };
    const msg = json.choices?.[0]?.message;
    return { content: msg?.content ?? null, toolCalls: msg?.tool_calls ?? [] };
  }
}
