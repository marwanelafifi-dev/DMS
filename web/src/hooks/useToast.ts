import { toast } from 'sonner';

interface ToastOptions {
  title?: string;
  description?: string;
  duration?: number;
}

export function useToast() {
  const showSuccess = (title: string, options?: Omit<ToastOptions, 'title'>) => {
    toast.success(title, {
      duration: options?.duration || 3000,
    });
  };

  const showError = (title: string, options?: Omit<ToastOptions, 'title'>) => {
    toast.error(title, {
      duration: options?.duration || 5000,
    });
  };

  const showInfo = (title: string, options?: Omit<ToastOptions, 'title'>) => {
    toast.info(title, {
      duration: options?.duration || 3000,
    });
  };

  const showWarning = (title: string, options?: Omit<ToastOptions, 'title'>) => {
    toast.warning(title, {
      duration: options?.duration || 3000,
    });
  };

  const showLoading = (title: string) => {
    return toast.loading(title);
  };

  const updateToast = (toastId: string | number, options: any) => {
    toast(options.message, {
      id: toastId,
      ...options,
    });
  };

  return {
    showSuccess,
    showError,
    showInfo,
    showWarning,
    showLoading,
    updateToast,
  };
}
