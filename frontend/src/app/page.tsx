"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Sparkles, 
  Play, 
  Download, 
  Film, 
  Layers, 
  Loader2, 
  CheckCircle2, 
  AlertTriangle, 
  Terminal, 
  ArrowRight, 
  Clock,
  Volume2,
  Video,
  UserCheck
} from "lucide-react";

interface Scene {
  id: string;
  index: number;
  prompt: string;
  duration: number;
  status: 'pending' | 'generating_image' | 'generating_motion' | 'completed' | 'failed';
  imageUrl?: string | null;
  videoUrl?: string | null;
}

interface JobState {
  job_id: string;
  project_id: string;
  status: 'queued' | 'analyzing' | 'awaiting_approval' | 'processing_scenes' | 'stitching' | 'completed' | 'failed';
  overall_progress: number;
  scenes: Scene[];
  video?: {
    videoUrl: string;
    thumbnailUrl: string;
    duration: number;
    fileSizeStr: string;
  } | null;
  error_message?: string | null;
}

const TEMPLATE_PROMPTS = [
  "A futuristic samurai walking through neon Tokyo in the rain, cinematic, dramatic lighting, 8k",
  "An astronaut riding a horse on Mars, red dust storm swirling, solar panels glowing, photo-realistic",
  "Cyberpunk detective looking over a dark rainy city ledge, neon reflections in eyes, noir style",
  "Epic slow-motion shot of a phoenix rising from volcanic ash, feathers of molten gold, cinematic sound"
];

