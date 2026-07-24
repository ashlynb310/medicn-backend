import { Injectable, Logger } from "@nestjs/common";
import type { Namespace } from "socket.io";
import type { MessagingRealtimeEvent } from "./messaging.types";

@Injectable()
export class MessagingRealtimeService {
  private readonly logger = new Logger(MessagingRealtimeService.name);
  private namespace?: Namespace;

  register(namespace: Namespace) {
    this.namespace = namespace;
  }

  publish(events: MessagingRealtimeEvent[]) {
    if (!this.namespace) return;

    for (const event of events) {
      try {
        this.namespace.to(event.rooms).emit(event.name, event.payload);
      } catch {
        this.logger.warn(`messaging_realtime_emit_failed event=${event.name}`);
      }
    }
  }
}
