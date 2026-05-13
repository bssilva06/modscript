import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const features = [
  'Generate rules from plain English',
  'Explain your existing config',
  'Audit for conflicts',
];

export const Splash = () => (
  <div className="flex flex-col justify-center items-center min-h-screen bg-[#0a0a0e] px-6 relative overflow-hidden">
    {/* Dot-grid background */}
    <div
      className="absolute inset-0 opacity-[0.06]"
      style={{
        backgroundImage: 'radial-gradient(circle, #ff4500 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }}
    />

    {/* Vignette */}
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,#0a0a0e_100%)]" />

    {/* Terminal card */}
    <div className="relative z-10 w-full max-w-[280px] border border-[#252535]">
      {/* Fake window chrome */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#252535] bg-[#0d0d12]">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#1e1e28]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#1e1e28]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff4500]/30 border border-[#ff4500]/20" />
        </div>
        <span className="font-mono text-[10px] text-[#2e2e3a] flex-1 text-center select-none">
          modscript
        </span>
      </div>

      {/* Body */}
      <div className="bg-[#0d0d12] p-5">
        <div className="font-mono text-[10px] text-[#3a3a4a] mb-2 select-none">$ init --tool modscript</div>

        <h1 className="font-mono text-lg font-bold text-[#e8e8f0] tracking-tight leading-none mb-0.5">
          ModScript
        </h1>
        <p className="font-mono text-[11px] text-[#ff4500]/70 mb-5">
          AI-powered AutoModerator tools
        </p>

        <div className="space-y-2 mb-6">
          {features.map((f) => (
            <div key={f} className="flex items-center gap-2">
              <span className="text-[#ff4500] font-mono text-xs select-none">▶</span>
              <span className="font-mono text-[11px] text-[#6a6a7a]">{f}</span>
            </div>
          ))}
        </div>

        <button
          className="w-full bg-[#ff4500] hover:bg-[#e03d00] text-white font-mono text-[11px] py-2.5 uppercase tracking-widest transition-colors"
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        >
          open modscript →
        </button>

        <div className="mt-4 font-mono text-[9px] text-[#2a2a35] text-center select-none">
          mod-only · powered by gemini
        </div>
      </div>
    </div>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
