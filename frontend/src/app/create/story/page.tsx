"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowRight, Loader2, Users, Film, CheckCircle2 } from "lucide-react";
import Link from "next/link";

interface Character {
  id: string;
  name: string;
  visualStyle: string;
  imageUrl: string | null;
  loraStatus?: string;
}

export default function StoryWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Story Setup State
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("Cinematic");
  const [visualStyle, setVisualStyle] = useState("Cinematic");
  const [duration, setDuration] = useState(15);
  const [videoEngine, setVideoEngine] = useState("wan");
  const [storyId, setStoryId] = useState<string | null>(null);

  // Cast Selection State
  const [libraryCharacters, setLibraryCharacters] = useState<Character[]>([]);
  const [selectedCastIds, setSelectedCastIds] = useState<string[]>([]);
  const [isLoadingCast, setIsLoadingCast] = useState(false);

  // Fetch characters when reaching step 2
  useEffect(() => {
    if (step === 2 && libraryCharacters.length === 0) {
      setIsLoadingCast(true);
      fetch("http://localhost:8000/api/v1/characters")
        .then(res => res.json())
        .then(data => {
          setLibraryCharacters(data.characters || []);
          setIsLoadingCast(false);
        })
        .catch(err => {
          console.error("Failed to load cast", err);
          setIsLoadingCast(false);
        });
    }
  }, [step]);

  const handleCreateStory = async () => {
    if (!title) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:8000/api/v1/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          genre,
          visualStyle,
          targetDuration: duration,
          videoEngine,
          castIds: selectedCastIds
        })
      });
      if (!res.ok) throw new Error("Failed to create story");
      const data = await res.json();
      setStoryId(data.id);
      setIsLoading(false);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  const handleGenerateBoard = async () => {
    if (!storyId) return;
    setIsLoading(true);
    
    // First, update the story if cast changed
    // In our simple API, we passed castIds during creation, but they might have changed on step 2.
    // For now, we'll just re-POST to generate board, assuming our API used the initial castIds
    // Actually, let's just create the story when moving from Step 2 to Step 3 instead!
    // But since we already created it in Step 1, let's just trigger board generation.
    
    try {
      const res = await fetch(`http://localhost:8000/api/v1/stories/${storyId}/generate-board`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ castIds: selectedCastIds })
      });
      if (!res.ok) throw new Error("Failed to generate storyboard");
      
      // Redirect to the actual interactive storyboard page!
      router.push(`/stories/${storyId}/board`);
    } catch (err: any) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col p-8 lg:p-12 max-w-4xl mx-auto w-full relative z-10">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-fuchsia-400 to-violet-400 bg-clip-text text-transparent inline-flex items-center gap-3">
          <Film className="w-8 h-8 text-fuchsia-400" />
          Story Mode
        </h1>
        <p className="text-sm text-zinc-400 mt-3 font-medium">Design your cinematic masterpiece step by step.</p>
      </header>

      {/* Progress Bar */}
      <div className="flex items-center justify-center gap-4 mb-12">
        <div className={`flex items-center gap-2 ${step >= 1 ? 'text-fuchsia-400' : 'text-zinc-600'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${step >= 1 ? 'bg-fuchsia-500/20 border border-fuchsia-500/50' : 'bg-white/5 border border-white/10'}`}>1</div>
          <span className="text-sm font-semibold">Setup</span>
        </div>
        <div className={`h-[1px] w-12 ${step >= 2 ? 'bg-fuchsia-500/50' : 'bg-white/10'}`}></div>
        <div className={`flex items-center gap-2 ${step >= 2 ? 'text-fuchsia-400' : 'text-zinc-600'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${step >= 2 ? 'bg-fuchsia-500/20 border border-fuchsia-500/50' : 'bg-white/5 border border-white/10'}`}>2</div>
          <span className="text-sm font-semibold">Cast Selection</span>
        </div>
        <div className={`h-[1px] w-12 ${step >= 3 ? 'bg-fuchsia-500/50' : 'bg-white/10'}`}></div>
        <div className={`flex items-center gap-2 ${step >= 3 ? 'text-fuchsia-400' : 'text-zinc-600'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${step >= 3 ? 'bg-fuchsia-500/20 border border-fuchsia-500/50' : 'bg-white/5 border border-white/10'}`}>3</div>
          <span className="text-sm font-semibold">Storyboard</span>
        </div>
      </div>

      <div className="bg-[#0b0a0f]/80 border border-fuchsia-500/20 rounded-[2rem] p-8 md:p-10 backdrop-blur-xl shadow-2xl shadow-fuchsia-900/10">
        
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 text-center">
            {error}
          </div>
        )}

        {/* STEP 1: SETUP */}
        {step === 1 && (
          <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col gap-2">
              <label className="text-sm text-fuchsia-100/70 font-semibold uppercase tracking-wider">Story Title / Concept</label>
              <textarea
                rows={2}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. A lone cyber-ronin must infiltrate a glowing neon megacity to retrieve a stolen artifact..."
                className="bg-[#121118]/80 border border-white/10 rounded-2xl px-5 py-4 text-base focus:outline-none focus:border-fuchsia-500/50 text-white placeholder-zinc-600 resize-none shadow-inner"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-xs text-fuchsia-100/70 font-semibold uppercase tracking-wider">Genre / Tone</label>
                <input
                  type="text"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="bg-[#121118]/80 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-fuchsia-500/50 text-white shadow-inner"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-fuchsia-100/70 font-semibold uppercase tracking-wider">Visual Style</label>
                <select
                  value={visualStyle}
                  onChange={(e) => setVisualStyle(e.target.value)}
                  className="bg-[#121118]/80 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-fuchsia-500/50 text-white shadow-inner"
                >
                  <option value="Cinematic">Cinematic</option>
                  <option value="Pixar 3D">Pixar 3D Animation</option>
                  <option value="Anime">Anime / Manga</option>
                  <option value="Cyberpunk">Cyberpunk</option>
                  <option value="Watercolor">Watercolor</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-fuchsia-100/70 font-semibold uppercase tracking-wider">Target Duration</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="bg-[#121118]/80 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-fuchsia-500/50 text-white shadow-inner"
                >
                  <option value={10}>10 Seconds (2-3 Scenes)</option>
                  <option value={15}>15 Seconds (3-4 Scenes)</option>
                  <option value={30}>30 Seconds (6-8 Scenes)</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-fuchsia-100/70 font-semibold uppercase tracking-wider">Video Engine</label>
                <select
                  value={videoEngine}
                  onChange={(e) => setVideoEngine(e.target.value)}
                  className="bg-[#121118]/80 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-fuchsia-500/50 text-white shadow-inner"
                >
                  <option value="wan">Wan 2.2 (Cinematic Pro)</option>
                  <option value="ltx">LTX Video (Fast Draft)</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleCreateStory}
              disabled={isLoading || !title}
              className="mt-6 w-full py-4 bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 disabled:opacity-50 disabled:pointer-events-none rounded-2xl text-sm font-bold tracking-wide text-white shadow-lg shadow-fuchsia-900/30 transition-all flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99]"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Next: Select Cast</span>}
            </button>
          </div>
        )}

        {/* STEP 2: CAST SELECTION */}
        {step === 2 && (
          <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-right-8 duration-500">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-2">Who is starring in this story?</h2>
              <p className="text-sm text-zinc-400">Select your primary character to maintain absolute consistency across all scenes.</p>
            </div>

            {isLoadingCast ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-fuchsia-500 animate-spin" />
              </div>
            ) : libraryCharacters.length === 0 ? (
              <div className="text-center py-10 bg-[#121118]/80 rounded-2xl border border-white/10">
                <Users className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-white mb-2">No Characters in Library</h3>
                <p className="text-sm text-zinc-400 mb-6">Create a character in the library first to use them in stories.</p>
                <Link href="/characters/new" className="text-fuchsia-400 hover:text-fuchsia-300 font-bold text-sm">
                  Go to Character Creator
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {libraryCharacters.map(char => {
                  const isSelected = selectedCastIds.includes(char.id);
                  const isTraining = ['generating_dataset', 'training'].includes(char.loraStatus || '');
                  
                  return (
                    <div 
                      key={char.id}
                      onClick={() => {
                        if (isTraining) return; // Prevent selection
                        // For MVP, we only allow 1 primary character
                        if (isSelected) {
                          setSelectedCastIds([]);
                        } else {
                          setSelectedCastIds([char.id]);
                        }
                      }}
                      className={`relative rounded-2xl overflow-hidden border-2 transition-all duration-300 aspect-[3/4] group ${
                        isTraining ? 'opacity-50 cursor-not-allowed border-white/5' : 
                        isSelected ? 'border-fuchsia-500 shadow-[0_0_20px_rgba(217,70,239,0.3)] scale-[1.02] cursor-pointer' : 
                        'border-white/10 hover:border-white/30 cursor-pointer'
                      }`}
                    >
                      {char.imageUrl ? (
                        <img src={char.imageUrl} alt={char.name} className={`w-full h-full object-cover ${isTraining ? 'grayscale' : ''}`} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-700">
                          <Loader2 className="w-6 h-6 animate-spin" />
                        </div>
                      )}
                      
                      {isTraining && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                          <Loader2 className="w-6 h-6 text-amber-400 animate-spin mb-2" />
                          <span className="text-amber-400 font-bold text-[10px] uppercase text-center px-2">
                            Model<br/>Training...
                          </span>
                        </div>
                      )}

                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-4">
                        <h3 className="text-white font-bold text-sm leading-tight">{char.name}</h3>
                      </div>

                      {isSelected && (
                        <div className="absolute top-3 right-3 bg-fuchsia-500 text-white rounded-full p-1 shadow-lg">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex gap-4 mt-6">
              <button
                onClick={() => setStep(1)}
                className="w-1/3 py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-sm font-bold tracking-wide text-white transition-all"
              >
                Back
              </button>
              <button
                onClick={handleGenerateBoard}
                disabled={isLoading}
                className="w-2/3 py-4 bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 disabled:opacity-50 disabled:pointer-events-none rounded-2xl text-sm font-bold tracking-wide text-white shadow-lg shadow-fuchsia-900/30 transition-all flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99]"
              >
                {isLoading ? (
                  <>
                     <Loader2 className="w-5 h-5 animate-spin" />
                     <span>Generating Storyboard...</span>
                  </>
                ) : (
                  <>
                     <Sparkles className="w-5 h-5" />
                     <span>Generate AI Storyboard</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
