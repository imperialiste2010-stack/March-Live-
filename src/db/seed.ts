import { count } from 'drizzle-orm';
import { db } from './index.ts';
import { markets, productCategories } from './schema.ts';

const IVORIAN_MARKETS = [
  // Abidjan (10 marchés principaux)
  {
    name: 'Marché de Cocody (Saint-Jean)',
    city: 'Abidjan',
    commune: 'Cocody',
    address: 'Boulevard de France, Cocody, Abidjan',
    lat: 5.3484,
    lng: -3.9985,
    description: 'Produits frais, poissons, fruits tropicaux et vivriers sélectionnés.',
  },
  {
    name: "Marché d'Angré",
    city: 'Abidjan',
    commune: 'Cocody',
    address: 'Angré 8ème Tranche, Cocody, Abidjan',
    lat: 5.3941,
    lng: -3.9889,
    description: 'Marché de proximité moderne d’Angré : légumes, volailles et épices.',
  },
  {
    name: 'Marché Gouro (Adjamé)',
    city: 'Abidjan',
    commune: 'Adjamé',
    address: 'Boulevard Nangui Abrogoua, Adjamé, Abidjan',
    lat: 5.3516,
    lng: -4.0226,
    description: 'Grand marché vivrier d’Abidjan : manioc, banane plantain, piments et légumes.',
  },
  {
    name: "Marché d'Adjamé (Forum)",
    city: 'Abidjan',
    commune: 'Adjamé',
    address: 'Rond-point d’Adjamé, Abidjan',
    lat: 5.3558,
    lng: -4.0209,
    description: 'Céréales, condiments, huiles, épices et denrées en gros et détail.',
  },
  {
    name: 'Grand Marché de Marcory',
    city: 'Abidjan',
    commune: 'Marcory',
    address: 'Rue du Commerce, Marcory, Abidjan',
    lat: 5.3027,
    lng: -3.9862,
    description: 'Viandes fraîches, poissons fumés, volailles et produits vivriers.',
  },
  {
    name: 'Grand Marché de Treichville',
    city: 'Abidjan',
    commune: 'Treichville',
    address: 'Avenue 16, Treichville, Abidjan',
    lat: 5.2981,
    lng: -4.0054,
    description: 'Marché historique : poissons de mer, crustacés, épices et produits alimentaires.',
  },
  {
    name: "Grand Marché d'Abobo",
    city: 'Abidjan',
    commune: 'Abobo',
    address: 'Abobo Gare, Abidjan',
    lat: 5.4161,
    lng: -4.0159,
    description: 'Vaste choix de vivriers, ignames, céréales, viandes et condiments.',
  },
  {
    name: 'Marché de Yopougon (Sicogi / Wassakara)',
    city: 'Abidjan',
    commune: 'Yopougon',
    address: 'Yopougon Sicogi, Abidjan',
    lat: 5.3446,
    lng: -4.0725,
    description: 'Poissons, attiéké frais, légumes et volailles de Yopougon.',
  },
  {
    name: 'Grand Marché de Koumassi',
    city: 'Abidjan',
    commune: 'Koumassi',
    address: 'Boulevard du 7 Décembre, Koumassi, Abidjan',
    lat: 5.2945,
    lng: -3.9562,
    description: 'Produits frais, fruits de saison, poissons et condiments.',
  },
  {
    name: "Marché d'Attécoubé",
    city: 'Abidjan',
    commune: 'Attécoubé',
    address: 'Centre d’Attécoubé, Abidjan',
    lat: 5.3358,
    lng: -4.0398,
    description: 'Marché lagunaire réputé pour le poisson frais et les vivriers.',
  },
  // Villes de l'intérieur
  {
    name: 'Grand Marché de Bouaké',
    city: 'Bouaké',
    commune: 'Bouaké Centre',
    address: 'Centre-ville, Bouaké',
    lat: 7.6906,
    lng: -5.0303,
    description: 'Carrefour agricole du Centre : ignames, anacardes, céréales et légumes.',
  },
  {
    name: 'Grand Marché de Yamoussoukro',
    city: 'Yamoussoukro',
    commune: 'Yamoussoukro',
    address: 'Quartier Commerce, Yamoussoukro',
    lat: 6.8206,
    lng: -5.2767,
    description: 'Produits vivriers, fruits, volailles et épices de la capitale.',
  },
  {
    name: 'Grand Marché de Daloa',
    city: 'Daloa',
    commune: 'Daloa',
    address: 'Centre Commerce, Daloa',
    lat: 6.8774,
    lng: -6.4502,
    description: 'Bananes, manioc, riz local et produits du Haut-Sassandra.',
  },
  {
    name: 'Marché de San Pedro (Bardot)',
    city: 'San Pedro',
    commune: 'San Pedro',
    address: 'Quartier Bardot, San Pedro',
    lat: 4.7485,
    lng: -6.6363,
    description: 'Poissons de mer débarqués du jour, fruits et vivriers du Sud-Ouest.',
  },
  {
    name: 'Grand Marché de Korhogo',
    city: 'Korhogo',
    commune: 'Korhogo',
    address: 'Centre-ville, Korhogo',
    lat: 9.458,
    lng: -5.6296,
    description: 'Mangues du Nord, beurre de karité, céréales, viandes et épices.',
  },
  {
    name: 'Grand Marché de Man',
    city: 'Man',
    commune: 'Man',
    address: 'Centre Commerce, Man',
    lat: 7.4125,
    lng: -7.5538,
    description: 'Riz de montagne, café, avocats et légumes frais du Tonkpi.',
  },
  {
    name: 'Grand Marché de Gagnoa',
    city: 'Gagnoa',
    commune: 'Gagnoa',
    address: 'Dioulabougou, Gagnoa',
    lat: 6.1319,
    lng: -5.9506,
    description: 'Vivriers, bananes plantains, condiments et viandes du Gôh.',
  },
  {
    name: "Grand Marché d'Abengourou",
    city: 'Abengourou',
    commune: 'Abengourou',
    address: 'Centre Commerce, Abengourou',
    lat: 6.7297,
    lng: -3.4964,
    description: 'Ignames, tarots, légumes et spécialités de l’Indénié-Djuablin.',
  },
];

