export interface WaClient {
  checkNumberStatus(phone: string): Promise<{ numberExists: boolean }>;
  sendText(phone: string, message: string): Promise<void>;
  kill(): Promise<void>;
}
