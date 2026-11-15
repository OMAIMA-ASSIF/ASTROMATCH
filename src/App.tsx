import { useEffect, useState } from "react";
import Papa from "papaparse";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Database,
  Download,
  Globe2,
  Layers3,
  MapPinned,
  Menu,
  Orbit,
  Radio,
  Satellite,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import GlobeCanvas from "./GlobeCanvas";
import { ENVIRONMENT_FEATURES, loadExplorerData, loadMissionData } from "./data";
import LunarContextExplorer from "./LunarContextExplorer";
import { orderScreeningRegions } from "./screeningOrder";
import type {
  Cell,
  ExplorerData,
  FeatureCoverage,
  GeologicalComposition,
  MissionData,
  MissionSite,
  NumericProfile,
  ScreeningRegion,
} from "./data";
import DocumentaryPage, { ClusterDossierModal } from "./Documentary";
import type { GlobeMarker } from "./GlobeCanvas";
import { SiteNavigation } from "./navigation";
import type { Route } from "./navigation";

const brandLogo = new URL("./LOGO.png", import.meta.url).href;
const CLUSTER_COLORS = ["#55d8d1", "#66b8ff", "#bddb7a", "#f0bf72", "#ad98ff"];
const CLUSTER_NAMES = ["Cluster 00", "Cluster 01", "Cluster 02", "Cluster 03", "Cluster 04"];
const FEATURE_INFO: Record<string, { label: string; unit: string }> = {
  precipitation: { label: "Precipitation", unit: "mm / yr" },
  vegetation: { label: "Vegetation (NDVI)", unit: "NDVI" },
  annual_temperature_range: { label: "Annual temp. range", unit: "K" },
  lst_diurnal_range: { label: "Surface temp. range", unit: "K" },
  slope: { label: "Slope", unit: "°" },
  roughness: { label: "Roughness", unit: "m" },
  elevation: { label: "Elevation", unit: "m" },
  mean_annual_temperature: { label: "Mean temperature", unit: "°C" },
};
const COVERAGE_LABELS: Record<string, string> = {
  base_8_predictors: "Core climate & terrain",
  aridity: "Aridity",
  geological: "Geology",
  local_relief: "Local relief",
  rock_cover: "Rock cover",
  solar_illumination: "Solar illumination",
};
const REGION_FEATURE_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(FEATURE_INFO).map(([key, value]) => [key, value.label])),
  ai_valeur: "Aridity value",
  ai_classe_nom: "Aridity class",
  land_fraction: "Land fraction",
  local_relief_m: "Local relief",
  bare_pct: "Bare-ground fraction",
  land_frac: "Land fraction (rock-cover layer)",
  glim_code: "GLiM code",
  glim_classe: "GLiM class",
  ssrd_wm2: "Surface solar flux",
  energie_kwh_m2_an: "Solar energy",
};

