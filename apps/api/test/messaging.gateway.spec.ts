import { UnauthorizedException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { MessagingGateway } from "../src/messaging/messaging.gateway";
import type { MessagingRealtimeService } from "../src/messaging/messaging-realtime.service";
import type { MessagingService } from "../src/messaging/messaging.service";
import type { DistributedRateLimitService } from "../src/common/http/distributed-rate-limit.service";

function createGateway() {
  const auth = {
    getCurrentUserRecord: jest.fn(),
    getAccessTokenExpiry: jest.fn()
  };
  const messaging = { canAccessInquiry: jest.fn() };
  const realtime = { register: jest.fn() };
  const config = { get: jest.fn() };
  const limiter = { consume: jest.fn().mockResolvedValue({ allowed: true }) };
  const gateway = new MessagingGateway(
    auth as unknown as AuthService,
    messaging as unknown as MessagingService,
    realtime as unknown as MessagingRealtimeService,
    config as never,
    limiter as unknown as DistributedRateLimitService
  );
  return { gateway, auth, messaging, realtime, config, limiter };
}

function socket(overrides: Record<string, unknown> = {}) {
  return {
    handshake: { auth: {}, query: {} },
    data: {},
    join: jest.fn(),
    leave: jest.fn(),
    disconnect: jest.fn(),
    ...overrides
  };
}

describe("MessagingGateway", () => {
  it("authenticates only from handshake auth and reserves the private user room", async () => {
    const { gateway, auth } = createGateway();
    const client = socket({
      handshake: { auth: { accessToken: "valid.jwt.token" }, query: {} }
    });
    auth.getCurrentUserRecord.mockResolvedValue({
      id: "user-1",
      roles: [UserRole.renter]
    });
    auth.getAccessTokenExpiry.mockReturnValue(Math.floor(Date.now() / 1000) + 60);

    await (gateway as any).authenticate(client);
    gateway.handleConnection(client as never);

    expect(client.data).toMatchObject({
      messagingUser: { id: "user-1", roles: [UserRole.renter] }
    });
    expect(client.join).toHaveBeenCalledWith("user:user-1");
    gateway.handleDisconnect(client as never);
  });

  it("rejects missing tokens and query-string tokens", async () => {
    const { gateway } = createGateway();
    await expect((gateway as any).authenticate(socket())).rejects.toMatchObject({
      data: { code: "UNAUTHORIZED" }
    });
    await expect(
      (gateway as any).authenticate(
        socket({ handshake: { auth: {}, query: { token: "leaked" } } })
      )
    ).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
  });

  it("surfaces invalid, expired and disabled auth codes without token data", async () => {
    const { gateway, auth } = createGateway();
    const client = socket({
      handshake: { auth: { accessToken: "expired.jwt.token" }, query: {} }
    });
    auth.getCurrentUserRecord.mockRejectedValue(
      new UnauthorizedException({
        code: "INVALID_SUPABASE_TOKEN",
        message: "Supabase access token is invalid or expired."
      })
    );
    await expect((gateway as any).authenticate(client)).rejects.toMatchObject({
      data: { code: "INVALID_SUPABASE_TOKEN" }
    });
  });

  it("returns opaque NOT_FOUND for an unauthorized inquiry subscription", async () => {
    const { gateway, messaging } = createGateway();
    const client = socket({
      data: {
        messagingUser: {
          id: "user-1",
          roles: [UserRole.renter],
          tokenExpiresAt: Math.floor(Date.now() / 1000) + 60
        }
      }
    });
    messaging.canAccessInquiry.mockResolvedValue(false);

    await expect(
      gateway.subscribe(client as never, { inquiryId: "private-inquiry" })
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(client.join).not.toHaveBeenCalled();
  });

  it("disconnects a socket when its verified access token expires", () => {
    jest.useFakeTimers();
    try {
      const { gateway } = createGateway();
      const client = socket({
        data: {
          messagingUser: {
            id: "user-1",
            roles: [UserRole.renter],
            tokenExpiresAt: Math.floor(Date.now() / 1000) + 1
          }
        }
      });
      gateway.handleConnection(client as never);
      jest.advanceTimersByTime(1_100);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      gateway.handleDisconnect(client as never);
    } finally {
      jest.useRealTimers();
    }
  });

  it("enforces and releases the per-user connection limit", async () => {
    const { gateway, auth, config } = createGateway();
    config.get.mockImplementation((key: string) =>
      key === "MESSAGING_MAX_SOCKETS_PER_USER" ? 1 : undefined
    );
    auth.getCurrentUserRecord.mockResolvedValue({
      id: "user-1",
      roles: [UserRole.renter]
    });
    auth.getAccessTokenExpiry.mockReturnValue(Math.floor(Date.now() / 1000) + 60);
    const first = socket({
      handshake: { auth: { accessToken: "first.jwt.token" }, query: {} }
    });
    const second = socket({
      handshake: { auth: { accessToken: "second.jwt.token" }, query: {} }
    });
    await (gateway as any).authenticate(first);
    await expect((gateway as any).authenticate(second)).rejects.toMatchObject({
      data: { code: "FORBIDDEN" }
    });
    gateway.handleDisconnect(first as never);
    await expect((gateway as any).authenticate(second)).resolves.toBeUndefined();
    gateway.handleDisconnect(second as never);
  });

  it("applies distributed connection and event limits without exposing tokens", async () => {
    const { gateway, auth, messaging, limiter } = createGateway();
    auth.getCurrentUserRecord.mockResolvedValue({
      id: "user-1",
      roles: [UserRole.renter]
    });
    auth.getAccessTokenExpiry.mockReturnValue(Math.floor(Date.now() / 1000) + 60);
    const client = socket({
      handshake: { auth: { accessToken: "private.jwt.token" }, query: {} }
    });

    await (gateway as any).authenticate(client);
    expect(limiter.consume).toHaveBeenCalledWith("websocket_connect", "user-1");

    messaging.canAccessInquiry.mockResolvedValue(true);
    await gateway.subscribe(client as never, { inquiryId: "inquiry-1" });
    expect(limiter.consume).toHaveBeenCalledWith("websocket_event", "user-1");
    expect(JSON.stringify(limiter.consume.mock.calls)).not.toContain(
      "private.jwt.token"
    );
    gateway.handleDisconnect(client as never);
  });

  it("returns a stable socket error when an event exceeds its distributed limit", async () => {
    const { gateway, limiter } = createGateway();
    limiter.consume.mockRejectedValue({
      response: { code: "RATE_LIMIT_EXCEEDED" }
    });
    const client = socket({
      data: {
        messagingUser: {
          id: "user-1",
          roles: [UserRole.renter],
          tokenExpiresAt: Math.floor(Date.now() / 1000) + 60
        }
      }
    });

    await expect(
      gateway.subscribe(client as never, { inquiryId: "inquiry-1" })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RATE_LIMIT_EXCEEDED" }
    });
  });
});
