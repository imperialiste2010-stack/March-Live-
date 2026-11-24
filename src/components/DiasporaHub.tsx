import React, { useEffect, useState } from 'react';
import { Globe2, HeartHandshake, MapPin, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiUrl } from '../lib/api.ts';
import { FxRates } from '../types.ts';

interface DiasporaHubProps {
  onActivateDiasporaOrder: (config: {
    enabled: boolean;
    beneficiaryName: string;
    beneficiaryPhone: string;
    city: string;
    commune: string;
    quartier: string;
    address: string;
    message: string;
    currency: string;
    fxRate: number;
  }) => void;
}

export const DiasporaHub: React.FC<DiasporaHubProps> = ({ onActivateDiasporaOrder }) => {
  const { dbUser, customerProfile, signIn, apiFetch, refreshProfile } = useAuth();
  const [fx, setFx] = useState<FxRates | null>(null);
  const [fxError, setFxError] = useState<string | null>(null);
  const [currency, setCurrency] = useState(customerProfile?.preferredCurrency || 'EUR');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [beneficiaryPhone, setBeneficiaryPhone] = useState('');
  const [city, setCity] = useState('Abidjan');
  const [commune, setCommune] = useState('Cocody');
  const [quartier, setQuartier] = useState('');
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState('');
  const [diasporaCountry, setDiasporaCountry] = useState(
    customerProfile?.diasporaCountry || 'France'
  );
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);

  const loadFx = async () => {
    setFxError(null);
    try {
      const res = await fetch(apiUrl('/api/fx-rates'));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Taux indisponibles');
      setFx(data);
    } catch (err: unknown) {
      setFxError(
        err instanceof Error
          ? err.message
          : 'Impossible de récupérer les taux de change en direct.'
      );
    }
  };

  useEffect(() => {
    loadFx();
  }, []);

  const currentRate = fx?.rates?.[currency] ?? 1;
  const sampleXof = 25000;
  const convertedSample =
    currency === 'XOF' || !fx?.rates?.[currency]
      ? `${sampleXof.toLocaleString('fr-FR')} FCFA`
      : `${(sampleXof * currentRate).toFixed(2)} ${currency}`;

  const handleSaveAndShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUser) {
      await signIn();
      return;
    }
    setSaving(true);
    setSavedFeedback(null);
    try {
      const existingAddresses = customerProfile?.savedAddresses || [];
      const newAddr = {
        id: `diaspora_${Date.now()}`,
        label: `Famille — ${beneficiaryName}`,
        city,
        commune,
        quartier,
        recipientName: beneficiaryName,
        recipientPhone: beneficiaryPhone,
      };
      await apiFetch('/api/me/profile', {
        method: 'PUT',
        body: JSON.stringify({
          city,
          commune,
          quartier,
          addressLabel: address,
          isDiaspora: true,
          diasporaCountry,
          preferredCurrency: currency,
          savedAddresses: [newAddr, ...existingAddresses.slice(0, 4)],
        }),
      });
      await refreshProfile();
      setSavedFeedback('Bénéficiaire enregistré. Sélectionnez maintenant votre marché ou LIVE.');
      onActivateDiasporaOrder({
        enabled: true,
        beneficiaryName,
        beneficiaryPhone,
        city,
        commune,
        quartier,
        address,
        message,
        currency,
        fxRate: currentRate,
      });
    } catch (err: unknown) {
      setSavedFeedback(err instanceof Error ? err.message : 'Erreur d’enregistrement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Diaspora Hero */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch bg-surface border border-line rounded-2xl overflow-hidden">
        <div className="lg:col-span-6 p-6 md:p-8 flex flex-col justify-between space-y-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-brand-green-text mb-2">
              <Globe2 className="w-4 h-4" />
              <span>Espace Diaspora · Acheter pour ma famille</span>
            </div>
            <h1 className="text-3xl font-extrabold text-ink leading-tight">
              Faites le marché en direct pour vos proches en Côte d'Ivoire
            </h1>
            <p className="text-sm text-ink-secondary mt-3 leading-relaxed">
              Choisissez un marché ivoirien, échangez en vidéo LIVE avec le commerçant, payez depuis l'étranger et suivez la livraison jusqu'à la porte de votre famille.
            </p>
          </div>

          <div className="bg-surface-subtle border border-line rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-secondary">
                Devise d'affichage & conversion en direct
              </span>
              <button
                type="button"
                onClick={loadFx}
                className="text-xs text-brand-green-text hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Actualiser</span>
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="px-3 py-2 text-sm font-semibold border border-line rounded-lg bg-surface text-ink"
              >
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
                <option value="CAD">CAD ($ CA)</option>
                <option value="GBP">GBP (£)</option>
                <option value="XOF">FCFA (XOF)</option>
              </select>
              <div className="text-xs text-ink-secondary font-mono tabular-nums">
                Exemple : 25 000 FCFA ≈ <strong className="text-ink">{convertedSample}</strong>
              </div>
            </div>
            {fx?.source && (
              <div className="text-[11px] text-ink-muted">Source fiable : {fx.source}</div>
            )}
            {fxError && <div className="text-xs text-amber-700 dark:text-amber-300">{fxError}</div>}
          </div>
        </div>

        <div className="lg:col-span-6 relative min-h-[260px] bg-surface-muted">
          <img
            src="/src/assets/images/diaspora_family_table_1795179890208.jpg"
            alt="Famille à Abidjan recevant ses courses du marché"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {/* Beneficiary Form */}
      <form
        onSubmit={handleSaveAndShop}
        className="bg-surface border border-line rounded-2xl p-6 md:p-8 space-y-5"
      >
        <div className="flex items-center gap-2">
          <HeartHandshake className="w-5 h-5 text-brand-orange-text" />
          <h2 className="text-xl font-bold text-ink">
            Ajouter un bénéficiaire et son adresse en Côte d'Ivoire
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Nom complet du bénéficiaire
            </label>
            <input
              required
              type="text"
              value={beneficiaryName}
              onChange={(e) => setBeneficiaryName(e.target.value)}
              placeholder="Ex: Mme Koné Aminata"
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Téléphone en Côte d'Ivoire
            </label>
            <input
              required
              type="tel"
              value={beneficiaryPhone}
              onChange={(e) => setBeneficiaryPhone(e.target.value)}
              placeholder="+225 07 XX XX XX XX"
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Pays de résidence (commanditaire)
            </label>
            <input
              type="text"
              value={diasporaCountry}
              onChange={(e) => setDiasporaCountry(e.target.value)}
              placeholder="France, Canada, USA..."
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">Ville</label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink"
            >
              <option value="Abidjan">Abidjan</option>
              <option value="Bouaké">Bouaké</option>
              <option value="Yamoussoukro">Yamoussoukro</option>
              <option value="Daloa">Daloa</option>
              <option value="San Pedro">San Pedro</option>
              <option value="Korhogo">Korhogo</option>
              <option value="Man">Man</option>
              <option value="Gagnoa">Gagnoa</option>
              <option value="Abengourou">Abengourou</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">Commune</label>
            <input
              required
              type="text"
              value={commune}
              onChange={(e) => setCommune(e.target.value)}
              placeholder="Cocody, Yopougon, Marcory..."
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">Quartier</label>
            <input
              required
              type="text"
              value={quartier}
              onChange={(e) => setQuartier(e.target.value)}
              placeholder="Angré, Riviera 2, Niangon..."
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">
              Repère / Rue / Résidence
            </label>
            <input
              required
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Près de la pharmacie..."
              className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink-secondary mb-1">
            Message personnalisé pour votre famille (inclus avec la livraison)
          </label>
          <textarea
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Bon week-end maman, voici les courses fraîches du marché !"
            className="w-full px-3.5 py-2.5 text-sm border border-line rounded-xl bg-surface-subtle text-ink placeholder:text-ink-muted"
          />
        </div>

        {savedFeedback && (
          <div className="text-sm text-brand-green-text font-medium">{savedFeedback}</div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div className="text-xs text-ink-muted flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-brand-green-text" />
            <span>Vous recevrez une notification dès la remise en main propre.</span>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 bg-brand-orange hover:bg-brand-orange-hover text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Choisir un marché et démarrer les achats'}
          </button>
        </div>
      </form>
    </div>
  );
};
