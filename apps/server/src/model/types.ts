/** A chat message in the OpenAI-compatible shape, which most providers accept. */
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type Completion = { content: string | null; toolCalls: ToolCall[] };

export type CompletionRequest = {
  messages: ChatMessage[];
  tools: ToolSpec[];
  /** Ask for a final JSON answer with no further tool calls. */
  final?: boolean;
};

/** Every provider sits behind this interface. The model never sees the database. */
export interface ModelAdapter {
  readonly name: string;
  complete(req: CompletionRequest): Promise<Completion>;
}
