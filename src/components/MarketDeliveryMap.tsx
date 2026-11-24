import React, { useEffect, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MapPin, Navigation } from 'lucide-react';
import { Market } from '../types.ts';

interface Point {
  lat: number;
  lng: number;
  label: string;
}

interface RouteOverlayProps {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  onRouteSummary?: (summary: { distanceMeters: number; durationText: string }) => void;
  onRoutePath?: (path: Array<{ lat: number; lng: number }>) => void;
}

interface PolylineHandle {
  setMap: (map: unknown) => void;
}

// Uses modern Route.computeRoutes() via useMapsLibrary('routes') — never legacy DirectionsService
const RouteOverlay: React.FC<RouteOverlayProps> = ({
  origin,
  destination,
  onRouteSummary,
  onRoutePath,
}) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const mapsLib = useMapsLibrary('maps');

  useEffect(() => {
    if (!map || !routesLib || !mapsLib) return;
    let active = true;
    const polylines: PolylineHandle[] = [];

    const compute = async () => {
      try {
        const RouteClass = (routesLib as unknown as { Route?: any }).Route;
        if (!RouteClass?.computeRoutes) return;

        const result = await RouteClass.computeRoutes({
          origin: { location: { lat: origin.lat, lng: origin.lng } },
          destination: { location: { lat: destination.lat, lng: destination.lng } },
          travelMode: 'DRIVING',
          fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
        });

        if (!active || !result?.routes?.[0]) return;
        const route = result.routes[0];

        if (route.path && Array.isArray(route.path) && onRoutePath) {
          const extracted = route.path
            .map((pt: { lat?: number | (() => number); lng?: number | (() => number) }) => {
              const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
              const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
              return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
            })
            .filter((p: { lat: number; lng: number } | null): p is { lat: number; lng: number } => Boolean(p));
          if (extracted.length >= 2) {
            onRoutePath(extracted);
          }
        }

        if (route.createPolylines) {
          const created: PolylineHandle[] = route.createPolylines({
            polylineOptions: {
              strokeColor: '#EA580C',
              strokeWeight: 4,
              strokeOpacity: 0.55,
            },
          });
          created.forEach((p) => {
            p.setMap(map);
            polylines.push(p);
          });
        } else if (route.path) {
          const line = new mapsLib.Polyline({
            path: route.path,
            strokeColor: '#EA580C',
            strokeWeight: 4,
            strokeOpacity: 0.55,
            map,
          });
          polylines.push(line);
        }

        if (route.viewport) {
          map.fitBounds(route.viewport);
        }

        if (onRouteSummary && route.distanceMeters) {
          const mins = Math.max(1, Math.round((route.durationMillis || 0) / 60000));
          onRouteSummary({
            distanceMeters: route.distanceMeters,
            durationText: `${mins} min`,
          });
        }
      } catch (err) {
        console.error('Routes API computeRoutes failed:', err);
      }
    };

    compute();

    return () => {
      active = false;
      polylines.forEach((p) => p.setMap(null));
    };
  }, [
    map,
    routesLib,
    mapsLib,
    origin.lat,
    origin.lng,
    destination.lat,
    destination.lng,
    onRouteSummary,
    onRoutePath,
  ]);

  return null;
};

const CourierTrailOverlay: React.FC<{ trail: Array<{ lat: number; lng: number }> }> = ({
  trail,
}) => {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');

  useEffect(() => {
    if (!map || !mapsLib || trail.length < 2) return;
    const line = new mapsLib.Polyline({
      path: trail,
      strokeColor: '#0F5132',
      strokeWeight: 5,
      strokeOpacity: 0.95,
      map,
    });
    return () => {
      line.setMap(null);
    };
  }, [map, mapsLib, trail]);

  return null;
};

interface MarketDeliveryMapProps {
  markets?: Market[];
  selectedMarketId?: number | null;
  onSelectMarket?: (market: Market) => void;
  pickup?: Point | null;
  dropoff?: Point | null;
  courier?: (Point & { heading?: number | null }) | null;
  courierTrail?: Array<{ lat: number; lng: number }>;
  onRoutePath?: (path: Array<{ lat: number; lng: number }>) => void;
  heightClass?: string;
}

