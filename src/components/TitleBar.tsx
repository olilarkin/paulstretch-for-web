import { useRef, useState } from 'react';

interface Props {
  onFile: (file: File | undefined) => Promise<void>;
}

export function TitleBar({ onFile }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const handleFile = async (file: File | undefined) => {
    await onFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="titlebar">
      <div className="titlebar-title">Paul's Extreme Sound Stretch</div>
      <div className="titlebar-menus">
        <button
          className="menu-button"
          onClick={() => fileInputRef.current?.click()}
          title="Load audio file"
        >
          File
        </button>
        <button className="menu-button" onClick={() => setAboutOpen(true)}>
          About
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
      {aboutOpen && (
        <div className="modal-backdrop" onClick={() => setAboutOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Paul's Extreme Sound Stretch (Web)</h2>
            <p>
              A browser port of <a href="https://hypermammut.sourceforge.net/paulstretch/" target="_blank" rel="noreferrer">Paulstretch</a> by Paul Nasca,
              built on top of <code>paulstretch-wasm</code>.
            </p>
            <p>
              Drop in an audio file via <strong>File</strong>, adjust the stretch / window /
              onset parameters, and shape the time-varying stretch with the breakpoint
              envelope. Output is rendered offline in a Web Worker.
            </p>
            <button onClick={() => setAboutOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
