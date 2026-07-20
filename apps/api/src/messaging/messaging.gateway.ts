import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway
} from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";
import { AuthService } from "../auth/auth.service";
import { MessagingRealtimeService } from "./messaging-realtime.service";
import { MessagingService } from "./messaging.service";
import { inquiryRoom, userRoom, type MessagingSocketUser } from "./messaging.types";
import { DistributedRateLimitService } from "../common/http/distributed-rate-limit.service";

type MessagingSocket = Socket & {
  data: {
    messagingUser?: MessagingSocketUser;
    expiryTimer?: NodeJS.Timeout;
    connectionReserved?: boolean;
  };
};

@WebSocketGateway({
  namespace: "/messaging",
  transports: ["websocket", "polling"]
})
export class MessagingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(MessagingGateway.name);
  private readonly connectionsByUser = new Map<string, number>();
  private totalConnections = 0;

  constructor(
    private readonly authService: AuthService,
    private readonly messagingService: MessagingService,
    private readonly realtime: MessagingRealtimeService,
    private readonly config: ConfigService,
    private readonly limiter: DistributedRateLimitService
  ) {}

  afterInit(namespace: Namespace) {
    this.realtime.register(namespace);
    namespace.use((socket: MessagingSocket, next) => {
      void this.authenticate(socket).then(() => next()).catch((error) => next(error));
    });
  }

  handleConnection(socket: MessagingSocket) {
    const user = socket.data.messagingUser;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    void socket.join(userRoom(user.id));
    const remainingMs = user.tokenExpiresAt * 1_000 - Date.now();
    socket.data.expiryTimer = setTimeout(
      () => socket.disconnect(true),
      Math.min(remainingMs, 2_147_483_647)
    );
  }

  handleDisconnect(socket: MessagingSocket) {
    if (socket.data.expiryTimer) clearTimeout(socket.data.expiryTimer);
    const user = socket.data.messagingUser;
    if (!user || !socket.data.connectionReserved) return;
    const count = this.connectionsByUser.get(user.id) ?? 1;
    if (count <= 1) this.connectionsByUser.delete(user.id);
    else this.connectionsByUser.set(user.id, count - 1);
    this.totalConnections = Math.max(0, this.totalConnections - 1);
    socket.data.connectionReserved = false;
  }

  @SubscribeMessage("inquiry.subscribe")
  async subscribe(
    @ConnectedSocket() socket: MessagingSocket,
    @MessageBody() payload: unknown
  ) {
    const inquiryId = this.inquiryId(payload);
    const user = socket.data.messagingUser;
    if (!inquiryId || !user) return this.socketError("NOT_FOUND");
    try {
      await this.limiter.consume("websocket_event", user.id);
      const allowed = await this.messagingService.canAccessInquiry(
        user,
        inquiryId
      );
      if (!allowed) return this.socketError("NOT_FOUND");
      await socket.join(inquiryRoom(inquiryId));
      return { ok: true, data: { inquiryId }, error: null };
    } catch (error) {
      const rateCode = this.rateLimitCode(error);
      if (rateCode) return this.socketError(rateCode);
      return this.socketError("NOT_FOUND");
    }
  }

  @SubscribeMessage("inquiry.unsubscribe")
  async unsubscribe(
    @ConnectedSocket() socket: MessagingSocket,
    @MessageBody() payload: unknown
  ) {
    const inquiryId = this.inquiryId(payload);
    const user = socket.data.messagingUser;
    if (!inquiryId || !user) return this.socketError("NOT_FOUND");
    try {
      await this.limiter.consume("websocket_event", user.id);
      await socket.leave(inquiryRoom(inquiryId));
      return { ok: true, data: { inquiryId }, error: null };
    } catch (error) {
      return this.socketError(this.rateLimitCode(error) ?? "NOT_FOUND");
    }
  }

  @SubscribeMessage("heartbeat")
  async heartbeat(@ConnectedSocket() socket: MessagingSocket) {
    const user = socket.data.messagingUser;
    if (!user) return this.socketError("UNAUTHORIZED");
    try {
      await this.limiter.consume("websocket_event", user.id);
      return {
        ok: true,
        data: { serverTime: new Date().toISOString() },
        error: null
      };
    } catch (error) {
      return this.socketError(this.rateLimitCode(error) ?? "RATE_LIMIT_UNAVAILABLE");
    }
  }

  private async authenticate(socket: MessagingSocket) {
    if (socket.handshake.query.token || socket.handshake.query.accessToken) {
      throw this.connectError("UNAUTHORIZED", "Tokens must use handshake auth.");
    }
    const token = socket.handshake.auth?.accessToken;
    if (typeof token !== "string" || token.length === 0) {
      throw this.connectError("UNAUTHORIZED", "Missing access token.");
    }
    try {
      const user = await this.authService.getCurrentUserRecord(token);
      const tokenExpiresAt = this.authService.getAccessTokenExpiry(token);
      await this.limiter.consume("websocket_connect", user.id);
      const perUserLimit = this.config.get<number>(
        "MESSAGING_MAX_SOCKETS_PER_USER"
      ) ?? 5;
      const globalLimit = this.config.get<number>(
        "MESSAGING_MAX_SOCKET_CONNECTIONS"
      ) ?? 10_000;
      const current = this.connectionsByUser.get(user.id) ?? 0;
      if (current >= perUserLimit || this.totalConnections >= globalLimit) {
        throw this.connectError("FORBIDDEN", "Realtime connection limit reached.");
      }
      this.connectionsByUser.set(user.id, current + 1);
      this.totalConnections += 1;
      socket.data.messagingUser = {
        id: user.id,
        roles: [...user.roles],
        tokenExpiresAt
      };
      socket.data.connectionReserved = true;
    } catch (error) {
      if (this.isConnectError(error)) throw error;
      const response =
        typeof error === "object" && error !== null && "response" in error
          ? (error as { response?: { code?: string; message?: string } }).response
          : undefined;
      const code = response?.code ?? "INVALID_SUPABASE_TOKEN";
      this.logger.warn(`messaging_socket_auth_rejected code=${code}`);
      throw this.connectError(code, response?.message ?? "Authentication failed.");
    }
  }

  private inquiryId(payload: unknown) {
    if (typeof payload !== "object" || payload === null || !("inquiryId" in payload)) {
      return null;
    }
    const value = (payload as { inquiryId?: unknown }).inquiryId;
    return typeof value === "string" && value.length > 0 && value.length <= 100
      ? value
      : null;
  }

  private socketError(code: string) {
    return { ok: false, data: null, error: { code, message: "Request unavailable." } };
  }

  private connectError(code: string, message: string) {
    const error = new Error(message) as Error & {
      data?: { code: string; message: string };
    };
    error.data = { code, message };
    return error;
  }

  private isConnectError(error: unknown): error is Error & { data: unknown } {
    return error instanceof Error && "data" in error;
  }

  private rateLimitCode(error: unknown) {
    if (typeof error !== "object" || error === null || !("response" in error)) {
      return undefined;
    }
    const response = (error as { response?: { code?: unknown } }).response;
    return response?.code === "RATE_LIMIT_EXCEEDED" ||
      response?.code === "RATE_LIMIT_UNAVAILABLE"
      ? response.code
      : undefined;
  }
}
