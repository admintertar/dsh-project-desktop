import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX,
  CENTER_MIN} from '../../../.upstream/desktop/dsh-plugin-desktop/src/client/layout-state.ts';
import {installDesktopOwnedStyles} from '../../../.upstream/desktop/dsh-plugin-desktop/src/client/styles.ts';

// Guides need less navigation space than the main window. The official controller
// hard-codes its sidebar bounds, so adapt only this geometry at two thirds its width.
const GUIDE_SIDEBAR_DEFAULT = Math.round(SIDEBAR_DEFAULT * 2 / 3);
const GUIDE_SIDEBAR_MIN = Math.round(SIDEBAR_MIN * 2 / 3);
const GUIDE_SIDEBAR_MAX = Math.round(SIDEBAR_MAX * 2 / 3);
const clampWidth = (width: number) => Math.max(GUIDE_SIDEBAR_MIN, Math.min(GUIDE_SIDEBAR_MAX, Math.round(width)));

/** Minimal two-panel adaptation of stable AdvancedFrame.tsx. Its fixed 1024px breakpoint
 * and sidebar bounds cannot be configured for pre-Host guide windows. Keep the official
 * surfaces, native caption geometry and CSS; omit rightbar/slots and adapt width state. */
export function GuideFrame({sidebar, children, overlay, chrome, initialWidth, defaultWidth = GUIDE_SIDEBAR_DEFAULT, resizeLabel, onWidthChange, className}: {
  sidebar: ReactNode; children: ReactNode; overlay: ReactNode;
  chrome: {platform: string; material: string}; initialWidth?: number; defaultWidth?: number;
  resizeLabel: string; onWidthChange: (width: number) => void; className: string;
}) {
  const [preferredWidth, setPreferredWidth] = useState(() => clampWidth(Number.isFinite(initialWidth) ? initialWidth! : defaultWidth));
  const preferredWidthRef = useRef(preferredWidth);
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(window.innerWidth);
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    document.body.dataset.dshDesktopMode = 'advanced';
    document.body.dataset.dshDesktopPlatform = chrome.platform;
    document.body.dataset.dshDesktopMaterial = chrome.material;
    return installDesktopOwnedStyles();
  }, [chrome.platform, chrome.material]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setViewport(entries[0].contentRect.width));
    observer.observe(root.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = root.current!;
    const timers = new Map<HTMLElement, number>();
    // Stable ui-theme supplies the scrollbar skin but no auto-hide controller.
    // Observe real scroll events so wheel, touchpad, keyboard and thumb dragging
    // share the same visibility without changing overflow or the reserved gutter.
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches('.guideBody,.welcomeNav,.createNav')) return;
      window.clearTimeout(timers.get(target));
      target.dataset.guideScrolling = 'true';
      timers.set(target, window.setTimeout(() => {
        delete target.dataset.guideScrolling;
        timers.delete(target);
      }, 800));
    };
    element.addEventListener('scroll', onScroll, true);
    return () => {
      element.removeEventListener('scroll', onScroll, true);
      for (const [target, timer] of timers) {window.clearTimeout(timer); delete target.dataset.guideScrolling}
    };
  }, []);
  const compact = viewport < GUIDE_SIDEBAR_MIN + CENTER_MIN;
  const maximum = Math.max(GUIDE_SIDEBAR_MIN, Math.min(GUIDE_SIDEBAR_MAX, viewport - CENTER_MIN));
  const width = Math.min(preferredWidth, maximum);
  const dragBase = useRef(width);
  const save = () => {setDragging(false); onWidthChange(preferredWidthRef.current)};
  const change = (next: number) => {
    preferredWidthRef.current = clampWidth(Math.min(maximum, next));
    setPreferredWidth(preferredWidthRef.current);
  };
  return <div ref={root} className={`dshDesktopFrame guideFrame ${className}`}
    data-desktop-mode="advanced" data-desktop-platform={chrome.platform}
    data-guide-compact={compact || undefined} data-dragging={dragging || undefined}
    style={{gridTemplateColumns: compact ? 'minmax(0,1fr)' : `${width}px minmax(0,1fr)`}}>
    {chrome.platform === 'darwin' && <div className="dshDesktopMacCaptionRow" aria-hidden="true"/>}
    <aside className="dshDesktopSidebarSurface"><div className="dshDesktopUpstreamSidebar">{sidebar}</div></aside>
    <main className="dshDesktopConversationSurface">{children}</main>
    {chrome.platform === 'win32' && <div className="dshDesktopWindowsCaptionRow" aria-hidden="true"/>}
    <div className="dshDesktopOverlay" data-shell-overlay>{overlay}</div>
    {!compact && <GuideResizeHandle width={width} defaultWidth={defaultWidth} maximum={maximum} label={resizeLabel}
      onStart={() => {dragBase.current = width; setDragging(true)}}
      onDrag={delta => change(dragBase.current + delta)} onEnd={save}
      onKeyResize={value => {change(value); save()}}/>}
  </div>;
}

/** Official AdvancedFrame.ResizeHandle pointer-capture/RAF interaction, with cancellation
 * cleanup and keyboard support for this standalone separator. Replace when exported upstream. */
function GuideResizeHandle({width, defaultWidth, maximum, label, onStart, onDrag, onEnd, onKeyResize}: {
  width: number; defaultWidth: number; maximum: number; label: string; onStart: () => void;
  onDrag: (delta: number) => void; onEnd: () => void; onKeyResize: (width: number) => void;
}) {
  const origin = useRef(0), latest = useRef(0), frame = useRef<number | null>(null);
  const active = useRef(false);
  const [pointerFocus, setPointerFocus] = useState(false);
  const callbacks = useRef({onStart, onDrag, onEnd});
  callbacks.current = {onStart, onDrag, onEnd};
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (active.current) {active.current = false; callbacks.current.onEnd()}
  }, []);
  const end = () => {
    if (!active.current) return;
    active.current = false;
    if (frame.current !== null) {cancelAnimationFrame(frame.current); frame.current = null}
    callbacks.current.onDrag(latest.current - origin.current);
    callbacks.current.onEnd();
  };
  return <div className="dshDesktopResizeHandle guideResizeHandle" data-side="sidebar" style={{left: width}}
    data-pointer-focus={pointerFocus || undefined}
    role="separator" aria-label={label} aria-orientation="vertical" tabIndex={0}
    aria-valuemin={GUIDE_SIDEBAR_MIN} aria-valuemax={maximum} aria-valuenow={width}
    onPointerDown={event => {
      if (event.button !== 0) return;
      // Chromium can carry :focus-visible over from an input when focus() is
      // called here. Show our keyboard cue only after keyboard interaction.
      setPointerFocus(true);
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      origin.current = latest.current = event.clientX; active.current = true; callbacks.current.onStart();
    }} onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      latest.current = event.clientX;
      frame.current ??= requestAnimationFrame(() => {frame.current = null; callbacks.current.onDrag(latest.current - origin.current)});
    }} onPointerUp={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      latest.current = event.clientX; end(); event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={end} onLostPointerCapture={end}
    onBlur={() => setPointerFocus(false)}
    onDoubleClick={() => onKeyResize(defaultWidth)}
    onKeyDown={event => {
      setPointerFocus(false);
      const next = {ArrowLeft: width - 16, ArrowRight: width + 16, Home: GUIDE_SIDEBAR_MIN, End: maximum}[event.key];
      if (next !== undefined) {event.preventDefault(); onKeyResize(next)}
    }}/>
}
