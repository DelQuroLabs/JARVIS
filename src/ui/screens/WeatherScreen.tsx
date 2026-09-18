/** The full weather dashboard: merged reading, radar, rain/snow, alerts, sources. */

import { Shell } from '../Shell.tsx';
import { SectionTitle } from '../components.tsx';
import { useApp } from '../state.tsx';
import { WeatherCard, SourcePanel, AlertPanel } from './Weather.tsx';
import { RadarPanel, RadarForecast } from './Radar.tsx';

export default function WeatherScreen() {
  const app = useApp();
  const w = app.weather;
  return (
    <Shell
      title="Weather"
      sub={w?.readings ? `${w.readings.filter((r) => r.ok).length} sources merged \u00b7 refreshes every 10 min` : 'three keyless sources, merged'}
    >
      <div className="dash">
        <div className="dash-split" style={{ marginBottom: 14 }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <WeatherCard />
            <AlertPanel />
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <SourcePanel />
          </div>
        </div>
        <SectionTitle>Radar &mdash; what has already happened</SectionTitle>
        <div style={{ marginBottom: 14 }}>
          <RadarPanel />
        </div>

        <SectionTitle>What is coming</SectionTitle>
        <div style={{ marginBottom: 14 }}>
          <RadarForecast />
        </div>
      </div>
    </Shell>
  );
}
