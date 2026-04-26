// Full-viewport pulsing edge-glow shown while the Magic Steps assistant is
// recording or executing a plan. Pointer-events:none so it never blocks taps.

type Props = {
  active: boolean;
  variant?: "recording" | "executing";
};

export const MagicGlowOverlay = ({ active, variant = "executing" }: Props) => {
  if (!active) return null;
  const isRecording = variant === "recording";
  return (
    <>
      <style>{`
        @keyframes magic-cycle {
          0%   { box-shadow: inset 0 0 60px 12px hsl(142 71% 45% / 0.85), 0 0 24px 4px hsl(142 71% 45% / 0.45); }
          25%  { box-shadow: inset 0 0 60px 12px hsl(217 91% 60% / 0.85), 0 0 24px 4px hsl(217 91% 60% / 0.45); }
          50%  { box-shadow: inset 0 0 60px 12px hsl(48 96% 53% / 0.85),  0 0 24px 4px hsl(48 96% 53% / 0.45); }
          75%  { box-shadow: inset 0 0 60px 12px hsl(330 81% 60% / 0.85), 0 0 24px 4px hsl(330 81% 60% / 0.45); }
          100% { box-shadow: inset 0 0 60px 12px hsl(142 71% 45% / 0.85), 0 0 24px 4px hsl(142 71% 45% / 0.45); }
        }
        @keyframes magic-recording {
          0%, 100% { box-shadow: inset 0 0 50px 10px hsl(0 84% 60% / 0.55); }
          50%      { box-shadow: inset 0 0 70px 14px hsl(0 84% 60% / 0.9);  }
        }
        .magic-glow {
          position: fixed;
          inset: 0;
          z-index: 60;
          pointer-events: none;
          border-radius: 24px;
          animation: magic-cycle 3.2s linear infinite;
        }
        .magic-glow.recording {
          animation: magic-recording 1.2s ease-in-out infinite;
        }
      `}</style>
      <div className={`magic-glow ${isRecording ? "recording" : ""}`} />
    </>
  );
};