function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function useExplorerData() {
  const [data, setData] = useState<ExplorerData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadExplorerData()
      .then((loaded) => {
        if (active) setData(loaded);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "The Earth dataset could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  return { data, error };
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark"><img src={brandLogo} alt="" /></span>
      <span className="brand-word">ASTRO<span>MATCH</span></span>
    </span>
  );
}

function Landing({
  data,
  error,
  route,
  onNavigate,
  onSelectCluster,
}: {
  data: ExplorerData | null;
  error: string | null;
  route: Route;
  onNavigate: (route: Route) => void;
  onSelectCluster: (cluster: number) => void;
}) {
  return (
    <main className="landing-documentary-home">
      <section className="landing-hero" aria-label="ASTROMATCH introduction">
        <div className="landing-stars" />
        <div className="landing-nebula landing-nebula-one" />
        <div className="landing-nebula landing-nebula-two" />
        <div className="landing-orbit landing-orbit-outer" />
        <div className="landing-orbit landing-orbit-inner" />
        <header className="landing-nav">
          <button className="control-brand-button landing-home-brand" onClick={() => onNavigate("home")} aria-label="ASTROMATCH home"><Brand /></button>
          <SiteNavigation current={route} onNavigate={onNavigate} className="landing-site-nav" />
        </header>
        <div className="landing-hero-earth">
          <div className="earth-aura" />
          <div className="landing-globe">
            {data ? (
              <GlobeCanvas cells={data.cells} clusterFilter={null} selectedCell={null} onSelectCell={() => undefined} className="landing-earth-canvas" startingZoom={1.18} />
            ) : (
              <div className="earth-placeholder"><Globe2 size={92} strokeWidth={0.65} /></div>
            )}
          </div>
          <div className="landing-geo-ring landing-geo-ring-a" />
          <div className="landing-geo-ring landing-geo-ring-b" />
          <div className="landing-scanline" />
          <span className="landing-solar-beacon" aria-hidden="true"><i /></span>
        </div>
        <div className="landing-copy">
          <div className="landing-scene-number">THE QUESTION <i /></div>
          <h1>WHERE ON EARTH<br />CAN WE FIND<br /><em>ANOTHER WORLD?</em></h1>
          <p>Exploring terrestrial environments to help prepare for future lunar and Martian missions.</p>
          <button className="explore-cta landing-hero-cta" onClick={() => onNavigate("explorer")}>
            <span>ENTER GLOBAL EXPLORER</span><ArrowUpRight size={16} />
          </button>
          <button className="landing-read-link" onClick={() => document.getElementById("story-diversity")?.scrollIntoView({ behavior: "smooth" })}>
            DISCOVER THE APPROACH <ArrowDown size={13} />
          </button>
          {error && <span className="landing-load-error">Earth data connection unavailable. {error}</span>}
        </div>
        <div className="landing-footer">
        <div className="landing-footnote">A SCIENTIFIC EXPLORATION <span>·</span> NOT A SITE-SUITABILITY RANKING</div>
        </div>
      </section>

      <section className="landing-story-section story-diversity" id="story-diversity">
        <div className="story-diversity-grid">
          <div className="story-editorial">
            <span className="story-eyebrow">ONE PLANET. COUNTLESS ENVIRONMENTS.</span>
            <h2>Earth is a<br /><em>natural laboratory.</em></h2>
            <p>From low-precipitation, high-elevation cells to warm, wet regions, the same global grid holds strikingly different measured conditions. ASTROMATCH groups those observations before asking what a specific mission needs.</p>
            <button type="button" className="story-link" onClick={() => onNavigate("documentary")}>How the data was built <ArrowRight size={14} /></button>
          </div>
          <div className="story-cluster-rail">
            <div className="story-rail-heading"><span>FIVE MEASURED FAMILIES</span><small>78,247 LABELLED CELLS</small></div>
            {CLUSTER_COLORS.map((color, cluster) => {
              const cells = data?.clusterCounts[cluster] ?? 0;
              const largest = Math.max(...(data?.clusterCounts ?? [1]));
              return (
                <button className="story-cluster-row" key={cluster} onClick={() => { onSelectCluster(cluster); onNavigate("explorer"); }}>
                  <span><i style={{ backgroundColor: color }} /> CLUSTER {String(cluster).padStart(2, "0")}</span>
                  <div><i style={{ width: `${cells / largest * 100}%`, backgroundColor: color }} /></div>
                  <strong>{cells ? cells.toLocaleString() : "—"}</strong>
                </button>
              );
            })}
            <p>Cluster sizes and colors are read from the existing Earth cell assignments.</p>
          </div>
        </div>
      </section>

      <section className="landing-story-section story-method">
        <div className="story-method-heading"><span className="story-eyebrow">A REPRODUCIBLE STARTING POINT</span><h2>From Earth data<br /><em>to planetary questions.</em></h2></div>
        <div className="story-method-grid">
          <article><span>01</span><Database size={18} /><h3>Observe globally</h3><p>Assemble climate, vegetation, and terrain observations on one documented Earth grid.</p><small>85,478 MASTER CELLS</small></article>
          <article><span>02</span><Layers3 size={18} /><h3>Group by environment</h3><p>Reuse the saved K-Means classification of the eight complete baseline predictors.</p><small>78,247 LABELLED CELLS</small></article>
          <article><span>03</span><MapPinned size={18} /><h3>Characterize the surface</h3><p>Inspect real cluster statistics, geology classes, and feature-specific data coverage.</p><small>NO MISSING-TO-ZERO SUBSTITUTION</small></article>
          <article className="story-next-stage"><span>04</span><Orbit size={18} /><h3>Screen by mission context</h3><p>Explore provisional dry-land filters while scientific comparability is reviewed.</p><small>EXPLORATORY FILTERS ONLY</small></article>
        </div>
        <details className="story-method-detail"><summary>Why clustering is not a prediction <ChevronDown size={15} /></summary><p>The saved labels describe similarity among Earth cells in a preprocessed feature space. They do not compare a cell against Moon or Mars requirements or nominate a landing location.</p></details>
      </section>

      <section className="landing-story-section story-about" id="about">
        <div className="story-section-index">ABOUT ASTROMATCH</div>
        <div className="story-about-grid">
          <div><span className="story-eyebrow">A MAP IS A BEGINNING, NOT A CONCLUSION.</span><h2>Explore the evidence.<br /><em>Keep the question open.</em></h2></div>
          <div><p>ASTROMATCH turns existing Earth data and environmental cluster outputs into an inspectable research interface. Explore Mars screening and lunar Earth-context regions using their measured features and transparent filters.</p><p className="story-about-note"><span className="live-dot" /> EXISTING SCIENTIFIC OUTPUTS PRESERVED <i /> EXPLORATORY RESULTS ONLY</p></div>
        </div>
        <div className="story-about-actions">
          <button className="explore-cta" onClick={() => onNavigate("explorer")}>EXPLORE EARTH <ArrowUpRight size={15} /></button>
          <button className="text-action" onClick={() => onNavigate("documentary")}>READ THE SCIENTIFIC DOCUMENTARY <BookOpen size={14} /></button>
        </div>
        <div className="story-about-foot"><span>ASTROMATCH / EARTH OBSERVATORY</span><span>GLOBAL CLASSIFICATION · K-MEANS / K=5</span><span>MISSION SCREENING · PROVISIONAL ONLY</span></div>
      </section>
    </main>
  );
}

function Header({ data, onNavigate }: { data: ExplorerData | null; onNavigate: (route: Route) => void }) {
  return (
    <header className="control-header">
      <button className="control-brand-button" onClick={() => onNavigate("home")} aria-label="Return to ASTROMATCH landing page"><Brand compact /></button>
      <div className="header-section-label"><span className="header-slash">/</span> EARTH OBSERVATORY <ChevronRight size={13} /> GLOBAL EXPLORER</div>
      <div className="header-right">
        <div className="header-status"><span className="live-dot" /> SOURCE DATA <span>{data ? "LOADED" : "SYNCING"}</span></div>
        <SiteNavigation current="explorer" onNavigate={onNavigate} className="explorer-site-nav" />
      </div>
    </header>
  );
}

function ClusterSidebar({
  data,
  selectedCluster,
  onSelect,
  onOpenDossier,
}: {
  data: ExplorerData | null;
  selectedCluster: number | null;
  onSelect: (cluster: number | null) => void;
  onOpenDossier: (cluster: number) => void;
}) {
  return (
    <aside className="left-sidebar">
      <div className="sidebar-heading"><span className="sidebar-kicker">CLASSIFICATION</span><span className="side-index">01 — 05</span></div>
      <div className="sidebar-section-title"><Layers3 size={14} /> K-MEANS CLUSTERS <span className="primary-tag">PRIMARY</span></div>
      <div className="cluster-options">
        {CLUSTER_COLORS.map((color, cluster) => {
          const count = data?.clusterCounts[cluster] ?? 0;
          const active = selectedCluster === cluster;
          const maximum = Math.max(...(data?.clusterCounts ?? [1]));
          return (
            <button
              type="button"
              key={cluster}
              className={`cluster-option ${active ? "is-active" : ""}`}
              onClick={() => {
                onSelect(active ? null : cluster);
                onOpenDossier(cluster);
              }}
              aria-pressed={active}
            >
              <span className="cluster-swatch" style={{ backgroundColor: color }} />
              <span className="cluster-option-copy"><span>{CLUSTER_NAMES[cluster]}</span><span className="cluster-cell-count">{count ? count.toLocaleString() : "—"} cells</span></span>
              <span className="cluster-size-track"><i style={{ width: `${maximum ? (count / maximum) * 100 : 0}%`, backgroundColor: color }} /></span>
              <span className="cluster-percent">{count && data ? `${((count / data.cells.length) * 100).toFixed(1)}%` : "—"}</span>
            </button>
          );
        })}
      </div>
      <button
        className={`all-clusters-button ${selectedCluster === null ? "is-active" : ""}`}
        type="button"
        onClick={() => onSelect(null)}
      ><Globe2 size={14} /> All clusters <span>{data?.cells.length.toLocaleString() ?? "—"}</span></button>

      <div className="sidebar-divider" />
      <div className="sidebar-section-title"><Database size={14} /> DATASET PROFILE</div>
      <div className="dataset-profile">
        <div><span>GRID CELLS</span><strong>{data?.cells.length.toLocaleString() ?? "—"}</strong></div>
        <div><span>CLUSTERS</span><strong>05</strong></div>
        <div><span>CLASSIFIER</span><strong>K-MEANS</strong></div>
        <div><span>INPUT FEATURES</span><strong>08</strong></div>
      </div>
      <div className="sidebar-dataset-note"><span className="dataset-icon"><Satellite size={14} /></span><span>Global Earth environmental<small>0.5° reference grid</small></span><Check size={13} className="check-icon" /></div>
      <div className="sidebar-bottom"><span className="tiny-pulse" /> EXISTING K-MEANS LABELS</div>
    </aside>
  );
}

function StatCard({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Database }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top"><span>{label}</span><Icon size={14} /></div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

function MapPanel({
  data,
  selectedCluster,
  selectedCell,
  onSelectCell,
  onSelectCluster,
}: {
  data: ExplorerData;
  selectedCluster: number | null;
  selectedCell: Cell | null;
  onSelectCell: (cell: Cell) => void;
  onSelectCluster: (cluster: number | null) => void;
}) {
  const visibleCount = selectedCluster === null ? data.cells.length : data.clusterCounts[selectedCluster];
  return (
    <section className="map-panel">
      <div className="map-topline">
        <div><span className="live-dot" /><span>SPATIAL CLASSIFICATION</span><span className="map-separator">/</span><strong>{selectedCluster === null ? "GLOBAL VIEW" : CLUSTER_NAMES[selectedCluster].toUpperCase()}</strong></div>
        <div className="map-legend-label"><span className="map-coordinate-mark">◎</span> ORTHOGRAPHIC PROJECTION <span className="map-separator">·</span> 0.5° GRID</div>
      </div>
      <div className="map-stage">
        <div className="map-top-left">
          <span className="map-micro-label">PLANETARY SURFACE</span>
          <strong>{visibleCount.toLocaleString()}</strong>
          <span>CELLS IN VIEW</span>
        </div>
        <div className="map-top-right"><span className="map-micro-label">CLASSIFICATION</span><strong>K-MEANS <i>K=5</i></strong></div>
        <GlobeCanvas cells={data.cells} clusterFilter={selectedCluster} selectedCell={selectedCell} onSelectCell={onSelectCell} />
        <div className="map-bottom-left">
          <span className="axis-marker">N <i /></span>
          <span className="map-interaction">DRAG TO ROTATE <span>·</span> SCROLL TO ZOOM</span>
        </div>
        {selectedCell && (
          <div className="cell-map-label">
            <span className="live-dot" /><span>SELECTED CELL</span>
            <strong>{selectedCell.latitude.toFixed(2)}° {selectedCell.latitude >= 0 ? "N" : "S"} <span>/</span> {Math.abs(selectedCell.longitude).toFixed(2)}° {selectedCell.longitude >= 0 ? "E" : "W"}</strong>
          </div>
        )}
        <div className="map-cluster-legend">
          {CLUSTER_COLORS.map((color, index) => (
            <button
              key={index}
              className={selectedCluster !== null && selectedCluster !== index ? "is-muted" : ""}
              onClick={() => onSelectCluster(selectedCluster === index ? null : index)}
              type="button"
              aria-label={`Show cluster ${index}`}
              aria-pressed={selectedCluster === index}
            >
              <i style={{ backgroundColor: color }} />{String(index).padStart(2, "0")}
            </button>
          ))}
        </div>
      </div>
      <div className="map-bottomline"><span><span className="tiny-pulse" /> GLOBAL GRID ACTIVE</span><span>DATA SOURCE <strong>K-MEANS CELLS</strong></span><span>SELECT A POINT FOR CELL TELEMETRY <Crosshair size={12} /></span></div>
    </section>
  );
}

function EnvironmentalChart({ profiles, cluster }: { profiles: NumericProfile[]; cluster: number | null }) {
  const features = ENVIRONMENT_FEATURES.map((feature) => {
    const values = profiles.filter((profile) => profile.feature === feature && profile.mean !== null);
    const current = cluster === null
      ? values.reduce((weighted, profile) => weighted + profile.mean! * profile.availableCells, 0) /
        values.reduce((total, profile) => total + profile.availableCells, 0)
      : values.find((profile) => profile.cluster === cluster)?.mean ?? null;
    const min = Math.min(...values.map((profile) => profile.mean!));
    const max = Math.max(...values.map((profile) => profile.mean!));
    const range = max - min;
    const position = current === null ? 0 : range > 0 ? ((current - min) / range) * 100 : 50;
    return { feature, current, position };
  });

  return (
    <section className="panel environmental-panel">
      <div className="panel-title-row"><div><span className="panel-overline">CLUSTER CHARACTERIZATION</span><h2>Environmental signature</h2></div><div className="chart-caption">MEAN VALUE <span>·</span> VS. OTHER CLUSTERS</div></div>
      <div className="feature-chart">
        {features.map(({ feature, current, position }) => (
          <div className="feature-row" key={feature}>
            <div className="feature-name">{FEATURE_INFO[feature].label}<small>{FEATURE_INFO[feature].unit}</small></div>
            <div className="feature-range"><span /><i style={{ left: `${position}%`, backgroundColor: cluster === null ? "#78d8d1" : CLUSTER_COLORS[cluster] }} /></div>
            <div className="feature-value">{formatNumber(current, 2)}</div>
          </div>
        ))}
      </div>
      <div className="chart-footnote"><span>LOWER CLUSTER MEAN</span><span>HIGHER CLUSTER MEAN</span></div>
    </section>
  );
}

function CoverageChart({ coverage, cluster }: { coverage: FeatureCoverage[]; cluster: number | null }) {
  const rows = cluster === null
    ? Array.from(coverage.reduce((groups, row) => {
      const current = groups.get(row.featureGroup) ?? { ...row, completeCells: 0, incompleteCells: 0, clusterCells: 0 };
      current.completeCells += row.completeCells;
      current.incompleteCells += row.incompleteCells;
      current.clusterCells += row.clusterCells;
      groups.set(row.featureGroup, current);
      return groups;
    }, new Map<string, FeatureCoverage>()).values()).map((row) => ({
      ...row,
      completenessPct: row.clusterCells ? (row.completeCells / row.clusterCells) * 100 : 0,
    }))
    : coverage.filter((row) => row.cluster === cluster);
  return (
    <section className="panel coverage-panel">
      <div className="panel-title-row"><div><span className="panel-overline">MEASUREMENT AVAILABILITY</span><h2>Data coverage</h2></div><span className="coverage-unit">COMPLETE CELLS</span></div>
      <div className="coverage-list">
        {rows.map((row) => (
          <div className="coverage-row" key={row.featureGroup}>
            <span>{COVERAGE_LABELS[row.featureGroup] ?? row.featureGroup}</span>
            <div className="coverage-track"><i style={{ width: `${Math.min(100, row.completenessPct)}%` }} /></div>
            <strong>{formatNumber(row.completenessPct, 1)}<small>%</small></strong>
            <span className="coverage-count">{row.completeCells.toLocaleString()} / {row.clusterCells.toLocaleString()}</span>
          </div>
        ))}
      </div>
      <div className="coverage-footnote"><span className="coverage-indicator" /> Coverage is computed from the existing feature-coverage output.</div>
    </section>
  );
}

function GeologyPanel({ rows, coverage, cluster }: { rows: GeologicalComposition[]; coverage: ExplorerData["geologyCoverage"]; cluster: number | null }) {
  const entries = (cluster === null
    ? Array.from(rows.reduce((groups, row) => {
      const key = `${row.code}|${row.className}`;
      const current = groups.get(key) ?? { ...row, cellCount: 0, clusterCells: 0, availableGeologyCells: 0, missingGeologyCells: 0 };
      current.cellCount += row.cellCount;
      current.clusterCells += row.clusterCells;
      current.availableGeologyCells += row.availableGeologyCells;
      current.missingGeologyCells += row.missingGeologyCells;
      groups.set(key, current);
      return groups;
    }, new Map<string, GeologicalComposition>()).values()).map((row) => ({
      ...row,
      pctOfAvailable: row.availableGeologyCells ? (row.cellCount / row.availableGeologyCells) * 100 : 0,
      pctOfAllCells: row.clusterCells ? (row.cellCount / row.clusterCells) * 100 : 0,
    }))
    : rows.filter((row) => row.cluster === cluster))
    .sort((a, b) => b.pctOfAvailable - a.pctOfAvailable);
  const top = entries.slice(0, 7);
  const selectedCoverage = cluster === null
    ? coverage.reduce((total, row) => ({
      cluster: -1,
      clusterCells: total.clusterCells + row.clusterCells,
      availableGeologyCells: total.availableGeologyCells + row.availableGeologyCells,
      missingGeologyCells: total.missingGeologyCells + row.missingGeologyCells,
      geologyCoveragePct: 0,
    }), { cluster: -1, clusterCells: 0, availableGeologyCells: 0, missingGeologyCells: 0, geologyCoveragePct: 0 })
    : coverage.find((row) => row.cluster === cluster);
  const coveragePct = selectedCoverage && selectedCoverage.clusterCells
    ? (selectedCoverage.availableGeologyCells / selectedCoverage.clusterCells) * 100
    : selectedCoverage?.geologyCoveragePct;
  const colors = ["#63e2d5", "#50b2d8", "#6688cf", "#a893e8", "#cb95b1", "#dcaa76", "#8aa679"];

  return (
    <section className="panel geology-panel">
      <div className="panel-title-row"><div><span className="panel-overline">GEOLOGICAL COMPOSITION</span><h2>Surface geology</h2></div><span className="geology-count">{entries.length} CLASSES</span></div>
      <div className="geology-coverage"><span>GEOLOGY COVERAGE</span><strong>{formatNumber(coveragePct, 2)}<small>%</small></strong></div>
      <div className="geology-stacked" aria-label="Geological composition by class">
        {top.map((entry, index) => <i key={entry.code} style={{ width: `${entry.pctOfAvailable}%`, backgroundColor: colors[index % colors.length] }} title={`${entry.className} ${formatNumber(entry.pctOfAvailable, 2)}%`} />)}
      </div>
      <div className="geology-list">
        {top.map((entry, index) => (
          <div className="geology-row" key={entry.code}>
            <i style={{ backgroundColor: colors[index % colors.length] }} />
            <span className="geology-class">{entry.className}<small>GLiM {entry.code}</small></span>
            <span className="geology-cells">{entry.cellCount.toLocaleString()} cells</span>
            <strong>{formatNumber(entry.pctOfAvailable, 1)}<small>%</small></strong>
          </div>
        ))}
      </div>
      {entries.length > top.length && <div className="geology-other">{entries.length - top.length} additional classes in source composition</div>}
      <div className="geology-note"><span className="tiny-pulse" /> Proportions of available geology measurements</div>
    </section>
  );
}

function CellReadout({ cell, onClear }: { cell: Cell | null; onClear: () => void }) {
  return (
    <section className={`panel cell-panel ${cell ? "cell-panel-selected" : ""}`}>
      <div className="panel-title-row"><div><span className="panel-overline">POINT INSPECTION</span><h2>Cell telemetry</h2></div>{cell ? <button className="icon-button" onClick={onClear} aria-label="Clear selected cell"><X size={14} /></button> : <Crosshair size={15} className="idle-icon" />}</div>
      {cell ? (
        <>
          <div className="cell-location"><span>LAT / LON</span><strong>{cell.latitude.toFixed(3)}° <i>{cell.latitude >= 0 ? "N" : "S"}</i> <span>·</span> {Math.abs(cell.longitude).toFixed(3)}° <i>{cell.longitude >= 0 ? "E" : "W"}</i></strong><div><span className="cluster-swatch" style={{ backgroundColor: CLUSTER_COLORS[cell.cluster] }} /> {CLUSTER_NAMES[cell.cluster]}</div></div>
          <div className="cell-feature-grid">
            {ENVIRONMENT_FEATURES.map((feature) => (
              <div key={feature}><span>{FEATURE_INFO[feature].label}</span><strong>{formatNumber(cell.features[feature], 2)}<small>{FEATURE_INFO[feature].unit}</small></strong></div>
            ))}
          </div>
        </>
      ) : (
        <div className="cell-empty"><Crosshair size={21} /><span>SELECT A CELL ON THE GLOBE</span><small>Coordinates and available feature values will appear here.</small></div>
      )}
    </section>
  );
}

function MissionStatus({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="mission-card" onClick={onOpen}>
      <div className="mission-card-title"><span className="mission-icon"><Sparkles size={14} /></span><div><span className="panel-overline">MISSION CONTROL</span><strong>Mission screening</strong></div><span className="pending-pill">PROVISIONAL</span></div>
      <p>Review transparent filters and measured Earth-region context; results are exploratory, not validated planetary matches.</p>
      <div className="mission-placeholder"><span className="mission-line" /><Orbit size={15} /><span>OPEN MISSION SCREENING</span></div>
    </button>
  );
}

type ReferenceObservation = {
  label: string;
  value: string;
  source: string;
  scope: string;
  detail: string;
};

function referenceObservations(site: MissionSite, mission: MissionData): ReferenceObservation[] {
  const records = mission.referenceDetails[site.site_id]?.records ?? [];
  return records.map((record) => {
    const flux = Object.entries(record).find(([key, value]) =>
      normalizedText(key).includes("flux_vis") && Boolean(value),
    );
    const range = [
      record.minimum ?? record.minimum_percent,
      record.maximum ?? record.maximum_percent,
    ].filter(Boolean).join("–");
    const rawValue = record.value
      || record.value_percent
      || record.relief_local_m
      || range
      || record.qualitative_aridity
      || flux?.[1]
      || "Descriptive source record; no single value reported";
    const unit = record.unit === "percent" ? "%"
      : record.unit
      || (record.value_percent || record.minimum_percent || record.maximum_percent ? "%" : "")
      || (record.relief_local_m ? "m" : "");
    const label = record.criterion
      || record.metric
      || record.component
      || record.qualitative_aridity && "Aridity description"
      || record.geological_unit
      || record.source_file?.split("/").pop()?.replace(/\.csv$/, "")
      || "Reference observation";
    const scope = record.subregion
      || record.geological_unit
      || record.region
      || record.location
      || record.site
      || "Scope not stated in source row";
    const detail = record.definition
      || record.spatial_and_method_notes
      || record.interpretation_notes
      || record.notes
      || record.measurement_basis
      || record.method
      || "";
    return {
      label,
      value: `${rawValue}${unit && !String(rawValue).includes(unit) ? ` ${unit}` : ""}`,
      source: record.source_file ?? "mission reference data",
      scope,
      detail,
    };
  });
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function downloadText(filename: string, contents: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function screeningExportRow(region: ScreeningRegion) {
  const { similarity_score, score_type, ranking_basis, ...exportRegion } = region;
  return exportRegion;
}

function MissionControl({ earthData }: { earthData: ExplorerData }) {
  const [mission, setMission] = useState<MissionData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [body, setBody] = useState<MissionSite["mission_body"]>("MARS");
  const [siteId, setSiteId] = useState("MARS_GALE");
  const [scenario, setScenario] = useState<"strict" | "extended">("extended");
  const [search, setSearch] = useState("");
  const [clusterFilter, setClusterFilter] = useState("all");
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareNotice, setCompareNotice] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    loadMissionData()
      .then((loaded) => {
        if (active) setMission(loaded);
      })
      .catch((reason: unknown) => {
        if (active) setLoadError(reason instanceof Error ? reason.message : "Mission screening data could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const sites = mission?.sites.filter((site) => site.mission_body === body) ?? [];
  const selectedSite = mission?.sites.find((site) => site.site_id === siteId) ?? sites[0] ?? null;
  const coverage = mission?.coverage.find(
    (row) => row.site_id === selectedSite?.site_id && row.screening_scenario === scenario,
  ) ?? null;
  const scenarioPolicy = mission?.screeningPolicy.screening_scenarios[scenario] ?? null;
  const filteredRegions = orderScreeningRegions((mission?.regions ?? [])
    .filter((region) => region.site_id === selectedSite?.site_id && region.screening_scenario === scenario)
    .filter((region) => {
      if (clusterFilter === "unlabelled" && region.kmeans_cluster_mode !== null) return false;
      if (clusterFilter !== "all" && clusterFilter !== "unlabelled" && region.kmeans_cluster_mode !== Number(clusterFilter)) return false;
      const query = search.trim().toLowerCase();
      return !query || [
        region.region_id,
        region.candidate_tier,
        region.aridity_class_mode,
        String(region.representative_lat),
        String(region.representative_lon),
      ].some((value) => value.toLowerCase().includes(query));
    }));
  const selectedRegion = filteredRegions.find((region) => region.region_id === selectedRegionId)
    ?? filteredRegions[0]
    ?? null;
  const markers: GlobeMarker[] = filteredRegions.map((region) => ({
    id: region.region_id,
    latitude: region.representative_lat,
    longitude: region.representative_lon,
  }));
  const selectedDetails = selectedSite && mission
    ? referenceObservations(selectedSite, mission)
    : [];
  const comparedRegions = compareIds
    .map((id) => mission?.regions.find((region) =>
      region.region_id === id
      && region.site_id === selectedSite?.site_id
      && region.screening_scenario === scenario,
    ))
    .filter((region): region is ScreeningRegion => region !== undefined);

  useEffect(() => {
    setSelectedRegionId(null);
    setCompareIds([]);
    setCompareNotice(null);
  }, [siteId, scenario]);

  const toggleCompare = (regionId: string) => {
    if (compareIds.includes(regionId)) {
      setCompareIds((current) => current.filter((value) => value !== regionId));
      setCompareNotice(null);
      return;
    }
    if (compareIds.length >= 2) {
      setCompareNotice("Two regions are already selected. Click IN COMPARE on one before adding another.");
      return;
    }
    setCompareIds((current) => [...current, regionId]);
    setCompareNotice(null);
  };

  const exportCsv = () => {
    if (!filteredRegions.length) return;
    downloadText(
      `${selectedSite?.site_id ?? "mission"}-${scenario}-screening.csv`,
      Papa.unparse(filteredRegions.map(screeningExportRow)),
      "text/csv;charset=utf-8",
    );
  };
  const exportGeoJson = () => {
    if (!filteredRegions.length) return;
    const geojson = {
      type: "FeatureCollection",
      features: filteredRegions.map((region) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [region.representative_lon, region.representative_lat] },
        properties: screeningExportRow(region),
      })),
    };
    downloadText(
      `${selectedSite?.site_id ?? "mission"}-${scenario}-screening.geojson`,
      JSON.stringify(geojson, null, 2),
      "application/geo+json",
    );
  };

  if (loadError) {
    return (
      <div className="mission-load-state mission-error">
        <strong>Mission screening data unavailable</strong>
        <span>{loadError}</span>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
      </div>
    );
  }
  if (!mission || !selectedSite) {
    return (
      <div className="mission-load-state">
        <div className="loading-orbit"><Orbit size={24} /></div>
        <strong>LOADING MISSION REFERENCE DATA</strong>
      </div>
    );
  }

  return (
    <div className="mission-workspace">
      <div className="mission-toolbar">
        <div className="mission-body-switch" aria-label="Select planetary body">
          {(["MOON", "MARS"] as const).map((value) => (
            <button type="button" key={value} className={body === value ? "is-active" : ""} onClick={() => {
              setBody(value);
              const nextSite = mission.sites.find((site) => site.mission_body === value);
              if (nextSite) setSiteId(nextSite.site_id);
            }}>{value}</button>
          ))}
        </div>
        <div className="mission-site-switch" aria-label="Select reference site">
          {sites.map((site) => (
            <button type="button" key={site.site_id} className={site.site_id === selectedSite.site_id ? "is-active" : ""} onClick={() => setSiteId(site.site_id)}>
              {site.site}
            </button>
          ))}
        </div>
        {body === "MARS" && (
          <div className="mission-export-actions">
            <button type="button" onClick={exportCsv} disabled={!filteredRegions.length}><Download size={13} /> CSV</button>
            <button type="button" onClick={exportGeoJson} disabled={!filteredRegions.length}><Download size={13} /> GeoJSON</button>
          </div>
        )}
      </div>

      {body === "MOON" ? (
        <LunarContextExplorer
          site={selectedSite}
          records={mission.referenceDetails[selectedSite.site_id]?.records ?? []}
          earthCells={earthData.cells}
        />
      ) : (
      <>
      <div className="mission-screening-banner">
        <span className="live-dot" />
        <div>
          <strong>SHARED MARS-WIDE SCREEN — NOT A SITE MATCH</strong>
          <small>
            Same Earth filters for Gale and Utopia: vegetation ≤ {scenarioPolicy?.vegetation_max ?? "Unavailable"},
            land fraction ≥ {scenarioPolicy?.minimum_land_fraction ?? "Unavailable"}, and aridity class
            {scenarioPolicy?.accepted_aridity_classes.length === 1 ? "" : "es"} {scenarioPolicy?.accepted_aridity_classes.join(", ") ?? "Unavailable"}.
            {scenarioPolicy ? ` ${scenarioPolicy.southern_polar_aridity_policy}` : ""}
          </small>
        </div>
        <label>SCREEN<select value={scenario} onChange={(event) => setScenario(event.target.value as "strict" | "extended")}><option value="strict">STRICT</option><option value="extended">EXTENDED</option></select></label>
      </div>
      <p className="mission-how-to">
        Start here: choose Strict or Extended, select Gale or Utopia to inspect its reference profile, then select an Earth region
        for its coordinates and measured screening evidence. Use COMPARE on up to two regions. The Earth screen is shared across both sites.
      </p>

      <div className="mission-summary-strip">
        <div><span>REFERENCE SITE</span><strong>{selectedSite.site}</strong></div>
        <div><span>SHARED MARS SCREEN CELLS</span><strong>{coverage?.screening_candidate_cells.toLocaleString() ?? "Unavailable"}</strong></div>
        <div><span>SHARED SCREEN REGIONS</span><strong>{coverage?.candidate_regions.toLocaleString() ?? "Unavailable"}</strong></div>
      </div>

      <div className="mission-explorer-grid">
        <section className="mission-map-card">
          <div className="mission-panel-heading"><div><span className="panel-overline">EARTH SCREENING CONTEXT</span><h2>Shared Mars screen regions</h2></div><span className="mission-map-legend"><i /> EXPLORATORY REGION</span></div>
          <div className="mission-map-wrap">
            <GlobeCanvas
              cells={earthData.cells}
              clusterFilter={null}
              selectedCell={selectedCell}
              onSelectCell={setSelectedCell}
              markers={markers}
              selectedMarkerId={selectedRegion?.region_id}
              onSelectMarker={setSelectedRegionId}
            />
          </div>
          <div className="mission-map-foot">Existing K-Means colors provide Earth context only. Orange markers identify regions in the shared Mars-wide filter, not Gale or Utopia matches.</div>
        </section>

        <aside className="mission-right-column">
          <section className="mission-reference-card">
            <div className="mission-panel-heading"><div><span className="panel-overline">PLANETARY REFERENCE</span><h2>{selectedSite.site}</h2></div><span className="mission-body-tag">{selectedSite.mission_body}</span></div>
            <div className="mission-coordinates">{selectedSite.latitude_deg.toFixed(4)}° / {selectedSite.longitude_east_deg.toFixed(4)}°E</div>
            <p>{selectedSite.spatial_scope_note}</p>
            <div className="mission-reference-records">
              <span className="panel-overline">SOURCE-BACKED RECORDS · {selectedDetails.length}</span>
              {selectedDetails.length ? selectedDetails.map((item, index) => (
                <div className="mission-reference-observation" key={`${item.source}-${item.label}-${index}`}>
                  <span>{item.label}</span><strong>{item.value}</strong>
                  <small>{item.scope} · {item.source}{item.detail ? ` · ${item.detail}` : ""}</small>
                </div>
              )) : <small>No source-backed feature descriptions were found.</small>}
            </div>
          </section>

          <section className="mission-results-card">
            <div className="mission-panel-heading"><div><span className="panel-overline">SCREENING RESULTS</span><h2>Regions to inspect</h2></div><span className="mission-results-count">{filteredRegions.length}</span></div>
            <p className="mission-screen-order">
              Order: {scenario === "strict" ? "known dry/arid → aridity unknown" : "known dry/arid → semi-arid → aridity unknown"}; within each tier, higher screening-evidence coverage first.
              This is an inspection order, not an analogue-quality ranking.
            </p>
            <div className="mission-result-filters">
              <label className="mission-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ID, tier, coordinate" /></label>
              <select aria-label="Filter by K-Means context" value={clusterFilter} onChange={(event) => setClusterFilter(event.target.value)}>
                <option value="all">All clusters</option>
                {[0, 1, 2, 3, 4].map((cluster) => <option key={cluster} value={cluster}>Cluster {String(cluster).padStart(2, "0")}</option>)}
                <option value="unlabelled">No K-Means label</option>
              </select>
            </div>
            <div className="mission-result-list">
              {filteredRegions.length ? filteredRegions.slice(0, 120).map((region) => (
                <div className={`mission-result-row ${selectedRegion?.region_id === region.region_id ? "is-active" : ""}`} key={region.region_id}>
                  <button type="button" className="mission-result-select" onClick={() => setSelectedRegionId(region.region_id)}>
                    <span className="mission-result-marker"><MapPinned size={14} /></span>
                    <span className="mission-result-copy"><strong>{region.region_id}</strong><small>{region.candidate_tier.replace(/_/g, " ")}</small></span>
                    <span className="mission-result-size">{region.support_cells.toLocaleString()}<small>cells</small></span>
                  </button>
                  <button type="button" className={`mission-compare-button ${compareIds.includes(region.region_id) ? "is-active" : ""}`} onClick={() => toggleCompare(region.region_id)} aria-label={`Compare ${region.region_id}`} aria-pressed={compareIds.includes(region.region_id)}>
                    {compareIds.includes(region.region_id) ? "IN COMPARE" : "COMPARE"}
                  </button>
                </div>
              )) : (
                <div className="mission-empty-state">
                  <strong>No regions match these filters</strong>
                  <p>Try another cluster or scenario. Missing measurements are retained as unknown, not treated as zero.</p>
                </div>
              )}
              {filteredRegions.length > 120 && <div className="mission-list-limit">Showing 120 of {filteredRegions.length.toLocaleString()} regions. Exports include all filtered regions.</div>}
            </div>
          </section>
        </aside>
      </div>

      <div className="mission-detail-grid">
        <section className="mission-detail-card">
          <div className="mission-panel-heading"><div><span className="panel-overline">SELECTED REGION</span><h2>{selectedRegion?.region_id ?? "No region selected"}</h2></div></div>
          {selectedRegion ? (
            <>
              <div className="mission-region-stats">
                <div><span>REPRESENTATIVE CELL</span><strong>{selectedRegion.representative_lat.toFixed(3)}°, {selectedRegion.representative_lon.toFixed(3)}°</strong></div>
                <div><span>APPROX. LAND AREA</span><strong>{formatNumber(selectedRegion.approx_area_km2, 0)} km²</strong></div>
                <div><span>CANDIDATE TIER</span><strong>{selectedRegion.candidate_tier.replace(/_/g, " ")}</strong></div>
                <div><span>NDVI MEDIAN</span><strong>{formatNumber(selectedRegion.vegetation_median, 3)}</strong></div>
                <div><span>ARIDITY CLASS</span><strong>{selectedRegion.aridity_class_mode || "Unknown"}</strong></div>
                <div><span>SCREENING EVIDENCE AVAILABLE</span><strong>{selectedRegion.screening_evidence_coverage_pct}%</strong></div>
                <div><span>K-MEANS CONTEXT</span><strong>{selectedRegion.kmeans_cluster_mode === null ? "Unlabelled" : `Cluster ${selectedRegion.kmeans_cluster_mode}`}</strong></div>
                <div><span>DBSCAN CONTEXT</span><strong>{selectedRegion.dbscan_cluster_mode === null ? "Unlabelled" : selectedRegion.dbscan_cluster_mode < 0 ? "Noise (-1)" : `Cluster ${selectedRegion.dbscan_cluster_mode}`}</strong></div>
              </div>
              <p>{selectedRegion.explanation} {selectedRegion.limitations}</p>
              <p className="mission-region-condition-note">
                Filters satisfied: {selectedRegion.screening_conditions_passed.replace(/;/g, ", ") || "Not recorded"}.
                {selectedRegion.screening_conditions_failed
                  ? ` Filters failed: ${selectedRegion.screening_conditions_failed.replace(/;/g, ", ")}.`
                  : ""}
              </p>
              {selectedRegion.screening_conditions_unavailable && <small className="mission-unknown-note">Unavailable screening evidence: {selectedRegion.screening_conditions_unavailable.replace(/;/g, ", ")}</small>}
              <div className="mission-region-feature-summary">
                <span className="panel-overline">REGIONAL FEATURE SUMMARIES · MEDIAN WHERE NUMERIC</span>
                {Object.entries(selectedRegion.feature_summaries).map(([feature, summary]) => (
                  <div key={feature}>
                    <span>{REGION_FEATURE_LABELS[feature] ?? feature}</span>
                    <strong>{summary.median === null ? summary.mode ?? "Unavailable" : formatNumber(summary.median, 3)}</strong>
                    <small>{summary.available_cells.toLocaleString()} available · {summary.missing_cells.toLocaleString()} missing</small>
                  </div>
                ))}
              </div>
              <small className="mission-unknown-note">Earth source: outputs/astromatch_enriched_earth.csv. Earth source resolution and aggregation definitions remain under verification; cluster labels are descriptive Earth context only.</small>
            </>
          ) : <p>No site-specific screening regions are available for this reference.</p>}
        </section>

        <section className="mission-detail-card mission-compare-card">
          <div className="mission-panel-heading"><div><span className="panel-overline">SIDE-BY-SIDE REVIEW</span><h2>Compare up to two regions</h2></div><span>{comparedRegions.length} / 2</span></div>
          <p className="mission-compare-help">
            To compare, click COMPARE beside one region in the results list, then click it beside a second.
            Their recorded Earth measurements appear here. Click IN COMPARE to remove a region.
            This is not a planetary similarity comparison.
          </p>
          {compareNotice && <p className="mission-compare-notice" role="status">{compareNotice}</p>}
          {comparedRegions.length ? (
            <div className="mission-compare-grid">
              {comparedRegions.map((region) => (
                <div key={region.region_id}>
                  <strong>{region.region_id}</strong>
                  <span>Tier: {region.candidate_tier.replace(/_/g, " ")}</span>
                  <span>{region.support_cells.toLocaleString()} cells · {formatNumber(region.approx_area_km2, 0)} km²</span>
                  <span>Vegetation median: {formatNumber(region.vegetation_median, 3)}</span>
                  <span>Land fraction mean: {formatNumber(region.land_fraction_mean, 3)}</span>
                  <span>Aridity: {region.aridity_class_mode || "Unknown"}</span>
                  <span>Slope median: {formatNumber(region.median_slope, 2)}°</span>
                  <span>Local relief median: {formatNumber(region.median_local_relief_m, 1)} m</span>
                  <span>Screening evidence: {formatNumber(region.screening_evidence_coverage_pct, 1)}%</span>
                  <span>K-Means / DBSCAN: {region.kmeans_cluster_mode ?? "unlabelled"} / {region.dbscan_cluster_mode ?? "unlabelled"}</span>
                  <small>Filters passed: {region.screening_conditions_passed.replace(/;/g, ", ") || "Not recorded"}</small>
                  {region.screening_conditions_unavailable && <small>Unavailable: {region.screening_conditions_unavailable.replace(/;/g, ", ")}</small>}
                </div>
              ))}
            </div>
          ) : <p className="mission-compare-empty">No regions selected yet. Search or filter the results list above, then use its COMPARE buttons.</p>}
        </section>
      </div>
      </>
      )}
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="error-state"><Radio size={20} /><strong>Earth data could not be loaded</strong><span>{error}</span><button onClick={onRetry}>Retry connection</button></div>
  );
}

function Explorer({
  data,
  error,
  selectedCluster: initialCluster,
  onNavigate,
  onClusterChange,
  onOpenDossier,
  onRetry,
}: {
  data: ExplorerData | null;
  error: string | null;
  selectedCluster: number | null;
  onNavigate: (route: Route) => void;
  onClusterChange: (cluster: number | null) => void;
  onOpenDossier: (cluster: number) => void;
  onRetry: () => void;
}) {
  const [selectedCluster, setSelectedCluster] = useState<number | null>(initialCluster);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"earth" | "mission">("earth");
  const geologyCoverage = selectedCluster === null
    ? data?.geologyCoverage.reduce((total, item) => ({
      cluster: -1,
      clusterCells: total.clusterCells + item.clusterCells,
      availableGeologyCells: total.availableGeologyCells + item.availableGeologyCells,
      missingGeologyCells: total.missingGeologyCells + item.missingGeologyCells,
      geologyCoveragePct: 0,
    }), { cluster: -1, clusterCells: 0, availableGeologyCells: 0, missingGeologyCells: 0, geologyCoveragePct: 0 })
    : data?.geologyCoverage.find((item) => item.cluster === selectedCluster);
  const selectedGeologyCoverage = geologyCoverage && geologyCoverage.clusterCells
    ? (geologyCoverage.availableGeologyCells / geologyCoverage.clusterCells) * 100
    : geologyCoverage?.geologyCoveragePct ?? null;
  const cluster = selectedCluster;

  useEffect(() => {
    if (selectedCell && selectedCluster !== null && selectedCell.cluster !== selectedCluster) setSelectedCell(null);
  }, [selectedCell, selectedCluster]);

  const updateCluster = (value: number | null) => {
    setSelectedCluster(value);
    onClusterChange(value);
  };

  return (
    <main className="explorer">
      <Header onNavigate={onNavigate} data={data} />
      <div className="explorer-layout">
        <div className={`explorer-side-wrap ${sidebarOpen ? "is-open" : ""} ${workspaceMode === "mission" ? "mission-mode" : ""}`}>
          <ClusterSidebar data={data} selectedCluster={selectedCluster} onSelect={(value) => { updateCluster(value); setSidebarOpen(false); }} onOpenDossier={onOpenDossier} />
        </div>
        <section className="workspace">
          <div className="workspace-toolbar">
            {workspaceMode === "earth" && <button className="mobile-sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle cluster controls">{sidebarOpen ? <X size={16} /> : <Menu size={16} />}</button>}
            <div className="workspace-title"><span className="workspace-breadcrumb">OBSERVATORY <ChevronRight size={12} /> PLANET EARTH</span><h1>{workspaceMode === "earth" ? "Global Explorer" : "Mission Control"} <span>{workspaceMode === "earth" ? "01" : "02"}</span></h1></div>
            <div className="workspace-mode-switch" aria-label="Explorer mode">
              <button type="button" className={workspaceMode === "earth" ? "is-active" : ""} onClick={() => setWorkspaceMode("earth")}>EARTH CLUSTERS</button>
              <button type="button" className={workspaceMode === "mission" ? "is-active" : ""} onClick={() => setWorkspaceMode("mission")}>MISSION SCREENING</button>
            </div>
          </div>
          {error && <ErrorState error={error} onRetry={onRetry} />}
          {!data ? (
            !error && <div className="loading-state"><div className="loading-orbit"><Orbit size={26} /></div><span>CONNECTING TO EARTH DATA</span><small>Loading existing environmental cell outputs…</small></div>
          ) : workspaceMode === "mission" ? (
            <MissionControl earthData={data} />
          ) : (
            <>
              <div className="stats-strip">
                <StatCard label="GRID CELLS" value={data.cells.length.toLocaleString()} note="GLOBAL LAND GRID" icon={Globe2} />
                <StatCard label="CLASSIFICATION" value="K = 5" note="PRIMARY MODEL" icon={Layers3} />
                <StatCard label="SELECTED CLUSTER" value={selectedCluster === null ? "ALL" : String(selectedCluster).padStart(2, "0")} note={selectedCluster === null ? "FIVE SIGNATURES" : `${data.clusterCounts[selectedCluster].toLocaleString()} EARTH CELLS`} icon={Crosshair} />
                <StatCard label="GEOLOGY COVERAGE" value={`${formatNumber(selectedGeologyCoverage, 1)}%`} note={`${geologyCoverage?.availableGeologyCells.toLocaleString() ?? "—"} AVAILABLE CELLS`} icon={Database} />
              </div>
              <div className="dashboard-grid">
                <div className="dashboard-primary">
                  <MapPanel data={data} selectedCluster={selectedCluster} selectedCell={selectedCell} onSelectCell={setSelectedCell} onSelectCluster={updateCluster} />
                  <div className="bottom-panels">
                    <EnvironmentalChart profiles={data.profiles} cluster={cluster} />
                    <CoverageChart coverage={data.featureCoverage} cluster={cluster} />
                  </div>
                </div>
                <aside className="dashboard-insights">
                  <CellReadout cell={selectedCell} onClear={() => setSelectedCell(null)} />
                  <GeologyPanel rows={data.geology} coverage={data.geologyCoverage} cluster={cluster} />
                  <MissionStatus onOpen={() => setWorkspaceMode("mission")} />
                </aside>
              </div>
            </>
          )}
          <footer className="workspace-footer"><span>ASTROMATCH <i>·</i> EARTH OBSERVATORY</span><span>ENVIRONMENTAL DATA <strong>AS PROVIDED</strong></span><span>DISCOVERY MODE <strong className="footer-pending">EXPLORATORY</strong></span><span>01 / 02</span></footer>
        </section>
      </div>
    </main>
  );
}

export default function App() {
  const { data, error } = useExplorerData();
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [dossierCluster, setDossierCluster] = useState<number | null>(null);
  const [documentaryAnchor, setDocumentaryAnchor] = useState<string | null>(null);

  useEffect(() => {
    const handleHash = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  useEffect(() => {
    if (route === "about") {
      window.setTimeout(() => document.getElementById("about")?.scrollIntoView({ behavior: "smooth" }), 40);
    } else if (route === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [route]);

  const navigate = (next: Route) => {
    setRoute(next);
    setDossierCluster(null);
    if (next === "explorer" || next === "documentary") window.scrollTo({ top: 0, behavior: "auto" });
    if (window.location.hash !== `#${next}`) window.location.hash = next;
    if (next === "about") {
      window.setTimeout(() => document.getElementById("about")?.scrollIntoView({ behavior: "smooth" }), 80);
    }
  };

  const exploreCluster = (cluster: number) => {
    setSelectedCluster(cluster);
    setDossierCluster(null);
    navigate("explorer");
  };
  const retryData = () => window.location.reload();

  return (
    <>
      {route === "explorer" ? (
        <Explorer
          key="explorer"
          data={data}
          error={error}
          selectedCluster={selectedCluster}
          onNavigate={navigate}
          onClusterChange={setSelectedCluster}
          onOpenDossier={setDossierCluster}
          onRetry={retryData}
        />
      ) : route === "documentary" ? (
        <DocumentaryPage
          data={data}
          onNavigate={navigate}
          onExploreCluster={exploreCluster}
          initialAnchor={documentaryAnchor}
          onAnchorHandled={() => setDocumentaryAnchor(null)}
        />
      ) : (
        <Landing data={data} error={error} route={route} onNavigate={navigate} onSelectCluster={setSelectedCluster} />
      )}
      {dossierCluster !== null && data && (
        <ClusterDossierModal
          cluster={dossierCluster}
          data={data}
          onClose={() => setDossierCluster(null)}
          onExplore={exploreCluster}
          onReadChapter={(cluster) => {
            setDossierCluster(null);
            setDocumentaryAnchor(`cluster-profile-${cluster}`);
            navigate("documentary");
          }}
        />
      )}
    </>
  );
}

function routeFromHash(hash: string): Route {
  const value = hash.replace(/^#/, "");
  if (value === "explorer" || value === "documentary" || value === "about") return value;
  return "home";
}
