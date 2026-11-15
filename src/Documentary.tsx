import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Database,
  Globe2,
  Layers3,
  MapPinned,
  Orbit,
  X,
} from "lucide-react";
import type { ExplorerData, FeatureCoverage, GeologicalComposition, NumericProfile } from "./data";
import { CHAPTERS, CLUSTER_EDITORIAL, FEATURE_GROUP_INFO, FEATURE_GUIDE } from "./documentaryData";
const brandLogo = new URL("./LOGO.png", import.meta.url).href;
import { SiteNavigation } from "./navigation";
import type { Route } from "./navigation";

const COLORS = ["#55d8d1", "#66b8ff", "#bddb7a", "#f0bf72", "#ad98ff"];
const CLUSTER_IDS = ["00", "01", "02", "03", "04"];

function number(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function percent(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "—" : `${number(value, digits)}%`;
}

function profileFor(data: ExplorerData | null, cluster: number, feature: string): NumericProfile | undefined {
  return data?.profiles.find((item) => item.cluster === cluster && item.feature === feature);
}

function coverageFor(data: ExplorerData | null, cluster: number): FeatureCoverage[] {
  return data?.featureCoverage.filter((item) => item.cluster === cluster) ?? [];
}

function geologyFor(data: ExplorerData | null, cluster: number): GeologicalComposition[] {
  return (data?.geology.filter((item) => item.cluster === cluster) ?? [])
    .sort((a, b) => b.pctOfAvailable - a.pctOfAvailable);
}

function Nameplate({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`doc-nameplate ${compact ? "is-compact" : ""}`}>
      <img className="doc-nameplate-logo" src={brandLogo} alt="" />
      <span>ASTRO<span>MATCH</span></span>
    </span>
  );
}

function Chapter({
  id,
  number: chapterNumber,
  eyebrow,
  title,
  summary,
  children,
}: {
  id: string;
  number: string;
  eyebrow: string;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section className="doc-chapter" id={`chapter-${id}`} data-chapter={id}>
      <div className="doc-chapter-index"><span>{chapterNumber}</span><i /></div>
      <div className="doc-chapter-content">
        <div className="doc-eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        <p className="doc-chapter-summary">{summary}</p>
        <div className="doc-chapter-body">{children}</div>
      </div>
    </section>
  );
}

function Cite({ href, children }: { href: string; children: React.ReactNode }) {
  return <a className="doc-citation" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={11} /></a>;
}

function FeatureField({ feature }: { feature: (typeof FEATURE_GUIDE)[number] }) {
  return (
    <details className="feature-field">
      <summary>
        <span className="feature-field-dot" />
        <span className="feature-field-name">
          <strong>{feature.label}</strong>
          <small>Field: {feature.key}</small>
          <span className="feature-field-teaser">{feature.measures}</span>
        </span>
        <span className="feature-field-unit">{feature.unit}</span>
        <ChevronDown size={14} />
      </summary>
      <div className="feature-field-detail">
        <div className="feature-measure"><strong>What it measures</strong><p>{feature.measures}</p></div>
        <div><strong>Why it is included</strong><span>{feature.whyItMatters}</span></div>
        <div><strong>Research context</strong><span>{feature.analogueRelevance}</span></div>
        <div><strong>Known limitation</strong><span>{feature.limitation}</span></div>
        <div className="feature-provenance"><strong>Source information</strong><span>{feature.provenance}{feature.sourceUrl && <> <Cite href={feature.sourceUrl}>View source</Cite></>}</span></div>
      </div>
    </details>
  );
}