const CATEGORIES = [
  { slug: 'poissons', nameFr: 'Poissons', nameNouchi: 'Djo / Machoiron & Carpe', sortOrder: 1 },
  { slug: 'viandes', nameFr: 'Viandes', nameNouchi: 'Viande fraîche', sortOrder: 2 },
  { slug: 'volailles', nameFr: 'Volailles', nameNouchi: 'Poulet bicyclette & chair', sortOrder: 3 },
  { slug: 'legumes', nameFr: 'Légumes', nameNouchi: 'Légumes du champ', sortOrder: 4 },
  { slug: 'fruits', nameFr: 'Fruits', nameNouchi: 'Fruits doux', sortOrder: 5 },
  { slug: 'condiments', nameFr: 'Condiments', nameNouchi: 'Gombo, piment, oignon', sortOrder: 6 },
  { slug: 'cereales', nameFr: 'Céréales', nameNouchi: 'Riz, maïs, mil', sortOrder: 7 },
  { slug: 'epices', nameFr: 'Épices', nameNouchi: 'Épices & soumara', sortOrder: 8 },
  { slug: 'alimentaires', nameFr: 'Produits alimentaires', nameNouchi: 'Attiéké, huile, vivriers', sortOrder: 9 },
];

let seeded = false;

export async function ensureReferenceDataSeeded() {
  if (seeded) return;
  try {
    const [{ value: marketCount }] = await db.select({ value: count() }).from(markets);
    if (Number(marketCount) === 0) {
      await db.insert(markets).values(IVORIAN_MARKETS);
    }

    const [{ value: catCount }] = await db.select({ value: count() }).from(productCategories);
    if (Number(catCount) === 0) {
      await db.insert(productCategories).values(CATEGORIES).onConflictDoNothing();
    }

    seeded = true;
  } catch (error) {
    console.error('Reference seeding failed:', error);
  }
}
