import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { customerProfiles, users } from './schema.ts';

export async function getOrCreateUser(uid: string, email: string, fullName?: string) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        fullName: fullName || email.split('@')[0],
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          updatedAt: new Date(),
        },
      })
      .returning();

    const user = result[0];

    await db
      .insert(customerProfiles)
      .values({
        userId: user.id,
        city: 'Abidjan',
        commune: 'Cocody',
        preferredCurrency: 'XOF',
      })
      .onConflictDoNothing({ target: customerProfiles.userId });

    return user;
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Impossible de synchroniser le profil utilisateur.', { cause: error });
  }
}

export async function getUserByUid(uid: string) {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] || null;
  } catch (error) {
    console.error('Database query failed in getUserByUid:', error);
    throw new Error('Impossible de charger le compte utilisateur.', { cause: error });
  }
}
