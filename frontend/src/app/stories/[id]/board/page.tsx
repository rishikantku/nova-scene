"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Film, Play, Loader2, Sparkles, CheckCircle2, Clock, Trash2, AlertTriangle } from "lucide-react";
import Link from "next/link";

interface Scene {
  id: string;
  index: number;
  prompt: string;
  duration: number;
  status: string;
  imageUrl?: string;
  videoUrl?: string;
}

interface Story {
  id: string;
  title: string;
  status: string;
  scenes: Scene[];
  finalVideoUrl?: string;
  includeAudio?: boolean;
  audioPrompt?: string;
}

export default function StoryBoard({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const [story, setStory] = useState<Story | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  // Poll for story status
  useEffect(() => {
    let interval: NodeJS.Timeout;
    const fetchStory = async () => {
      try {
        const res = await fetch(`${process.env.NODE_ENV === 'production' ? 'https://esudvxmq41.execute-api.ap-south-1.amazonaws.com' : 'http://localhost:8000'}/api/v1/stories/${id}`);
        if (res.ok) {
          const data = await res.json();
          setStory(data);
          
          if (data.status === 'board_ready' || data.status === 'completed' || data.status === 'failed') {
             // Stop fast polling if we reached a terminal state for the board
             if (data.status !== 'generating_video') {
               clearInterval(interval);
             }
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchStory();
    interval = setInterval(fetchStory, 2000);
    return () => clearInterval(interval);
  }, [id]);

  const handleRender = async () => {
    setIsRendering(true);
    try {
      if (!story) return;
      await fetch(`${process.env.NODE_ENV === 'production' ? 'https://esudvxmq41.execute-api.ap-south-1.amazonaws.com' : 'http://localhost:8000'}/api/v1/stories/${id}/render`, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes: story.scenes, audioPrompt: story.audioPrompt })
      });
      
      // The initial polling interval was cleared because the status was 'board_ready'.
      // We must manually poll here until it completes.
      const renderInterval = setInterval(async () => {
        const res = await fetch(`${process.env.NODE_ENV === 'production' ? 'https://esudvxmq41.execute-api.ap-south-1.amazonaws.com' : 'http://localhost:8000'}/api/v1/stories/${id}`);
        if (res.ok) {
          const data = await res.json();
          setStory(data);
          if (data.status === 'completed' || data.status === 'failed') {
            clearInterval(renderInterval);
            setIsRendering(false);
          }
        }
      }, 2000);

    } catch (err) {
      console.error("Failed to start render", err);
      setIsRendering(false);
    }
  };

  const handleDeleteScene = async (sceneId: string) => {
    if (!confirm("Are you sure you want to delete this scene?")) return;
    
    try {
      const res = await fetch(`${process.env.NODE_ENV === 'production' ? 'https://esudvxmq41.execute-api.ap-south-1.amazonaws.com' : 'http://localhost:8000'}/api/v1/stories/${id}/scenes/${sceneId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const data = await res.json();
        setStory({ ...story!, scenes: data.scenes });
      } else {
        alert("Failed to delete scene.");
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting scene.");
    }
  };

  if (!story) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 text-fuchsia-500 animate-spin" />
      </div>
    );
  }

  // Polling states
  if (story.status === 'generating_board') {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-6 text-center">
        <div className="relative w-24 h-24 flex items-center justify-center">
          <div className="absolute inset-0 border-4 border-fuchsia-500/30 rounded-full animate-ping duration-1000"></div>
          <Loader2 className="w-10 h-10 text-fuchsia-500 animate-spin relative z-10" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Director is plotting scenes...</h2>
          <p className="text-zinc-400 max-w-md">The LLM is currently breaking your prompt down into individual shots and injecting your canonical characters.</p>
        </div>
      </div>
    );
  }

  if (story.status === 'generating_video') {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-6 text-center">
         <div className="relative w-32 h-32 flex items-center justify-center bg-violet-900/30 rounded-full border border-violet-500/30 shadow-[0_0_50px_rgba(139,92,246,0.2)]">
           <Film className="w-12 h-12 text-violet-400 animate-pulse" />
           <div className="absolute -bottom-2 -right-2 bg-fuchsia-500 text-white p-2 rounded-full shadow-lg">
             <Loader2 className="w-4 h-4 animate-spin" />
           </div>
         </div>
         <div>
           <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 to-violet-400 mb-2">Rendering Masterpiece</h2>
           <p className="text-zinc-400 max-w-md mx-auto leading-relaxed">
             The GPU farm is now rendering your scenes. Depending on the duration, this may take a few minutes. 
           </p>
         </div>
         
         <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-3xl">
           {story.scenes.map(s => (
              <div key={s.id} className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col items-center justify-center gap-2 group relative">
                 <div className="text-xs font-bold text-zinc-500">Scene {s.index + 1}</div>
                 {s.status === 'completed' ? (
                   <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                 ) : (s.status === 'generating_motion' || s.status === 'generating_image') ? (
                   <div className="w-5 h-5 rounded-full border-2 border-violet-500 border-t-transparent animate-spin"></div>
                 ) : (
                   <Clock className="w-5 h-5 text-zinc-600" />
                 )}
                 <button
                    onClick={() => handleDeleteScene(s.id)}
                    className="absolute top-2 right-2 p-1 rounded-md text-zinc-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete Scene"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
              </div>
           ))}
         </div>
      </div>
    );
  }

  if (story.status === 'completed') {
    return (
      <div className="min-h-full flex flex-col p-8 lg:p-12 max-w-5xl mx-auto w-full relative z-10">
        <header className="mb-10 text-center">
          <div className="inline-block mb-4 px-4 py-1.5 bg-emerald-500/20 border border-emerald-500/30 rounded-full">
            <span className="text-emerald-400 text-xs font-bold tracking-widest uppercase flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> Render Complete
            </span>
          </div>
          <h1 className="text-4xl font-extrabold text-white mb-2">{story.title}</h1>
        </header>

        <div className="w-full aspect-video bg-black rounded-3xl border-2 border-white/10 shadow-[0_0_80px_rgba(217,70,239,0.15)] overflow-hidden mb-12 relative group">
           <video src={story.finalVideoUrl} controls className="w-full h-full object-cover" autoPlay />
        </div>
        
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Individual Scenes</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
          {story.scenes.map((scene, i) => (
            <div key={scene.id} className="bg-[#121118]/80 border border-white/10 rounded-3xl overflow-hidden shadow-xl group">
              <div className="aspect-[16/9] bg-zinc-900 relative">
                {scene.videoUrl ? (
                  <video 
                    src={scene.videoUrl} 
                    className="w-full h-full object-cover"
                    controls 
                  />
                ) : scene.imageUrl ? (
                  <img src={scene.imageUrl} alt="Scene Reference" className="w-full h-full object-cover opacity-80" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700">
                    <Film className="w-8 h-8 mb-2 opacity-50" />
                  </div>
                )}
                {!scene.videoUrl && (
                  <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur text-white text-[10px] font-bold px-2 py-1 rounded-md border border-white/10">
                    {scene.duration}s
                  </div>
                )}
              </div>
              
              <div className="p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-violet-400">Scene {i + 1}</span>
                </div>
                <textarea 
                  readOnly
                  value={scene.prompt}
                  className="w-full bg-black/30 border border-white/5 rounded-xl px-4 py-3 text-xs text-zinc-300 leading-relaxed resize-none focus:outline-none"
                  rows={3}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-center">
          <Link href="/stories" className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-white font-bold transition-colors">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Default: Board Ready (Review Mode)
  return (
    <div className="min-h-full flex flex-col p-8 lg:p-12 max-w-6xl mx-auto w-full relative z-10">
      
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="inline-block mb-3 px-3 py-1 bg-violet-500/20 border border-violet-500/30 rounded-full">
            <span className="text-violet-300 text-[10px] font-bold tracking-widest uppercase">Director's Review</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">{story.title}</h1>
          <p className="text-sm text-zinc-400">
            {isRendering || story.status === 'generating_video' 
              ? 'The final scenes are being generated and stitched. Please wait...' 
              : 'Review your generated scenes and canonical character injections before rendering the final video.'}
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleRender}
            disabled={isRendering || story.status === 'generating_video'}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 text-white px-8 py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-3 transition-all shadow-lg shadow-emerald-900/30 hover:shadow-emerald-900/50 hover:scale-105 active:scale-95"
          >
            {isRendering || story.status === 'generating_video' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-white" />}
            {isRendering || story.status === 'generating_video' ? 'Rendering Masterpiece...' : 'Render Masterpiece'}
          </button>
        </div>
      </header>

      {story.status === 'failed' && (
        <div className="mb-8 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start gap-3">
           <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
           <div>
             <h3 className="text-red-400 font-bold text-sm">Previous Render Failed</h3>
             <p className="text-red-400/80 text-xs mt-1">The rendering pipeline encountered an error. However, your successfully generated assets are safely stored. Click <b>Render Masterpiece</b> to automatically resume the process from where it left off.</p>
           </div>
        </div>
      )}

      {story.includeAudio && (
        <div className="mb-8 p-6 bg-[#121118]/80 border border-fuchsia-500/20 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-bold text-fuchsia-400 flex items-center gap-2">
              Background Audio Generation
            </label>
            <span className="text-xs text-zinc-500">Will be stitched to the final video</span>
          </div>
          <textarea
            value={story.audioPrompt || ''}
            onChange={(e) => setStory({ ...story, audioPrompt: e.target.value })}
            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-300 focus:outline-none focus:border-fuchsia-500/50 resize-none"
            rows={2}
            placeholder="Describe the audio, sound effects, and background music..."
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {story.scenes.map((scene, i) => (
          <div key={scene.id} className="bg-[#121118]/80 border border-white/10 rounded-3xl overflow-hidden hover:border-violet-500/30 transition-all shadow-xl group">
            <div className="aspect-[16/9] bg-zinc-900 relative">
              {scene.imageUrl ? (
                <>
                  <img src={scene.imageUrl} alt="Scene Reference" className="w-full h-full object-cover opacity-80" />
                  <div className="absolute top-3 left-3 bg-fuchsia-600/90 backdrop-blur text-white text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider flex items-center gap-1 shadow-lg border border-fuchsia-400/50">
                    <Sparkles className="w-3 h-3" /> Character Injected
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 bg-gradient-to-br from-zinc-900 to-black">
                  <Film className="w-8 h-8 mb-2 opacity-50" />
                  <span className="text-xs font-medium uppercase tracking-widest">New Keyframe</span>
                </div>
              )}
              <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur text-white text-[10px] font-bold px-2 py-1 rounded-md border border-white/10">
                {scene.duration}s
              </div>
            </div>
            
            <div className="p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-violet-400">Scene {i + 1}</span>
              </div>
              <textarea 
                value={scene.prompt}
                onChange={(e) => {
                  const newScenes = [...story.scenes];
                  newScenes[i].prompt = e.target.value;
                  setStory({ ...story, scenes: newScenes });
                }}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-xs text-zinc-300 leading-relaxed resize-none focus:outline-none focus:border-violet-500/50 focus:bg-black"
                rows={4}
              />
            </div>
          </div>
        ))}
      </div>
      
    </div>
  );
}
