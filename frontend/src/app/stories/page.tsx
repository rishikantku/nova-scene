"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, Plus, Film, Clock, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Story {
  id: string;
  title: string;
  genre: string;
  visualStyle: string;
  targetDuration: number;
  status: string;
  createdAt: string;
  scenes?: any[];
  finalVideoUrl?: string;
}

export default function StoriesPage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchStories = () => {
      fetch(`${process.env.NODE_ENV === 'production' ? 'https://esudvxmq41.execute-api.ap-south-1.amazonaws.com' : 'http://localhost:8000'}/api/v1/stories?cb=${Date.now()}`, {
        cache: 'no-store'
      })
        .then((res) => res.json())
        .then((data) => {
          setStories(data.stories || []);
          setIsLoading(false);
        })
        .catch((err) => {
          console.error("Failed to load stories:", err);
          setIsLoading(false);
        });
    };

    fetchStories();
    const interval = setInterval(fetchStories, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDeleteStory = async (e: React.MouseEvent, storyId: string) => {
    e.preventDefault();
    if (!confirm("Are you sure you want to delete this story?")) return;
    
    try {
      const res = await fetch(`${process.env.NODE_ENV === 'production' ? 'https://esudvxmq41.execute-api.ap-south-1.amazonaws.com' : 'http://localhost:8000'}/api/v1/stories/${storyId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setStories(stories.filter(s => s.id !== storyId));
      } else {
        alert("Failed to delete story.");
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting story.");
    }
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "completed":
        return <span className="text-emerald-400 flex items-center gap-1 text-xs font-medium"><CheckCircle2 className="w-3 h-3" /> Completed</span>;
      case "failed":
        return <span className="text-red-400 flex items-center gap-1 text-xs font-medium"><AlertTriangle className="w-3 h-3" /> Failed</span>;
      case "draft":
        return <span className="text-zinc-400 flex items-center gap-1 text-xs font-medium">Draft</span>;
      default:
        return (
          <span className="text-fuchsia-400 flex items-center gap-1 text-xs font-medium">
            <Loader2 className="w-3 h-3 animate-spin" /> In Progress
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-8 animate-in fade-in duration-500 relative z-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-8">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">My Stories</h1>
            <p className="text-zinc-400 text-sm">View and manage your generated stories</p>
          </div>
          <Link
            href="/create/story"
            className="px-5 py-2.5 bg-white text-black hover:bg-zinc-200 rounded-xl font-semibold text-sm transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Story
          </Link>
        </div>

        {/* Story List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-fuchsia-500 animate-spin" />
          </div>
        ) : stories.length === 0 ? (
          <div className="text-center py-20 bg-[#121118]/80 rounded-2xl border border-white/10 flex flex-col items-center">
            <Film className="w-12 h-12 text-zinc-600 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">No Stories Yet</h3>
            <p className="text-sm text-zinc-400 mb-6 max-w-sm">
              You haven't generated any stories. Create your first cinematic masterpiece today!
            </p>
            <Link
              href="/create/story"
              className="px-6 py-3 bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 rounded-xl font-bold text-sm shadow-lg shadow-fuchsia-900/20 transition-all text-white"
            >
              Create New Story
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {stories.map((story) => (
              <Link 
                key={story.id} 
                href={`/stories/${story.id}/board`}
                className="group flex flex-col bg-[#121118]/80 border border-white/10 rounded-2xl overflow-hidden hover:border-fuchsia-500/50 transition-all hover:-translate-y-1"
              >
                {/* Thumbnail Area */}
                <div className="aspect-video bg-zinc-900 relative overflow-hidden flex items-center justify-center">
                  {story.finalVideoUrl ? (
                    <video 
                      src={story.finalVideoUrl} 
                      poster={story.scenes?.[0]?.imageUrl || undefined}
                      className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                      muted 
                      loop 
                      onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(()=>{})}
                      onMouseLeave={(e) => (e.target as HTMLVideoElement).pause()}
                    />
                  ) : story.scenes?.[0]?.imageUrl ? (
                    <img 
                      src={story.scenes[0].imageUrl} 
                      alt={story.title} 
                      className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" 
                    />
                  ) : (
                    <Film className="w-10 h-10 text-zinc-700" />
                  )}
                  
                  {/* Status Badge overlays the image */}
                  <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
                    {getStatusDisplay(story.status)}
                  </div>

                  <button 
                    onClick={(e) => handleDeleteStory(e, story.id)}
                    className="absolute top-3 right-3 bg-black/60 backdrop-blur-md p-2 rounded-lg border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 text-white z-20"
                    title="Delete Story"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Content Area */}
                <div className="p-5 flex flex-col flex-1 gap-3">
                  <h3 className="font-bold text-white text-lg line-clamp-2 leading-tight">
                    {story.title}
                  </h3>
                  
                  <div className="flex flex-wrap gap-2 mt-auto">
                    <span className="px-2.5 py-1 bg-white/5 rounded-md text-xs text-zinc-300 border border-white/5">
                      {story.visualStyle}
                    </span>
                    <span className="px-2.5 py-1 bg-white/5 rounded-md text-xs text-zinc-300 border border-white/5">
                      {story.genre}
                    </span>
                    <span className="px-2.5 py-1 bg-white/5 rounded-md text-xs text-zinc-300 border border-white/5 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {story.targetDuration}s
                    </span>
                  </div>
                  
                  <div className="text-xs text-zinc-500 mt-2">
                    {formatDistanceToNow(new Date(story.createdAt), { addSuffix: true })}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
