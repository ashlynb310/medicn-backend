import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "@prisma/client";

function optionValue(option: string) {
  const index = process.argv.indexOf(option);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value?.trim();
}

async function main() {
  const email = optionValue("--email");
  const databaseUrl = process.env.DATABASE_URL;

  if (!email) {
    throw new Error("Usage: npm run admin:grant -- --email user@example.com");
  }

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_ADMIN_BOOTSTRAP !== "true"
  ) {
    throw new Error(
      "Production admin bootstrap requires ALLOW_ADMIN_BOOTSTRAP=true."
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl })
  });

  try {
    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive"
        }
      },
      select: {
        id: true,
        email: true,
        roles: true
      }
    });

    if (!user) {
      throw new Error(
        "No synced MediCN user found for this email. Sign in once before granting admin."
      );
    }

    const roles = Array.from(new Set([...user.roles, UserRole.admin]));
    await prisma.user.update({
      where: { id: user.id },
      data: { roles }
    });

    console.log(`Granted admin role to ${user.email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
