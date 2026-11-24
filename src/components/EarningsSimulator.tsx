import React, { useMemo, useState } from 'react';
import { Calculator, TrendingUp, Info } from 'lucide-react';

interface EarningsSimulatorProps {
  onStartMerchant: () => void;
}

export const EarningsSimulator: React.FC<EarningsSimulatorProps> = ({ onStartMerchant }) => {
  const [dailyOrders, setDailyOrders] = useState(12);
  const [avgBasketXof, setAvgBasketXof] = useState(12500);
  const [daysPerMonth, setDaysPerMonth] = useState(26);

  const metrics = useMemo(() => {
    const dailyGross = dailyOrders * avgBasketXof;
    const dailyCommission = Math.round(dailyGross * 0.1);
    const dailyNet = dailyGross - dailyCommission;
    const monthlyGross = dailyGross * daysPerMonth;
    const monthlyCommission = dailyCommission * daysPerMonth;
    const monthlyNet = dailyNet * daysPerMonth;

    const weeklyBreakdown = [1, 2, 3, 4].map((week) => {
      const weekDays = Math.min(7, Math.max(0, daysPerMonth - (week - 1) * 7));
      const factor = weekDays / Math.max(daysPerMonth, 1);
      return {
        label: `Sem. ${week}`,
        net: Math.round(monthlyNet * factor),
        commission: Math.round(monthlyCommission * factor),
      };
    });

    return {
      dailyGross,
      dailyCommission,
      dailyNet,
      monthlyGross,
      monthlyCommission,
      monthlyNet,
      weeklyBreakdown,
    };
  }, [dailyOrders, avgBasketXof, daysPerMonth]);

  const maxWeekTotal = Math.max(
    ...metrics.weeklyBreakdown.map((w) => w.net + w.commission),
    1
  );

  return (
    <section className="bg-surface border border-line rounded-2xl p-6 md:p-8">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-6 border-b border-line">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-brand-green-text mb-1">
            <Calculator className="w-4 h-4" />
            <span>Simulateur de revenus commerçant</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-ink">
            Calculez vos gains avec MARCHÉ LIVE
          </h2>
          <p className="text-sm text-ink-secondary mt-1">
            Ajustez votre volume quotidien, panier moyen et jours d'activité. Commission fixe de 10 % sur les marchandises (hors livraison).
          </p>
        </div>
        <button
          onClick={onStartMerchant}
          className="px-5 py-3 bg-brand-orange hover:bg-brand-orange-hover text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Ouvrir ma boutique gratuitement
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-6">
        {/* Sliders */}
        <div className="lg:col-span-5 space-y-6">
          <div>
            <div className="flex items-center justify-between text-sm mb-2">
              <label htmlFor="sim-orders" className="font-medium text-ink-secondary">
                Commandes quotidiennes
              </label>
              <span className="font-mono font-semibold text-ink tabular-nums">
                {dailyOrders} / jour
              </span>
            </div>
            <input
              id="sim-orders"
              type="range"
              min={1}
              max={50}
              step={1}
              value={dailyOrders}
              onChange={(e) => setDailyOrders(Number(e.target.value))}
              className="w-full accent-brand-green cursor-pointer"
            />
            <div className="flex justify-between text-xs text-ink-muted mt-1 tabular-nums">
              <span>1 cmd</span>
              <span>25 cmds</span>
              <span>50 cmds</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-sm mb-2">
              <label htmlFor="sim-basket" className="font-medium text-ink-secondary">
                Panier moyen client
              </label>
              <span className="font-mono font-semibold text-ink tabular-nums">
                {avgBasketXof.toLocaleString('fr-FR')} FCFA
              </span>
            </div>
            <input
              id="sim-basket"
              type="range"
              min={1000}
              max={100000}
              step={500}
              value={avgBasketXof}
              onChange={(e) => setAvgBasketXof(Number(e.target.value))}
              className="w-full accent-brand-orange cursor-pointer"
            />
            <div className="flex justify-between text-xs text-ink-muted mt-1 tabular-nums">
              <span>1 000 FCFA</span>
              <span>50 000 FCFA</span>
              <span>100 000 FCFA</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-sm mb-2">
              <label htmlFor="sim-days" className="font-medium text-ink-secondary">
                Jours travaillés par mois
              </label>
              <span className="font-mono font-semibold text-ink tabular-nums">
                {daysPerMonth} jours
              </span>
            </div>
            <input
              id="sim-days"
              type="range"
              min={1}
              max={30}
              step={1}
              value={daysPerMonth}
              onChange={(e) => setDaysPerMonth(Number(e.target.value))}
              className="w-full accent-brand-green cursor-pointer"
            />
            <div className="flex justify-between text-xs text-ink-muted mt-1 tabular-nums">
              <span>1 jour</span>
              <span>15 jours</span>
              <span>30 jours</span>
            </div>
          </div>

          <div className="bg-surface-subtle rounded-xl p-4 border border-line flex items-center justify-between">
            <span className="text-sm text-ink-secondary">Commission plateforme MARCHÉ LIVE</span>
            <span className="font-mono font-bold text-ink tabular-nums">10 %</span>
          </div>
        </div>

        {/* Results & Chart */}
        <div className="lg:col-span-7 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-surface-subtle border border-line">
              <div className="text-xs text-ink-muted">Ventes potentielles par jour</div>
              <div className="text-xl font-bold text-ink font-mono tabular-nums mt-1">
                {metrics.dailyGross.toLocaleString('fr-FR')} FCFA
              </div>
              <div className="text-xs text-ink-muted mt-1 tabular-nums">
                Commission (10 %) : −{metrics.dailyCommission.toLocaleString('fr-FR')} FCFA
              </div>
            </div>

            <div className="p-4 rounded-xl bg-brand-green/5 dark:bg-brand-green/15 border border-brand-green/20 dark:border-brand-green/40">
              <div className="text-xs font-medium text-brand-green-text">Revenu journalier après commission</div>
              <div className="text-xl font-bold text-brand-green-text font-mono tabular-nums mt-1">
                {metrics.dailyNet.toLocaleString('fr-FR')} FCFA
              </div>
              <div className="text-xs text-ink-secondary mt-1">Versé après confirmation de livraison</div>
            </div>

            <div className="sm:col-span-2 p-5 rounded-xl bg-[#0F5132] dark:bg-[#14532D] text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="text-xs text-emerald-100 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-[#FACC15]" />
                  <span>Revenu mensuel estimé après commission ({daysPerMonth} jours)</span>
                </div>
                <div className="text-3xl font-extrabold font-mono tabular-nums mt-1">
                  {metrics.monthlyNet.toLocaleString('fr-FR')} FCFA
                </div>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-xs text-emerald-100">Chiffre d'affaires brut</div>
                <div className="text-sm font-mono font-semibold tabular-nums">
                  {metrics.monthlyGross.toLocaleString('fr-FR')} FCFA
                </div>
                <div className="text-xs text-[#FACC15] tabular-nums mt-0.5">
                  Commission totale : {metrics.monthlyCommission.toLocaleString('fr-FR')} FCFA
                </div>
              </div>
            </div>
          </div>

          {/* Weekly progression chart */}
          <div className="border border-line rounded-xl p-4 bg-surface-subtle/50">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <span className="text-xs font-semibold text-ink-secondary">
                Répartition hebdomadaire estimée (Net commerçant vs Commission 10 %)
              </span>
              <div className="flex items-center gap-4 text-xs text-ink-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-brand-green inline-block" />
                  Net commerçant
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-brand-orange inline-block" />
                  Commission 10 %
                </span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 items-end h-36 pt-2">
              {metrics.weeklyBreakdown.map((w) => {
                const netH = Math.round((w.net / maxWeekTotal) * 100);
                const commH = Math.max(4, Math.round((w.commission / maxWeekTotal) * 100));
                return (
                  <div key={w.label} className="flex flex-col items-center h-full justify-end">
                    <div className="text-[11px] font-mono text-ink-secondary tabular-nums mb-1">
                      {Math.round(w.net / 1000)}k
                    </div>
                    <div className="w-full max-w-[52px] flex flex-col justify-end h-24 rounded-t-md overflow-hidden bg-surface-muted">
                      <div
                        style={{ height: `${commH}%` }}
                        className="w-full bg-brand-orange transition-all duration-200"
                        title={`Commission : ${w.commission.toLocaleString('fr-FR')} FCFA`}
                      />
                      <div
                        style={{ height: `${netH}%` }}
                        className="w-full bg-brand-green transition-all duration-200"
                        title={`Net : ${w.net.toLocaleString('fr-FR')} FCFA`}
                      />
                    </div>
                    <div className="text-xs font-medium text-ink-secondary mt-2">{w.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-ink-muted flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 text-ink-muted mt-0.5" />
            <span>
              Mention obligatoire : simulation indicative, non garantie, avant coût d'achat des marchandises et autres charges.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
};
