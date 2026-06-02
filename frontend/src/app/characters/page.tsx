"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Users, Plus, Loader2 } from "lucide-react";

interface Character {
  id: string;
  name: string;
  gender: string;
  appearance: string;
  outfit: string;
  visualStyle: string;
  imageUrl: string | null;
  createdAt: string;
}

export default function CharacterLibrary() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("http://localhost:8000/api/v1/characters")
      .then(res => res.json())
      .then(data => {
        setCharacters(data.characters || []);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch characters", err);
        setIsLoading(false);
      });
  }, []);

  return (
    <div className="min-h-full flex flex-col p-8 lg:p-12 max-w-6xl mx-auto w-full relative z-10">
      <header className="mb-12 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-fuchsia-100 to-zinc-400 bg-clip-text text-transparent flex items-center gap-4">
            <div className="p-2 bg-gradient-to-br from-fuchsia-600 to-violet-600 rounded-xl shadow-lg shadow-fuchsia-500/20">
              <Users className="w-6 h-6 text-white" />
            </div>
            Character Library
          </h1>
          <p className="text-base text-zinc-400 mt-3 font-medium max-w-xl">Manage your persistent cast members for Story Mode. Canonical images are injected directly into the video pipeline.</p>
        </div>
        <Link 
          href="/characters/new"
          className="bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 text-white px-6 py-3.5 rounded-2xl text-sm font-bold flex items-center gap-2 transition-all shadow-[0_0_30px_rgba(217,70,239,0.3)] hover:shadow-[0_0_40px_rgba(217,70,239,0.5)] hover:scale-105 active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Create Character
        </Link>
      </header>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500 gap-3">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Loading your cast...</span>
        </div>
      ) : characters.length === 0 ? (
        <div className="bg-[#0b0a0f]/80 border border-white/5 rounded-3xl p-12 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-4">
            <Users className="w-8 h-8 text-zinc-600" />
          </div>
          <h3 className="text-lg font-bold text-zinc-300 mb-2">No characters yet</h3>
          <p className="text-sm text-zinc-500 max-w-md mb-6">
            Create your first canonical character to ensure perfect consistency across all your cinematic scenes.
          </p>
          <Link 
            href="/characters/new"
            className="bg-white/10 hover:bg-white/15 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
          >
            Create Your First Character
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {characters.map(char => (
            <div key={char.id} className="bg-[#121118]/80 border border-white/10 rounded-2xl overflow-hidden group hover:border-violet-500/50 transition-all">
              <div className="aspect-square bg-zinc-900 relative overflow-hidden">
                {char.imageUrl ? (
                  <img src={char.imageUrl} alt={char.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-700">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                )}
                <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-2 py-1 rounded-md border border-white/10 text-[10px] uppercase font-bold text-zinc-300 tracking-wider">
                  {char.visualStyle}
                </div>
              </div>
              <div className="p-5">
                <h3 className="text-lg font-bold text-[#f5f5f7] mb-1">{char.name}</h3>
                <p className="text-xs text-zinc-500 mb-3 line-clamp-2">{char.appearance}</p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 bg-white/5 border border-white/5 rounded-md text-[10px] text-zinc-400 capitalize">{char.gender}</span>
                  <span className="px-2 py-1 bg-white/5 border border-white/5 rounded-md text-[10px] text-zinc-400 truncate max-w-[120px]">{char.outfit}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
