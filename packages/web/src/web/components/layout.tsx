import { Link, useLocation } from "wouter";
import {
  CalendarClock,
  ClipboardList,
  Clock3,
  Drumstick,
  Egg,
  FileSpreadsheet,
  LayoutDashboard,
  Package,
  Receipt,
  Settings as SettingsIcon,
  ShoppingBasket,
  Sprout,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/orders", label: "Website Orders", icon: ShoppingBasket },
  { to: "/subscriptions", label: "Subscriptions", icon: CalendarClock },
  { to: "/billing", label: "Billing Run", icon: Receipt },
  { to: "/lists", label: "Weekly Lists", icon: ClipboardList },
  { to: "/timesheets", label: "Timesheets", icon: Clock3 },
  { to: "/broilers", label: "Pastured Broilers", icon: Drumstick },
  { to: "/layers", label: "Pastured Layers", icon: Egg },
  { to: "/products", label: "Products", icon: Package },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/batches", label: "Xero Batches", icon: FileSpreadsheet },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Layout({ children, authenticated, onLogout }: {
  children: React.ReactNode;
  authenticated: boolean;
  onLogout: () => void;
}) {
  const [location] = useLocation();
  const visibleNav = authenticated ? nav : [
    { to: "/lists", label: "Weekly Lists", icon: ClipboardList },
    { to: "/timesheets/log", label: "Timesheets", icon: Clock3 },
    { to: "/broilers/log", label: "Broilers", icon: Drumstick },
    { to: "/layers/log", label: "Layers", icon: Egg },
  ];
  const accountControl = authenticated ? (
    <button onClick={onLogout} className="rounded-md px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-white/10">Sign out</button>
  ) : (
    <Link to="/timesheets" className="rounded-md px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-white/10">Manager sign-in</Link>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed top-0 left-0 z-30 hidden h-screen w-[232px] flex-col bg-primary text-primary-foreground md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-accent">
            <Sprout className="size-5 text-white" />
          </div>
          <div>
            <div className="font-display text-[15px] leading-tight font-semibold">FarmBox</div>
            <div className="text-[11px] text-primary-foreground/60">Xero invoicing</div>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-0.5 px-2.5">
          {visibleNav.map((item) => {
            const active = item.to === "/" ? location === "/" : location.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-primary-foreground/75 hover:bg-white/8 hover:text-primary-foreground",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-2.5 py-2">{accountControl}</div>
        <div className="px-5 py-4 text-[11px] leading-relaxed text-primary-foreground/45">
          {authenticated ? "SKUs are shared with Xero. Nothing is sent to Xero automatically — every run produces a CSV you import." : "Weekly farm lists and daily employee timesheets. Other sections require manager sign-in."}
        </div>
      </aside>
      <header className="bg-primary px-4 py-3 text-primary-foreground md:hidden">
        <div className="mb-3 flex items-center justify-between gap-2 font-display text-lg">
          <span className="flex items-center gap-2">
          <Sprout className="size-5 text-accent" />
          FarmBox
          </span>
          {accountControl}
        </div>
        <nav className="flex gap-2 overflow-x-auto pb-1">
          {visibleNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "shrink-0 rounded-md px-3 py-2 text-xs font-semibold",
                location === item.to ? "bg-accent" : "bg-white/10",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="min-h-screen md:ml-[232px]">
        <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
