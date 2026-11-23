import React, { useRef, useState } from 'react';
import { Check, Copy, FileText, Lock, Trash2, Upload, X } from 'lucide-react';
import type { Language, LocalDocumentDigest, ProjectRecord, RegionPreset } from '../types/ipds';
import { getTranslations } from '../i18n/translations';
import { getRegionDefaults } from '../utils/financialModel';
import {
  ACCEPTED_LOCAL_FILE_TYPES,
  formatFileSize,
  parseLocalFileToDigest,
  validateLocalFilesBatch,
} from '../utils/localFileParser';

interface CreateProjectModalProps {
  language: Language;
  isOpen: boolean;
  defaultEmail?: string;
  gasWebhookUrl: string;
  onClose: () => void;
  onCreated: (
    project: ProjectRecord,
    sessionToken: string,
    accessKeyHint?: string,
    newlyGeneratedKey?: string | null
  ) => void;
}

const REGION_OPTIONS: RegionPreset[] = ['Казахстан', 'РФ', 'Международный', 'Свой вариант'];

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  language,
  isOpen,
  defaultEmail = '',
  gasWebhookUrl,
  onClose,
  onCreated,
}) => {
  const t = getTranslations(language);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(defaultEmail);
  const [projectName, setProjectName] = useState('');
  const [region, setRegion] = useState<RegionPreset>('Казахстан');
  const [customRegion, setCustomRegion] = useState('');
  const [category, setCategory] = useState('');
  const [comment, setComment] = useState('');
  const [documents, setDocuments] = useState<LocalDocumentDigest[]>([]);
  const [parsingFiles, setParsingFiles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdNotice, setCreatedNotice] = useState<{
    project: ProjectRecord;
    sessionToken: string;
    accessKeyHint?: string;
    newlyGeneratedKey: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setParsingFiles(true);
    setError(null);
    try {
      const { accepted, oversized } = validateLocalFilesBatch(Array.from(files));

      if (oversized.length > 0) {
        const list = oversized
          .map((f) => `«${f.name}» (${formatFileSize(f.size, language)})`)
          .join(', ');
        setError(t.createModal.errFileTooLarge.replace('{files}', list));
      }

      if (accepted.length > 0) {
        const parsed = await Promise.all(
          accepted.map((file) => parseLocalFileToDigest(file))
        );
        setDocuments((prev) => [...prev, ...parsed]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.createModal.errReadFile);
    } finally {
      setParsingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveDoc = (docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim() || !email.trim() || !projectName.trim()) {
      setError(t.createModal.errRequired);
      return;
    }
    if (!email.includes('@')) {
      setError(t.createModal.errEmail);
      return;
    }
    if (region === 'Свой вариант' && !customRegion.trim()) {
      setError(t.createModal.errCustomRegion);
      return;
    }

    setSubmitting(true);
    const regionMeta = getRegionDefaults(region, customRegion, language);
    const now = new Date().toISOString();

    const newProject: ProjectRecord = {
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      projectName: projectName.trim(),
      region,
      customRegion: region === 'Свой вариант' ? customRegion.trim() : undefined,
      category: category.trim() || undefined,
      comment: comment.trim() || undefined,
      currencyCode: regionMeta.currencyCode,
      currencySymbol: regionMeta.currencySymbol,
      documents,
      analysis: null,
      manualOverrides: {},
      dialogue: [],
      leadSyncStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    // Гарантированное локальное сохранение (Local-First) сразу при нажатии
    const initialSessionToken = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    onCreated(newProject, initialSessionToken, undefined, null);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: newProject,
          gasWebhookUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t.createModal.errCreateFailed);
      }

      const savedProject: ProjectRecord = data.project || newProject;

      if (data.newlyGeneratedKey) {
        setCreatedNotice({
          project: savedProject,
          sessionToken: data.sessionToken || initialSessionToken,
          accessKeyHint: data.accessKeyHint,
          newlyGeneratedKey: data.newlyGeneratedKey,
        });
      } else {
        onCreated(savedProject, data.sessionToken || initialSessionToken, data.accessKeyHint, null);
        resetAndClose();
      }
    } catch (err) {
      // Проект уже сохранён локально, но выводим понятное уведомление об ошибке вместо тихого перехода на пустой экран
      setError(
        err instanceof Error
          ? `${t.createModal.errCreateFailed}: ${err.message}`
          : t.createModal.errCreateFailed
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setFullName('');
    setProjectName('');
    setCustomRegion('');
    setCategory('');
    setComment('');
    setDocuments([]);
    setCreatedNotice(null);
    setError(null);
    onClose();
  };

  const handleContinueAfterKey = () => {
    if (!createdNotice) return;
    onCreated(
      createdNotice.project,
      createdNotice.sessionToken,
      createdNotice.accessKeyHint,
      createdNotice.newlyGeneratedKey
    );
    resetAndClose();
  };

  const handleCopyKey = async () => {
    if (!createdNotice) return;
    await navigator.clipboard.writeText(createdNotice.newlyGeneratedKey).catch(() => {});
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16181A]/60 backdrop-blur-xs">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] text-[#1E2022] shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E0D5] sticky top-0 bg-[#FAF8F3] z-10">
          <div>
            <h2 className="text-lg font-bold text-[#1E2022]">{t.createModal.title}</h2>
            <p className="text-xs text-[#5C6066] mt-0.5">{t.createModal.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label={t.createModal.closeAria}
            className="p-2 rounded-lg border border-[#C9C1B2] hover:border-[#8C6D3F] text-[#5C6066] hover:text-[#1E2022] hover:bg-[#EFECE4] cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {createdNotice ? (
          <div className="p-6 space-y-5">
            <div className="rounded-xl bg-[#EFECE4] border border-[#D8C7A5] p-5 space-y-3">
              <div className="text-sm font-semibold text-[#9A6E2E]">
                {t.createModal.keyNoticeTitle}
              </div>
              <p className="text-sm text-[#1E2022] leading-relaxed">
                {t.createModal.keyNoticeBodyBefore}{' '}
                <span className="font-semibold text-[#1E2022]">{createdNotice.project.email}</span>{' '}
                {t.createModal.keyNoticeBodyAfter}
              </p>
              <div className="flex items-center justify-between gap-3 bg-[#FFFFFF] border border-[#D8C7A5] rounded-lg px-4 py-3">
                <span className="font-mono-tabular text-base font-semibold text-[#9A6E2E] tracking-wider">
                  {createdNotice.newlyGeneratedKey}
                </span>
                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-xs font-medium text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 cursor-pointer transition-colors"
                >
                  {copiedKey ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{t.createModal.copied}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#F5F3EE]" />
                      <span>{t.createModal.copyKey}</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-[#5C6066]">
                {t.createModal.leadSyncLabel}{' '}
                <span className="text-[#1E2022] font-medium">
                  {createdNotice.project.leadSyncMessage || t.createModal.leadSyncFallback}
                </span>
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleContinueAfterKey}
                className="px-5 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 cursor-pointer transition-colors"
              >
                {t.createModal.continueBtn}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#3A3D42] mb-1.5">
                  {t.createModal.labelFullName} <span className="text-[#9A6E2E]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t.createModal.placeholderFullName}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-sm text-[#1E2022] placeholder:text-[#8B8F96]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#3A3D42] mb-1.5">
                  {t.createModal.labelEmail} <span className="text-[#9A6E2E]">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.createModal.placeholderEmail}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-sm text-[#1E2022] placeholder:text-[#8B8F96]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#3A3D42] mb-1.5">
                {t.createModal.labelProjectName} <span className="text-[#9A6E2E]">*</span>
              </label>
              <input
                type="text"
                required
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={t.createModal.placeholderProjectName}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-sm text-[#1E2022] placeholder:text-[#8B8F96]"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-[#3A3D42]">
                {t.createModal.labelRegion} <span className="text-[#9A6E2E]">*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {REGION_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRegion(option)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                      region === option
                        ? 'bg-[#1A1C1F] border-white/[0.26] hover:border-white/[0.38] text-[#F5F3EE] font-semibold'
                        : 'bg-[#FFFFFF] border-[#C9C1B2] text-[#5C6066] hover:border-[#8C6D3F] hover:text-[#1E2022]'
                    }`}
                  >
                    {t.createModal.regions[option]}
                  </button>
                ))}
              </div>
              {region === 'Свой вариант' && (
                <input
                  type="text"
                  required
                  value={customRegion}
                  onChange={(e) => setCustomRegion(e.target.value)}
                  placeholder={t.createModal.placeholderCustomRegion}
                  className="mt-2 w-full px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-sm text-[#1E2022] placeholder:text-[#8B8F96]"
                />
              )}
              <div className="text-[11px] text-[#5C6066]">
                {t.createModal.baseCurrencyLabel}{' '}
                <span className="font-mono-tabular text-[#1E2022] font-medium">
                  {getRegionDefaults(region, customRegion, language).displayLabel}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#3A3D42] mb-1.5">
                  {t.createModal.labelCategory}
                </label>
                <input
                  type="text"
                  list="ipds-categories"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder={t.createModal.placeholderCategory}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-sm text-[#1E2022] placeholder:text-[#8B8F96]"
                />
                <datalist id="ipds-categories">
                  {t.createModal.categories.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#3A3D42] mb-1.5">
                  {t.createModal.labelComment}
                </label>
                <input
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t.createModal.placeholderComment}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-sm text-[#1E2022] placeholder:text-[#8B8F96]"
                />
              </div>
            </div>

            {/* Локальная загрузка файлов (Local-First) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[#3A3D42]">
                  {t.createModal.labelDocs}
                </label>
                <span className="inline-flex items-center gap-1 text-[11px] text-[#5C6066]">
                  <Lock className="w-3 h-3 text-[#B88B4A]" />
                  <span>{t.createModal.docsStayLocal}</span>
                </span>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleFilesSelected(e.dataTransfer.files);
                }}
                className="rounded-xl border border-dashed border-[#D8D1C3] hover:border-[#B88B4A] bg-[#F5F3EE] p-5 text-center cursor-pointer transition-colors"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_LOCAL_FILE_TYPES}
                  onChange={(e) => void handleFilesSelected(e.target.files)}
                  className="hidden"
                />
                <Upload className="w-5 h-5 text-[#B88B4A] mx-auto mb-2" />
                <div className="text-xs font-medium text-[#1E2022]">
                  {parsingFiles ? t.createModal.parsingFiles : t.createModal.dropzoneTitle}
                </div>
                <div className="text-[11px] text-[#5C6066] mt-1">
                  {t.createModal.dropzoneDesc}
                </div>
              </div>

              {documents.length > 0 && (
                <div className="space-y-1.5">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-[#B88B4A] shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[#1E2022] font-medium truncate">{doc.name}</div>
                          <div className="text-[11px] text-[#5C6066]">
                            {doc.previewNote} · {t.createModal.extractedCharsPrefix}{' '}
                            {doc.charCount} {t.createModal.extractedCharsSuffix}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveDoc(doc.id)}
                        aria-label={`Remove ${doc.name}`}
                        className="p-1.5 text-[#7A7E85] hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-[#E5E0D5] flex flex-wrap items-center justify-between gap-3">
              <div className="text-[11px] text-[#5C6066] max-w-sm">
                {t.createModal.crmFooterNote}
              </div>
              <div className="flex items-center gap-2.5 ml-auto">
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="px-4 py-2.5 rounded-lg border border-white/[0.22] hover:border-white/[0.36] bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] text-xs font-semibold text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 cursor-pointer transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={submitting || parsingFiles}
                  className="px-5 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
                >
                  {submitting ? t.createModal.saving : t.createModal.submit}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
