import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Clipboard, Link2, Mail, X } from 'lucide-react';
import type { Folder } from '../../types';
import { apiClient } from '../../utils/api';
import { folderPathLabel } from '../../utils/folderPath';
import { preventModalOutsideDismiss } from '../ui/ModalOverlay';
import { Button } from '../ui';

export type LibraryShareTarget = { type: 'folder' | 'document'; id: string; name: string };

const dialogClass = 'fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[5px] border border-[#dbe2ec] bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900';

export function CreateShortcutDialog({
  target,
  folders,
  initialDestinationFolderId,
  onClose,
  onCreated,
}: {
  target: LibraryShareTarget | null;
  folders: Folder[];
  initialDestinationFolderId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [destinationId, setDestinationId] = useState(initialDestinationFolderId);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const destinations = useMemo(() => folders.filter((folder) => !(target?.type === 'folder' && folder.folderId === target.id)), [folders, target]);

  useEffect(() => {
    setDestinationId(initialDestinationFolderId);
    setError('');
  }, [initialDestinationFolderId, target]);

  if (!target) return null;
  const create = async () => {
    if (!destinationId) {
      setError('Choose the folder that should contain this shortcut.');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      await apiClient.createLibraryShortcut({
        parentFolderId: destinationId,
        ...(target.type === 'folder' ? { targetFolderId: target.id } : { targetDocumentId: target.id }),
      });
      onCreated();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not create the shortcut.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/50" />
        <Dialog.Content onPointerDownOutside={preventModalOutsideDismiss} onInteractOutside={preventModalOutsideDismiss} className={dialogClass}>
          <div className="flex items-center justify-between border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
            <div>
              <Dialog.Title className="section-heading">Create shortcut</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[#52627a] dark:text-slate-300">Adds an alias to the original {target.type}; no file, version, or metadata is copied.</Dialog.Description>
            </div>
            <Dialog.Close asChild><button type="button" aria-label="Close create shortcut dialog" className="text-[#718198] hover:text-[#26334d]"><X className="h-5 w-5" /></button></Dialog.Close>
          </div>
          <div className="space-y-4 p-5">
            <div className="rounded-[4px] border border-[#dbe2ec] bg-[#f7f9fc] px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs font-medium uppercase tracking-wide text-[#718198]">Original {target.type}</p>
              <p className="mt-1 truncate text-sm font-semibold text-[#26334d] dark:text-white" title={target.name}>{target.name}</p>
            </div>
            <label className="block text-sm font-medium text-[#34425b] dark:text-slate-100">
              Put shortcut in
              <select autoFocus className="field-control mt-2 w-full" value={destinationId} onChange={(event) => { setDestinationId(event.target.value); setError(''); }}>
                <option value="">Choose a destination folder</option>
                {destinations.map((folder) => <option key={folder.folderId} value={folder.folderId}>{folderPathLabel(folder.folderId, folders) || folder.name}</option>)}
              </select>
            </label>
            {error && <p role="alert" className="text-sm text-[#c73c44]">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#e2e8f0] bg-[#f7f9fc] px-5 py-4 dark:border-white/10 dark:bg-slate-950">
            <Dialog.Close asChild><Button variant="secondary" type="button" disabled={isSaving}>Cancel</Button></Dialog.Close>
            <Button variant="primary" type="button" onClick={create} disabled={isSaving}><Link2 className="h-4 w-4" /> {isSaving ? 'Creating…' : 'Create shortcut'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ProtectedLinkDialog({
  target,
  startWithEmail,
  onClose,
  onCopied,
  onSent,
}: {
  target: LibraryShareTarget | null;
  startWithEmail: boolean;
  onClose: () => void;
  onCopied: () => void;
  onSent: (count: number) => void;
}) {
  const [link, setLink] = useState('');
  const [recipients, setRecipients] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) return;
    setLink('');
    setRecipients('');
    setError('');
    setIsLoading(true);
    apiClient.createProtectedLibraryLink(target.type === 'folder' ? { folderId: target.id } : { documentId: target.id })
      .then((response) => setLink(response.data?.link || ''))
      .catch((requestError: any) => setError(requestError?.response?.data?.error || 'Could not create a protected link.'))
      .finally(() => setIsLoading(false));
  }, [target]);

  if (!target) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      onCopied();
    } catch {
      setError('Your browser blocked clipboard access. Select and copy the link manually.');
    }
  };
  const send = async () => {
    const recipientList = recipients.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean);
    if (recipientList.length === 0) {
      setError('Enter at least one active DMS user email address.');
      return;
    }
    setIsSending(true);
    setError('');
    try {
      const response = await apiClient.shareProtectedLibraryLink({
        ...(target.type === 'folder' ? { folderId: target.id } : { documentId: target.id }),
        recipients: recipientList,
      });
      const sent = response.data?.sent ?? 0;
      if (response.success === false || sent !== recipientList.length) {
        setError(response.error || 'Some messages could not be sent.');
        return;
      }
      onSent(sent);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not send the protected link.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/50" />
        <Dialog.Content onPointerDownOutside={preventModalOutsideDismiss} onInteractOutside={preventModalOutsideDismiss} className={dialogClass}>
          <div className="flex items-center justify-between border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
            <div>
              <Dialog.Title className="section-heading">Protected DMS link</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[#52627a] dark:text-slate-300">{target.name}</Dialog.Description>
            </div>
            <Dialog.Close asChild><button type="button" aria-label="Close protected link dialog" className="text-[#718198] hover:text-[#26334d]"><X className="h-5 w-5" /></button></Dialog.Close>
          </div>
          <div className="space-y-5 p-5">
            <div>
              <label className="block text-sm font-medium text-[#34425b] dark:text-slate-100">Copy link</label>
              <p className="mt-1 text-xs leading-5 text-[#52627a] dark:text-slate-300">Anyone opening this link must sign in and already have access to the original {target.type}.</p>
              <div className="mt-2 flex gap-2">
                <input readOnly value={link} aria-label="Protected DMS link" className="field-control min-w-0 flex-1 font-mono text-xs" placeholder={isLoading ? 'Creating protected link…' : ''} onFocus={(event) => event.currentTarget.select()} />
                <Button variant="secondary" type="button" onClick={copy} disabled={!link || isLoading}><Clipboard className="h-4 w-4" /> Copy</Button>
              </div>
            </div>
            <div className="border-t border-[#e2e8f0] pt-5 dark:border-white/10">
              <label className="block text-sm font-medium text-[#34425b] dark:text-slate-100">Email this link <span className="font-normal text-[#718198]">(optional)</span></label>
              <p className="mt-1 text-xs leading-5 text-[#52627a] dark:text-slate-300">Separate addresses with commas. Recipients must be active DMS users; sending never grants access.</p>
              <textarea autoFocus={startWithEmail} value={recipients} onChange={(event) => { setRecipients(event.target.value); setError(''); }} className="field-control mt-2 min-h-20 w-full resize-y" placeholder="name@si-ware.com, colleague@si-ware.com" aria-label="Recipient email addresses" />
              <div className="mt-3 flex justify-end"><Button variant="primary" type="button" onClick={send} disabled={isSending || isLoading}><Mail className="h-4 w-4" /> {isSending ? 'Sending…' : 'Send email'}</Button></div>
            </div>
            {error && <p role="alert" className="text-sm text-[#c73c44]">{error}</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
