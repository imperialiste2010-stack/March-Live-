import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigation, Pause, Play, Radio, RotateCcw, Truck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { wsUrl } from '../lib/api.ts';
import { auth } from '../lib/firebase.ts';
import { isSupabaseRealtimeConfigured, supabase } from '../lib/supabase.ts';
import { Order } from '../types.ts';
import { MarketDeliveryMap } from './MarketDeliveryMap.tsx';

interface DeliveryTrackingProps {
  order: Order;
}

interface CoordPoint {
  lat: number;
  lng: number;
}

interface LiveTelemetry {
  lat: number;
  lng: number;
  heading: number | null;
  speedKmh: number | null;
  source: string;
  recordedAt: string;
  progressPercent?: number;
}

const COMMUNE_COORDS: Array<{ match: string; lat: number; lng: number }> = [
  { match: 'cocody', lat: 5.3602, lng: -3.9674 },
  { match: 'plateau', lat: 5.3235, lng: -4.018 },
  { match: 'marcory', lat: 5.3026, lng: -3.9825 },
  { match: 'treichville', lat: 5.2974, lng: -4.0005 },
  { match: 'yopougon', lat: 5.3364, lng: -4.0831 },
  { match: 'abobo', lat: 5.4161, lng: -4.0159 },
  { match: 'koumassi', lat: 5.2917, lng: -3.9491 },
  { match: 'port-bouet', lat: 5.2597, lng: -3.9277 },
  { match: 'port bouet', lat: 5.2597, lng: -3.9277 },
  { match: 'adjam', lat: 5.3578, lng: -4.0226 },
  { match: 'anyama', lat: 5.4946, lng: -4.0518 },
  { match: 'bingerville', lat: 5.3558, lng: -3.8854 },
  { match: 'bouak', lat: 7.6939, lng: -5.0303 },
  { match: 'yamoussoukro', lat: 6.8276, lng: -5.2893 },
  { match: 'san-pedro', lat: 4.7485, lng: -6.6363 },
  { match: 'daloa', lat: 6.8774, lng: -6.4502 },
  { match: 'korhogo', lat: 9.458, lng: -5.6296 },
];

function resolveFallbackDropoff(order: Order, pickup: CoordPoint): CoordPoint {
  const haystack = `${order.deliveryCommune || ''} ${order.deliveryCity || ''}`.toLowerCase();
  const matched = COMMUNE_COORDS.find((c) => haystack.includes(c.match));
  if (matched) {
    // Avoid identical pickup/dropoff if merchant and client share the same commune
    const delta = Math.abs(matched.lat - pickup.lat) + Math.abs(matched.lng - pickup.lng);
    if (delta > 0.008) {
      return { lat: matched.lat, lng: matched.lng };
    }
  }
  return {
    lat: Number((pickup.lat + 0.024).toFixed(6)),
    lng: Number((pickup.lng + 0.028).toFixed(6)),
  };
}

function haversineKm(a: CoordPoint, b: CoordPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

function computeBearing(from: CoordPoint, to: CoordPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.round((toDeg(Math.atan2(y, x)) + 360) % 360);
}

function buildSimulationWaypoints(
  pickup: CoordPoint,
  dropoff: CoordPoint,
  googleRoutePath: CoordPoint[],
  steps = 36
): CoordPoint[] {
  if (googleRoutePath.length >= 2) {
    const out: CoordPoint[] = [];
    for (let i = 0; i <= steps; i++) {
      const idx = Math.min(
        googleRoutePath.length - 1,
        Math.round((i / steps) * (googleRoutePath.length - 1))
      );
      out.push(googleRoutePath[idx]);
    }
    return out;
  }

  // Smooth curved street-like path when Google Routes polyline isn't loaded
  const dLat = dropoff.lat - pickup.lat;
  const dLng = dropoff.lng - pickup.lng;
  const points: CoordPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const curveOffset = Math.sin(t * Math.PI) * 0.0045;
    points.push({
      lat: Number((pickup.lat + dLat * t + curveOffset * (dLng >= 0 ? 0.6 : -0.6)).toFixed(6)),
      lng: Number((pickup.lng + dLng * t - curveOffset * (dLat >= 0 ? 0.5 : -0.5)).toFixed(6)),
    });
  }
  return points;
}

