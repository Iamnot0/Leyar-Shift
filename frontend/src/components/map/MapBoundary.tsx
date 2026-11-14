import { Component, type ReactNode } from 'react';

interface MapBoundaryState {
  failed: boolean;
}

/**
 * Catches a map that cannot start (no WebGL, or its code failed to download on a poor connection)
 * and says so in place, so the zone list beneath it still carries the view.
 */
export class MapBoundary extends Component<{ children: ReactNode }, MapBoundaryState> {
  state: MapBoundaryState = { failed: false };

  static getDerivedStateFromError(): MapBoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <p className="map-frame map-frame__fallback">The map could not be shown on this device. The list below gives the same information.</p>;
  }
}
