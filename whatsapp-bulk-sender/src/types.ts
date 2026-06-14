export interface CheckNumberResult {
  numberExists: boolean;
  wid?: string;
}

export interface WaClient {
  waitUntilReady(): Promise<void>;
  checkNumberStatus(phone: string): Promise<CheckNumberResult>;
  sendText(phone: string, message: string): Promise<void>;
  kill(): Promise<void>;
}
