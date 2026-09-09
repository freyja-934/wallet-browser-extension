import { useEffect, useState, type ReactNode } from 'react';

type AtmosphereMode = 'video' | 'still';
type AtmosphereFocus = 'mark' | 'stage';

export function Atmosphere({
  mode,
  heavy = false,
  focus = 'stage',
}: {
  mode: AtmosphereMode;
  heavy?: boolean;
  focus?: AtmosphereFocus;
}) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const useVideo = mode === 'video' && !reduceMotion;
  const mark = focus === 'mark';

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {useVideo ? (
        <video
          className="atmosphere-media"
          autoPlay
          loop
          muted
          playsInline
          poster="./media/bg-img.jpg"
        >
          <source src="./media/bg-video.mp4" type="video/mp4" />
        </video>
      ) : (
        <img className="atmosphere-media" src="./media/bg-img.jpg" alt="" />
      )}
      <div
        className={`atmosphere-scrim ${heavy ? 'atmosphere-scrim-heavy' : ''} ${mark && !heavy ? 'atmosphere-scrim-mark' : ''}`}
      />
    </div>
  );
}

export function PopupFrame({
  atmosphere = 'still',
  heavy = false,
  focus = 'stage',
  children,
  className = '',
}: {
  atmosphere?: AtmosphereMode | 'none';
  heavy?: boolean;
  focus?: AtmosphereFocus;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`popup-container text-fg-0 ${className}`}>
      {atmosphere !== 'none' && <Atmosphere mode={atmosphere} heavy={heavy} focus={focus} />}
      <div className="relative z-10 flex h-full min-h-0 flex-col">{children}</div>
    </div>
  );
}
