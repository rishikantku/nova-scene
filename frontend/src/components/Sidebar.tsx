"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, Home, Video, Film, Users, Package, Settings, History } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { name: "Home", href: "/", icon: Home },
    { name: "Create", href: "/create", icon: Video },
    { name: "Stories", href: "/stories", icon: Film },
    { name: "Characters", href: "/characters", icon: Users },
    { name: "Assets", href: "/assets", icon: Package },
    { name: "History", href: "/history", icon: History },
  ];

  return (
    <aside className="w-64 bg-[#0a0a0c]/40 backdrop-blur-3xl border-r border-white/10 h-screen sticky top-0 flex flex-col pt-8 pb-6 px-4 shadow-2xl relative">
      {/* Decorative inner glow */}
      <div className="absolute inset-y-0 right-0 w-[1px] bg-gradient-to-b from-transparent via-fuchsia-500/20 to-transparent"></div>

      {/* Brand Logo */}
      <div className="flex items-center gap-3 px-3 mb-10 group cursor-pointer">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-600 via-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-fuchsia-500/30 group-hover:scale-105 transition-transform duration-300">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="text-base font-extrabold tracking-tight bg-gradient-to-r from-white to-zinc-300 bg-clip-text text-transparent group-hover:text-white transition-colors">NovaScene</span>
          <span className="text-[9px] text-fuchsia-400 tracking-widest uppercase font-black">Studio</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-2 flex-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const isActuallyActive = item.href === "/" ? pathname === "/" : isActive;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 relative overflow-hidden group ${
                isActuallyActive
                  ? "text-white shadow-lg shadow-violet-900/20"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {isActuallyActive && (
                <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-600/20 to-violet-600/20 border border-fuchsia-500/20 rounded-xl"></div>
              )}
              {isActuallyActive && (
                <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-gradient-to-b from-fuchsia-500 to-violet-500 rounded-r-full shadow-[0_0_10px_rgba(217,70,239,0.8)]"></div>
              )}
              <item.icon className={`w-4 h-4 relative z-10 transition-transform duration-300 ${isActuallyActive ? "text-fuchsia-400 scale-110" : "text-zinc-500 group-hover:scale-110"}`} />
              <span className="relative z-10">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="mt-auto flex flex-col gap-2">
        <Link
          href="/settings"
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-zinc-400 hover:text-white hover:bg-white/5 transition-all group"
        >
          <Settings className="w-4 h-4 text-zinc-500 group-hover:rotate-90 transition-transform duration-500" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
