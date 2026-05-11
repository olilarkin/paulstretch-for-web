export function Tabs() {
  return (
    <div className="tabs">
      <button className="tab active">Parameters</button>
      <button className="tab" disabled title="Not available in MVP">Process</button>
      <button className="tab" disabled title="Not available in MVP">Binaural beats</button>
      <button className="tab" disabled title="Not available in MVP">Write to file</button>
    </div>
  );
}
