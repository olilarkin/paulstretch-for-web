import { useStore } from '../../state/store';
import type { AudioSource, Envelope, Params } from '../../types';

export interface StoreSyncedEngine {
  setParams(params: Params): void;
  setEnvelope(envelope: Envelope): void;
  loadSource(source: AudioSource): void;
}

export function syncEngineFromStore(engine: StoreSyncedEngine): void {
  const { params, envelope, source } = useStore.getState();
  engine.setParams(params);
  engine.setEnvelope(envelope);
  if (source) engine.loadSource(source);
}
