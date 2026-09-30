import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '../ui';
import { preventModalOutsideDismiss } from '../ui/ModalOverlay';
import type { GuideDefinition, GuideSection } from './guideRegistry';

interface PageGuideModalProps {
  open: boolean;
  guide: GuideDefinition | null;
  sections: GuideSection[];
  onClose: () => void;
  onGotIt: () => void;
}
export function PageGuideModal({ open, guide, sections, onClose, onGotIt }: PageGuideModalProps) {
  if (!guide) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/55 backdrop-blur-[1px]" />
        <Dialog.Content
          onPointerDownOutside={preventModalOutsideDismiss}
          onInteractOutside={preventModalOutsideDismiss}
          className="fixed left-1/2 top-1/2 z-[101] flex max-h-[88vh] w-[calc(100%-2rem)] max-w-[900px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[10px] border border-[#dbe2ec] bg-white shadow-2xl outline-none dark:border-white/10 dark:bg-slate-900"
          aria-describedby="page-guide-description"
        >
          <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-[#e2e8f0] px-5 py-4 sm:px-7 dark:border-white/10">
            <div className="min-w-0">
              <Dialog.Title className="page-heading">{guide.title}</Dialog.Title>
              <Dialog.Description id="page-guide-description" className="page-subtitle">
                A quick guide to the page you are viewing.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex-shrink-0 rounded-md p-2 text-[#718198] transition-colors hover:bg-slate-100 hover:text-[#26334d] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Close page guide"
                title="Close page guide"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            <div className="space-y-7">
              {sections.map((section) => (
                <section key={section.id}>
                  <h2 className="section-heading">{section.title}</h2>
                  {section.paragraphs?.map((paragraph) => (
                    <p key={paragraph} className="mt-2 leading-6">{paragraph}</p>
                  ))}
                  {section.bullets && (
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#5f708b] dark:text-slate-300">
                      {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                    </ul>
                  )}
                  {section.media?.map((media) => (
                    <figure key={media.src} className="mt-4">
                      <img src={media.src} alt={media.alt} className="max-w-full rounded-[5px] border border-[#dbe2ec] dark:border-white/10" />
                      {media.caption && <figcaption className="mt-1 text-xs text-[#718198] dark:text-slate-400">{media.caption}</figcaption>}
                    </figure>
                  ))}
                </section>
              ))}
            </div>
          </div>

          <div className="flex flex-shrink-0 justify-end border-t border-[#e2e8f0] bg-[#f8fafc] px-5 py-3 dark:border-white/10 dark:bg-slate-950 sm:px-7">
            <Button type="button" onClick={onGotIt}>Got it</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
