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
          // Listing extensions explicitly (not just `audio/*`) is what lets
          // iOS Safari surface .wav/.aif files in the Files picker — with a
          // bare `audio/*` it greys them out or only offers the Music library.
          accept=".wav,.wave,.aif,.aiff,.aifc,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.webm,audio/*"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
      {aboutOpen && (
        <div className="modal-backdrop" onClick={() => setAboutOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Paulstretch For Web</h2>
            <div className="modal-subtitle">Paul's Extreme Sound Stretch For Web</div>
            <p className="modal-version">Version {__APP_VERSION__}</p>
            <p>This is an experimental program for extreme stretching the audio.</p>
            <p>
              A port of{' '}
              <a href="https://hypermammut.sourceforge.net/paulstretch/" target="_blank" rel="noreferrer">Paulstretch</a>{' '}
              by Nasca Octavian Paul, built on <code>libpaulstretch</code> by{' '}
              <a href="https://github.com/olilarkin" target="_blank" rel="noreferrer">Oli Larkin</a>.
            </p>
            <p>
              Source:{' '}
              <a href="https://github.com/olilarkin/paulstretch-for-web" target="_blank" rel="noreferrer">
                github.com/olilarkin/paulstretch-for-web
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
