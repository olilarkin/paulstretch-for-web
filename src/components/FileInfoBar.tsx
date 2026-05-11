import { useStore } from '../state/store';
import { formatDuration } from '../state/mappings';

export function FileInfoBar() {
  const source = useStore((s) => s.source);
  if (!source) {
    return (
      <div className="file-info empty">
        no file loaded — use <strong>File</strong> menu, or drag &amp; drop audio
      </div>
    );
  }
  return (
    <div className="file-info">
      {source.name} ( samplerate={source.sampleRate}; duration={formatDuration(source.durationSec)} )
    </div>
  );
}