export const MarketDeliveryMap: React.FC<MarketDeliveryMapProps> = ({
  markets = [],
  selectedMarketId,
  onSelectMarket,
  pickup,
  dropoff,
  courier,
  courierTrail = [],
  onRoutePath,
  heightClass = 'h-[360px] md:h-[420px]',
}) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const [activeMarker, setActiveMarker] = useState<{
    lat: number;
    lng: number;
    title: string;
    subtitle?: string;
  } | null>(null);
  const [routeSummary, setRouteSummary] = useState<{
    distanceMeters: number;
    durationText: string;
  } | null>(null);

  const defaultCenter = pickup
    ? { lat: pickup.lat, lng: pickup.lng }
    : markets[0]
      ? { lat: markets[0].lat, lng: markets[0].lng }
      : { lat: 5.3484, lng: -4.0083 }; // Abidjan

  if (!apiKey) {
    return (
      <div
        className={`${heightClass} w-full rounded-2xl border border-line bg-surface-subtle flex flex-col items-center justify-center p-6 text-center`}
      >
        <MapPin className="w-8 h-8 text-brand-green-text mb-2" />
        <p className="text-sm font-semibold text-ink">
          Carte Google Maps prête dès l'injection de la clé API
        </p>
        <p className="text-xs text-ink-muted mt-1 max-w-md">
          Configurez <code>VITE_GOOGLE_MAPS_API_KEY</code> pour afficher les marchés de Côte d'Ivoire, les itinéraires et le suivi GPS autorisé.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className={`${heightClass} w-full rounded-2xl overflow-hidden border border-line relative`}>
        <APIProvider apiKey={apiKey} language="fr" region="CI">
          <GoogleMap
            defaultCenter={defaultCenter}
            defaultZoom={pickup && dropoff ? 13 : 11}
            mapId="DEMO_MAP_ID"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            gestureHandling="greedy"
            className="w-full h-full"
          >
            {markets.map((m) => (
              <AdvancedMarker
                key={m.id}
                position={{ lat: m.lat, lng: m.lng }}
                onClick={() => {
                  setActiveMarker({
                    lat: m.lat,
                    lng: m.lng,
                    title: m.name,
                    subtitle: `${m.city} · ${m.commune}`,
                  });
                  onSelectMarket?.(m);
                }}
              >
                <Pin
                  background={selectedMarketId === m.id ? '#EA580C' : '#0F5132'}
                  borderColor="#FFFFFF"
                  glyphColor="#FFFFFF"
                />
              </AdvancedMarker>
            ))}

            {pickup && (
              <AdvancedMarker
                position={{ lat: pickup.lat, lng: pickup.lng }}
                onClick={() =>
                  setActiveMarker({
                    lat: pickup.lat,
                    lng: pickup.lng,
                    title: 'Point de collecte (Commerçant)',
                    subtitle: pickup.label,
                  })
                }
              >
                <Pin background="#0F5132" borderColor="#FFFFFF" glyphColor="#FACC15" />
              </AdvancedMarker>
            )}

            {dropoff && (
              <AdvancedMarker
                position={{ lat: dropoff.lat, lng: dropoff.lng }}
                onClick={() =>
                  setActiveMarker({
                    lat: dropoff.lat,
                    lng: dropoff.lng,
                    title: 'Adresse de livraison (Client)',
                    subtitle: dropoff.label,
                  })
                }
              >
                <Pin background="#EA580C" borderColor="#FFFFFF" glyphColor="#FFFFFF" />
              </AdvancedMarker>
            )}

            {courier && (
              <AdvancedMarker
                position={{ lat: courier.lat, lng: courier.lng }}
                onClick={() =>
                  setActiveMarker({
                    lat: courier.lat,
                    lng: courier.lng,
                    title: 'Position GPS du livreur',
                    subtitle: courier.label,
                  })
                }
              >
                <div className="bg-slate-900 text-white px-2.5 py-1 rounded-lg text-xs font-semibold shadow-md border border-white flex items-center gap-1.5">
                  <Navigation
                    className="w-3.5 h-3.5 text-[#FACC15] transition-transform duration-150"
                    style={{
                      transform: `rotate(${((courier.heading ?? 45) - 45)}deg)`,
                    }}
                  />
                  <span>Livreur</span>
                </div>
              </AdvancedMarker>
            )}

            {courierTrail.length >= 2 && <CourierTrailOverlay trail={courierTrail} />}

            {pickup && dropoff && (
              <RouteOverlay
                origin={{ lat: pickup.lat, lng: pickup.lng }}
                destination={{ lat: dropoff.lat, lng: dropoff.lng }}
                onRouteSummary={setRouteSummary}
                onRoutePath={onRoutePath}
              />
            )}

            {activeMarker && (
              <InfoWindow
                position={{ lat: activeMarker.lat, lng: activeMarker.lng }}
                onCloseClick={() => setActiveMarker(null)}
              >
                <div className="p-1 max-w-[220px]">
                  <div className="font-semibold text-sm text-slate-900">{activeMarker.title}</div>
                  {activeMarker.subtitle && (
                    <div className="text-xs text-slate-600 mt-0.5">{activeMarker.subtitle}</div>
                  )}
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        </APIProvider>
      </div>

      {routeSummary && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary bg-surface-subtle border border-line rounded-xl px-4 py-2">
          <span>Itinéraire routier calculé (Routes API)</span>
          <span className="font-mono font-semibold text-ink tabular-nums">
            {(routeSummary.distanceMeters / 1000).toFixed(1)} km · ~{routeSummary.durationText}
          </span>
        </div>
      )}
    </div>
  );
};
