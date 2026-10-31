'use client';

import { useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { useCopia } from '@/hooks/use-copia';

interface CopyButtonProps {
  text: string;
  /** Il testo del pulsante al posto di «Copia link» (es. quale link). */
  label?: string;
  /** Il nome per chi usa un lettore di schermo, quando in pagina ci sono
   *  piu' pulsanti di copia: deve contenere il testo visibile. */
  accessibleName?: string;
}

export default function CopyButton({ text, label, accessibleName }: CopyButtonProps) {
  const t = useTranslations('admin.links');
  const { esito, copia } = useCopia();
  const handleCopy = () => void copia(text);

  return (
    <>
    <Button
      color={esito === 'copiato' ? 'success' : esito === 'fallito' ? 'danger' : 'primary'}
      outline
      size="sm"
      onClick={handleCopy}
      aria-label={accessibleName ?? label ?? t('copyLink')}
    >
      <Icon icon={esito === 'copiato' ? 'it-check' : esito === 'fallito' ? 'it-error' : 'it-copy'} size="sm" className="me-1" />
      {esito === 'copiato' ? t('copied') : esito === 'fallito' ? t('copyFailedShort') : (label ?? t('copyLink'))}
    </Button>
    <span className="visually-hidden" role="status">
      {esito === 'copiato' ? t('copied') : esito === 'fallito' ? t('copyFailedShort') : ''}
    </span>
    </>
  );
}
