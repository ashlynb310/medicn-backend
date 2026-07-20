import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ConnectCapabilityStatus,
  Prisma,
  StripeAccountApiModel,
  UserRole,
  type ConnectedAccount,
  type User
} from "@prisma/client";
import type Stripe from "stripe";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import type {
  ConnectAccountTargetDto,
  CreateConnectedAccountDto
} from "./dto/connect-account.dto";
import { StripeService } from "./stripe.service";

type StripeV2Account = Stripe.V2.Core.Account;

interface SafeRequirement {
  status: "currently_due" | "past_due";
  awaitingActionFrom: "stripe" | "user";
  requestedReasonCodes: string[];
  restrictsCapabilities: string[];
}

@Injectable()
export class ConnectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly stripeService: StripeService,
    private readonly config: ConfigService
  ) {}

  isEnabled() {
    return this.config.get<boolean>("STRIPE_CONNECT_ENABLED") === true;
  }

  marketplaceConfiguration() {
    this.assertConfigured();
    const platformFeeBps = this.config.get<number>("PLATFORM_FEE_BPS");
    const transferDelayHours = this.config.get<number>(
      "HOST_TRANSFER_DELAY_HOURS"
    );
    if (platformFeeBps === undefined || transferDelayHours === undefined) {
      throw this.notConfigured();
    }
    return { platformFeeBps, transferDelayHours };
  }

  async createOrReuseAccount(token: string, input: CreateConnectedAccountDto) {
    this.assertConfigured();
    const target = await this.authorizedHost(token, input.hostUserId);

    return this.prisma.$transaction(async (transaction) => {
      await this.lockHost(transaction, target.id);
      const existing = await transaction.connectedAccount.findUnique({
        where: { userId: target.id }
      });
      if (existing) {
        return this.toSafeAccount(existing);
      }

      const providerAccount = await this.stripeService.createRecipientAccount({
        userId: target.id,
        email: target.email,
        displayName: this.displayName(target),
        country: input.country,
        idempotencyKey: `connect-account:${target.id}`
      });
      const snapshot = this.providerSnapshot(providerAccount);
      const created = await transaction.connectedAccount.create({
        data: {
          userId: target.id,
          providerAccountId: providerAccount.id,
          apiModel: StripeAccountApiModel.accounts_v2_recipient,
          ...snapshot
        }
      });
      return this.toSafeAccount(created);
    });
  }

  async createOnboardingLink(
    token: string,
    input: ConnectAccountTargetDto
  ) {
    this.assertConfigured();
    const target = await this.authorizedHost(token, input.hostUserId);
    const account = await this.requireStoredAccount(target.id);
    return this.stripeService.createRecipientAccountLink(
      account.providerAccountId,
      "account_onboarding"
    );
  }

  async createManagementLink(
    token: string,
    input: ConnectAccountTargetDto
  ) {
    this.assertConfigured();
    const target = await this.authorizedHost(token, input.hostUserId);
    const account = await this.requireStoredAccount(target.id);
    return this.stripeService.createRecipientAccountLink(
      account.providerAccountId,
      "account_update"
    );
  }

  async synchronizeAccount(token: string, input: ConnectAccountTargetDto) {
    this.assertConfigured();
    const target = await this.authorizedHost(token, input.hostUserId);
    return this.toSafeAccount(await this.synchronizeHostAccount(target.id));
  }

  async requireTransferReadyForBooking(bookingId: string) {
    if (!this.isEnabled()) {
      return null;
    }
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { hostId: true }
    });
    if (!booking) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Booking was not found.",
        details: {}
      });
    }
    const account = await this.synchronizeHostAccount(booking.hostId);
    if (!account.transfersReady) {
      throw new UnprocessableEntityException({
        code: "HOST_PAYOUT_ACCOUNT_NOT_READY",
        message: "The listing Host must complete Stripe onboarding before checkout.",
        details: {}
      });
    }
    return account;
  }

  async synchronizeHostAccount(userId: string) {
    const stored = await this.requireStoredAccount(userId);
    const providerAccount = await this.stripeService.retrieveRecipientAccount(
      stored.providerAccountId
    );
    return this.prisma.connectedAccount.update({
      where: { id: stored.id },
      data: this.providerSnapshot(providerAccount)
    });
  }

  private async authorizedHost(token: string, requestedHostId?: string) {
    const current = await this.authService.getCurrentUserRecord(token);
    const isAdmin = current.roles.includes(UserRole.admin);
    const isHost = current.roles.includes(UserRole.host);
    if (!isAdmin && !isHost) {
      throw this.forbidden();
    }
    if (!isAdmin && requestedHostId && requestedHostId !== current.id) {
      throw this.forbidden();
    }
    if (isAdmin && !isHost && !requestedHostId) {
      throw new UnprocessableEntityException({
        code: "VALIDATION_ERROR",
        message: "hostUserId is required when an Admin manages a Host account.",
        details: {}
      });
    }

    const targetId = requestedHostId ?? current.id;
    const target =
      targetId === current.id
        ? current
        : await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Host was not found.",
        details: {}
      });
    }
    if (!target.roles.includes(UserRole.host)) {
      throw this.forbidden();
    }
    return target;
  }

  private async requireStoredAccount(userId: string) {
    const account = await this.prisma.connectedAccount.findUnique({
      where: { userId }
    });
    if (!account) {
      throw new UnprocessableEntityException({
        code: "CONNECT_ONBOARDING_REQUIRED",
        message: "Create the Host Stripe connected account before onboarding.",
        details: {}
      });
    }
    return account;
  }

  private providerSnapshot(account: StripeV2Account) {
    const transferCapability =
      account.configuration?.recipient?.capabilities?.stripe_balance
        ?.stripe_transfers;
    const payoutCapability =
      account.configuration?.recipient?.capabilities?.stripe_balance?.payouts;
    const requirements = this.safeRequirements(account.requirements?.entries);
    const currentlyDue = requirements.filter(
      (requirement) => requirement.status === "currently_due"
    );
    const pastDue = requirements.filter(
      (requirement) => requirement.status === "past_due"
    );
    const capability = this.capabilityStatus(transferCapability?.status);

    return {
      country: account.identity?.country?.toUpperCase() ?? null,
      currency: account.defaults?.currency?.toUpperCase() ?? null,
      detailsSubmitted:
        account.applied_configurations.includes("recipient") &&
        currentlyDue.length === 0 &&
        pastDue.length === 0,
      transfersCapability: capability,
      transfersReady: capability === ConnectCapabilityStatus.active,
      payoutsEnabled: payoutCapability
        ? payoutCapability.status === "active"
        : null,
      requirementsCurrentlyDue: currentlyDue as unknown as Prisma.InputJsonValue,
      requirementsPastDue: pastDue as unknown as Prisma.InputJsonValue,
      lastSynchronizedAt: new Date()
    };
  }

  private safeRequirements(
    entries: NonNullable<StripeV2Account["requirements"]>["entries"]
  ): SafeRequirement[] {
    return (entries ?? []).flatMap((entry) => {
      const status = entry.minimum_deadline.status;
      if (status !== "currently_due" && status !== "past_due") {
        return [];
      }
      return [
        {
          status,
          awaitingActionFrom: entry.awaiting_action_from,
          requestedReasonCodes: entry.requested_reasons.map(
            (reason) => reason.code
          ),
          restrictsCapabilities:
            entry.impact.restricts_capabilities?.map(
              (impact) => `${impact.configuration}.${impact.capability}`
            ) ?? []
        }
      ];
    });
  }

  private capabilityStatus(status?: string) {
    if (status === "active") return ConnectCapabilityStatus.active;
    if (status === "restricted") return ConnectCapabilityStatus.restricted;
    if (status === "unsupported") return ConnectCapabilityStatus.unsupported;
    return ConnectCapabilityStatus.pending;
  }

  private toSafeAccount(account: ConnectedAccount) {
    return {
      userId: account.userId,
      providerAccountId: account.providerAccountId,
      apiModel: account.apiModel,
      country: account.country,
      currency: account.currency,
      detailsSubmitted: account.detailsSubmitted,
      transfersCapability: account.transfersCapability,
      transfersReady: account.transfersReady,
      payoutsEnabled: account.payoutsEnabled,
      requirementsCurrentlyDue: account.requirementsCurrentlyDue,
      requirementsPastDue: account.requirementsPastDue,
      lastSynchronizedAt: account.lastSynchronizedAt.toISOString(),
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString()
    };
  }

  private displayName(user: User) {
    return (
      user.displayName ??
      [user.firstName, user.lastName].filter(Boolean).join(" ") ??
      "MediCN Host"
    ) || "MediCN Host";
  }

  private lockHost(transaction: Prisma.TransactionClient, hostId: string) {
    return transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`connect:${hostId}`}, 0))`
    );
  }

  private assertConfigured() {
    if (
      !this.isEnabled() ||
      !this.config.get<string>("STRIPE_SECRET_KEY") ||
      !this.config.get<string>("NEXT_PUBLIC_APP_URL")
    ) {
      throw this.notConfigured();
    }
  }

  private notConfigured() {
    return new ServiceUnavailableException({
      code: "CONNECT_NOT_CONFIGURED",
      message: "Stripe Connect is not enabled.",
      details: {}
    });
  }

  private forbidden() {
    return new ForbiddenException({
      code: "FORBIDDEN",
      message: "Only Hosts and Admins can manage connected accounts.",
      details: {}
    });
  }
}
