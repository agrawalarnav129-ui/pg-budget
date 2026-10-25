import { useMemo, useState } from 'react';
import { Button, Card, Field, Segmented, Sheet, cx, inputClass } from '../components/ui';
import { CATEGORIES, INCOME_SOURCES } from '../domain/categories';
import type { ColumnMapping, IncomeSource } from '../domain/types';
import { importCandidates, rememberRule, updateSettings } from '../db/actions';
import type { AppData } from '../db/hooks';
import {
  guessMapping,
  headerSignature,
  normaliseRows,
  parseCsv,
  prepareCandidates,
  type ImportCandidate,
  type NormalisedRow,
  type ParsedCsv,
} from '../import/csv';
import { PdfPasswordError, parsePdfStatement, type PdfParseResult } from '../import/pdf';
import { formatShortDate } from '../lib/dates';
import { rupees } from '../lib/money';

type Step = 'pick' | 'password' | 'pdfCheck' | 'map' | 'review' | 'done';

export default function Import({ data, onClose }: { data: AppData; onClose: () => void }) {
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pdf, setPdf] = useState<PdfParseResult | null>(null);
  const [password, setPassword] = useState('');
  const [positiveIsDebit, setPositiveIsDebit] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [imported, setImported] = useState(0);
  const [busy, setBusy] = useState(false);

  const readPdf = async (buffer: ArrayBuffer, opts: { password?: string; dateFormat?: 'DMY' | 'MDY'; positiveIsDebit?: boolean } = {}) => {
    try {
      const result = await parsePdfStatement(buffer, opts);
      if (!result.rows.length) {
        setError(
          "Couldn't find any transactions in this PDF. If it's a scanned copy rather than one downloaded from your bank, the text can't be read.",
        );
        return;
      }
      setPdf(result);
      setPassword(opts.password ?? '');
      setStep('pdfCheck');
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        setError(e.wrongPassword ? 'That password didn\u2019t work. Try again.' : '');
        setStep('password');
        return;
      }
      setError("Couldn't read this PDF. Try downloading the statement again from your bank.");
    }
  };

  const onFile = async (file: File) => {
    setError('');
    if (/\.xlsx?$/i.test(file.name)) {
      setError('Excel files need converting first: open it in Numbers and choose File → Export To → CSV. Or download the statement as PDF instead.');
      return;
    }
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const buffer = await file.arrayBuffer();
      setPdfData(buffer);
      await readPdf(buffer);
      return;
    }
    const text = await file.text();
    const p = parseCsv(text);
    if (!p.headers.length || !p.rows.length) {
      setError("Couldn't find a table with dates and amounts in this file.");
      return;
    }
    setParsed(p);
    setMapping(data.settings.importMappings[headerSignature(p.headers)] ?? guessMapping(p.headers));
    setStep('map');
  };

  const preview = useMemo(() => (parsed && mapping ? normaliseRows(parsed.rows, mapping) : null), [parsed, mapping]);

  const toReview = (rows: NormalisedRow[]) => {
    const existing = new Set(data.txns.map((t) => t.importHash).filter((h): h is string => Boolean(h)));
    setCandidates(prepareCandidates(rows, existing, data.rules, data.fixedCosts));
    setStep('review');
  };

  const csvToReview = async () => {
    if (!parsed || !mapping || !preview) return;
    await updateSettings({ importMappings: { ...data.settings.importMappings, [headerSignature(parsed.headers)]: mapping } });
    toReview(preview.rows);
  };

  const commit = async () => {
    setBusy(true);
    try {
      setImported(await importCandidates(candidates));
      setStep('done');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Import statement" full>
      {step === 'pick' && (
        <div className="space-y-4">
          <Card className="space-y-2 text-[14px] text-ink-2">
            <p className="text-[15px] font-semibold text-ink">Where to get the file</p>
            <p>
              <b>Bank:</b> in net banking or your bank app, open <b>Account statement</b>, pick the dates and download the{' '}
              <b>PDF</b> or <b>CSV</b>. Password-protected PDFs are fine, you'll be asked for the password.
            </p>
            <p>
              <b>UPI apps:</b> GPay, PhonePe and Paytm each have a statement or passbook download in their settings. Import those the
              same way to get everything in one place.
            </p>
            <p className="text-ink-3">The file is read on your phone and never uploaded anywhere.</p>
          </Card>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line bg-card text-center">
            <span className="text-3xl" aria-hidden>
              📄
            </span>
            <span className="mt-1 text-[15px] font-semibold text-accent">Choose PDF or CSV file</span>
            <span className="mt-0.5 text-[12px] text-ink-3">Bank statement or UPI app statement</span>
            <input
              type="file"
              accept=".pdf,application/pdf,.csv,text/csv,text/comma-separated-values,application/vnd.ms-excel"
              className="sr-only"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
          {error && <p className="px-1 text-[14px] font-medium text-critical">{error}</p>}
        </div>
      )}

      {step === 'password' && (
        <div className="space-y-4">
          <Card className="space-y-2 text-[14px] text-ink-2">
            <p className="text-[15px] font-semibold text-ink">This statement is locked</p>
            <p>
              Banks usually set the password to something like your PAN in lower case, your date of birth as DDMMYYYY, or the two
              joined together. The exact rule is in the email the statement came with.
            </p>
            <p className="text-ink-3">The password is used on this phone only to open the file, and is never saved.</p>
          </Card>
          <Field label="Statement password">
            <input
              type="password"
              className={inputClass}
              value={password}
              autoFocus
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password && pdfData) readPdf(pdfData, { password });
              }}
            />
          </Field>
          {error && <p className="px-1 text-[14px] font-medium text-critical">{error}</p>}
          <Button className="w-full" disabled={!password || !pdfData} onClick={() => pdfData && readPdf(pdfData, { password })}>
            Unlock statement
          </Button>
        </div>
      )}

      {step === 'pdfCheck' && pdf && (
        <div className="space-y-4">
          <Card className="space-y-1 text-[14px] text-ink-2">
            <p className="text-[15px] font-semibold text-ink">Found {pdf.rows.length} transactions</p>
            <p>Check a few look right below, then continue to pick categories.</p>
          </Card>

          <Card className="p-0">
            <p className="px-4 pt-3 text-[13px] font-semibold text-ink-3">PREVIEW</p>
            {pdf.rows.slice(0, 5).map((r) => (
              <div key={r.hash} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
                <span className="w-14 shrink-0 text-[13px] text-ink-3">{formatShortDate(r.date)}</span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{r.description || '—'}</span>
                <span className={cx('tabular text-[14px] font-semibold', r.direction === 'credit' && 'text-good-ink')}>
                  {r.direction === 'credit' ? '+' : '−'}
                  {rupees(r.amount)}
                </span>
              </div>
            ))}
          </Card>

          <Field label="Dates read as" hint="Change this if the days and months look swapped above.">
            <Segmented
              value={pdf.dateFormat}
              onChange={(dateFormat) => pdfData && readPdf(pdfData, { password, dateFormat, positiveIsDebit })}
              options={[
                { value: 'DMY' as const, label: 'DD/MM/YY' },
                { value: 'MDY' as const, label: 'MM/DD/YY' },
              ]}
            />
          </Field>

          {pdf.directionAmbiguous && (
            <Card className="space-y-2">
              <p className="text-[14px] text-ink-2">
                This statement doesn't show a running balance, so money in and money out look the same. Which is it?
              </p>
              <Segmented
                value={positiveIsDebit ? 'spent' : 'received'}
                onChange={(v) => {
                  const next = v === 'spent';
                  setPositiveIsDebit(next);
                  if (pdfData) readPdf(pdfData, { password, dateFormat: pdf.dateFormat, positiveIsDebit: next });
                }}
                options={[
                  { value: 'spent' as const, label: 'Money spent' },
                  { value: 'received' as const, label: 'Money received' },
                ]}
              />
            </Card>
          )}

          {pdf.errors.length > 0 && (
            <p className="px-1 text-[13px] text-ink-3">{pdf.errors.length} lines skipped because they had no amount.</p>
          )}

          <Button className="w-full" onClick={() => toReview(pdf.rows)}>
            Continue with {pdf.rows.length} {pdf.rows.length === 1 ? 'transaction' : 'transactions'}
          </Button>
        </div>
      )}

      {step === 'map' && parsed && mapping && preview && (
        <div className="space-y-4">
          <p className="px-1 text-[14px] text-ink-2">
            Found {parsed.rows.length} rows. Check the columns are right and the preview looks correct.
          </p>
          <Card className="space-y-3">
            <ColumnSelect label="Date" headers={parsed.headers} value={mapping.date} onChange={(v) => setMapping({ ...mapping, date: v! })} />
            <Field label="Date format">
              <Segmented
                value={mapping.dateFormat}
                onChange={(v) => setMapping({ ...mapping, dateFormat: v })}
                options={[
                  { value: 'DMY', label: 'DD/MM/YY' },
                  { value: 'MDY', label: 'MM/DD/YY' },
                  { value: 'YMD', label: 'YYYY-MM-DD' },
                ]}
              />
            </Field>
            <ColumnSelect
              label="Description / narration"
              headers={parsed.headers}
              value={mapping.description}
              onChange={(v) => setMapping({ ...mapping, description: v! })}
            />
            <Field label="Amounts are in">
              <Segmented
                value={mapping.amount ? 'single' : 'split'}
                onChange={(v) => {
                  const g = guessMapping(parsed.headers);
                  setMapping(
                    v === 'single'
                      ? { ...mapping, amount: g.amount ?? parsed.headers[2], debit: undefined, credit: undefined }
                      : { ...mapping, amount: undefined, type: undefined, debit: g.debit ?? parsed.headers[2], credit: g.credit ?? parsed.headers[3] },
                  );
                }}
                options={[
                  { value: 'split', label: 'Debit + Credit columns' },
                  { value: 'single', label: 'One amount column' },
                ]}
              />
            </Field>
            {mapping.amount ? (
              <>
                <ColumnSelect label="Amount" headers={parsed.headers} value={mapping.amount} onChange={(v) => setMapping({ ...mapping, amount: v })} />
                <ColumnSelect
                  label="Dr / Cr column (optional)"
                  headers={parsed.headers}
                  value={mapping.type}
                  optional
                  onChange={(v) => setMapping({ ...mapping, type: v })}
                />
                {!mapping.type && (
                  <label className="flex items-center gap-2 px-1 text-[14px]">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[var(--accent)]"
                      checked={mapping.positiveIsDebit !== false}
                      onChange={(e) => setMapping({ ...mapping, positiveIsDebit: e.target.checked })}
                    />
                    Positive amounts are money spent
                  </label>
                )}
              </>
            ) : (
              <>
                <ColumnSelect
                  label="Withdrawal / debit"
                  headers={parsed.headers}
                  value={mapping.debit}
                  onChange={(v) => setMapping({ ...mapping, debit: v })}
                />
                <ColumnSelect
                  label="Deposit / credit"
                  headers={parsed.headers}
                  value={mapping.credit}
                  onChange={(v) => setMapping({ ...mapping, credit: v })}
                />
              </>
            )}
          </Card>

          <Card className="p-0">
            <p className="px-4 pt-3 text-[13px] font-semibold text-ink-3">PREVIEW</p>
            {preview.rows.slice(0, 4).map((r) => (
              <div key={r.hash} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
                <span className="w-14 text-[13px] text-ink-3">{formatShortDate(r.date)}</span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{r.description}</span>
                <span className={cx('tabular text-[14px] font-semibold', r.direction === 'credit' && 'text-good-ink')}>
                  {r.direction === 'credit' ? '+' : '−'}
                  {rupees(r.amount)}
                </span>
              </div>
            ))}
            {preview.rows.length === 0 && <p className="px-4 pb-3 text-[14px] text-critical">No valid rows. Check the columns above.</p>}
            {preview.errors.length > 0 && (
              <p className="px-4 pb-3 text-[13px] text-ink-3">
                {preview.errors.length} rows skipped ({preview.errors[0].reason}).
              </p>
            )}
          </Card>

          <Button className="w-full" disabled={!preview.rows.length} onClick={csvToReview}>
            Continue with {preview.rows.length} {preview.rows.length === 1 ? 'transaction' : 'transactions'}
          </Button>
        </div>
      )}

      {step === 'review' && (
        <Review
          candidates={candidates}
          setCandidates={setCandidates}
          openingDate={data.settings.openingDate}
          busy={busy}
          onCommit={commit}
        />
      )}

      {step === 'done' && (
        <div className="flex flex-col items-center py-12 text-center">
          <div className="text-5xl" aria-hidden>
            ✅
          </div>
          <p className="mt-3 text-[20px] font-bold">
            Imported {imported} {imported === 1 ? 'transaction' : 'transactions'}
          </p>
          <p className="mt-1 text-[15px] text-ink-2">Your report and spending pace now include them.</p>
          <Button className="mt-6" onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function ColumnSelect({
  label,
  headers,
  value,
  onChange,
  optional,
}: {
  label: string;
  headers: string[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  optional?: boolean;
}) {
  return (
    <Field label={label}>
      <select className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        {(optional || !value) && <option value="">{optional ? 'None' : 'Choose column'}</option>}
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Review({
  candidates,
  setCandidates,
  openingDate,
  busy,
  onCommit,
}: {
  candidates: ImportCandidate[];
  setCandidates: (c: ImportCandidate[]) => void;
  openingDate: string;
  busy: boolean;
  onCommit: () => void;
}) {
  const [hint, setHint] = useState<{ merchant: string; categoryId: string } | null>(null);
  const included = candidates.filter((c) => c.include);
  const dupes = candidates.filter((c) => c.duplicate).length;
  const uncategorised = included.filter((c) => c.direction === 'debit' && !c.autoCategorised && c.categoryId === 'other').length;
  const beforeOpening = included.filter((c) => `${c.date}T12:00` < openingDate).length;

  const patch = (hash: string, p: Partial<ImportCandidate>) =>
    setCandidates(candidates.map((c) => (c.hash === hash ? { ...c, ...p } : c)));

  const applyAll = async () => {
    if (!hint) return;
    setCandidates(
      candidates.map((c) =>
        c.direction === 'debit' && c.merchant === hint.merchant ? { ...c, categoryId: hint.categoryId, autoCategorised: true } : c,
      ),
    );
    await rememberRule(hint.merchant, hint.categoryId);
    setHint(null);
  };

  return (
    <div className="space-y-3">
      <Card className="space-y-1 text-[14px] text-ink-2">
        <p>
          <b className="text-ink">{included.length}</b> to import
          {dupes > 0 && ` · ${dupes} already imported (skipped)`}
          {uncategorised > 0 && ` · ${uncategorised} need a category`}
        </p>
        {beforeOpening > 0 && (
          <p className="text-[13px] text-ink-3">
            {beforeOpening} entries are from before you started using the app. They count in reports but won't change your current balance.
          </p>
        )}
      </Card>

      {hint && (
        <Card className="flex items-center gap-3 bg-accent-soft">
          <p className="flex-1 text-[14px]">
            Always put <b>{hint.merchant}</b> in {CATEGORIES.find((c) => c.id === hint.categoryId)?.name}?
          </p>
          <Button className="min-h-9 px-3 text-[13px]" onClick={applyAll}>
            Yes
          </Button>
        </Card>
      )}

      <Card className="divide-y divide-line p-0">
        {candidates.map((c) => (
          <div key={c.hash} className={cx('flex gap-3 px-4 py-3', !c.include && 'opacity-50')}>
            <input
              type="checkbox"
              aria-label="Include"
              className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
              checked={c.include}
              disabled={c.duplicate}
              onChange={(e) => patch(c.hash, { include: e.target.checked })}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{c.merchant}</span>
                <span className={cx('tabular text-[15px] font-semibold', c.direction === 'credit' && 'text-good-ink')}>
                  {c.direction === 'credit' ? '+' : '−'}
                  {rupees(c.amount)}
                </span>
              </div>
              <p className="truncate text-[12px] text-ink-3">
                {formatShortDate(c.date)} · {c.duplicate ? 'Already imported' : c.description}
              </p>
              {c.direction === 'debit' ? (
                <select
                  className={cx(
                    inputClass,
                    'mt-2 min-h-9 py-1 text-[14px]',
                    !c.autoCategorised && c.categoryId === 'other' && 'border-warning',
                  )}
                  value={c.categoryId}
                  onChange={(e) => {
                    patch(c.hash, { categoryId: e.target.value, autoCategorised: true });
                    const similar = candidates.filter((x) => x.merchant === c.merchant && x.hash !== c.hash && x.direction === 'debit');
                    setHint(similar.length > 0 || c.merchant.length >= 3 ? { merchant: c.merchant, categoryId: e.target.value } : null);
                  }}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.emoji} {cat.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className={cx(inputClass, 'mt-2 min-h-9 py-1 text-[14px]')}
                  value={c.source}
                  onChange={(e) => patch(c.hash, { source: e.target.value as IncomeSource })}
                >
                  {INCOME_SOURCES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.emoji} {s.name}
                    </option>
                  ))}
                </select>
              )}
              {c.fixedCostId != null && <p className="mt-1 text-[12px] text-accent">Matched to a fixed bill</p>}
            </div>
          </div>
        ))}
      </Card>

      <div className="sticky bottom-0 bg-bg pt-2">
        <Button className="w-full" disabled={!included.length || busy} onClick={onCommit}>
          {included.length === 0
            ? 'Nothing new to import'
            : `Import ${included.length} ${included.length === 1 ? 'transaction' : 'transactions'}`}
        </Button>
      </div>
    </div>
  );
}