export default function Home() {
  const [prompt, setPrompt] = useState(TEMPLATE_PROMPTS[0]);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [duration, setDuration] = useState(15);
  const [videoEngine, setVideoEngine] = useState("wan");
  const [includeAudio, setIncludeAudio] = useState(false);
  const [audioPrompt, setAudioPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedPreview, setSelectedPreview] = useState<{ url: string; title: string } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Clean up SSE connection on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const [isDownloading, setIsDownloading] = useState(false);
  const handleDownload = async (url: string, filename: string) => {
    setIsDownloading(true);
    addLog(`Fetching media bytes for secure local download: ${filename}...`);
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      addLog("Media file successfully downloaded.");
    } catch (err: any) {
      addLog("CORS restricted direct download. Redirecting to media page in new window...");
      window.open(url, '_blank');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleApprove = async () => {
    if (!job) return;
    try {
      const response = await fetch(`http://localhost:8000/api/v1/jobs/${job.job_id}/approve`, {
        method: "POST"
      });
      if (!response.ok) throw new Error("Failed to approve job");
      addLog("Scenes approved. Triggering GPU rendering phase...");
    } catch (err: any) {
      addLog(`Error approving job: ${err.message}`);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);
    setJob(null);
    setSelectedPreview(null);
    setLogs([]);
    addLog("Initializing generation pipeline...");

    try {
      const payload: any = { prompt, aspect_ratio: aspectRatio, duration_target: duration, video_engine: videoEngine };
      if (includeAudio) {
        payload.include_audio = true;
        payload.audio_prompt = audioPrompt.trim() ? audioPrompt.trim() : prompt;
      }

      const response = await fetch("http://localhost:8000/api/v1/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }

      const data = await response.json();
      addLog(`Job accepted. ID: ${data.job_id}`);
      
      // Initialize state
      setJob({
        job_id: data.job_id,
        project_id: data.project_id,
        status: "queued",
        overall_progress: 0,
        scenes: []
      });

      // Connect to EventSource (SSE)
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource(`http://localhost:8000/api/v1/jobs/${data.job_id}/stream`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        const update = JSON.parse(event.data);
        setJob(update);
        addLog(`Pipeline stage: ${update.status.toUpperCase()} (${update.overall_progress}%)`);

        // Auto-select first completed scene if nothing selected yet
        const completedScenes = update.scenes.filter((s: Scene) => s.status === 'completed' && s.videoUrl);
        if (completedScenes.length > 0 && !selectedPreview && update.status !== "completed") {
          const firstScene = completedScenes[0];
          setSelectedPreview({
            url: firstScene.videoUrl!,
            title: `Scene ${firstScene.index} Preview`
          });
        }

        if (update.status === "completed") {
          addLog("Cinematic rendering complete! Video compiled successfully.");
          setIsLoading(false);
          if (update.video) {
            setSelectedPreview({
              url: update.video.videoUrl,
              title: "Full Stitched Video"
            });
          }
          es.close();
        } else if (update.status === "failed") {
          addLog(`Pipeline failed: ${update.error_message}`);
          setIsLoading(false);
          es.close();
        }
      };

      es.onerror = () => {
        addLog("SSE Connection disconnected. Retrying...");
      };

    } catch (error: any) {
      addLog(`Error: ${error.message}`);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030303] text-[#f5f5f7] font-sans antialiased relative overflow-hidden flex flex-col">
      {/* Background Mesh Gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-violet-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-900/10 blur-[120px] pointer-events-none" />

      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-20" />

      {/* Header bar */}
      <header className="w-full py-5 px-8 flex justify-between items-center border-b border-white/5 bg-[#0b0a0f]/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-tr from-violet-600 to-cyan-500 rounded-lg shadow-lg shadow-violet-500/20">
            <Film className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-[#f5f5f7] to-zinc-400 bg-clip-text text-transparent">
              NovaScene
            </h1>
            <p className="text-[10px] text-zinc-500 tracking-wider uppercase font-semibold">Cinematic AI Orchestrator</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-xs text-emerald-400/90 font-mono tracking-tight bg-emerald-500/5 px-2.5 py-1 rounded-full border border-emerald-500/10">
            Core API Connected
          </span>
        </div>
      </header>

      {/* Main Workstation */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 z-10">
        
        {/* Left Side: Controller Console */}
        <section className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-[#0b0a0f]/80 border border-white/10 rounded-2xl p-6 backdrop-blur-lg flex flex-col gap-5 shadow-2xl relative">
            <div className="flex items-center gap-2 text-violet-400 text-sm font-semibold">
              <Sparkles className="w-4 h-4" />
              <span>Prompt Station</span>
            </div>

            <form onSubmit={handleGenerate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-400 font-medium">Natural Language Prompt</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe your cinematic masterpiece..."
                  rows={4}
                  className="w-full bg-[#121118]/80 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500/50 transition-colors placeholder-zinc-600 resize-none text-[#f5f5f7]"
                />
              </div>

              {/* Template Prompts */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-zinc-500 tracking-wider uppercase font-semibold">Prompt Presets</span>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATE_PROMPTS.map((t, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setPrompt(t)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-all text-left truncate max-w-full ${
                        prompt === t 
                          ? "bg-violet-900/20 border-violet-500/40 text-violet-200" 
                          : "bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10"
                      }`}
                    >
                      Preset {idx + 1}
                    </button>
                  ))}
                </div>
              </div>

              {/* Parameters */}
              <div className="grid grid-cols-3 gap-4 pt-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400 font-medium">Aspect Ratio</label>
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    className="bg-[#121118]/80 border border-white/10 rounded-lg px-3 py-2 text-xs text-[#f5f5f7] focus:outline-none focus:border-violet-500/50"
                  >
                    <option value="16:9">16:9 Cinematic</option>
                    <option value="9:16">9:16 Portrait</option>
                    <option value="1:1">1:1 Square</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400 font-medium">Target Duration</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="bg-[#121118]/80 border border-white/10 rounded-lg px-3 py-2 text-xs text-[#f5f5f7] focus:outline-none focus:border-violet-500/50"
                  >
                    <option value={15}>15 Seconds</option>
                    <option value={30}>30 Seconds</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400 font-medium">Video Engine</label>
                  <select
                    value={videoEngine}
                    onChange={(e) => setVideoEngine(e.target.value)}
                    className="bg-[#121118]/80 border border-white/10 rounded-lg px-3 py-2 text-xs text-[#f5f5f7] focus:outline-none focus:border-violet-500/50"
                  >
                    <option value="wan">Wan 2.1 (Cinematic, Slow)</option>
                    <option value="ltx">LTX-Video (Fast)</option>
                  </select>
                </div>
              </div>

              {/* Audio Settings */}
              <div className="flex flex-col gap-3 pt-2 pb-1 border-t border-white/5 mt-1">
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={includeAudio} onChange={() => setIncludeAudio(!includeAudio)} />
                    <div className="w-9 h-5 bg-[#121118]/80 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600 peer-checked:after:bg-white border border-white/10"></div>
                    <span className="ml-3 text-xs text-zinc-400 font-medium flex items-center gap-1.5"><Volume2 className="w-3.5 h-3.5 text-violet-400" /> Generate SFX / Background Audio</span>
                  </label>
                </div>

                {includeAudio && (
                  <div className="flex flex-col gap-1.5 transition-all">
                    <label className="text-xs text-zinc-400 font-medium">Audio Prompt (Optional)</label>
                    <input
                      type="text"
                      value={audioPrompt}
                      onChange={(e) => setAudioPrompt(e.target.value)}
                      placeholder="e.g. cinematic bass drop, gentle waves crashing..."
                      className="w-full bg-[#121118]/80 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-violet-500/50 transition-colors placeholder-zinc-600 text-[#f5f5f7]"
                    />
                    <p className="text-[10px] text-zinc-500 leading-tight">If left blank, the video prompt will be used for audio generation.</p>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading || !prompt.trim()}
                className="w-full mt-2 py-3 bg-gradient-to-r from-violet-600 via-indigo-600 to-violet-700 hover:from-violet-500 hover:to-violet-600 disabled:opacity-40 disabled:pointer-events-none rounded-xl text-sm font-semibold tracking-wide text-white shadow-lg shadow-violet-600/30 transition-all flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99]"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Rendering...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generate Cinematic Video</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Logs and Terminal Panel */}
          <div className="bg-[#0b0a0f]/60 border border-white/5 rounded-2xl p-5 backdrop-blur-lg flex-1 flex flex-col gap-3 min-h-[220px]">
            <div className="flex items-center gap-2 text-xs text-zinc-500 font-semibold tracking-wider uppercase">
              <Terminal className="w-3.5 h-3.5" />
              <span>Orchestrator Logs</span>
            </div>
            
            <div className="flex-1 bg-black/40 rounded-xl p-4 font-mono text-[11px] leading-relaxed text-zinc-400 overflow-y-auto max-h-[220px] flex flex-col gap-1 border border-white/5">
              {logs.length === 0 ? (
                <span className="text-zinc-600 italic">Ready to trace pipeline operations...</span>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="whitespace-pre-wrap break-all">
                    {log}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </section>

        {/* Right Side: Render Monitor / Playback */}
        <section className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Main Output Monitor */}
          <div className="bg-[#0b0a0f]/80 border border-white/10 rounded-2xl p-6 backdrop-blur-lg flex flex-col gap-5 flex-1 shadow-2xl relative min-h-[380px] justify-center">
            
            {/* Visual monitor placeholder */}
            {!job ? (
              <div className="flex flex-col items-center justify-center text-center gap-4 py-12">
                <div className="w-16 h-16 rounded-full bg-violet-600/5 border border-violet-500/25 flex items-center justify-center text-violet-400 shadow-xl shadow-violet-500/5 animate-pulse">
                  <Video className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-md font-semibold text-zinc-200">Director Workspace</h3>
                  <p className="text-xs text-zinc-500 mt-1 max-w-[280px]">Submit a prompt on the left to initiate the distributed rendering workflow.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5 h-full justify-between">
                
                {/* Header state */}
                <div className="flex justify-between items-center bg-white/5 p-3.5 rounded-xl border border-white/5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-zinc-400 font-semibold uppercase tracking-wider">Job Progress</span>
                    <span className="text-[10px] text-zinc-600 font-mono">{job.job_id}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {job.status === 'completed' ? (
                      <span className="text-emerald-400 bg-emerald-500/5 border border-emerald-500/10 px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Complete
                      </span>
                    ) : job.status === 'failed' ? (
                      <span className="text-rose-400 bg-rose-500/5 border border-rose-500/10 px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Failed
                      </span>
                    ) : job.status === 'awaiting_approval' ? (
                      <span className="text-amber-400 bg-amber-500/5 border border-amber-500/10 px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5">
                        <UserCheck className="w-3.5 h-3.5" />
                        Awaiting Approval
                      </span>
                    ) : (
                      <span className="text-violet-400 bg-violet-500/5 border border-violet-500/10 px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {job.status.toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Main Video View Box */}
                <div className="flex-1 bg-black/60 rounded-xl border border-white/5 overflow-hidden relative min-h-[220px] flex flex-col justify-between">
                  {job.status === 'awaiting_approval' ? (
                    <div className="flex-1 flex flex-col p-6 overflow-y-auto max-h-[500px]">
                      <div className="flex items-center gap-2 mb-4 text-amber-400">
                        <Sparkles className="w-5 h-5" />
                        <h3 className="font-bold tracking-wide">Director's Cut: Review Scenes</h3>
                      </div>
                      <p className="text-xs text-zinc-400 mb-6">The Director has drafted the following sequence. Approve to begin rendering.</p>
                      
                      <div className="flex flex-col gap-4 mb-6">
                        {job.scenes.map((scene) => (
                          <div key={scene.id} className="bg-[#121118]/80 border border-white/10 rounded-xl p-4 shadow-lg border-l-2 border-l-amber-500/50">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-bold text-violet-400 tracking-wider">SCENE {scene.index + 1}</span>
                              <span className="text-[10px] text-zinc-500 font-mono bg-black/40 px-2 py-0.5 rounded border border-white/5">{scene.duration}s</span>
                            </div>
                            <p className="text-sm text-zinc-300 leading-relaxed font-mono">{scene.prompt}</p>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={handleApprove}
                        className="w-full mt-auto py-3 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 rounded-xl text-sm font-semibold tracking-wide text-white shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99]"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Approve & Generate Video</span>
                      </button>
                    </div>
                  ) : selectedPreview ? (
                    <div className="w-full h-full relative flex-1 min-h-[200px]">
                      <video 
                        key={selectedPreview.url}
                        src={selectedPreview.url} 
                        controls
                        autoPlay
                        muted
                        playsInline
                        loop
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-4 left-4 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-[10px] text-violet-300 font-bold tracking-wide uppercase flex items-center gap-1.5">
                        <Play className="w-3 h-3 fill-violet-400 text-violet-400" />
                        <span>{selectedPreview.title}</span>
                      </div>
                      <div className="absolute bottom-4 right-4 flex gap-2">
                        <button 
                          onClick={() => handleDownload(selectedPreview.url, `${selectedPreview.title.replace(/\s+/g, '_')}.mp4`)}
                          disabled={isDownloading}
                          className="p-2 bg-black/60 backdrop-blur-md border border-white/10 hover:bg-black/90 rounded-lg text-white transition-colors disabled:opacity-50"
                          title="Download MP4"
                        >
                          {isDownloading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6 min-h-[200px]">
                      <div className="relative flex items-center justify-center">
                        <div className="w-12 h-12 rounded-full border border-violet-500/20 flex items-center justify-center text-violet-500 bg-violet-500/5">
                          <Layers className="w-6 h-6 animate-pulse" />
                        </div>
                        <svg className="absolute w-[60px] h-[60px]">
                          <circle 
                            cx="30" cy="30" r="28" 
                            stroke="rgba(139, 92, 246, 0.2)" 
                            strokeWidth="2" 
                            fill="transparent" 
                          />
                          <circle 
                            cx="30" cy="30" r="28" 
                            stroke="rgba(139, 92, 246, 1)" 
                            strokeWidth="2" 
                            fill="transparent" 
                            strokeDasharray="175"
                            strokeDashoffset={175 - (175 * job.overall_progress) / 100}
                            className="transition-all duration-300"
                          />
                        </svg>
                      </div>
                      <span className="text-sm font-semibold tracking-wide text-zinc-300 mt-2">{job.overall_progress}% rendered</span>
                      <span className="text-[11px] text-zinc-500 max-w-[240px] italic">"Pipeline orchestrating parallel generative AI models"</span>
                    </div>
                  )}

                  {/* Active Preview Monitor Navigation Bar */}
                  {job && (job.video || job.scenes.some(s => s.status === 'completed')) && (
                    <div className="w-full bg-[#121118]/80 border-t border-white/5 px-4 py-2 flex items-center gap-2 overflow-x-auto">
                      <span className="text-[9px] text-zinc-500 tracking-wider uppercase font-semibold mr-1">Preview Channels:</span>
                      {job.video && (
                        <button
                          onClick={() => setSelectedPreview({ url: job.video!.videoUrl, title: "Full Stitched Video" })}
                          className={`text-[10px] px-2.5 py-1 rounded-md border font-semibold transition-all ${
                            selectedPreview?.url === job.video.videoUrl
                              ? "bg-violet-600/20 border-violet-500/50 text-violet-300"
                              : "bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10"
                          }`}
                        >
                          Full Stitched
                        </button>
                      )}
                      {job.scenes.filter(s => s.status === 'completed' && s.videoUrl).map(scene => (
                        <button
                          key={scene.id}
                          onClick={() => setSelectedPreview({ url: scene.videoUrl!, title: `Scene ${scene.index} Preview` })}
                          className={`text-[10px] px-2.5 py-1 rounded-md border font-semibold transition-all ${
                            selectedPreview?.url === scene.videoUrl
                              ? "bg-violet-600/20 border-violet-500/50 text-violet-300"
                              : "bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10"
                          }`}
                        >
                          Scene {scene.index}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Progress bar */}
                <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/5">
                  <div 
                    className="bg-gradient-to-r from-violet-600 to-cyan-500 h-full transition-all duration-500" 
                    style={{ width: `${job.overall_progress}%` }}
                  />
                </div>

                {/* Scene Timeline */}
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] text-zinc-500 tracking-wider uppercase font-semibold">Scene Pipeline Map</span>
                  <div className="grid grid-cols-3 gap-3">
                    {job.scenes.map((scene) => {
                      const isComplete = scene.status === 'completed' && scene.videoUrl;
                      return (
                        <div 
                          key={scene.id} 
                          onClick={() => {
                            if (isComplete) {
                              setSelectedPreview({ url: scene.videoUrl!, title: `Scene ${scene.index} Preview` });
                            }
                          }}
                          className={`p-3 rounded-xl border flex flex-col gap-1.5 transition-all select-none ${
                            isComplete
                              ? "bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-500/10 cursor-pointer"
                              : scene.status === 'failed'
                              ? "bg-rose-500/5 border-rose-500/20 cursor-default"
                              : scene.status !== 'pending'
                              ? "bg-violet-500/5 border-violet-500/35 shadow-lg shadow-violet-500/5 cursor-default"
                              : "bg-[#121118]/40 border-white/5 cursor-default"
                          }`}
                          title={isComplete ? "Click to play scene preview" : undefined}
                        >
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-semibold text-zinc-400">Scene {scene.index}</span>
                            <span className="text-[9px] text-zinc-500 font-mono font-semibold">{scene.duration}s</span>
                          </div>
                          <div className="text-[10px] text-zinc-400 line-clamp-1 truncate font-medium">{scene.prompt}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {scene.status === 'completed' ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            ) : scene.status === 'pending' ? (
                              <Clock className="w-3 h-3 text-zinc-600" />
                            ) : (
                              <Loader2 className="w-3 h-3 text-violet-500 animate-spin" />
                            )}
                            <span className={`text-[9px] font-semibold ${
                              scene.status === 'completed' 
                                ? "text-emerald-400" 
                                : scene.status === 'pending' 
                                ? "text-zinc-500" 
                                : "text-violet-400"
                            }`}>
                              {scene.status.replace('_', ' ')}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            )}
            
          </div>
        </section>

      </main>

      {/* Footer bar */}
      <footer className="w-full py-4 text-center text-xs text-zinc-600 border-t border-white/5 bg-[#0b0a0f]/20 mt-auto">
        <span>© 2026 NovaScene. Powered by distributed Cloud GPUs.</span>
      </footer>
    </div>
  );
}
