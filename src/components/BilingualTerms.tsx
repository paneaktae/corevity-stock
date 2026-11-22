import { t } from '../i18n';

/** A term written in Thai and English; documents print the one for their language. */
export function BilingualTermField({
  label,
  thai,
  english,
  onThai,
  onEnglish,
  onTranslate,
  translating = false,
}: {
  label: string;
  thai: string;
  english: string;
  onThai: (value: string) => void;
  onEnglish: (value: string) => void;
  /** When given, shows a button that fills English from the Thai text. */
  onTranslate?: () => void;
  translating?: boolean;
}) {
  return (
    <fieldset className="bilingual-term">
      <legend>{t(label)}</legend>
      <label>
        <span>ไทย</span>
        <textarea rows={3} value={thai} onChange={(e) => onThai(e.target.value)} />
      </label>
      <label>
        <span className="bilingual-term-head">
          English
          {onTranslate || translating ? (
            <button
              type="button"
              className="link-button"
              disabled={translating || !onTranslate || !thai.trim()}
              onClick={(e) => {
                e.preventDefault();
                onTranslate?.();
              }}
            >
              {translating ? t('Translating…') : t('Translate from Thai')}
            </button>
          ) : null}
        </span>
        <textarea rows={3} value={english} onChange={(e) => onEnglish(e.target.value)} />
      </label>
    </fieldset>
  );
}

/** Shows both language versions of a saved term. */
export function BilingualTermText({
  label,
  thai,
  english,
}: {
  label: string;
  thai: string;
  english: string;
}) {
  if (!thai.trim() && !english.trim()) return null;
  return (
    <div className="quotation-detail-term">
      <strong>{t(label)}</strong>
      {thai.trim() ? <p><span className="term-language">TH</span>{thai}</p> : null}
      {english.trim() ? <p><span className="term-language">EN</span>{english}</p> : null}
    </div>
  );
}
