import Link from "next/link";
import { CalendarDays, Clock, LayoutList, Settings } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { signOut } from "@/lib/auth/actions";
import { Logo } from "@/components/brand/logo";
import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { NavLink } from "@/components/dashboard/nav-link";
import { appUrl } from "@/lib/app-url";

const NAV = [
  { href: "/dashboard", label: "Bookings", icon: CalendarDays },
  { href: "/dashboard/event-types", label: "Meeting types", icon: LayoutList },
  { href: "/dashboard/availability", label: "Availability", icon: Clock },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const origin = appUrl();
  const bookingLink = `${origin}/${user.username}`;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
          <Link href="/dashboard">
            <Logo className="text-base" />
          </Link>

          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href}>
                <item.icon className="size-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <CopyLinkButton url={bookingLink} />
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-full px-3 py-2 text-sm font-semibold text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              >
                Log out
              </button>
            </form>
          </div>
        </div>

        <nav className="scrollbar-thin flex gap-1 overflow-x-auto border-t border-border px-5 py-2 md:hidden">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href}>
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
