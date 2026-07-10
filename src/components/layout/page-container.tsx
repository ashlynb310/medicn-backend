import { cn } from "@/lib/utils";

interface PageContainerProps {
  children: React.ReactNode;
  /** Constrains the content width. Defaults to the standard app width. */
  width?: "default" | "narrow" | "wide";
  className?: string;
}

const widthClass: Record<NonNullable<PageContainerProps["width"]>, string> = {
  narrow: "max-w-3xl",
  default: "max-w-5xl",
  wide: "max-w-7xl",
};

export default function PageContainer({
  children,
  width = "default",
  className,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-4 py-8 sm:px-6",
        widthClass[width],
        className
      )}
    >
      {children}
    </div>
  );
}
