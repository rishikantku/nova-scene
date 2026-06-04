"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Users, Plus, Loader2, Trash2, Crown, RefreshCw, X } from "lucide-react";

interface Character {
  id: string;
  name: string;
  gender: string;
  appearance: string;
  outfit: string;
  visualStyle: string;
  imageUrl: string | null;
  createdAt: string;
  loraStatus?: string;
  status?: 'generating' | 'ready';
}

export default function CharacterLibrary() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingChar, setEditingChar] = useState<Character | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  useEffect(() => {
    const fetchCharacters = () => {
      fetch(`${process.env.NODE_ENV === 'production' ? 'https://esudvxmq41.execute-api.ap-south-1.amazonaws.com' : 'http://localhost:8000'}/api/v1/characters`)
        .then(res => res.json())
        .then(data => {
          setCharacters(data.characters || []);
          setIsLoading(false);
        })
        .catch(err => {
          console.error("Failed to fetch characters", err);
          setIsLoading(false);
        });
    };

    fetchCharacters();
    // Poll every 5s in case a character finishes training
    const interval = setInterval(fetchCharacters, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This will also remove any associated LoRA data.`)) return;
    
    setDeletingId(id);
    try {
      const res = await fetch(`${process.env.NODE_ENV === 'production' ? 'https://esudvxmq41.execute-api.ap-south-1.amazonaws.com' : 'http://localhost:8000'}/api/v1/characters/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setCharacters(prev => prev.filter(c => c.id !== id));
      } else {
        alert('Failed to delete character');
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete character');
    }
    setDeletingId(null);
  };

  const handleRegenerateClick = (char: Character) => {
    const isPremium = char.loraStatus !== undefined;
    const msg = isPremium 
      ? `⚠️ Regenerate Premium Character?\n\nThis will re-run the Flux generation AND re-train the AI model.\n\n• Cost: ~$1-3 (GPU usage)\n• Time: 15-30 minutes\n\nContinue?`
      : `Regenerate Standard Character?\n\nThis will re-run the Flux generation to create a new portrait.\n\nContinue?`;
      
    if (confirm(msg)) {
      // Open modal with cloned character data
      setEditingChar({ ...char });
    }
  };

  const submitRegenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChar) return;
    
    const charId = editingChar.id;
    const updateData = {
      name: editingChar.name,
      gender: editingChar.gender,
      appearance: editingChar.appearance,
      outfit: editingChar.outfit,
      visualStyle: editingChar.visualStyle
    };
    
    // Close modal and show loading state on card immediately
    setEditingChar(null);
    setRegeneratingId(charId);
    
    try {
      const res = await fetch(`${process.env.NODE_ENV === 'production' ? 'https://esudvxmq41.execute-api.ap-south-1.amazonaws.com' : 'http://localhost:8000'}/api/v1/characters/${charId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData)
      });
      
      if (!res.ok) throw new Error("Failed to regenerate");
      
      // Update local state with new image and training status
      const updated = await res.json();
      setCharacters(prev => prev.map(c => c.id === updated.id ? { ...updated, loraStatus: updated.loraId ? 'generating_dataset' : undefined } : c));
      
    } catch (err) {
      console.error(err);
      alert("Failed to regenerate character");
    } finally {
      setRegeneratingId(null);
    }
  };

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
          {characters.map(char => {
            const isTraining = ['generating_dataset', 'training'].includes(char.loraStatus || '');
            const isPremiumReady = char.loraStatus === 'completed';
            const isRegenerating = regeneratingId === char.id || char.status === 'generating';
            const isCardLoading = isTraining || isRegenerating;
            
            return (
              <div key={char.id} className="bg-[#121118]/80 border border-white/10 rounded-2xl overflow-hidden group hover:border-violet-500/50 transition-all relative">
                <div className="aspect-square bg-zinc-900 relative overflow-hidden">
                  {char.imageUrl ? (
                    <img 
                      src={char.imageUrl} 
                      alt={char.name} 
                      className={`w-full h-full object-cover transition-transform duration-700 ${isCardLoading ? 'opacity-40 grayscale' : 'group-hover:scale-105'}`} 
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-700">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  )}
                  
                  {isRegenerating ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                      <Loader2 className="w-8 h-8 text-fuchsia-400 animate-spin mb-3" />
                      <span className="text-fuchsia-400 font-bold text-sm bg-fuchsia-900/40 px-3 py-1 rounded-full border border-fuchsia-500/30">
                        Generating Portrait...
                      </span>
                    </div>
                  ) : isTraining ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                      <Loader2 className="w-8 h-8 text-amber-400 animate-spin mb-3" />
                      <span className="text-amber-400 font-bold text-sm bg-amber-900/40 px-3 py-1 rounded-full border border-amber-500/30">
                        {char.loraStatus === 'generating_dataset' ? 'Generating Dataset...' : 'Training AI Model...'}
                      </span>
                    </div>
                  ) : null}

                  <div className="absolute top-3 right-3 flex gap-2 z-20">
                    {isPremiumReady && (
                      <div className="bg-amber-500/20 backdrop-blur-md px-2 py-1 rounded-md border border-amber-500/30 flex items-center gap-1 shadow-lg shadow-amber-900/50">
                        <Crown className="w-3 h-3 text-amber-400" />
                        <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">Premium</span>
                      </div>
                    )}
                    <div className="bg-black/60 backdrop-blur-md px-2 py-1 rounded-md border border-white/10 text-[10px] uppercase font-bold text-zinc-300 tracking-wider">
                      {char.visualStyle}
                    </div>
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-1 relative z-20">
                    <h3 className="text-lg font-bold text-[#f5f5f7]">{char.name}</h3>
                    <div className="flex">
                      <button
                        onClick={() => handleDelete(char.id, char.name)}
                        disabled={deletingId === char.id || isCardLoading}
                        className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-0"
                        title="Delete character"
                      >
                        {deletingId === char.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleRegenerateClick(char)}
                        disabled={isCardLoading}
                        className="p-1.5 rounded-lg text-zinc-600 hover:text-amber-400 hover:bg-amber-500/10 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-0 ml-1"
                        title="Regenerate character"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 mb-3 line-clamp-2">{char.appearance}</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 bg-white/5 border border-white/5 rounded-md text-[10px] text-zinc-400 capitalize">{char.gender}</span>
                    <span className="px-2 py-1 bg-white/5 border border-white/5 rounded-md text-[10px] text-zinc-400 truncate max-w-[120px]">{char.outfit}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit / Regenerate Modal */}
      {editingChar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0b0a0f] border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-amber-400" />
                Regenerate Character
              </h2>
              <button onClick={() => setEditingChar(null)} className="p-2 hover:bg-white/5 rounded-full text-zinc-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={submitRegenerate} className="p-6 flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-5">
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-zinc-400 font-medium">Name</label>
                  <input
                    type="text"
                    required
                    value={editingChar.name}
                    onChange={(e) => setEditingChar({...editingChar, name: e.target.value})}
                    className="bg-[#121118] border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500/50 text-white"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-zinc-400 font-medium">Gender</label>
                  <select
                    value={editingChar.gender}
                    onChange={(e) => setEditingChar({...editingChar, gender: e.target.value})}
                    className="bg-[#121118] border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500/50 text-white"
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="androgynous">Androgynous</option>
                    <option value="robot">Robot / AI</option>
                    <option value="creature">Creature</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs text-zinc-400 font-medium">Appearance</label>
                <textarea
                  required
                  rows={3}
                  value={editingChar.appearance}
                  onChange={(e) => setEditingChar({...editingChar, appearance: e.target.value})}
                  className="bg-[#121118] border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500/50 text-white resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-zinc-400 font-medium">Outfit</label>
                  <input
                    type="text"
                    value={editingChar.outfit}
                    onChange={(e) => setEditingChar({...editingChar, outfit: e.target.value})}
                    className="bg-[#121118] border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500/50 text-white"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-zinc-400 font-medium">Visual Style</label>
                  <select
                    value={editingChar.visualStyle}
                    onChange={(e) => setEditingChar({...editingChar, visualStyle: e.target.value})}
                    className="bg-[#121118] border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500/50 text-white"
                  >
                    <option value="Cinematic">Cinematic</option>
                    <option value="Pixar 3D Animation">Pixar 3D Animation</option>
                    <option value="Anime/Manga">Anime / Manga</option>
                    <option value="Cyberpunk">Cyberpunk</option>
                    <option value="Photorealistic">Photorealistic</option>
                    <option value="Watercolor">Watercolor</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingChar(null)}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!editingChar.name || !editingChar.appearance}
                  className="px-6 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 disabled:pointer-events-none rounded-xl text-sm font-bold text-white shadow-lg shadow-amber-900/20 transition-all flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Confirm & Regenerate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
