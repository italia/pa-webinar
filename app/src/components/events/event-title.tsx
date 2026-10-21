import type { ReactNode, CSSProperties } from 'react';

import { splitTitleKicker } from '@/lib/utils/title-kicker';

interface EventTitleProps {
  title: string;
  kickerEnabled: boolean;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p';
  className?: string;
  style?: CSSProperties;
  wrapMain?: (main: string) => ReactNode;
  /** La lingua del titolo, se non e' quella della pagina. */
  lang?: string;
}

export default function EventTitle({
  title,
  kickerEnabled,
  as: Tag = 'h3',
  className,
  style,
  wrapMain,
  lang,
}: EventTitleProps) {
  const { kicker, main } = splitTitleKicker(title, kickerEnabled);
  const mainNode = wrapMain ? wrapMain(main) : main;

  if (!kicker) {
    return (
      <Tag className={className} style={style} lang={lang}>
        {mainNode}
      </Tag>
    );
  }

  return (
    <Tag className={className} style={style} lang={lang}>
      <span className="event-title-kicker">{kicker}</span>
      <span className="event-title-main">{mainNode}</span>
    </Tag>
  );
}
