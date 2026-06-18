import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ListingStatus, UserRole, type User } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import type { CreatePresignedUploadDto } from "./dto/create-presigned-upload.dto";

interface SupabaseStorageClient {
  storage: {
    from(bucket: string): {
      createSignedUploadUrl(path: string): Promise<{
        data: { signedUrl: string; path: string; token?: string } | null;
        error: Error | null;
      }>;
    };
  };
}

@Injectable()
export class UploadsService {
  private readonly supabase: SupabaseStorageClient | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly config: ConfigService
  ) {
    this.supabase = this.createSupabaseClient();
  }

  async createPresignedUploadUrl(
    token: string,
    input: CreatePresignedUploadDto
  ) {
    const currentUser = await this.authService.getCurrentUserRecord(token);
    const listing = await this.prisma.listing.findFirst({
      where: {
        id: input.listingId,
        deletedAt: null,
        status: {
          not: ListingStatus.archived
        }
      },
      select: {
        id: true,
        hostId: true
      }
    });

    if (!listing) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Listing was not found.",
        details: {}
      });
    }

    this.assertHostOwnerOrAdmin(currentUser, listing.hostId);

    if (!this.supabase) {
      throw new InternalServerErrorException({
        code: "INTERNAL_SERVER_ERROR",
        message: "Supabase Storage is not configured.",
        details: {}
      });
    }

    const bucket = this.config.get<string>("SUPABASE_STORAGE_BUCKET") ?? "listing-photos";
    const storagePath = `listings/${listing.id}/${randomUUID()}-${this.safeFileName(
      input.fileName
    )}`;
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      throw new InternalServerErrorException({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not create upload URL.",
        details: {}
      });
    }

    return {
      uploadUrl: data.signedUrl,
      fileUrl: this.toStorageFileUrl(bucket, storagePath),
      storagePath
    };
  }

  private assertHostOwnerOrAdmin(user: User, hostId: string) {
    if (user.roles.includes(UserRole.admin)) {
      return;
    }

    if (user.roles.includes(UserRole.host) && user.id === hostId) {
      return;
    }

    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "You do not have permission to upload photos for this listing.",
      details: {}
    });
  }

  private safeFileName(fileName: string) {
    const normalized = fileName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    return normalized.length > 0 ? normalized : "upload";
  }

  private toStorageFileUrl(bucket: string, storagePath: string) {
    const supabaseUrl = this.config
      .get<string>("NEXT_PUBLIC_SUPABASE_URL")
      ?.replace(/\/$/, "");
    const encodedPath = storagePath
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");

    return supabaseUrl
      ? `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodedPath}`
      : storagePath;
  }

  private createSupabaseClient() {
    const supabaseUrl = this.config.get<string>("NEXT_PUBLIC_SUPABASE_URL");
    const secretKey = this.config.get<string>("SUPABASE_SECRET_KEY");

    if (!supabaseUrl || !secretKey) {
      return null;
    }

    return createClient(supabaseUrl, secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
      }
    }) as SupabaseStorageClient;
  }
}
