import { toast } from 'sonner';
import { useCallback } from 'react';

interface ToastOptions {
  title?: string;
  description?: string;
  duration?: number;
}

export function useToast() {
  const showSuccess = useCallback((title: string, options?: Omit<ToastOptions, 'title'>) => {
    toast.success(title, {
      duration: options?.duration || 3000,
    });
  }, []);

  const showError = useCallback((title: string, options?: Omit<ToastOptions, 'title'>) => {
    toast.error(title, {
      duration: options?.duration || 5000,
    });
  }, []);

  const showInfo = useCallback((title: string, options?: Omit<ToastOptions, 'title'>) => {
    toast.info(title, {
      duration: options?.duration || 3000,
    });
  }, []);

  const showWarning = useCallback((title: string, options?: Omit<ToastOptions, 'title'>) => {
    toast.warning(title, {
      duration: options?.duration || 3000,
    });
  }, []);

  const showLoading = useCallback((title: string) => {
    return toast.loading(title);
  }, []);

  const updateToast = useCallback((toastId: string | number, options: any) => {
    toast(options.message, {
      id: toastId,
      ...options,
    });
  }, []);

  return {
    showSuccess,
    showError,
    showInfo,
    showWarning,
    showLoading,
    updateToast,
  };
}
