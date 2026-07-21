import { io, type Socket } from "socket.io-client";
import { getApiBaseUrl } from "@/lib/api/client";

// ONE shared Socket.IO connection for the whole app (never one per component).
// Namespace: /messaging. The server origin is derived from NEXT_PUBLIC_API_URL
// by stripping the /api/v1 suffix — no duplicate origin env var is introduced.
//
// The access token is passed ONLY via the handshake `auth` payload. The backend
// explicitly rejects query-string tokens, and the token is never placed in a
// URL, log, error message, or any storage created here.

const HEARTBEAT_MS = 25_000;

export function getSocketOrigin(): string {
  return getApiBaseUrl().replace(/\/api\/v\d+\/?$/, "");
}

interface SocketInstance {
  socket: Socket;
  token: string;
  refCount: number;
  heartbeat: ReturnType<typeof setInterval> | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export interface MessagingSocketHandle {
  socket: Socket;
  /** Idempotent; only ever affects the instance it was issued for. */
  release: () => void;
}

let current: SocketInstance | null = null;

function startHeartbeat(instance: SocketInstance) {
  stopHeartbeat(instance);
  // Exactly one heartbeat interval per connection, owned by this manager.
  instance.heartbeat = setInterval(() => {
    if (instance.socket.connected) instance.socket.emit("heartbeat");
  }, HEARTBEAT_MS);
}

function stopHeartbeat(instance: SocketInstance) {
  if (instance.heartbeat) {
    clearInterval(instance.heartbeat);
    instance.heartbeat = null;
  }
}

function teardown(instance: SocketInstance) {
  stopHeartbeat(instance);
  instance.socket.off("connect", instance.onConnect);
  instance.socket.off("disconnect", instance.onDisconnect);
  instance.socket.removeAllListeners();
  instance.socket.disconnect();
  if (current === instance) current = null;
}

/**
 * Acquires the shared socket for `accessToken`, reference-counted.
 *
 * A rotated token tears down the previous connection and creates a new one.
 * Because each handle's `release` is bound to the instance it was issued for, a
 * late cleanup from the OLD connection can never close the NEW one.
 */
export function acquireMessagingSocket(
  accessToken: string
): MessagingSocketHandle {
  if (current && current.token !== accessToken) {
    teardown(current);
  }

  if (!current) {
    const socket = io(`${getSocketOrigin()}/messaging`, {
      auth: { accessToken },
      // Prefer WebSocket; polling remains as a fallback the server also allows.
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      timeout: 10_000,
    });
    const instance: SocketInstance = {
      socket,
      token: accessToken,
      refCount: 0,
      heartbeat: null,
      onConnect: () => {},
      onDisconnect: () => {},
    };
    instance.onConnect = () => startHeartbeat(instance);
    instance.onDisconnect = () => stopHeartbeat(instance);
    socket.on("connect", instance.onConnect);
    socket.on("disconnect", instance.onDisconnect);
    if (socket.connected) startHeartbeat(instance);
    current = instance;
  }

  const instance = current;
  instance.refCount += 1;
  let released = false;

  return {
    socket: instance.socket,
    release() {
      if (released) return;
      released = true;
      instance.refCount -= 1;
      // Close only when this instance is still the live one and nothing else
      // is using it (last consumer unmounted, or the user signed out).
      if (instance.refCount <= 0 && current === instance) {
        teardown(instance);
      }
    },
  };
}

/** Closes the shared connection outright (e.g. explicit sign-out teardown). */
export function closeMessagingSocket(): void {
  if (current) teardown(current);
}
