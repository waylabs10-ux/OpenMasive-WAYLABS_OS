export interface WaClient {
  waitUntilReady(): Promise<void>;
  sendText(phone: string, message: string): Promise<void>;
  kill(): Promise<void>;
}
