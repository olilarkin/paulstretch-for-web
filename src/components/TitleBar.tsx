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
            <h2>Paulstretch2026:</h2>
            <div className="modal-subtitle">Paul's Extreme Sound Stretch For Web</div>
            <p>This is an experimental program for extreme stretching the audio.</p>
            <p>
              A browser port of{' '}
              <a href="https://hypermammut.sourceforge.net/paulstretch/" target="_blank" rel="noreferrer">Paulstretch</a>{' '}
              by Nasca Octavian Paul, built on <code>libpaulstretch</code> by Oli Larkin.
            </p>
            <p>
              Source:{' '}
              <a href="https://github.com/olilarkin/paulstretch2026" target="_blank" rel="noreferrer">
                github.com/olilarkin/paulstretch2026
              </a>
            </p>
            <p>License: GPL v2.0</p>
            <button onClick={() => setAboutOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
