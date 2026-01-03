import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Copies to the clipboard and says so for a moment.
 *
 * Pasting the Markdown somewhere else is what most of it is generated for — a
 * release page, a channel, a ticket — so the button follows the text rather
 * than the page that happens to be showing it.
 */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A clipboard the browser refuses is not worth a banner: the Markdown is
      // on screen and selectable either way.
      setCopied(false);
    }
  }

  return (
    <button type="button" className="btn" onClick={() => void copy()}>
      {copied ? t('common.copied') : (label ?? t('common.copy'))}
    </button>
  );
}
