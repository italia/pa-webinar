/** I gesti della piazza (EMOTE_TYPES della lobby): solo questi arrivano agli
 *  altri, quello che il server ripete è quello che loro mostrano. */
export const GARDEN_EMOTE_TYPES = ['wave', 'heart', 'clap', 'laugh', 'idea', 'caffe'] as const;
export type GardenEmoteType = (typeof GARDEN_EMOTE_TYPES)[number];

export function isGardenEmote(tipo: string): tipo is GardenEmoteType {
  return (GARDEN_EMOTE_TYPES as readonly string[]).includes(tipo);
}
