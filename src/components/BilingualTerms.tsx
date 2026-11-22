import { t } from '../i18n';

/** A term written in Thai and English; documents print the one for their language. */
export function BilingualTermField({
  label,
  thai,
  english,
  onThai,
  onEnglish,
}: {
  label: string;
  thai: string;
  english: string;
  onThai: (value: string) => void;
  onEnglish: (value: string) => void;
}) {
  return (
    <fieldset className="bilingual-term">
      <legend>{t(label)}</legend>
      <label>
        <span>ไทย</span>
        <textarea rows={3} value={thai} onChange={(e) => onThai(e.target.value)} />
      </label>
      <label>
        <span>English</span>
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
