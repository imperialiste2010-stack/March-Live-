import React from 'react';

export const MARCHE_LIVE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="116" fill="#0F5132" />
  <rect x="20" y="20" width="472" height="472" rx="98" stroke="#1A6B44" stroke-width="4" />
  <path d="M92 164C92 141.909 109.909 124 132 124H380C402.091 124 420 141.909 420 164V192C420 218.51 398.51 240 372 240C354.5 240 339.185 230.635 330.8 216.662C322.415 230.635 307.1 240 289.6 240C272.1 240 256.785 230.635 248.4 216.662C240.015 230.635 224.7 240 207.2 240C189.7 240 174.385 230.635 166 216.662C157.615 230.635 142.3 240 124.8 240C106.685 240 92 225.315 92 207.2V164Z" fill="#EA580C" />
  <path d="M168 124H208V216C208 228 198 238 188 238C178 238 168 228 168 216V124Z" fill="#FFFDF9" fill-opacity="0.92" />
  <path d="M304 124H344V216C344 228 334 238 324 238C314 238 304 228 304 216V124Z" fill="#FFFDF9" fill-opacity="0.92" />
  <rect x="128" y="258" width="256" height="142" rx="28" fill="#FFFDF9" />
  <circle cx="256" cy="329" r="44" fill="#0F5132" />
  <path d="M244 307L279 329L244 351V307Z" fill="#EA580C" />
  <circle cx="348" cy="292" r="12" fill="#DC2626" />
  <path d="M332 276C341 267 355 267 364 276" stroke="#EA580C" stroke-width="7" stroke-linecap="round" />
</svg>`;

export const MarcheLiveMark: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg
    viewBox="0 0 512 512"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <rect width="512" height="512" rx="116" fill="#0F5132" />
    <rect x="20" y="20" width="472" height="472" rx="98" stroke="#1A6B44" strokeWidth="4" />
    <path
      d="M92 164C92 141.909 109.909 124 132 124H380C402.091 124 420 141.909 420 164V192C420 218.51 398.51 240 372 240C354.5 240 339.185 230.635 330.8 216.662C322.415 230.635 307.1 240 289.6 240C272.1 240 256.785 230.635 248.4 216.662C240.015 230.635 224.7 240 207.2 240C189.7 240 174.385 230.635 166 216.662C157.615 230.635 142.3 240 124.8 240C106.685 240 92 225.315 92 207.2V164Z"
      fill="#EA580C"
    />
    <path
      d="M168 124H208V216C208 228 198 238 188 238C178 238 168 228 168 216V124Z"
      fill="#FFFDF9"
      fillOpacity="0.92"
    />
    <path
      d="M304 124H344V216C344 228 334 238 324 238C314 238 304 228 304 216V124Z"
      fill="#FFFDF9"
      fillOpacity="0.92"
    />
    <rect x="128" y="258" width="256" height="142" rx="28" fill="#FFFDF9" />
    <circle cx="256" cy="329" r="44" fill="#0F5132" />
    <path d="M244 307L279 329L244 351V307Z" fill="#EA580C" />
    <circle cx="348" cy="292" r="12" fill="#DC2626" />
    <path
      d="M332 276C341 267 355 267 364 276"
      stroke="#EA580C"
      strokeWidth="7"
      strokeLinecap="round"
    />
  </svg>
);

export const MarcheLiveLockup: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const iconSize = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-14 h-14' : 'w-9 h-9';
  const textSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg';
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <MarcheLiveMark className={iconSize} />
      <span className={`${textSize} font-extrabold tracking-tight text-brand-green-text`}>
        MARCHÉ <span className="text-brand-orange-text">LIVE</span>
      </span>
    </span>
  );
};
