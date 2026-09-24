'use client';

import { useState, useCallback, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Dropdown,
  DropdownToggle,
  DropdownMenu,
  LinkList,
  LinkListItem,
} from 'design-react-kit';

import {
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
  generateYahooCalendarUrl,
  generateIcsDownloadUrl,
} from '@/lib/ical/calendar-links';

import { Icon } from '@/components/ui/icon';
import { localizedPath } from '@/lib/utils/localized-url';

interface AddToCalendarProps {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  slug: string;
  appUrl: string;
}

export default function AddToCalendar({
  title,
  description,
  startsAt,
  endsAt,
  slug,
  appUrl,
}: AddToCalendarProps) {
  const t = useTranslations('events.detail.calendar');
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  // Dal server, non da `window`: il markup resta identico fra server e
  // browser, e i link finiscono nel calendario con l'indirizzo pubblico.
  // Solo se l'indirizzo pubblico non e' configurato si ripiega, dopo il
  // montaggio, sull'origine della pagina.
  const [baseUrl, setBaseUrl] = useState(appUrl);
  useEffect(() => {
    if (!appUrl) setBaseUrl(window.location.origin);
  }, [appUrl]);

  const input = {
    title,
    description: description.slice(0, 300),
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    // Nella lingua di chi aggiunge l'evento: e' la pagina che aprira'
    // dal proprio calendario.
    joinUrl: `${baseUrl}${localizedPath(`/events/${slug}`, locale)}`,
  };

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  return (
    <Dropdown isOpen={open} toggle={toggle} className="w-100 mt-3">
      <DropdownToggle
        color="outline-primary"
        className="w-100 d-flex align-items-center justify-content-center"
        caret
      >
        <Icon icon="it-calendar" size="sm" className="me-2" />
        {t('addToCalendar')}
      </DropdownToggle>
      <DropdownMenu className="w-100">
        <LinkList>
          <LinkListItem
            tag="a"
            href={generateGoogleCalendarUrl(input)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="me-2">📅</span>
            {t('google')}
          </LinkListItem>
          <LinkListItem
            tag="a"
            href={generateOutlookCalendarUrl(input)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="me-2">📅</span>
            {t('outlook')}
          </LinkListItem>
          <LinkListItem
            tag="a"
            href={generateYahooCalendarUrl(input)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="me-2">📅</span>
            {t('yahoo')}
          </LinkListItem>
          <LinkListItem divider />
          <LinkListItem
            tag="a"
            href={generateIcsDownloadUrl(slug, baseUrl)}
            download
          >
            <span className="me-2">⬇️</span>
            {t('downloadIcs')}
          </LinkListItem>
        </LinkList>
      </DropdownMenu>
    </Dropdown>
  );
}
