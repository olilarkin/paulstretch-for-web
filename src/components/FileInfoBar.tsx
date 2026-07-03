import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useStore } from '../state/store';
import { formatDuration } from '../state/mappings';

export function FileInfoBar() {
  const source = useStore((s) => s.source);
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  const text = source
    ? `${source.name} ( samplerate=${source.sampleRate}; duration=${formatDuration(source.durationSec)} )`
    : '';

  // Marquee only when the text is genuinely wider than the bar. Measured, not
  // assumed, so short names sit still and don't scroll pointlessly.
  useEffect(() => {
    const container = containerRef.current;
    const el = textRef.current;
    if (!source || !container || !el) {
      setOverflow(0);
      return;
    }
    const measure = () => {
      const cs = getComputedStyle(container);
      const avail =
        container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const diff = Math.ceil(el.scrollWidth - avail);
      setOverflow(diff > 4 ? diff : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    // Re-measure once the monospace webfont swaps in (it changes text width).
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [text, source]);

  if (!source) {
    return (
      <div className="file-info empty">
        no file loaded — use <strong>File</strong> menu, or drag &amp; drop audio
      </div>
    );
  }

  const marquee = overflow > 0;
  const style = marquee
    ? ({
        '--marquee-shift': `-${overflow}px`,
        // ~30px/sec, with a floor so short overflows don't zip past.
        '--marquee-duration': `${Math.max(6, Math.round(overflow / 30))}s`,
      } as CSSProperties)
    : undefined;

  return (
    <div className="file-info file-info-loaded" ref={containerRef} title={text}>
      <span
        ref={textRef}
        className={'file-info-text' + (marquee ? ' marquee' : '')}
        style={style}
      >
        {text}
      </span>
    </div>
  );
}
