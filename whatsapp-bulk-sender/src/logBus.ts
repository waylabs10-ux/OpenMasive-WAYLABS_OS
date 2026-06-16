import { EventEmitter } from 'events';
import { LogType } from './config';

export interface LogEvent {
  timestamp: string;
  message: string;
  type: LogType;
}

export interface QrEvent {
  dataUrl: string;
}

export interface StatusEvent {
  session: string;
  sending: boolean;
  sent: number;
  skipped: number;
  failed: number;
  excluded?: number;
  optoutCount?: number;
  contactCount: number;
  autoReplyEnabled?: boolean;
  autoReplyProcessing?: boolean;
}

export interface AutoReplyEvent {
  phone: string;
  incoming: string;
  reply: string;
  senderName?: string;
  timestamp: string;
}

export interface AutoReplyStatusEvent {
  enabled: boolean;
  aiConfigured: boolean;
  processing: boolean;
  replyCount: number;
}

class LogBus extends EventEmitter {
  emitLog(message: string, type: LogType = 'info'): void {
    const event: LogEvent = {
      timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
      message,
      type,
    };
    this.emit('log', event);
  }

  emitQr(dataUrl: string): void {
    const event: QrEvent = { dataUrl };
    this.emit('qr', event);
  }

  emitStatus(status: StatusEvent): void {
    this.emit('status', status);
  }

  emitAutoReply(event: Omit<AutoReplyEvent, 'timestamp'>): void {
    const payload: AutoReplyEvent = {
      ...event,
      timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
    };
    this.emit('autoreply', payload);
  }

  emitAutoReplyStatus(status: AutoReplyStatusEvent): void {
    this.emit('autoreply_status', status);
  }
}

export const logBus = new LogBus();
