import { useId, useState, type CSSProperties } from 'react';
import { Footprints } from 'lucide-react';
import type { Frame } from './types';
import { adjacentSites, currentSite, siteName } from './tabletop';
import { geographicEntityClusters, geographicLinks, geographicMarkers, geographicView, geographicViewport, REGION_OUTLINES } from './geography';
import { EntityIcon } from './EntityIcon';
import { entityPresenceNote, entityPresences } from './presence';
import './geographic.css';

export function GeographicMap({ frame, selectedId, selectedEntityId, onSelect, onSelectEntity, compact = false, recommendedSite }: {
  frame: Frame; selectedId?: string; selectedEntityId?: string; onSelect: (id: string) => void; onSelectEntity: (id: string) => void; compact?: boolean; recommendedSite?: string;
}) {
  const view = geographicView(frame);
  const mask = useId().replace(/:/g, '');
  const here = currentSite(frame);
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const entities = entityPresences(frame);
  const clusters = geographicEntityClusters(frame);
  const focused = clusters.find(cluster => cluster.key === expandedCluster);
  const markers = geographicMarkers(frame);
  const caption = view.places.some(place => place.id === selectedId) ? selectedId : here;
  const links = geographicLinks(frame, markers);
  const viewport = geographicViewport();
  return <section className={`geographic-map ${compact ? 'compact' : 'expanded'}`} data-testid="geographic-map" aria-label="冰宫空间地图">
    <div className="geographic-chart" style={{ '--map-ratio': viewport.width / viewport.height } as CSSProperties}>
      <svg viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} role="img" aria-label="已知冰宫建筑剖面" preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id={mask}>{view.regions.map(region => <polygon key={region} data-geographic-region={region} points={REGION_OUTLINES[region]} />)}</clipPath>
          <marker id={`${mask}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="#ffe6a2" strokeWidth="2" /></marker>
        </defs>
        <image href="/assets/palace-geographic-v3.png" width="900" height="1280" preserveAspectRatio="none" clipPath={`url(#${mask})`} />
        <g className="geographic-links" aria-label="已知地点通路">{links.map(link => <g key={`${link.start.id}:${link.end.id}`}>
          <line className="geographic-link-underlay" x1={link.start.x} y1={link.start.y} x2={link.end.x} y2={link.end.y} />
          <line
          data-map-connection={`${link.start.id}:${link.end.id}`} data-map-directions={link.forward && link.backward ? 'both' : link.forward ? 'forward' : 'backward'}
          x1={link.start.x} y1={link.start.y} x2={link.end.x} y2={link.end.y}>
          <title>{link.routes.map(route => `${siteName(route.start, frame)} → ${siteName(route.end, frame)}`).join('；')}</title>
        </line>
        {link.forward !== link.backward && <line data-map-arrow={link.forward ? 'forward' : 'backward'}
          x1={link.start.x + (link.end.x - link.start.x) * (link.forward ? 0.4 : 0.6)}
          y1={link.start.y + (link.end.y - link.start.y) * (link.forward ? 0.4 : 0.6)}
          x2={(link.start.x + link.end.x) / 2} y2={(link.start.y + link.end.y) / 2}
          markerEnd={`url(#${mask}-arrow)`} />}
        </g>)}</g>
      </svg>
      {markers.map(place => {
        const isHere = place.id === here;
        return <button key={place.id} className={`geographic-place ${isHere ? 'here' : ''} ${selectedId === place.id ? 'selected' : ''} ${place.id === recommendedSite ? 'recommended-location' : ''}`}
        style={{ left: `${(place.x - viewport.x) / viewport.width * 100}%`, top: `${(place.y - viewport.y) / viewport.height * 100}%` }}
        data-map-site={place.id} data-map-region={place.region} aria-current={isHere ? 'location' : undefined}
        aria-pressed={selectedId === place.id} aria-label={place.label} title={place.label} onClick={() => onSelect(place.id)}>
        {isHere ? <Footprints size={compact ? 10 : 18} /> : <span className="geographic-pin" />}
        {!compact && place.id === caption && <span className="geographic-name">{place.label}</span>}
      </button>; })}
      {clusters.map(cluster => <button key={cluster.key}
        className={`geographic-entity-marker ${cluster.presence} ${cluster.entities.some(item => item.id === selectedEntityId) ? 'selected' : ''} ${cluster.entities.length > 1 ? 'clustered' : ''}`}
        style={{ left: `${cluster.x / viewport.width * 100}%`, top: `${cluster.y / viewport.height * 100}%` }}
        data-entity-cluster={cluster.key} data-presence={cluster.presence}
        aria-label={cluster.entities.map(item => `${item.label} · ${entityPresenceNote(item, frame)}`).join('；')}
        title={cluster.entities.map(item => `${item.label} · ${entityPresenceNote(item, frame)}`).join('；')}
        aria-expanded={cluster.entities.length > 1 ? focused?.key === cluster.key : undefined}
        aria-controls={cluster.entities.length > 1 ? `${mask}-entities` : undefined}
        onClick={() => cluster.entities.length === 1 ? onSelectEntity(cluster.entities[0].id) : setExpandedCluster(cluster.key)}>
        <EntityIcon kind={cluster.kind} size={compact ? 10 : 14} />
        {cluster.entities.length > 1 && <span className="entity-count">{cluster.entities.length}</span>}
      </button>)}
    </div>
    <strong className="geographic-here" data-testid="geographic-location">{siteName(currentSite(frame), frame)} · 你在这里</strong>
    {!compact && <nav className="known-place-key" aria-label="地图上的已知地点">{markers.map(place => <button key={place.id} onClick={() => onSelect(place.id)} aria-pressed={selectedId === place.id} aria-current={place.id === here ? 'location' : undefined}>{place.label}{place.id === here ? ' · 你在这里' : ''}</button>)}</nav>}
    {compact && <div className="map-neighbors" aria-label="附近已知方向"><strong>附近方向</strong>{adjacentSites(frame).map(place => <button key={place.id} onClick={() => onSelect(place.id)}>{place.label}</button>)}</div>}
    {!!entities.length && <><div className="geographic-presence-key"><span>当前可见</span><span className="memory">上次所见</span></div>
      <details className="geographic-entities" open={expandedCluster !== null || !compact} onToggle={event => { if (!event.currentTarget.open) setExpandedCluster(null); else if (expandedCluster === null) setExpandedCluster('*'); }}>
        <summary>人物与物件 · {entities.length}</summary>
        <div id={`${mask}-entities`} className="geographic-entity-list">
          {focused && <button className="entity-list-all" onClick={() => setExpandedCluster('*')}>全部记录</button>}
          {(focused?.entities ?? entities).map(item => <button key={item.id} className={`entity-list-row ${item.presence}`} data-map-entity={item.id} data-presence={item.presence}
            aria-pressed={selectedEntityId === item.id} title={`${item.label} · ${entityPresenceNote(item, frame)}`} onClick={() => onSelectEntity(item.id)}>
            <EntityIcon kind={item.kind} /><span><strong>{item.label}</strong><small>{entityPresenceNote(item, frame)}</small></span>
          </button>)}
        </div>
      </details></>}
    {!compact && <><small className="geographic-boundary">连线为双向通路，箭头为单向通路</small>
      {view.unillustrated.length > 0 && <p>已知但尚未绘制：{view.unillustrated.map(place => place.label).join('、')}</p>}
      <small className="geographic-credit">地图改编：Pepijn &amp; Willem-Jan · CC BY-SA 4.0</small></>}
  </section>;
}
