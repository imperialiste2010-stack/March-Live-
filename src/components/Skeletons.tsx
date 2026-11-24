import React from 'react';

const ShimmerBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`skeleton-shimmer rounded-lg ${className}`} aria-hidden="true" />
);

export const MerchantCardSkeleton: React.FC = () => (
  <div
    className="bg-surface border border-line rounded-2xl p-5 flex flex-col justify-between gap-4"
    aria-hidden="true"
  >
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <ShimmerBlock className="h-3.5 w-36" />
        <ShimmerBlock className="h-3.5 w-12" />
      </div>
      <ShimmerBlock className="h-6 w-3/4" />
      <ShimmerBlock className="h-3.5 w-5/6" />
    </div>

    <div className="flex items-center gap-2 pt-2 border-t border-line">
      <ShimmerBlock className="flex-1 h-9 rounded-xl" />
      <ShimmerBlock className="w-24 h-9 rounded-xl" />
    </div>
  </div>
);

export const MerchantGridSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <div
    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
    role="status"
    aria-label="Chargement des commerçants"
  >
    {Array.from({ length: count }).map((_, idx) => (
      <MerchantCardSkeleton key={idx} />
    ))}
  </div>
);

export const ProductCardSkeleton: React.FC = () => (
  <div
    className="bg-surface border border-line rounded-2xl p-4 flex flex-col justify-between gap-3"
    aria-hidden="true"
  >
    <div className="space-y-2">
      <ShimmerBlock className="h-3 w-20" />
      <ShimmerBlock className="h-5 w-4/5" />
      <ShimmerBlock className="h-4 w-28" />
    </div>
    <div className="flex items-center gap-2 pt-1">
      <ShimmerBlock className="w-20 h-9 rounded-lg" />
      <ShimmerBlock className="flex-1 h-9 rounded-lg" />
    </div>
  </div>
);

export const ShopDetailSkeleton: React.FC = () => (
  <div className="space-y-6" role="status" aria-label="Chargement de la boutique et des produits">
    <ShimmerBlock className="h-5 w-36" />

    <div className="bg-surface border border-line rounded-2xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div className="space-y-2.5 flex-1">
        <ShimmerBlock className="h-3.5 w-64" />
        <ShimmerBlock className="h-7 w-72 max-w-full" />
        <ShimmerBlock className="h-3.5 w-52" />
      </div>
      <ShimmerBlock className="h-11 w-44 rounded-xl shrink-0" />
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-7 space-y-4">
        <ShimmerBlock className="h-6 w-52" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <ProductCardSkeleton key={idx} />
          ))}
        </div>
      </div>

      <div className="lg:col-span-5 bg-surface border border-line rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <ShimmerBlock className="h-5 w-32" />
          <ShimmerBlock className="h-5 w-24" />
        </div>
        <div className="space-y-2.5">
          <ShimmerBlock className="h-4 w-full" />
          <ShimmerBlock className="h-4 w-5/6" />
        </div>
        <ShimmerBlock className="h-11 w-full rounded-xl" />
      </div>
    </div>
  </div>
);

export const LiveRoomSkeleton: React.FC = () => (
  <div className="space-y-6" role="status" aria-label="Connexion au studio LIVE">
    <div className="bg-surface border border-line rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
      <div className="space-y-2 flex-1">
        <ShimmerBlock className="h-4 w-48" />
        <ShimmerBlock className="h-6 w-72 max-w-full" />
      </div>
      <div className="flex items-center gap-3">
        <ShimmerBlock className="h-9 w-28 rounded-lg" />
        <ShimmerBlock className="h-9 w-32 rounded-xl" />
      </div>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-7 space-y-4">
        <ShimmerBlock className="w-full aspect-video rounded-2xl" />
        <div className="bg-surface border border-line rounded-2xl p-4 space-y-3">
          <ShimmerBlock className="h-4 w-44" />
          <ShimmerBlock className="h-36 w-full rounded-xl" />
          <ShimmerBlock className="h-10 w-full rounded-xl" />
        </div>
      </div>

      <div className="lg:col-span-5 space-y-4">
        <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
          <ShimmerBlock className="h-5 w-40" />
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="p-3 rounded-xl border border-line bg-surface-subtle flex justify-between items-center gap-3">
              <div className="space-y-1.5 flex-1">
                <ShimmerBlock className="h-4 w-3/4" />
                <ShimmerBlock className="h-3.5 w-1/2" />
              </div>
              <ShimmerBlock className="h-8 w-24 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export const OrdersSkeleton: React.FC = () => (
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start" role="status" aria-label="Chargement des commandes">
    <div className="lg:col-span-4 space-y-3">
      <ShimmerBlock className="h-6 w-40" />
      {Array.from({ length: 3 }).map((_, idx) => (
        <div key={idx} className="bg-surface border border-line rounded-2xl p-4 space-y-2">
          <div className="flex justify-between">
            <ShimmerBlock className="h-3.5 w-24" />
            <ShimmerBlock className="h-3.5 w-20" />
          </div>
          <ShimmerBlock className="h-5 w-44" />
          <ShimmerBlock className="h-3.5 w-32" />
        </div>
      ))}
    </div>
    <div className="lg:col-span-8 space-y-6">
      <div className="bg-surface border border-line rounded-2xl p-6 space-y-4">
        <ShimmerBlock className="h-7 w-64" />
        <ShimmerBlock className="h-4 w-80 max-w-full" />
        <ShimmerBlock className="h-24 w-full rounded-xl" />
      </div>
      <ShimmerBlock className="h-[300px] w-full rounded-2xl" />
    </div>
  </div>
);

export const MerchantDashboardSkeleton: React.FC = () => (
  <div className="space-y-6" role="status" aria-label="Chargement de votre espace commerçant">
    <div className="bg-surface border border-line rounded-2xl p-6 flex flex-col lg:flex-row justify-between gap-4">
      <div className="space-y-2">
        <ShimmerBlock className="h-3.5 w-52" />
        <ShimmerBlock className="h-7 w-64" />
        <ShimmerBlock className="h-3.5 w-80 max-w-full" />
      </div>
      <ShimmerBlock className="h-11 w-48 rounded-xl" />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div key={idx} className="bg-surface border border-line rounded-2xl p-5 space-y-2">
          <ShimmerBlock className="h-3.5 w-36" />
          <ShimmerBlock className="h-7 w-32" />
        </div>
      ))}
    </div>
  </div>
);
