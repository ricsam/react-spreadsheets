import { useEffect } from 'react';

export const useClickAway = (ref: HTMLElement | null, callback: (away: boolean) => void) => {
  useEffect(() => {
    const handleClickAway = (event: MouseEvent) => {
      if (ref) {
        const away = !ref.contains(event.target as Node);
        callback(away);
      }
    };

    document.addEventListener('mousedown', handleClickAway);
    return () => {
      document.removeEventListener('mousedown', handleClickAway);
    };
  }, [ref, callback]);
};