function ClusterBars({ data }: { data: ExplorerData | null }) {
  const maximum = Math.max(1, ...(data?.clusterCounts ?? [1]));
  return (
    <div className="cluster-distribution">
      {CLUSTER_IDS.map((id, cluster) => {
        const cells = data?.clusterCounts[cluster] ?? 0;
        const share = data?.cells.length ? (cells / data.cells.length) * 100 : 0;
        return (
          <div className="cluster-distribution-row" key={id}>
            <span className="cluster-id-label"><i style={{ backgroundColor: COLORS[cluster] }} />CLUSTER {id}</span>
            <div className="distribution-track"><i style={{ width: `${cells / maximum * 100}%`, backgroundColor: COLORS[cluster] }} /></div>
            <strong>{cells ? cells.toLocaleString() : "—"}</strong>
            <span>{percent(share)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ProcessDiagram() {
  const steps = [
    { number: "01", title: "Reference grid", body: "A 0.5° Earth grid with the project land-cell mask." },
    { number: "02", title: "Baseline inputs", body: "Eight predictors define the complete-case clustering population." },
    { number: "03", title: "Saved transform", body: "Log1p on three skewed features, then RobustScaler." },
    { number: "04", title: "Saved labels", body: "Existing K-Means and DBSCAN assignments are reused as supplied." },
  ];
  return (
    <div className="process-diagram">
      {steps.map((step, index) => (
        <div className="process-step" key={step.number}>
          <span>{step.number}</span><strong>{step.title}</strong><p>{step.body}</p>
          {index < steps.length - 1 && <ArrowRight className="process-arrow" size={16} />}
        </div>
      ))}
    </div>
  );
}

function MethodBars({ data }: { data: ExplorerData | null }) {
  const dbscan = data?.labelSummary.filter((item) => item.algorithm === "dbscan") ?? [];
  const maxCount = Math.max(1, ...dbscan.map((item) => item.cells));
  return (
    <div className="dbscan-list">
      {dbscan.sort((a, b) => b.cells - a.cells).map((item) => (
        <div className="dbscan-row" key={item.cluster}>
          <span>{item.cluster === -1 ? "Noise · −1" : `Cluster ${String(item.cluster).padStart(2, "0")}`}</span>
          <div className="distribution-track"><i style={{ width: `${item.cells / maxCount * 100}%`, background: item.cluster === -1 ? "#d28f73" : "#62b9dc" }} /></div>
          <strong>{item.cells.toLocaleString()}</strong><small>{percent(item.percentage, 2)}</small>
        </div>
      ))}
    </div>
  );
}

function ClusterProfileCard({
  cluster,
  data,
  onOpen,
  onExplore,
}: {
  cluster: number;
  data: ExplorerData | null;
  onOpen: (cluster: number) => void;
  onExplore: (cluster: number) => void;
}) {
  const cells = data?.clusterCounts[cluster] ?? 0;
  const share = data?.cells.length ? (cells / data.cells.length) * 100 : 0;
  const color = COLORS[cluster];
  const temp = profileFor(data, cluster, "mean_annual_temperature");
  const rain = profileFor(data, cluster, "precipitation");
  const vegetation = profileFor(data, cluster, "vegetation");
  const elevation = profileFor(data, cluster, "elevation");
  return (
    <article className={`doc-cluster-card ${cluster === 0 ? "is-featured" : ""}`} id={`cluster-profile-${cluster}`} style={{ "--cluster-color": color } as React.CSSProperties}>
      <div className="doc-cluster-card-top">
        <span className="cluster-id-label"><i style={{ backgroundColor: color }} />K-MEANS / {CLUSTER_IDS[cluster]}</span>
        <span className="doc-cluster-share">{percent(share)}<small>OF LABELLED CELLS</small></span>
      </div>
      <div className="doc-cluster-card-title">
        <span>ENVIRONMENTAL FAMILY</span>
        <h3>{CLUSTER_EDITORIAL[cluster].title}</h3>
      </div>
      <p>{CLUSTER_EDITORIAL[cluster].summary}</p>
      <div className="doc-cluster-share-track" aria-label={`${percent(share)} of labelled cells`}>
        <i style={{ width: `${share}%` }} />
      </div>
      <div className="doc-cluster-key-stats">
        <div><span>CELLS</span><strong>{cells.toLocaleString()}</strong></div>
        <div><span>MEDIAN AIR TEMP.</span><strong>{number(temp?.median, 1)}<small>°C</small></strong></div>
        <div><span>MEDIAN PRECIP.</span><strong>{number(rain?.median, 1)}<small>mm/yr</small></strong></div>
        <div><span>MEDIAN NDVI</span><strong>{number(vegetation?.median, 3)}</strong></div>
      </div>
      {cluster === 4 && <div className="doc-cluster-extra">Median elevation <strong>{number(elevation?.median, 0)} m</strong> above Earth mean sea level.</div>}
      <div className="doc-cluster-actions">
        <button type="button" className="text-action" onClick={() => onOpen(cluster)}>Open research dossier <ArrowUpRight size={13} /></button>
        <button type="button" className="secondary-action" onClick={() => onExplore(cluster)}>Explore map <MapPinned size={13} /></button>
      </div>
      <span className="doc-card-index" aria-hidden="true">{CLUSTER_IDS[cluster]}</span>
    </article>
  );
}

function DistributionStrip({ profile, color }: { profile: NumericProfile | undefined; color: string }) {
  if (!profile || profile.min === null || profile.max === null || profile.median === null) {
    return <div className="distribution-unavailable">Distribution not available</div>;
  }
  const span = profile.max - profile.min;
  const position = (value: number | null) => span > 0 && value !== null ? Math.max(0, Math.min(100, (value - profile.min!) / span * 100)) : 50;
  const left = position(profile.q25);
  const right = position(profile.q75);
  return (
    <div className="dossier-dist-row">
      <div className="dossier-dist-name">{profile.feature.replace(/_/g, " ")}</div>
      <div className="dossier-dist-track">
        <i className="dossier-dist-iqr" style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%`, backgroundColor: color }} />
        <i className="dossier-dist-median" style={{ left: `${position(profile.median)}%` }} />
      </div>
      <span>Q25 {number(profile.q25, 2)} · MED {number(profile.median, 2)} · Q75 {number(profile.q75, 2)}</span>
    </div>
  );
}

export function ClusterDossierModal({
  cluster,
  data,
  onClose,
  onExplore,
  onReadChapter,
}: {
  cluster: number;
  data: ExplorerData;
  onClose: () => void;
  onExplore: (cluster: number) => void;
  onReadChapter: (cluster: number) => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const cells = data.clusterCounts[cluster];
  const share = (cells / data.cells.length) * 100;
  const color = COLORS[cluster];
  const profiles = data.profiles.filter((item) => item.cluster === cluster);
  const geology = geologyFor(data, cluster);
  const coverage = coverageFor(data, cluster);
  const importantFeatures = [
    "precipitation", "vegetation", "mean_annual_temperature", "annual_temperature_range",
    "slope", "roughness", "elevation", "lst_diurnal_range", "ai_valeur", "local_relief_m",
    "bare_pct", "energie_kwh_m2_an",
  ];

  return (
    <div className="dossier-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dossier-modal" role="dialog" aria-modal="true" aria-labelledby="dossier-title">
        <div className="dossier-cover" style={{ "--dossier-cluster": color } as React.CSSProperties}>
          <div className="dossier-cover-grid" />
          <button type="button" className="dossier-close" aria-label="Close research dossier" onClick={onClose}><X size={17} /></button>
          <span className="doc-eyebrow">ASTROMATCH FIELD DOSSIER · K-MEANS / K=5</span>
          <span className="dossier-cluster-number">{CLUSTER_IDS[cluster]}</span>
          <h2 id="dossier-title">{CLUSTER_EDITORIAL[cluster].title}</h2>
          <p>CLUSTER {CLUSTER_IDS[cluster]} <i /> {cells.toLocaleString()} CELLS <i /> {percent(share)} OF LABELLED CELLS</p>
        </div>
        <div className="dossier-content">
          <div className="dossier-interpretation">
            <span>FIELD INTERPRETATION</span>
            <p>{CLUSTER_EDITORIAL[cluster].summary}</p>
            <small>{CLUSTER_EDITORIAL[cluster].interpretation}</small>
          </div>

          <div className="dossier-section-title"><span>01</span><h3>Environmental profile</h3><small>MEDIANS · SOURCE: CLUSTER NUMERIC PROFILES</small></div>
          <div className="dossier-profile-grid">
            {importantFeatures.map((feature) => {
              const profile = profiles.find((item) => item.feature === feature);
              const guide = FEATURE_GUIDE.find((item) => item.key === feature);
              return (
                <div className="dossier-metric" key={feature}>
                  <span>{guide?.label ?? feature.replace(/_/g, " ")}</span>
                  <strong>{number(profile?.median, 3)}<small>{guide?.unit ?? "—"}</small></strong>
                  <i>{profile ? `${profile.availableCells.toLocaleString()} / ${profile.clusterCells.toLocaleString()} values · ${percent(profile.availabilityPct, 1)} coverage` : "No profile row in source output"}</i>
                </div>
              );
            })}
          </div>

          <div className="dossier-distribution">
            <div className="dossier-section-title"><span>02</span><h3>Distribution, not just the median</h3></div>
            <p>The shaded range is q25–q75; the marker is the median. Lines use each feature's observed cluster minimum and maximum.</p>
            {["precipitation", "vegetation", "annual_temperature_range", "mean_annual_temperature"].map((feature) => {
              const profile = profiles.find((item) => item.feature === feature);
              return <DistributionStrip key={feature} profile={profile} color={color} />;
            })}
          </div>

          <div className="dossier-two-column">
            <section>
              <div className="dossier-section-title"><span>03</span><h3>Leading geological classes</h3></div>
              <div className="dossier-geology-list">
                {geology.slice(0, 5).map((row, index) => (
                  <div className="dossier-geology-row" key={row.code}>
                    <span>{index + 1}</span><strong>{row.className}</strong><small>GLiM {row.code}</small>
                    <i><b style={{ width: `${row.pctOfAvailable}%`, backgroundColor: color }} /></i>
                    <em>{percent(row.pctOfAvailable, 2)}</em>
                  </div>
                ))}
              </div>
              <p className="dossier-note">Class proportions use available geological observations. Short codes are not expanded because a verified local codebook is absent.</p>
            </section>
            <section>
              <div className="dossier-section-title"><span>04</span><h3>Additional-data coverage</h3></div>
              <div className="dossier-coverage-list">
                {coverage.filter((row) => row.featureGroup !== "base_8_predictors").map((row) => (
                  <div key={row.featureGroup}>
                    <span>{row.featureGroup.replace(/_/g, " ")}</span>
                    <b>{percent(row.completenessPct, 1)}</b>
                    <i><b style={{ width: `${row.completenessPct}%`, backgroundColor: color }} /></i>
                    <small>{row.completeCells.toLocaleString()} of {row.clusterCells.toLocaleString()} complete</small>
                  </div>
                ))}
              </div>
              <p className="dossier-note">{CLUSTER_EDITORIAL[cluster].caveat}</p>
            </section>
          </div>
          <div className="dossier-footer">
            <span><CircleHelp size={13} /> Cluster IDs are nominal and do not rank suitability.</span>
            <button type="button" className="secondary-action" onClick={() => onReadChapter(cluster)}>Read chapter 06 <BookOpen size={13} /></button>
            <button type="button" className="explore-cta dossier-explore" onClick={() => onExplore(cluster)}>Explore cluster on map <ArrowUpRight size={14} /></button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function DocumentaryPage({
  data,
  onNavigate,
  onExploreCluster,
  initialAnchor,
  onAnchorHandled,
}: {
  data: ExplorerData | null;
  onNavigate: (route: Route) => void;
  onExploreCluster: (cluster: number) => void;
  initialAnchor: string | null;
  onAnchorHandled: () => void;
}) {
  const [activeChapter, setActiveChapter] = useState<string>("challenge");
  const [geologyCluster, setGeologyCluster] = useState(0);
  const [dossierCluster, setDossierCluster] = useState<number | null>(null);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]"));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveChapter(visible[0].target.getAttribute("data-chapter") ?? "challenge");
    }, { rootMargin: "-18% 0px -70% 0px" });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!initialAnchor) return;
    window.setTimeout(() => {
      document.getElementById(initialAnchor)?.scrollIntoView({ behavior: "smooth", block: "center" });
      onAnchorHandled();
    }, 60);
  }, [initialAnchor, onAnchorHandled]);

  const dbscanCount = useMemo(
    () => data?.labelSummary.filter((item) => item.algorithm === "dbscan").reduce((total, item) => total + item.cells, 0) ?? 0,
    [data],
  );
  const selectedGeology = geologyFor(data, geologyCluster).slice(0, 5);
  const allCoverage = data?.featureCoverage.filter((item) => item.cluster === geologyCluster) ?? [];
  const jumpTo = (id: string) => {
    document.getElementById(`chapter-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="documentary-page">
      <header className="doc-header">
        <button type="button" className="doc-brand-button" onClick={() => onNavigate("home")} aria-label="ASTROMATCH home"><Nameplate compact /></button>
        <div className="doc-header-label"><span>RESEARCH NOTES</span><i /> EARTH ANALOGUE STUDY</div>
        <SiteNavigation current="documentary" onNavigate={onNavigate} className="doc-main-nav" />
      </header>

      <section className="doc-hero">
        <div className="doc-hero-stars" />
        <div className="doc-hero-orbit doc-hero-orbit-one" />
        <div className="doc-hero-orbit doc-hero-orbit-two" />
        <div className="doc-hero-copy">
          <span className="doc-eyebrow"><span className="live-dot" /> ASTROMATCH · SCIENTIFIC DOCUMENTARY</span>
          <h1>Earth is not another world.<br /><em>But it can help us study one.</em></h1>
          <p>A field guide to the Earth measurements, environmental clusters, and open questions behind ASTROMATCH.</p>
          <button type="button" className="doc-begin-button" onClick={() => jumpTo("challenge")}>READ THE FIELD NOTES <ArrowDown size={14} /></button>
        </div>
        <div className="doc-hero-stats">
          <div><span>MASTER GRID</span><strong>{data?.enrichment.master_rows.toLocaleString() ?? "—"}</strong><small>EARTH CELLS</small></div>
          <i />
          <div><span>BASELINE LABELS</span><strong>{data?.enrichment.kmeans_labelled_cells.toLocaleString() ?? "—"}</strong><small>K-MEANS · K=5</small></div>
          <i />
          <div><span>DISCOVERY MODE</span><strong>EXPLORATORY</strong><small>EARTH CONTEXT</small></div>
        </div>
        <div className="doc-hero-caption">{CHAPTERS.length} CHAPTERS <span>·</span> DATA, METHODS & OPEN QUESTIONS</div>
      </section>

      <div className="doc-progress"><i style={{ width: `${((CHAPTERS.findIndex((chapter) => chapter.id === activeChapter) + 1) / CHAPTERS.length) * 100}%` }} /></div>
      <div className="doc-layout">
        <aside className="doc-toc">
          <div className="doc-toc-title"><span>CONTENTS</span><small>{CHAPTERS.length} CHAPTERS</small></div>
          <nav aria-label="Documentary chapters">
            {CHAPTERS.map((chapter) => (
              <button type="button" className={activeChapter === chapter.id ? "is-active" : ""} key={chapter.id} onClick={() => jumpTo(chapter.id)}>
                <span>{chapter.number}</span><span>{chapter.title}</span>
              </button>
            ))}
          </nav>
          <div className="doc-toc-bottom"><span className="live-dot" /> {CHAPTERS.find((chapter) => chapter.id === activeChapter)?.eyebrow}</div>
        </aside>

        <div className="doc-content">
          <Chapter id="challenge" number="01" eyebrow="WHY LOOK TO EARTH?" title="The challenge" summary="The NASA Space Apps challenge asks teams to identify Earth locations that analog the permanent Moon Base and Mars locations. ASTROMATCH begins with a narrower, testable step: map measurable environmental families across Earth.">
            <div className="doc-quote"><span>THE CHALLENGE</span><blockquote>“Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars.”</blockquote><small>NASA Space Apps Challenge wording supplied with the project brief.</small></div>
            <div className="doc-prose-grid">
              <div><h3>What is an analogue site?</h3><p>An analogue is a terrestrial research environment chosen because some measured conditions resemble a defined extraterrestrial setting or operational scenario. It is a useful place to test hypotheses, instruments, procedures, or human factors on Earth.</p></div>
              <div><h3>Why start here?</h3><p>Earth offers accessible environments with diverse climates, surfaces, and terrain. Characterizing that diversity can help researchers frame comparisons and plan field studies before missions operate farther from home.</p></div>
            </div>
            <div className="doc-callout"><Globe2 size={17} /><span><strong>An analogue is not a replica.</strong> Earth has a different gravity, atmosphere, radiation environment, chemistry, and geological history. Similarity on selected measurements does not make two worlds equivalent.</span></div>
          </Chapter>

          <Chapter id="question" number="02" eyebrow="WHAT THE CLUSTERS ANSWER" title="The scientific question" summary="Which terrestrial environments share measurable characteristics that could make them useful research analogues for future lunar and Martian exploration?">
            <div className="doc-comparison-grid">
              <article><span>01 / ENVIRONMENT</span><h3>Climate & surface context</h3><p>Temperature, precipitation, vegetation and solar fields describe selected environmental conditions. They do not prove an operational match.</p></article>
              <article><span>02 / GEOLOGY</span><h3>Mapped material classes</h3><p>Geological codes describe the composition categories available in the Earth layer. They are categorical, coverage-dependent, and not a mineralogical mission assessment.</p></article>
              <article><span>03 / TERRAIN</span><h3>Regional form</h3><p>Elevation, slope, roughness and local relief add topographic context. Several are aggregated to scales too coarse for landing hazards.</p></article>
              <article className="is-muted"><span>04 / OPERATIONS</span><h3>Suitability remains untested</h3><p>Power demand, radiation, communications, access, safety, and mandatory mission thresholds are not represented by the current screening outputs.</p><small>NO VALIDATED SUITABILITY RESULT</small></article>
            </div>
            <details className="doc-technical"><summary>What this clustering does not claim <ChevronDown size={15} /></summary><p>The saved K-Means labels group Earth cells by their baseline environmental predictors. They do not rank sites, predict lunar/Martian similarity, or establish that a cell meets a mission requirement.</p></details>
          </Chapter>

          <Chapter id="dataset" number="03" eyebrow="THE EARTH REFERENCE GRID" title="Earth data & measurements" summary="The project combines environmental observations on a 0.5° Earth grid. Existing K-Means labels cover cells with all eight baseline measurements present; supplementary layers are used to describe those clusters.">
            <div className="dataset-overview">
              <div className="dataset-count-band">
                <div><span>MASTER GRID CELLS</span><strong>{data?.enrichment.master_rows.toLocaleString() ?? "—"}</strong><small>ALL CELLS IN THE EARTH DATASET</small></div>
                <div><span>K-MEANS LABELLED</span><strong>{data?.enrichment.kmeans_labelled_cells.toLocaleString() ?? "—"}</strong><small>COMPLETE ON 8 BASELINE INPUTS</small></div>
                <div className="count-band-missing"><span>WITHOUT BASELINE LABEL</span><strong>{data?.enrichment.master_cells_without_clustering_labels.toLocaleString() ?? "—"}</strong><small>RETAINED IN THE MASTER GRID</small></div>
              </div>
              <p className="dataset-explanation">The 7,231 cells without a baseline label were not included in the existing complete-case clustering because one or more baseline inputs were unavailable. This is a data-coverage distinction, not a judgement about those locations.</p>
              <div className="dataset-section-heading">
                <span className="dataset-section-index">01</span>
                <div><h3>Baseline clustering inputs</h3><p>These eight measurements define the existing K-Means and DBSCAN classifications.</p></div>
                <small>8 MEASUREMENTS</small>
              </div>
              <div className="feature-field-list">
                {FEATURE_GUIDE.filter((feature) => feature.group === "Baseline predictors").map((feature) => <FeatureField key={feature.key} feature={feature} />)}
              </div>
              <div className="dataset-section-heading supporting-heading">
                <span className="dataset-section-index">02</span>
                <div><h3>Supporting environmental layers</h3><p>These additional fields characterize clusters; they were not inputs to the baseline clustering.</p></div>
                <small>5 DATA GROUPS</small>
              </div>
              <div className="dataset-support-groups">
                {Array.from(new Set(FEATURE_GUIDE.filter((feature) => feature.group !== "Baseline predictors").map((feature) => feature.group))).map((group) => {
                  const key = group.replace(/^Additional · /, "");
                  const info = FEATURE_GROUP_INFO[key];
                  const features = FEATURE_GUIDE.filter((feature) => feature.group === group);
                  return (
                    <section className="dataset-support-group" key={group}>
                      <div><h4>{info?.title ?? key}</h4><p>{info?.description}</p></div>
                      <div className="feature-field-list">{features.map((feature) => <FeatureField key={feature.key} feature={feature} />)}</div>
                    </section>
                  );
                })}
              </div>
            </div>
          </Chapter>

          <Chapter id="preparation" number="04" eyebrow="FROM GRID TO FEATURES" title="Data preparation" summary="The saved preprocessing configuration is read from the project. This documentary describes that configuration; it does not rerun or refit it.">
            <ProcessDiagram />
            <div className="preprocessing-stats">
              <div><span>TRANSFORMATION</span><strong>log1p</strong><p>{data?.preprocessing.log1p_features.map((feature) => feature.replace(/_/g, " ")).join(" · ") ?? "Loading saved config"}</p></div>
              <div><span>SCALER</span><strong>{data?.preprocessing.scaler ?? "—"}</strong><p>Robust scaling using the saved q25–q75 quantile range.</p></div>
              <div><span>BASE FEATURES</span><strong>{data?.preprocessing.features.length.toString().padStart(2, "0") ?? "—"}</strong><p>One consistent transform was recorded for K-Means and DBSCAN.</p></div>
            </div>
            <div className="doc-callout"><Database size={16} /><span>Different features have different units and ranges. Log1p compresses selected positive-skew fields; robust scaling uses medians and interquartile ranges so large raw units do not dominate solely due to scale. The project selects cells complete on the baseline predictors instead of silently turning missing values into zeros.</span></div>
            
          </Chapter>

          <Chapter id="clustering" number="05" eyebrow="TWO METHODS · DIFFERENT ROLES" title="Global clustering" summary="The existing models group Earth cells by their eight baseline measurements. K-Means is the primary map classification; DBSCAN is shown only as a supplementary experiment. Neither method evaluates mission requirements.">
            <div className="clustering-overview">
              <div className="clustering-overview-stat"><span>PRIMARY EARTH CLASSIFICATION</span><strong>K = 5</strong><small>K-MEANS · EXISTING LABELS</small></div>
              <div className="clustering-overview-stat"><span>LABELLED EARTH CELLS</span><strong>{data?.cells.length.toLocaleString() ?? "—"}</strong><small>FIVE ENVIRONMENTAL GROUPS</small></div>
              <div className="clustering-overview-note"><span className="live-dot" /> DESCRIPTIVE EARTH GROUPS</div>
            </div>
            <div className="clustering-method-grid">
              <section className="method-card method-kmeans">
                <div className="method-card-heading"><span className="method-step">01</span><span className="method-kind">PRIMARY CLASSIFICATION</span><strong><Layers3 size={15} /> K-MEANS / K=5</strong></div>
                <p>The existing K-Means model assigns each labelled cell to one of five groups in the saved transformed feature space. Select a group in the explorer to inspect its mapped cells and measurements.</p>
                <ClusterBars data={data} />
                <div className="chart-caption-note">Counts and shares use {data?.cells.length.toLocaleString() ?? "78,247"} K-Means-labelled cells. Cluster IDs are nominal.</div>
              </section>
              <section className="method-card method-dbscan">
                <div className="method-card-heading"><span className="method-step">02</span><span className="method-kind">SUPPLEMENTARY EXPERIMENT</span><strong><Orbit size={15} /> DBSCAN</strong></div>
                <p>DBSCAN identifies dense groups and marks low-density observations as noise (label −1). It does not replace the primary K-Means classification.</p>
                <MethodBars data={data} />
                <div className="chart-caption-note">Label summary: {dbscanCount.toLocaleString()} cells. Noise is shown as a label, not a mission judgement.</div>
              </section>
            </div>
            <details className="doc-technical"><summary>Algorithm settings and selection limits <ChevronDown size={15} /></summary><p>The available workspace records K-Means K=5 in the saved model/config filenames and DBSCAN output labels, but does not include a training report explaining parameter-selection criteria. This interface therefore reports the observed classifications and distributions only.</p></details>
          </Chapter>

          <Chapter id="families" number="06" eyebrow="THE K-MEANS PROFILES" title="Five environmental families" summary="The five labels describe distinct patterns in the Earth dataset. Compare their measured medians below, then open a dossier for distributions, geological composition, and data coverage.">
            <div className="family-intro">
              <div className="family-intro-mark"><Layers3 size={18} /></div>
              <div><span>HOW TO READ THESE PROFILES</span><p>Cluster names are concise descriptions of observed Earth conditions. They are not validated Moon or Mars analogues, and a cluster number does not indicate rank.</p></div>
              <strong>DENOMINATOR <i /> {data?.cells.length.toLocaleString() ?? "78,247"} CELLS</strong>
            </div>
            <div className="doc-cluster-grid">
              {CLUSTER_IDS.map((_, cluster) => (
                <ClusterProfileCard key={cluster} cluster={cluster} data={data} onOpen={setDossierCluster} onExplore={onExploreCluster} />
              ))}
            </div>
          </Chapter>

          <Chapter id="geology" number="07" eyebrow="THE SURFACE RECORD" title="Geological character" summary="The geological composition output counts the GLiM-labelled classes within each K-Means cluster. This is a separate characterization axis—not a feature used to train the saved K-Means labels.">
            <div className="doc-cluster-tabs" role="group" aria-label="Select a cluster for the geology chart">
              {CLUSTER_IDS.map((id, cluster) => (
                <button key={id} type="button" aria-pressed={geologyCluster === cluster} onClick={() => setGeologyCluster(cluster)} style={{ "--tab-color": COLORS[cluster] } as React.CSSProperties}>
                  <i />CLUSTER {id}
                </button>
              ))}
            </div>
            <div className="doc-geology-chart">
              <div className="doc-geology-heading"><div><span>CLUSTER {CLUSTER_IDS[geologyCluster]}</span><h3>Leading mapped classes</h3></div><strong>{percent(data?.geologyCoverage[geologyCluster]?.geologyCoveragePct, 2)}<small> GEOLOGY COVERAGE</small></strong></div>
              <div className="doc-geology-bars">
                {selectedGeology.map((row, index) => (
                  <div className="doc-geology-bar" key={row.code}>
                    <span>{row.className}<small>GLiM {row.code}</small></span>
                    <i><b style={{ width: `${row.pctOfAvailable}%`, backgroundColor: COLORS[geologyCluster], opacity: 1 - index * .085 }} /></i>
                    <strong>{percent(row.pctOfAvailable, 2)}</strong>
                    <small>{row.cellCount.toLocaleString()} cells</small>
                  </div>
                ))}
              </div>
              <p className="doc-small-note">Percentages are of the available geological cells in this cluster, as reported by <code>cluster_geological_composition.csv</code>. Short class codes are kept verbatim because the workspace does not contain a verified GLiM codebook for expanding them.</p>
            </div>
            <div className="doc-callout"><Layers3 size={16} /><span>Geology may matter for mineralogy, substrate, and field-science context. A mapped class is not a measurement of accessible resources, subsurface composition, or engineering suitability.</span></div>
            <button type="button" className="text-action doc-inline-action" onClick={() => onExploreCluster(geologyCluster)}>View this cluster on the global map <ArrowUpRight size={13} /></button>
          </Chapter>

          <Chapter id="completeness" number="08" eyebrow="WHAT IS NOT KNOWN" title="Completeness & uncertainty" summary="A percentage describes whether the source fields are present for a cell. It says nothing about whether that environment is good or bad for a mission.">
            <div className="coverage-denominator-card"><span>SELECT A CLUSTER</span><div className="doc-cluster-tabs compact-tabs">
              {CLUSTER_IDS.map((id, cluster) => (
                <button key={id} type="button" aria-pressed={geologyCluster === cluster} onClick={() => setGeologyCluster(cluster)} style={{ "--tab-color": COLORS[cluster] } as React.CSSProperties}>
                  <i />{id}
                </button>
              ))}
            </div></div>
            <div className="coverage-table">
              <div className="coverage-table-head"><span>FEATURE GROUP</span><span>COMPLETE CELLS</span><span>COMPLETENESS</span></div>
              {allCoverage.map((row) => (
                <div className="coverage-table-row" key={row.featureGroup}>
                  <span>{row.featureGroup.replace(/_/g, " ")}</span>
                  <strong>{row.completeCells.toLocaleString()} <small>/ {row.clusterCells.toLocaleString()}</small></strong>
                  <div><i><b style={{ width: `${row.completenessPct}%`, backgroundColor: COLORS[geologyCluster] }} /></i><strong>{percent(row.completenessPct, 2)}</strong></div>
                </div>
              ))}
            </div>
          </Chapter>

          <Chapter id="matching" number="09" eyebrow="EXPLORATORY DISCOVERY" title="Mission-specific screening" summary="Mars discovery uses transparent terrestrial aridity and vegetation filters. The lunar explorer supports independent Earth terrain, geology, and surface-context filters. Neither workflow validates an Earth region as a planetary analogue.">
            <div className="mission-roadmap">
              {[
                ["01", "Global clustering", "COMPLETE", true],
                ["02", "Cluster characterization", "COMPLETE", true],
                ["03", "Mission source inputs", "INTEGRATED", true],
                ["04", "Mars screening", "PROVISIONAL", false],
                ["05", "Lunar Earth context", "AVAILABLE", true],
              ].map(([step, title, status, complete]) => (
                <div className={`mission-roadmap-step ${complete ? "is-complete" : ""}`} key={step as string}>
                  <span>{step}</span><div><strong>{title}</strong><small>{status}</small></div><i>{complete ? <Check size={13} /> : <ChevronRight size={13} />}</i>
                </div>
              ))}
            </div>
            <div className="doc-callout mission-pending-callout"><BookOpen size={16} /><span><strong>Discovery results are exploratory, not validated planetary analogues.</strong> Mars filters use aridity classes, a vegetation threshold, and the master land fraction as transparent screening proxies. Missing Antarctic aridity is shown as unknown. Lunar filters describe terrestrial terrain, geology, and surface context only; Earth measurements do not establish lunar equivalence.</span></div>
          </Chapter>

          <footer className="doc-footer"><span>ASTROMATCH / FIELD NOTES</span><span>EXISTING EARTH OUTPUTS · {data?.cells.length.toLocaleString() ?? "—"} LABELLED CELLS</span><span>DISCOVERY OUTPUTS · EXPLORATORY</span></footer>
        </div>
      </div>
      {dossierCluster !== null && data && (
        <ClusterDossierModal
          cluster={dossierCluster}
          data={data}
          onClose={() => setDossierCluster(null)}
          onExplore={(cluster) => { setDossierCluster(null); onExploreCluster(cluster); }}
          onReadChapter={(cluster) => {
            setDossierCluster(null);
            onNavigate("documentary");
            window.setTimeout(() => document.getElementById(`cluster-profile-${cluster}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
          }}
        />
      )}
    </main>
  );
}
