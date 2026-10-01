'use client';

import ModelPicker from '@/components/ModelPicker';

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section className="mt-6 flex flex-col gap-3">
        <h2 className="font-medium">AI model</h2>
        <p className="text-sm text-[var(--muted)]">
          The model behind rules answers, deck tagging and search, for everyone on this app. All are on free plans with
          daily limits; if the chosen one refuses or runs out, Gemini Flash-Lite answers instead.
        </p>
        <ModelPicker />
      </section>
    </div>
  );
}
