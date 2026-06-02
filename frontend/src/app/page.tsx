"use client";

import Link from "next/link";
import { Film, Video, ArrowRight, Sparkles, BookOpen } from "lucide-react";

export default function Dashboard() {
  return (
    <div className="min-h-full flex flex-col p-8 lg:p-12 max-w-6xl mx-auto w-full relative">
      
      <header className="mb-16 relative z-10">
        <div className="inline-block mb-4 px-3 py-1 bg-white/5 border border-white/10 rounded-full">
          <span className="bg-gradient-to-r from-fuchsia-400 to-violet-400 bg-clip-text text-transparent text-xs font-bold tracking-widest uppercase">
            NovaScene Studio 2.0
          </span>
        </div>
        <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tighter bg-gradient-to-r from-white via-fuchsia-100 to-zinc-400 bg-clip-text text-transparent mb-6 drop-shadow-sm">
          Bring your vision <br className="hidden md:block"/> to life.
        </h1>
        <p className="text-xl text-zinc-400 font-medium max-w-2xl">
          What do you want to create today?
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
        
        {/* Option A: One-Time Video */}
        <Link 
          href="/create/single"
          className="group relative bg-[#0a0a0c]/80 border border-white/10 rounded-[2.5rem] p-10 backdrop-blur-2xl hover:bg-white/[0.04] transition-all duration-500 hover:border-violet-500/50 overflow-hidden flex flex-col h-[380px] shadow-2xl"
        >
          {/* Neon mesh background hover */}
          <div className="absolute inset-0 bg-gradient-to-br from-violet-600/0 to-fuchsia-600/0 group-hover:from-violet-600/10 group-hover:to-fuchsia-600/10 transition-colors duration-700"></div>
          
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 border border-white/20 flex items-center justify-center mb-8 text-white group-hover:scale-110 group-hover:shadow-[0_0_30px_rgba(139,92,246,0.3)] transition-all duration-500 relative z-10">
            <Video className="w-7 h-7" />
          </div>
          
          <h2 className="text-3xl font-bold text-white mb-4 relative z-10">Quick Generation</h2>
          <p className="text-base text-zinc-400 leading-relaxed mb-auto pr-8 relative z-10 font-medium">
            Fast, standalone cinematic video. Enter a prompt, pick a style, and let the AI direct a stunning quick sequence.
          </p>
          
          <div className="flex items-center gap-3 text-sm font-bold text-violet-400 group-hover:text-fuchsia-400 transition-colors mt-8 relative z-10">
            <span>Start Quick Gen</span>
            <ArrowRight className="w-5 h-5 group-hover:translate-x-2 transition-transform duration-300" />
          </div>
        </Link>

        {/* Option B: Story Mode */}
        <Link 
          href="/create/story"
          className="group relative bg-gradient-to-b from-[#13072e] to-[#0a0a0c] border border-fuchsia-500/30 rounded-[2.5rem] p-10 backdrop-blur-2xl hover:border-fuchsia-400/60 transition-all duration-500 overflow-hidden flex flex-col h-[380px] shadow-[0_0_50px_rgba(217,70,239,0.15)] hover:shadow-[0_0_80px_rgba(217,70,239,0.3)]"
        >
           {/* Crazy glowing orb */}
           <div className="absolute -top-32 -right-32 w-96 h-96 bg-fuchsia-600/30 rounded-full blur-[100px] group-hover:bg-fuchsia-500/40 group-hover:scale-110 transition-all duration-700"></div>
           
           <div className="absolute top-8 right-8 z-20">
              <span className="bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white border border-white/20 shadow-lg px-4 py-1.5 text-[10px] uppercase font-black tracking-widest rounded-full flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" /> Pro Mode
              </span>
           </div>
          
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center mb-8 text-white group-hover:scale-110 group-hover:rotate-3 shadow-xl shadow-fuchsia-500/30 transition-all duration-500 relative z-10">
            <Film className="w-7 h-7" />
          </div>
          
          <h2 className="text-3xl font-bold text-white mb-4 relative z-10">Story Mode</h2>
          <p className="text-base text-fuchsia-100/70 leading-relaxed mb-auto pr-8 relative z-10 font-medium">
            The ultimate AI filmmaking studio. Create a persistent cast, maintain 100% character consistency, and storyboard multi-scene masterpieces.
          </p>
          
          <div className="flex items-center gap-3 text-sm font-bold text-fuchsia-300 group-hover:text-white transition-colors mt-8 relative z-10">
            <span>Enter Story Studio</span>
            <ArrowRight className="w-5 h-5 group-hover:translate-x-2 transition-transform duration-300" />
          </div>
        </Link>
        
      </div>

      <div className="mt-20 border-t border-white/10 pt-12 flex items-center justify-center relative z-10">
        <Link href="/characters" className="group flex items-center gap-5 p-5 rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all backdrop-blur-xl hover:scale-[1.02] cursor-pointer">
           <div className="p-3 bg-gradient-to-br from-zinc-700 to-zinc-900 border border-white/10 rounded-xl shadow-inner group-hover:shadow-fuchsia-500/20 transition-all">
             <BookOpen className="w-5 h-5 text-white" />
           </div>
           <div>
             <h3 className="text-base font-bold text-white mb-1">Character Library</h3>
             <p className="text-sm text-zinc-400">Manage your persistent cast members & canonical assets.</p>
           </div>
           <ArrowRight className="w-4 h-4 text-zinc-500 ml-4 group-hover:text-white transition-colors" />
        </Link>
      </div>
    </div>
  );
}
