"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="workspace-theme flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-slate-900 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">Mellivo</p>
        <h1 className="mt-3 text-2xl font-bold">Something went wrong</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">The workspace could not finish loading. Please try again.</p>
        <button onClick={reset} className="mt-6 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700">Try again</button>
      </div>
    </main>
  );
}

