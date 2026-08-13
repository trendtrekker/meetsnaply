import { cn } from "@/lib/utils";

/** Four-point star mark. Inherits currentColor so it works on any surface. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-6", className)}
    >
      <path
        d="M16 0c.9 7.3 7.8 14.2 16 16-8.2 1.8-15.1 8.7-16 16-.9-7.3-7.8-14.2-16-16C8.2 14.2 15.1 7.3 16 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Logo({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-lg font-extrabold tracking-tight",
        className,
      )}
    >
      <Mark className={cn("size-5 text-primary", markClassName)} />
      meetsnaply
    </span>
  );
}
