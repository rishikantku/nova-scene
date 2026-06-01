# NovaScene Frontend Architecture & Design Blueprint

NovaScene's interface is built for modern browser experiences, inspired by Vercel, Linear, and Runway. It features a premium, motion-heavy dark UI, implementing glassmorphism, glowing accents, and dynamic timeline visualization.

---

## 1. Visual Identity & Styling System

We define our core brand assets using **Vanilla CSS Custom Properties** or **Tailwind CSS variables**. The styling leverages a sleek dark palette with electric purple, deep indigo, and neon cyan accents.

### Color Palette (Tailwind Variable Mappings)

| Variable | Value (HEX) | Use Case |
| :--- | :--- | :--- |
| `--background` | `#030303` | Dark space background |
| `--foreground` | `#f5f5f7` | Apple-like crisp text |
| `--card` | `#0b0a0f` | Card backgrounds with subtle gradients |
| `--card-border`| `rgba(255, 255, 255, 0.08)` | Semi-transparent borders (glassmorphism) |
| `--primary` | `#8b5cf6` | Electric Purple for action states |
| `--primary-glow`| `rgba(139, 92, 246, 0.15)` | Dynamic button glow and background light |
| `--secondary` | `#06b6d4` | Neon Blue for status indicators |
| `--accent` | `#d946ef` | Bright Fuchsia for highlights |
| `--muted` | `#6b7280` | Subdued labels and description text |

### Typography
- **Primary Font**: `Inter` (Google Fonts) for readable dashboards, labels, and text.
- **Display Font**: `Outfit` or `Cabinet Grotesk` for titles, pricing, and main branding headers.

### Core Animation Library (Framer Motion / Tailwind)
- **Pulse Glow**: Used on rendering scenes to show processing activity.
- **Stitch Transition**: Smooth opacity-scale fades during scene previews.
- **Slider Progress**: Custom timeline progress bar using hardware-accelerated transitions.

---

## 2. Page Directory Layout

A Next.js 15 App Router structure is recommended:

```text
src/
├── app/
│   ├── layout.tsx                # Dynamic shell, auth provider, global context
│   ├── page.tsx                  # Cinematic Landing Page
│   ├── dashboard/
│   │   └── page.tsx              # Overview, activity, quota balance
│   ├── generate/
│   │   └── page.tsx              # Core AI prompt workstation & timeline
│   ├── history/
│   │   └── page.tsx              # Gallery of rendered videos
│   ├── billing/
│   │   └── page.tsx              # Tier subscription & balance top-ups
│   └── settings/
│       └── page.tsx              # Account, API integration hooks
├── components/
│   ├── ui/                       # Shadcn basic primitives (dialog, button, slider)
│   ├── workspace/
│   │   ├── Timeline.tsx          # Multi-scene editor and playhead
│   │   ├── PromptInput.tsx       # Prompt submission panel with suggestions
│   │   ├── SceneCard.tsx         # Preview card for individual scene states
│   │   └── VideoPreview.tsx      # Video player with H264 source stream
│   └── navigation/
│       └── Sidebar.tsx           # Collapsible glass-panel navbar
└── context/
    └── GenerationContext.tsx     # SSE state manager for real-time orchestration
```

---

## 3. Core Page Specifications

### Landing Page (`app/page.tsx`)
- **Visuals**: Full-screen ambient video loop in background, overlaid with subtle radial dark gradient. Hero title utilizing the custom display font: `"Cinematic AI Video Generation From A Single Prompt"`.
- **CTA**: High-contrast glassmorphic action button: `"Create Scene"`.
- **Feature Showcase**: Interactive interactive slider showcasing a prompt on the left (e.g. *"A futuristic samurai in neon Tokyo..."*) and playing a preview video on the right.

### Generation Workstation (`app/generate/page.tsx`)
- **Split Layout**:
  - **Left Panel (2/5 width)**: Single prompt text area, style preset selection (Anime, Cinematic, photorealistic), duration selector, and generating CTA button.
  - **Right Panel (3/5 width)**: Interactive workspace. Shows the generation status divided into two horizontal bands:
    1. **Primary Video Screen**: Custom HTML5 video component showing either the rendering progress state (percentage circle, SSE logs) or the stitched MP4.
    2. **Timeline View**: Visual representation of generated scenes (`[ Scene 1 | Scene 2 | Scene 3 ]`), each card displaying its prompt segment, Flux thumbnail, Wan rendering status (Pending, Rendering, Done), and duration indicator.

### Gallery History (`app/history/page.tsx`)
- **Masonry Grid**: Display of completed projects.
- **Card Features**: Hovering over a card starts a loop preview of the video. Quick download buttons, share links, and copy prompt shortcuts.

---

## 4. Real-Time SSE/WebSocket State Manager

To avoid polling, the client opens a Server-Sent Events (SSE) channel linked to the backend orchestrator job token:

```typescript
// context/GenerationContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';

interface SceneState {
  id: string;
  index: number;
  prompt: string;
  status: 'pending' | 'generating_image' | 'generating_motion' | 'completed' | 'failed';
  imageUrl?: string;
  videoUrl?: string;
  progress: number;
}

interface JobState {
  jobId: string;
  status: 'queued' | 'analyzing' | 'processing_scenes' | 'stitching' | 'completed' | 'failed';
  scenes: SceneState[];
  outputUrl?: string;
  progress: number;
}

export const GenerationContext = createContext<{
  activeJob: JobState | null;
  startGeneration: (prompt: string) => Promise<void>;
}>({ activeJob: null, startGeneration: async () => {} });

export const GenerationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeJob, setActiveJob] = useState<JobState | null>(null);

  const startGeneration = async (prompt: string) => {
    // 1. Post generation job to API
    const response = await fetch('/api/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await response.json();
    
    // 2. Open SSE stream
    const eventSource = new EventSource(`/api/v1/jobs/${data.id}/stream`);
    
    eventSource.onmessage = (event) => {
      const update: JobState = JSON.parse(event.data);
      setActiveJob(update);
      
      if (update.status === 'completed' || update.status === 'failed') {
        eventSource.close();
      }
    };
  };

  return (
    <GenerationContext.Provider value={{ activeJob, startGeneration }}>
      {children}
    </GenerationContext.Provider>
  );
};
```

---

## 5. Premium Micro-Interactions
- **Glassmorphic Cards**: `backdrop-filter: blur(16px); background: rgba(11, 10, 15, 0.6); border: 1px solid rgba(255, 255, 255, 0.08)`
- **Hover Glows**: Buttons hover to animate shadows (`box-shadow: 0 0 20px var(--primary-glow)`).
- **Text Skeleton Loader**: For prompt analysis, use text skeleton animations simulating the LLM typing out the scenes in real time.
