import {useEffect, useRef} from 'react';

/** The pinned Modal supplies Escape/mask dismissal; keep the pre-Host form behind its portal inert. */
export function useModalBoundary() {
  const opener = useRef<HTMLElement>();
  useEffect(() => {
    const root = document.getElementById('root')!;
    let active = false;
    const dialog = () => [...document.querySelectorAll<HTMLElement>('[role=dialog]')].at(-1);
    const remember = () => {if (!active && document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) opener.current = document.activeElement};
    const update = () => {
      const open = Boolean(dialog());
      if (open === active) return;
      active = open; root.inert = open;
      if (!open && opener.current?.isConnected) opener.current.focus();
    };
    const trap = (event: KeyboardEvent) => {
      const current = dialog();
      if (!current || event.key !== 'Tab' || document.querySelector('[role=menu]')) return;
      const fields = [...current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')]
        .filter(item => item.getClientRects().length);
      const first = fields[0], last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus()}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus()}
    };
    const observer = new MutationObserver(update); observer.observe(document.body, {childList: true, subtree: true});
    document.addEventListener('focusin', remember); document.addEventListener('keydown', trap); remember(); update();
    return () => {observer.disconnect(); root.inert = false; document.removeEventListener('focusin', remember); document.removeEventListener('keydown', trap)};
  }, []);
  return (element: HTMLElement) => {opener.current = element};
}
