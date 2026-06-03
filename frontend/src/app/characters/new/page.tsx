"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowLeft, Loader2, UserPlus, Crown } from "lucide-react";
import Link from "next/link";

export default function NewCharacter() {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  
  const [formData, setFormData] = useState({
    name: "",
    gender: "female",
    appearance: "",
    outfit: "",
    visualStyle: "Cinematic",
    enableLora: false
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.appearance) return;
    
    setIsGenerating(true);
    try {
      const res = await fetch("http://localhost:8000/api/v1/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      
      if (!res.ok) throw new Error("Failed to generate character");
      
      // Navigate back to library on success
      router.push("/characters");
    } catch (err) {
      console.error(err);
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col p-8 lg:p-12 max-w-4xl mx-auto w-full">
      <header className="mb-8 flex flex-col gap-4">
        <Link href="/characters" className="text-zinc-500 hover:text-zinc-300 flex items-center gap-2 text-sm w-fit transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Library
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#f5f5f7] flex items-center gap-3">
            <UserPlus className="w-8 h-8 text-violet-400" />
            Create Cast Member
          </h1>
          <p className="text-sm text-zinc-400 mt-2">Design a canonical character to use across multiple scenes.</p>
        </div>
      </header>

      <div className="bg-[#0b0a0f]/80 border border-white/5 rounded-3xl p-8 backdrop-blur-lg shadow-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-xs text-zinc-400 font-medium">Character Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                placeholder="e.g. Anya, The Cyber-Ronin"
                className="bg-[#121118]/80 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500/50 text-white placeholder-zinc-600"
              />
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-xs text-zinc-400 font-medium">Gender</label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({...formData, gender: e.target.value})}
                className="bg-[#121118]/80 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500/50 text-white"
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
            <label className="text-xs text-zinc-400 font-medium">Core Appearance (Hair, Face, Body)</label>
            <textarea
              required
              rows={3}
              value={formData.appearance}
              onChange={(e) => setFormData({...formData, appearance: e.target.value})}
              placeholder="e.g. 24 years old, sharp jawline, messy silver hair, glowing blue eyes..."
              className="bg-[#121118]/80 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500/50 text-white placeholder-zinc-600 resize-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-xs text-zinc-400 font-medium">Standard Outfit</label>
              <input
                type="text"
                value={formData.outfit}
                onChange={(e) => setFormData({...formData, outfit: e.target.value})}
                placeholder="e.g. Tactical black leather jacket with neon accents"
                className="bg-[#121118]/80 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500/50 text-white placeholder-zinc-600"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-zinc-400 font-medium">Visual Style</label>
              <select
                value={formData.visualStyle}
                onChange={(e) => setFormData({...formData, visualStyle: e.target.value})}
                className="bg-[#121118]/80 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500/50 text-white"
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

          {/* LoRA Premium Toggle */}
          <div 
            onClick={() => {
              if (!formData.enableLora) {
                const confirmed = confirm(
                  "⚠️ Premium LoRA Training\n\n" +
                  "This will train a custom AI model for this character.\n\n" +
                  "• Cost: ~$1-3 per character (GPU usage)\n" +
                  "• Time: 15-30 minutes\n" +
                  "• Benefit: Pixel-perfect consistency across all scenes\n\n" +
                  "Standard mode (free) uses prompt-based consistency which works well for most use cases.\n\n" +
                  "Do you want to enable Premium mode?"
                );
                if (!confirmed) return;
              }
              setFormData({...formData, enableLora: !formData.enableLora});
            }}
            className={`p-4 rounded-xl border cursor-pointer transition-all ${
              formData.enableLora 
                ? 'bg-amber-500/10 border-amber-500/30' 
                : 'bg-[#121118]/50 border-white/5 hover:border-white/10'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-5 rounded-full relative transition-all ${formData.enableLora ? 'bg-amber-500' : 'bg-zinc-700'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${formData.enableLora ? 'left-5' : 'left-0.5'}`} />
              </div>
              <div className="flex items-center gap-2">
                <Crown className={`w-4 h-4 ${formData.enableLora ? 'text-amber-400' : 'text-zinc-600'}`} />
                <span className={`text-sm font-semibold ${formData.enableLora ? 'text-amber-300' : 'text-zinc-400'}`}>
                  Premium Consistency (LoRA Training)
                </span>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500 mt-2 ml-[52px]">
              {formData.enableLora 
                ? "Multi-angle reference sheet + AI fine-tuning. Takes ~15-30 min. Best for recurring characters." 
                : "Standard mode: Single portrait + prompt-based consistency. Instant and free."}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20 text-xs text-violet-300 leading-relaxed">
            <strong>How it works:</strong> {formData.enableLora 
              ? "Flux will generate a multi-angle reference sheet and train a custom LoRA model for pixel-perfect consistency across all scenes. This takes 15-30 minutes but guarantees identical character reproduction."
              : "Flux will generate a clean portrait of your character. GPT-4o will inject the character's full description into every scene prompt to maintain consistency across your story."}
          </div>

          <button
            type="submit"
            disabled={isGenerating || !formData.name || !formData.appearance}
            className="w-full mt-4 py-4 bg-gradient-to-r from-violet-600 via-indigo-600 to-violet-700 hover:from-violet-500 hover:to-violet-600 disabled:opacity-40 disabled:pointer-events-none rounded-xl text-sm font-bold tracking-wide text-white shadow-xl shadow-violet-900/30 transition-all flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99]"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{formData.enableLora ? "Training LoRA Model... (15-30 min)" : "Generating Portrait..."}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                <span>Generate Cast Member</span>
              </>
            )}
          </button>

        </form>
      </div>
    </div>
  );
}
