import {
  AI_API_KEY,
  AI_API_URL,
  AI_MAX_TOKENS,
  AI_MODEL,
  AI_TEMPERATURE,
} from './config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiReplyResult {
  text: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function isAiConfigured(): boolean {
  return Boolean(AI_API_KEY?.trim());
}

export async function generateAiReply(
  systemPrompt: string,
  history: ChatMessage[],
  incomingText: string
): Promise<AiReplyResult> {
  if (!isAiConfigured()) {
    throw new Error(
      'API de IA no configurada. Define OPENAI_API_KEY (o AI_API_KEY) en el archivo .env'
    );
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: incomingText },
  ];

  const response = await fetch(AI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      temperature: AI_TEMPERATURE,
      max_tokens: AI_MAX_TOKENS,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `Error API IA (${response.status})`);
  }

  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('La API de IA no devolvió una respuesta válida');
  }

  return {
    text,
    model: payload.model || AI_MODEL,
    usage: payload.usage,
  };
}
