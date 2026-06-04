"use client";

import { useEffect, useState } from "react";
import { Loader2, Zap, CheckCircle2, Video } from "lucide-react";

interface Activity {
  id: string;
  type: string;
  status: string;
  message: string;
  characterName?: string;
}

export function GlobalActivityBar() {
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const res = await fetch(`${process.env.NODE_ENV === 'production' ? 'https://esudvxmq41.execute-api.ap-south-1.amazonaws.com' : 'http://localhost:8000'}/api/v1/activity`);
        if (res.ok) {
          const data = await res.json();
          setActivities(data.activities || []);
        }
      } catch (err) {
        // Silent fail for polling
      }
    };

    fetchActivity();
    const interval = setInterval(fetchActivity, 5000);
    return () => clearInterval(interval);
  }, []);

  if (activities.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {activities.map((activity) => (
        <div 
          key={activity.id}
          className="bg-[#0b0a0f]/90 border border-white/10 rounded-xl p-4 backdrop-blur-md shadow-2xl flex items-start gap-3 w-80 animate-in slide-in-from-right fade-in"
        >
          <div className="mt-0.5">
            {activity.status === 'completed' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : activity.type === 'story_rendering' ? (
              <Video className="w-5 h-5 text-fuchsia-400 animate-pulse" />
            ) : (
              <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-white truncate">
              {activity.type === 'lora_training' && 'AI Model Training'}
              {activity.type === 'lora_complete' && 'Training Complete'}
              {activity.type === 'story_rendering' && 'Studio Rendering'}
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-snug">
              {activity.message}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
