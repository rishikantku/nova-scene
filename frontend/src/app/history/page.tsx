export default function Placeholder() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-8 text-center relative z-10 h-screen">
      <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">
        <span className="text-2xl">🚧</span>
      </div>
      <h1 className="text-3xl font-bold text-white mb-2 capitalize border-b border-white/10 pb-4">
        history
      </h1>
      <p className="text-zinc-400 mt-4 max-w-md">
        This section is currently under construction as part of Phase 3 of the Studio Revamp.
      </p>
    </div>
  );
}
