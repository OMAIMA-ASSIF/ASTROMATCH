import { useCallback, useEffect, useRef } from "react";
import type { Cell } from "./data";

const CLUSTER_COLORS = ["#55d8d1", "#66b8ff", "#bddb7a", "#f0bf72", "#ad98ff"];
const TAU = Math.PI * 2;

type Props = {
  cells: Cell[];
  clusterFilter: number | null;
  selectedCell: Cell | null;
  onSelectCell: (cell: Cell) => void;
  markers?: GlobeMarker[];
  selectedMarkerId?: string | null;
  onSelectMarker?: (markerId: string) => void;
  className?: string;
  startingZoom?: number;
};

type View = { longitude: number; latitude: number; zoom: number };
export type GlobeMarker = { id: string; latitude: number; longitude: number; color?: string };

export default function GlobeCanvas({
  cells,
  clusterFilter,
  selectedCell,
  onSelectCell,
  markers,
  selectedMarkerId = null,
  onSelectMarker,
  className = "",
  startingZoom = 1,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ longitude: 8, latitude: -9, zoom: startingZoom });
  const dragRef = useRef<{ x: number; y: number; longitude: number; latitude: number } | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const onSelectRef = useRef(onSelectCell);
  const onSelectMarkerRef = useRef(onSelectMarker);
  onSelectRef.current = onSelectCell;
  onSelectMarkerRef.current = onSelectMarker;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);

    const cx = bounds.width / 2;
    const cy = bounds.height / 2;
    const radius = Math.max(20, Math.min(bounds.width * 0.39, bounds.height * 0.44)) * viewRef.current.zoom;
    const view = viewRef.current;
    const yaw = (view.longitude * Math.PI) / 180;
    const pitch = (view.latitude * Math.PI) / 180;
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const project = (longitude: number, latitude: number) => {
      const lon = ((longitude * Math.PI) / 180) - yaw;
      const lat = (latitude * Math.PI) / 180;
      const cosLat = Math.cos(lat);
      const x = cosLat * Math.sin(lon);
      const y = Math.sin(lat) * cosPitch - cosLat * Math.cos(lon) * sinPitch;
      const z = Math.sin(lat) * sinPitch + cosLat * Math.cos(lon) * cosPitch;
      return { x: cx + x * radius, y: cy - y * radius, z };
    };

    const glow = context.createRadialGradient(cx, cy, radius * 0.62, cx, cy, radius * 1.23);
    glow.addColorStop(0, "rgba(12, 118, 166, .16)");
    glow.addColorStop(0.58, "rgba(17, 100, 154, .08)");
    glow.addColorStop(1, "rgba(9, 28, 55, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(cx, cy, radius * 1.23, 0, TAU);
    context.fill();

    const ocean = context.createRadialGradient(cx - radius * 0.28, cy - radius * 0.32, 0, cx, cy, radius);
    ocean.addColorStop(0, "#0b314b");
    ocean.addColorStop(0.57, "#071b2b");
    ocean.addColorStop(1, "#020913");
    context.fillStyle = ocean;
    context.beginPath();
    context.arc(cx, cy, radius, 0, TAU);
    context.fill();

    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, TAU);
    context.clip();

    context.strokeStyle = "rgba(88, 192, 220, .115)";
    context.lineWidth = 0.65;
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      context.beginPath();
      for (let longitude = -180; longitude <= 180; longitude += 4) {
        const point = project(longitude, latitude);
        if (point.z > 0) {
          if (longitude === -180 || project(longitude - 4, latitude).z <= 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
      }
      context.stroke();
    }
    for (let longitude = -150; longitude <= 180; longitude += 30) {
      context.beginPath();
      for (let latitude = -88; latitude <= 88; latitude += 3) {
        const point = project(longitude, latitude);
        if (point.z > 0) {
          if (latitude === -88 || project(longitude, latitude - 3).z <= 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
      }
      context.stroke();
    }

    const cellsToDraw = clusterFilter === null ? cells : cells.filter((cell) => cell.cluster === clusterFilter);
    context.globalCompositeOperation = "lighter";
    for (const cell of cellsToDraw) {
      const point = project(cell.longitude, cell.latitude);
      if (point.z <= 0) continue;
      const depth = 0.72 + point.z * 0.28;
      context.globalAlpha = depth * (selectedCell?.latitude === cell.latitude && selectedCell.longitude === cell.longitude ? 1 : 0.82);
      context.fillStyle = CLUSTER_COLORS[cell.cluster] ?? "#65d9ee";
      const dotRadius = selectedCell?.latitude === cell.latitude && selectedCell.longitude === cell.longitude ? 3.4 : 1.22;
      context.beginPath();
      context.arc(point.x, point.y, dotRadius, 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";

    for (const marker of markers ?? []) {
      const point = project(marker.longitude, marker.latitude);
      if (point.z <= 0) continue;
      const markerColor = marker.color ?? "#f4a66f";
      context.globalAlpha = 0.94;
      context.fillStyle = markerColor;
      context.beginPath();
      context.arc(point.x, point.y, 2.4, 0, TAU);
      context.fill();
      context.strokeStyle = marker.id === selectedMarkerId ? "#fff2e5" : markerColor;
      context.lineWidth = marker.id === selectedMarkerId ? 1.8 : 1;
      context.beginPath();
      context.arc(point.x, point.y, marker.id === selectedMarkerId ? 8 : 5.5, 0, TAU);
      context.stroke();
    }
    context.globalAlpha = 1;

    if (selectedCell) {
      const point = project(selectedCell.longitude, selectedCell.latitude);
      if (point.z > 0) {
        context.strokeStyle = "#ecffff";
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(point.x, point.y, 7, 0, TAU);
        context.stroke();
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(point.x, point.y, 2, 0, TAU);
        context.fill();
      }
    }
    context.restore();

    context.strokeStyle = "rgba(109, 211, 239, .48)";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(cx, cy, radius, 0, TAU);
    context.stroke();
    context.strokeStyle = "rgba(105, 202, 231, .075)";
    context.lineWidth = 8;
    context.beginPath();
    context.arc(cx, cy, radius + 3, 0, TAU);
    context.stroke();
  }, [cells, clusterFilter, markers, selectedCell, selectedMarkerId]);

  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      viewRef.current.zoom = Math.max(0.75, Math.min(1.7, viewRef.current.zoom + (event.deltaY < 0 ? 0.06 : -0.06)));
      drawRef.current();
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    drawRef.current();
    return () => {
      observer.disconnect();
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    drawRef.current();
  }, [cells, clusterFilter, markers, selectedCell, selectedMarkerId]);

  const changeZoom = (step: number) => {
    viewRef.current.zoom = Math.max(0.75, Math.min(1.7, viewRef.current.zoom + step));
    drawRef.current();
  };

  return (
    <div className={`globe-wrap ${className}`}>
      <canvas
        ref={canvasRef}
        className="globe-canvas"
        aria-label="Interactive globe showing the K-Means clusters of 78,247 Earth cells"
        onPointerDown={(event) => {
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            longitude: viewRef.current.longitude,
            latitude: viewRef.current.latitude,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const scale = 90 / Math.max(160, event.currentTarget.clientWidth);
          viewRef.current.longitude = drag.longitude - (event.clientX - drag.x) * scale;
          viewRef.current.latitude = Math.max(-65, Math.min(65, drag.latitude + (event.clientY - drag.y) * scale));
          drawRef.current();
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          dragRef.current = null;
          if (!drag) return;
          const moved = Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
          if (moved < 5) {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const radius = Math.max(20, Math.min(rect.width * 0.39, rect.height * 0.44)) * viewRef.current.zoom;
            if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
              const yaw = (viewRef.current.longitude * Math.PI) / 180;
              const pitch = (viewRef.current.latitude * Math.PI) / 180;
              let nearestMarker: GlobeMarker | null = null;
              let nearestMarkerDistance = 13 ** 2;
              for (const marker of markers ?? []) {
                const lon = ((marker.longitude * Math.PI) / 180) - yaw;
                const lat = (marker.latitude * Math.PI) / 180;
                const cosLat = Math.cos(lat);
                const z = Math.sin(lat) * Math.sin(pitch) + cosLat * Math.cos(lon) * Math.cos(pitch);
                if (z <= 0) continue;
                const px = cx + cosLat * Math.sin(lon) * radius;
                const py = cy - (Math.sin(lat) * Math.cos(pitch) - cosLat * Math.cos(lon) * Math.sin(pitch)) * radius;
                const distance = (px - x) ** 2 + (py - y) ** 2;
                if (distance < nearestMarkerDistance) {
                  nearestMarkerDistance = distance;
                  nearestMarker = marker;
                }
              }
              if (nearestMarker) {
                onSelectMarkerRef.current?.(nearestMarker.id);
                drawRef.current();
                return;
              }
              let nearest: Cell | null = null;
              let nearestDistance = 22 ** 2;
              for (const cell of cells) {
                if (clusterFilter !== null && cell.cluster !== clusterFilter) continue;
                const lon = ((cell.longitude * Math.PI) / 180) - yaw;
                const lat = (cell.latitude * Math.PI) / 180;
                const cosLat = Math.cos(lat);
                const z = Math.sin(lat) * Math.sin(pitch) + cosLat * Math.cos(lon) * Math.cos(pitch);
                if (z <= 0) continue;
                const px = cx + cosLat * Math.sin(lon) * radius;
                const py = cy - (Math.sin(lat) * Math.cos(pitch) - cosLat * Math.cos(lon) * Math.sin(pitch)) * radius;
                const distance = (px - x) ** 2 + (py - y) ** 2;
                if (distance < nearestDistance) {
                  nearestDistance = distance;
                  nearest = cell;
                }
              }
              if (nearest) onSelectRef.current(nearest);
            }
          }
          drawRef.current();
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      />
      <div className="globe-controls" aria-label="Globe zoom controls">
        <button type="button" aria-label="Zoom in" onClick={() => changeZoom(0.12)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => changeZoom(-0.12)}>−</button>
        <button
          type="button"
          aria-label="Reset globe view"
          onClick={() => {
            viewRef.current = { longitude: 8, latitude: -9, zoom: startingZoom };
            drawRef.current();
          }}
        >↺</button>
      </div>
    </div>
  );
}