export const DeliveryTracking: React.FC<DeliveryTrackingProps> = ({ order }) => {
  const { apiFetch } = useAuth();

  const pickup = useMemo(() => {
    if (order.market) {
      return {
        lat: order.market.lat,
        lng: order.market.lng,
        label: order.market.name,
      };
    }
    return {
      lat: 5.3578,
      lng: -4.0226,
      label: order.shop?.shopName || 'Marché de départ',
    };
  }, [order.market, order.shop?.shopName]);

  const dropoff = useMemo(() => {
    if (order.deliveryLat && order.deliveryLng) {
      return {
        lat: order.deliveryLat,
        lng: order.deliveryLng,
        label: `${order.deliveryAddress}, ${order.deliveryCommune}`,
      };
    }
    const fallback = resolveFallbackDropoff(order, pickup);
    return {
      lat: fallback.lat,
      lng: fallback.lng,
      label: `${order.deliveryAddress}, ${order.deliveryCommune} (Zone estimée)`,
    };
  }, [order, pickup]);

  const initialLatest = order.tracking?.[0];
  const [liveTelemetry, setLiveTelemetry] = useState<LiveTelemetry | null>(() =>
    initialLatest
      ? {
          lat: initialLatest.lat,
          lng: initialLatest.lng,
          heading: initialLatest.heading ?? null,
          speedKmh: initialLatest.speedKmh ?? null,
          source: initialLatest.source,
          recordedAt: initialLatest.recordedAt,
        }
      : null
  );
  const [trail, setTrail] = useState<CoordPoint[]>(() => {
    if (order.tracking && order.tracking.length > 0) {
      return [...order.tracking].reverse().map((t) => ({ lat: t.lat, lng: t.lng }));
    }
    return [];
  });
  const [googleRoutePath, setGoogleRoutePath] = useState<CoordPoint[]>([]);
  const [simRunning, setSimRunning] = useState(false);
  const [simStep, setSimStep] = useState(0);
  const [simSpeed, setSimSpeed] = useState<1 | 2 | 4>(1);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'offline'>(
    'connecting'
  );

  const [animatedPos, setAnimatedPos] = useState<CoordPoint | null>(() =>
    initialLatest ? { lat: initialLatest.lat, lng: initialLatest.lng } : null
  );
  const animatedPosRef = useRef<CoordPoint | null>(animatedPos);
  const simStepRef = useRef(0);
  const supabaseChannelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(
    null
  );

  useEffect(() => {
    animatedPosRef.current = animatedPos;
  }, [animatedPos]);

  const totalSteps = 36;
  const waypoints = useMemo(
    () => buildSimulationWaypoints(pickup, dropoff, googleRoutePath, totalSteps),
    [pickup, dropoff, googleRoutePath]
  );

  // Smoothly animate courier marker between consecutive Supabase/WS coordinate updates
  useEffect(() => {
    if (!liveTelemetry) {
      setAnimatedPos(null);
      return;
    }

    const target = { lat: liveTelemetry.lat, lng: liveTelemetry.lng };
    const start = animatedPosRef.current || target;
    const distance = Math.abs(target.lat - start.lat) + Math.abs(target.lng - start.lng);

    if (distance < 0.000001) {
      setAnimatedPos(target);
      return;
    }

    const durationMs = simSpeed === 4 ? 280 : simSpeed === 2 ? 550 : 950;
    const startTime = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      // Smooth ease-out curve for natural vehicle motion
      const eased = 1 - Math.pow(1 - t, 2);
      const nextPos = {
        lat: start.lat + (target.lat - start.lat) * eased,
        lng: start.lng + (target.lng - start.lng) * eased,
      };
      animatedPosRef.current = nextPos;
      setAnimatedPos(nextPos);
      if (t < 1) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [liveTelemetry, simSpeed]);

  const applyIncomingLocation = useCallback((point: LiveTelemetry) => {
    setLiveTelemetry(point);
    setTrail((prev) => {
      const last = prev[prev.length - 1];
      if (
        last &&
        Math.abs(last.lat - point.lat) < 0.00001 &&
        Math.abs(last.lng - point.lng) < 0.00001
      ) {
        return prev;
      }
      return [...prev.slice(-60), { lat: point.lat, lng: point.lng }];
    });
  }, []);

  // Reset local tracking view when user switches selected order
  useEffect(() => {
    const latest = order.tracking?.[0];
    setSimRunning(false);
    setSimStep(0);
    simStepRef.current = 0;
    setGoogleRoutePath([]);
    if (latest) {
      const startPt = { lat: latest.lat, lng: latest.lng };
      animatedPosRef.current = startPt;
      setAnimatedPos(startPt);
      setLiveTelemetry({
        lat: latest.lat,
        lng: latest.lng,
        heading: latest.heading ?? null,
        speedKmh: latest.speedKmh ?? null,
        source: latest.source,
        recordedAt: latest.recordedAt,
      });
      setTrail(
        [...(order.tracking || [])].reverse().map((t) => ({ lat: t.lat, lng: t.lng }))
      );
    } else {
      animatedPosRef.current = null;
      setAnimatedPos(null);
      setLiveTelemetry(null);
      setTrail([]);
    }
  }, [order.id, order.tracking]);

  // 1. Subscribe to Supabase Realtime channel when configured
  useEffect(() => {
    const client = supabase;
    if (!client || !isSupabaseRealtimeConfigured) return;

    const channel = client
      .channel(`delivery:order:${order.id}`, {
        config: { broadcast: { self: true } },
      })
      .on('broadcast', { event: 'courier_location' }, ({ payload }) => {
        if (!payload || typeof payload.lat !== 'number' || typeof payload.lng !== 'number') return;
        applyIncomingLocation({
          lat: payload.lat,
          lng: payload.lng,
          heading: typeof payload.heading === 'number' ? payload.heading : null,
          speedKmh: typeof payload.speedKmh === 'number' ? payload.speedKmh : null,
          source: String(payload.source || 'supabase_realtime'),
          recordedAt: String(payload.recordedAt || new Date().toISOString()),
          progressPercent:
            typeof payload.progressPercent === 'number' ? payload.progressPercent : undefined,
        });
      })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'delivery_tracking',
        },
        (payload) => {
          const row = payload.new as {
            delivery_request_id?: number;
            lat?: number;
            lng?: number;
            heading?: number | null;
            speed_kmh?: number | null;
            source?: string;
            recorded_at?: string;
          };
          if (
            order.deliveryRequest &&
            row.delivery_request_id === order.deliveryRequest.id &&
            typeof row.lat === 'number' &&
            typeof row.lng === 'number'
          ) {
            applyIncomingLocation({
              lat: row.lat,
              lng: row.lng,
              heading: row.heading ?? null,
              speedKmh: row.speed_kmh ?? null,
              source: row.source || 'supabase_postgres_changes',
              recordedAt: row.recorded_at || new Date().toISOString(),
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        }
      });

    supabaseChannelRef.current = channel;

    return () => {
      supabaseChannelRef.current = null;
      client.removeChannel(channel);
    };
  }, [order.id, order.deliveryRequest, applyIncomingLocation]);

  // 2. Subscribe to real-time Express WebSocket delivery:location stream
  useEffect(() => {
    let closedByEffect = false;
    const ws = new WebSocket(wsUrl('/ws'));

    ws.onopen = async () => {
      try {
        if (auth.currentUser) {
          const token = await auth.currentUser.getIdToken();
          if (!closedByEffect && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'auth', payload: { token } }));
          }
        }
      } catch {
        // Ignore auth error
      }
      if (!isSupabaseRealtimeConfigured) {
        setRealtimeStatus('connected');
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.event === 'delivery:location' && msg.payload?.orderId === order.id) {
          const pt = msg.payload.point;
          if (pt && typeof pt.lat === 'number' && typeof pt.lng === 'number') {
            applyIncomingLocation({
              lat: pt.lat,
              lng: pt.lng,
              heading: pt.heading ?? null,
              speedKmh: pt.speedKmh ?? null,
              source: pt.source || 'websocket_live',
              recordedAt: pt.recordedAt || new Date().toISOString(),
              progressPercent:
                typeof pt.progressPercent === 'number' ? pt.progressPercent : undefined,
            });
          }
        }
      } catch {
        // Ignore malformed WS frames
      }
    };

    ws.onclose = () => {
      if (!closedByEffect && !isSupabaseRealtimeConfigured) {
        setRealtimeStatus('offline');
      }
    };

    return () => {
      closedByEffect = true;
      ws.close();
    };
  }, [order.id, applyIncomingLocation]);

  // 3. Emit simulated GPS updates along route when simRunning === true
  useEffect(() => {
    if (!simRunning) return;

    const intervalMs = simSpeed === 4 ? 320 : simSpeed === 2 ? 620 : 1100;
    const timer = window.setInterval(() => {
      const nextStep = simStepRef.current + 1;
      if (nextStep > totalSteps) {
        setSimRunning(false);
        return;
      }

      simStepRef.current = nextStep;
      setSimStep(nextStep);

      const currentPt = waypoints[Math.min(nextStep, waypoints.length - 1)];
      const prevPt = waypoints[Math.max(0, nextStep - 1)];
      const heading = computeBearing(prevPt, currentPt);
      const speedKmh = nextStep === totalSteps ? 0 : Math.round(28 + Math.sin(nextStep * 0.7) * 9);
      const progressPercent = Math.round((nextStep / totalSteps) * 100);
      const recordedAt = new Date().toISOString();

      const payload = {
        lat: currentPt.lat,
        lng: currentPt.lng,
        heading,
        speedKmh,
        progressPercent,
        source: isSupabaseRealtimeConfigured ? 'supabase_realtime_sim' : 'simulation',
        recordedAt,
      };

      // Broadcast via Supabase Realtime channel if configured
      if (supabaseChannelRef.current) {
        supabaseChannelRef.current
          .send({
            type: 'broadcast',
            event: 'courier_location',
            payload,
          })
          .catch(() => {});
      }

      // Persist & broadcast via server WebSocket (works everywhere, including without Supabase keys)
      apiFetch(`/api/orders/${order.id}/simulate-tracking`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }).catch(() => {
        applyIncomingLocation(payload);
      });

      if (nextStep >= totalSteps) {
        setSimRunning(false);
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [simRunning, simSpeed, waypoints, totalSteps, order.id, apiFetch, applyIncomingLocation]);

  const handleStartOrToggleSim = () => {
    if (simStepRef.current >= totalSteps) {
      simStepRef.current = 0;
      setSimStep(0);
      setTrail([pickup]);
      animatedPosRef.current = { lat: pickup.lat, lng: pickup.lng };
      setAnimatedPos({ lat: pickup.lat, lng: pickup.lng });
      setLiveTelemetry({
        lat: pickup.lat,
        lng: pickup.lng,
        heading: computeBearing(pickup, waypoints[1] || dropoff),
        speedKmh: 24,
        source: isSupabaseRealtimeConfigured ? 'supabase_realtime_sim' : 'simulation',
        recordedAt: new Date().toISOString(),
        progressPercent: 0,
      });
      setSimRunning(true);
      return;
    }

    if (!simRunning && simStepRef.current === 0 && trail.length === 0) {
      setTrail([{ lat: pickup.lat, lng: pickup.lng }]);
      animatedPosRef.current = { lat: pickup.lat, lng: pickup.lng };
      setAnimatedPos({ lat: pickup.lat, lng: pickup.lng });
      setLiveTelemetry({
        lat: pickup.lat,
        lng: pickup.lng,
        heading: computeBearing(pickup, waypoints[1] || dropoff),
        speedKmh: 24,
        source: isSupabaseRealtimeConfigured ? 'supabase_realtime_sim' : 'simulation',
        recordedAt: new Date().toISOString(),
        progressPercent: 0,
      });
    }
    setSimRunning((prev) => !prev);
  };

  const handleResetSim = () => {
    setSimRunning(false);
    simStepRef.current = 0;
    setSimStep(0);
    setTrail([]);
    animatedPosRef.current = null;
    setAnimatedPos(null);
    setLiveTelemetry(null);
  };

  const totalDistanceKm = useMemo(() => haversineKm(pickup, dropoff), [pickup, dropoff]);
  const remainingKm = useMemo(() => {
    if (!liveTelemetry) return totalDistanceKm;
    return haversineKm(liveTelemetry, dropoff);
  }, [liveTelemetry, dropoff, totalDistanceKm]);

  const etaMinutes = useMemo(() => {
    const speed = liveTelemetry?.speedKmh && liveTelemetry.speedKmh > 5 ? liveTelemetry.speedKmh : 28;
    return Math.max(0, Math.round((remainingKm / speed) * 60));
  }, [remainingKm, liveTelemetry?.speedKmh]);

  const progressPercent =
    liveTelemetry?.progressPercent !== undefined
      ? liveTelemetry.progressPercent
      : simStep > 0
        ? Math.round((simStep / totalSteps) * 100)
        : 0;

  return (
    <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-ink flex items-center gap-2">
            <Truck className="w-4 h-4 text-brand-orange-text" />
            <span>Suivi géographique en temps réel</span>
          </h4>
          <div className="text-xs text-ink-muted flex flex-wrap items-center gap-2 mt-0.5">
            <span className="inline-flex items-center gap-1.5">
              {realtimeStatus === 'connected' && (
                <span className="w-2 h-2 rounded-full bg-brand-green inline-block" aria-hidden="true" />
              )}
              <span>
                {isSupabaseRealtimeConfigured
                  ? 'Canal Supabase Realtime actif'
                  : 'Flux temps réel WebSocket actif'}
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {liveTelemetry
                ? `Maj ${new Date(liveTelemetry.recordedAt).toLocaleTimeString('fr-FR')}`
                : 'Prêt pour le suivi GPS ou simulation'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-surface-subtle border border-line rounded-xl">
            {([1, 2, 4] as const).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => setSimSpeed(spd)}
                className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  simSpeed === spd
                    ? 'bg-surface text-ink border border-line shadow-xs'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleStartOrToggleSim}
            className={`px-3.5 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              simRunning
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-brand-green hover:bg-brand-green-hover text-white'
            }`}
          >
            {simRunning ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>
                  {simStep >= totalSteps
                    ? 'Rejouer la simulation'
                    : simStep > 0
                      ? 'Reprendre'
                      : 'Simuler le trajet'}
                </span>
              </>
            )}
          </button>

          {(simStep > 0 || trail.length > 0) && (
            <button
              type="button"
              onClick={handleResetSim}
              aria-label="Réinitialiser la simulation"
              className="p-2 bg-surface-muted hover:bg-line text-ink-secondary rounded-xl border border-line transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Live Telemetry & Progress Bar */}
      <div className="bg-surface-subtle border border-line rounded-xl p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <Radio className="w-3.5 h-3.5 text-brand-orange-text" />
            <span>
              {simStep >= totalSteps && liveTelemetry
                ? 'Livreur arrivé à destination'
                : simRunning
                  ? 'Livreur en route vers votre adresse'
                  : liveTelemetry
                    ? 'Dernière position enregistrée'
                    : `Trajet ${pickup.label} → ${order.deliveryCommune}`}
            </span>
          </div>
          <span className="font-mono font-bold text-brand-green-text tabular-nums">
            {progressPercent}%
          </span>
        </div>

        <progress
          value={progressPercent}
          max={100}
          aria-label="Progression de la livraison"
          className="w-full h-2 rounded-full overflow-hidden bg-surface-muted [&::-webkit-progress-bar]:bg-surface-muted [&::-webkit-progress-value]:bg-brand-green [&::-moz-progress-bar]:bg-brand-green"
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs font-mono tabular-nums">
          <div>
            <div className="text-[11px] font-sans text-ink-muted">Coordonnées GPS</div>
            <div className="text-ink font-semibold mt-0.5 truncate">
              {animatedPos
                ? `${animatedPos.lat.toFixed(4)}, ${animatedPos.lng.toFixed(4)}`
                : liveTelemetry
                  ? `${liveTelemetry.lat.toFixed(4)}, ${liveTelemetry.lng.toFixed(4)}`
                  : `${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)}`}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-sans text-ink-muted">Vitesse estimée</div>
            <div className="text-ink font-semibold mt-0.5 flex items-center gap-1">
              <Navigation className="w-3 h-3 text-brand-orange-text" />
              <span>{liveTelemetry?.speedKmh ?? 0} km/h</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-sans text-ink-muted">Distance restante</div>
            <div className="text-ink font-semibold mt-0.5">{remainingKm.toFixed(1)} km</div>
          </div>
          <div>
            <div className="text-[11px] font-sans text-ink-muted">Arrivée estimée</div>
            <div className="text-brand-green-text font-bold mt-0.5">
              {simStep >= totalSteps ? 'Arrivé' : `~${Math.max(1, etaMinutes)} min`}
            </div>
          </div>
        </div>
      </div>

      <MarketDeliveryMap
        heightClass="h-[320px]"
        pickup={pickup}
        dropoff={dropoff}
        courier={
          liveTelemetry
            ? {
                lat: (animatedPos || liveTelemetry).lat,
                lng: (animatedPos || liveTelemetry).lng,
                heading: liveTelemetry.heading,
                label: `Source : ${liveTelemetry.source} · ${liveTelemetry.speedKmh ?? 0} km/h`,
              }
            : null
        }
        courierTrail={animatedPos && trail.length > 0 ? [...trail, animatedPos] : trail}
        onRoutePath={setGoogleRoutePath}
      />
    </div>
  );
};
