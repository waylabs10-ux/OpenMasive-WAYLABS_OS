export interface SendResult {
  messageId: string;
  ack: number;
  to?: string;
}

export interface WaClient {
  waitUntilReady(): Promise<void>;
  sendText(phone: string, message: string): Promise<SendResult>;
  kill(): Promise<void>;
}
