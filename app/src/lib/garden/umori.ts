/** Gli umori della piazza (UMORI della lobby): solo questi arrivano agli
 *  altri. Uno sconosciuto si scarta, come per i gesti. */
export const GARDEN_UMORI = ['felice', 'curioso', 'assonnato', 'carico'] as const;
export type GardenUmore = (typeof GARDEN_UMORI)[number];

export function isGardenUmore(v: string): v is GardenUmore {
  return (GARDEN_UMORI as readonly string[]).includes(v);
}
