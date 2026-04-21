import type { ReactNode, CSSProperties } from 'react';

import { splitTitleKicker } from '@/lib/utils/title-kicker';

interface EventTitleProps {
  title: string;
  kickerEnabled: boolean;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p';
  className?: string;
  style?: CSSProperties;
  wrapMain?: (main: string) => ReactNode;
}

export default function EventTitle({
  title,
  kickerEnabled,
  as: Tag = 'h3',
  className,
  style,
  wrapMain,
}: EventTitleProps) {
  const { kicker, main } = splitTitleKicker(title, kickerEnabled);
  const mainNode = wrapMain ? wrapMain(main) : main;

  if (!kicker) {
    return (
      <Tag className={className} style={style}>
        {mainNode}
      </Tag>
    );
  }

  return (
    <Tag className={className} style={style}>
      <span className="event-title-kicker">{kicker}</span>
      <span className="event-title-main">{mainNode}</span>
    </Tag>
  );
}
