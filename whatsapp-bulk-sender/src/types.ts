export interface SendResult {
  messageId: string;
  ack: number;
  to?: string;
  isBusiness?: boolean;
  resolvedId?: string;
}

export interface IncomingMessage {
  chatId: string;
  body: string;
  messageId?: string;
  senderName?: string;
  fromMe: boolean;
  isGroup: boolean;
}

export type IncomingMessageHandler = (message: IncomingMessage) => void;

export interface WaClient {
  waitUntilReady(): Promise<void>;
  sendText(phone: string, message: string): Promise<SendResult>;
  onIncomingMessage(handler: IncomingMessageHandler): void;
  kill(): Promise<void>;
}
