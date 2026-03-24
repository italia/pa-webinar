'use client';

import { useState, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dropdown,
  DropdownToggle,
  DropdownMenu,
  Icon,
  LinkList,
  LinkListItem,
} from 'design-react-kit';

import {
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
  generateYahooCalendarUrl,
  generateIcsDownloadUrl,
} from '@/lib/ical/calendar-links';

interface AddToCalendarProps {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  slug: string;
}

export default function AddToCalendar({
  title,
  description,
  startsAt,
  endsAt,
  slug,
}: AddToCalendarProps) {
  const t = useTranslations('events.detail.calendar');
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost:3000';

  const input = {
    title,
    description: description.slice(0, 300),
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    joinUrl: `${baseUrl}/it/eventi/${slug}`,
  };

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  return (
    <Dropdown isOpen={open} toggle={toggle} className="w-100 mt-3">
      <DropdownToggle
        color="outline-primary"
        className="w-100 d-flex align-items-center justify-content-center"
        innerRef={toggleRef}
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
