import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");

export interface MediaObjectInfo {
  size: number;
  contentType: string | null;
}

export interface MediaStorage {
  createSignedUploadUrl(bucket: string, path: string): Promise<string>;
  createSignedDownloadUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number
  ): Promise<string>;
  exists(bucket: string, path: string): Promise<boolean>;
  info(bucket: string, path: string): Promise<MediaObjectInfo>;
  download(bucket: string, path: string, maxBytes: number): Promise<Buffer>;
  upload(
    bucket: string,
    path: string,
    data: Buffer,
    contentType: string
  ): Promise<void>;
  remove(bucket: string, paths: string[]): Promise<void>;
  publicUrl(bucket: string, path: string): string;
}

export function createMediaStorage(config: ConfigService): MediaStorage {
  const enabled = config.get<boolean>("MEDIA_PROCESSING_ENABLED") ?? false;
  const url = config.get<string>("NEXT_PUBLIC_SUPABASE_URL");
  const key = config.get<string>("SUPABASE_SECRET_KEY");
  if (!enabled || !url || !key) return new DisabledMediaStorage();
  return new SupabaseMediaStorage(url, key);
}

export class DisabledMediaStorage implements MediaStorage {
  private unavailable(): never {
    throw new ServiceUnavailableException({
      code: "MEDIA_NOT_CONFIGURED",
      message: "Media processing is not configured.",
      details: {}
    });
  }

  createSignedUploadUrl(): Promise<string> { return Promise.reject(this.unavailable()); }
  createSignedDownloadUrl(): Promise<string> { return Promise.reject(this.unavailable()); }
  exists(): Promise<boolean> { return Promise.reject(this.unavailable()); }
  info(): Promise<MediaObjectInfo> { return Promise.reject(this.unavailable()); }
  download(): Promise<Buffer> { return Promise.reject(this.unavailable()); }
  upload(): Promise<void> { return Promise.reject(this.unavailable()); }
  remove(): Promise<void> { return Promise.reject(this.unavailable()); }
  publicUrl(): string { return this.unavailable(); }
}

export class SupabaseMediaStorage implements MediaStorage {
  private readonly client: SupabaseClient;
  private readonly timeoutMs = 10_000;

  constructor(url: string, serviceKey: string) {
    this.client = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
      }
    });
  }

  async createSignedUploadUrl(bucket: string, path: string) {
    const { data, error } = await this.withTimeout(
      this.client.storage.from(bucket).createSignedUploadUrl(path, {
        upsert: false
      })
    );
    if (error || !data || data.path !== path || !data.signedUrl) {
      throw this.unavailable();
    }
    return data.signedUrl;
  }

  async createSignedDownloadUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number
  ) {
    const { data, error } = await this.withTimeout(
      this.client.storage.from(bucket).createSignedUrl(path, expiresInSeconds)
    );
    if (error || !data?.signedUrl) throw this.unavailable();
    return data.signedUrl;
  }

  async exists(bucket: string, path: string) {
    const { data, error } = await this.withTimeout(
      this.client.storage.from(bucket).exists(path)
    );
    if (error) throw this.unavailable();
    return data;
  }

  async info(bucket: string, path: string) {
    const { data, error } = await this.withTimeout(
      this.client.storage.from(bucket).info(path)
    );
    if (error || !data || !Number.isSafeInteger(data.size)) {
      throw this.unavailable();
    }
    return {
      size: Number(data.size),
      contentType:
        typeof data.metadata?.mimetype === "string"
          ? data.metadata.mimetype
          : null
    };
  }

  async download(bucket: string, path: string, maxBytes: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const { data, error } = await this.client.storage
        .from(bucket)
        .download(path, {}, { signal: controller.signal, cache: "no-store" });
      if (error || !data) throw this.unavailable();
      const buffer = Buffer.from(await data.arrayBuffer());
      if (buffer.length > maxBytes) {
        throw new Error("MEDIA_INPUT_TOO_LARGE");
      }
      return buffer;
    } catch (error) {
      if (error instanceof Error && error.message === "MEDIA_INPUT_TOO_LARGE") {
        throw error;
      }
      throw this.unavailable();
    } finally {
      clearTimeout(timeout);
    }
  }

  async upload(
    bucket: string,
    path: string,
    data: Buffer,
    contentType: string
  ) {
    const result = await this.withTimeout(
      this.client.storage.from(bucket).upload(path, data, {
        cacheControl: "31536000",
        contentType,
        upsert: true
      })
    );
    if (result.error || result.data?.path !== path) throw this.unavailable();
  }

  async remove(bucket: string, paths: string[]) {
    if (paths.length === 0) return;
    const { error } = await this.withTimeout(
      this.client.storage.from(bucket).remove(paths)
    );
    if (error) throw this.unavailable();
  }

  publicUrl(bucket: string, path: string) {
    return this.client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(this.unavailable()), this.timeoutMs);
        })
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private unavailable() {
    return new ServiceUnavailableException({
      code: "MEDIA_STORAGE_UNAVAILABLE",
      message: "Media storage is temporarily unavailable.",
      details: {}
    });
  }
}
